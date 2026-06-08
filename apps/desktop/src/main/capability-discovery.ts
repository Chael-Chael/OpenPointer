import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { AgentBackendId, CapabilityItem, CapabilitySnapshot, CapabilitySource } from '@openpointer/core';

const execFileAsync = promisify(execFile);

type CapabilityDiscoveryOptions = {
  homeDir: string;
  appDataDir?: string;
  ccSwitchDbPath?: string;
  sqliteCommand?: string;
  now?: () => number;
};

type DiscoveredCapability = CapabilityItem & {
  mergeKey: string;
};

type McpConfigSummary = {
  transportKind: 'local' | 'remote' | 'unknown';
  locator: string;
};

const EMPTY_SNAPSHOT: CapabilitySnapshot = {
  status: 'idle',
  sources: [],
  mcp: [],
  skills: []
};

export class CapabilityDiscoveryService {
  private snapshot: CapabilitySnapshot = EMPTY_SNAPSHOT;
  private inFlight: Promise<CapabilitySnapshot> | null = null;

  getSnapshot(): CapabilitySnapshot {
    return this.snapshot;
  }

  refresh(options: CapabilityDiscoveryOptions): Promise<CapabilitySnapshot> {
    if (this.inFlight) return this.inFlight;
    this.snapshot = { ...this.snapshot, status: 'scanning' };
    this.inFlight = discoverCapabilities(options)
      .then((snapshot) => {
        this.snapshot = snapshot;
        return snapshot;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}

export async function discoverCapabilities(options: CapabilityDiscoveryOptions): Promise<CapabilitySnapshot> {
  const errors: string[] = [];
  const items: DiscoveredCapability[] = [];

  try {
    items.push(...(await scanCcSwitchCapabilities(options)));
  } catch (error) {
    errors.push(`cc-switch: ${errorMessage(error)}`);
  }

  try {
    items.push(...(await scanNativeCapabilities(options)));
  } catch (error) {
    errors.push(`native: ${errorMessage(error)}`);
  }

  const merged = mergeCapabilityItems(items);
  const sources = unique([...merged.mcp, ...merged.skills].flatMap((item) => item.sources));
  return {
    status: errors.length > 0 && merged.mcp.length === 0 && merged.skills.length === 0 ? 'failed' : 'ready',
    lastScannedAt: (options.now ?? Date.now)(),
    sources,
    mcp: merged.mcp,
    skills: merged.skills,
    error: errors.length > 0 ? errors.join('; ') : undefined
  };
}

export async function scanNativeCapabilities(options: CapabilityDiscoveryOptions): Promise<DiscoveredCapability[]> {
  const home = options.homeDir;
  const appData = options.appDataDir ?? join(home, 'AppData', 'Roaming');
  const configScans = await Promise.allSettled([
    scanCodexMcpConfig(join(home, '.codex', 'config.toml')),
    scanJsonMcpConfig(join(appData, 'Claude', 'claude_desktop_config.json'), 'claude-agent'),
    scanJsonMcpConfig(join(home, '.claude', 'settings.json'), 'claude-agent'),
    scanJsonMcpConfig(join(home, '.config', 'opencode', 'opencode.json'), 'opencode'),
    scanJsonMcpConfig(join(home, '.openclaw', 'openclaw.json'), 'openclaw')
  ]);

  const skillScans = await Promise.allSettled([
    scanSkillRoot(join(home, '.codex', 'skills'), 'codex', 3),
    scanSkillRoot(join(home, '.codex', 'plugins', 'cache'), 'codex', 8),
    scanSkillRoot(join(home, '.claude', 'skills'), 'claude-agent', 3),
    scanSkillRoot(join(home, '.claude-desktop', 'skills'), 'claude-agent', 3),
    scanSkillRoot(join(home, '.config', 'opencode', 'skills'), 'opencode', 3),
    scanSkillRoot(join(home, '.openclaw', 'skills'), 'openclaw', 3),
    scanSkillRoot(join(home, '.agents', 'skills'), 'codex', 3)
  ]);

  return [...configScans, ...skillScans].flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
}

export function capabilitiesFromCcSwitchRows(mcpRows: unknown[], skillRows: unknown[]): DiscoveredCapability[] {
  return [...mcpRows.flatMap(ccSwitchMcpRow), ...skillRows.flatMap(ccSwitchSkillRow)];
}

export function mergeCapabilityItems(items: DiscoveredCapability[]): { mcp: CapabilityItem[]; skills: CapabilityItem[] } {
  const byKey = new Map<string, CapabilityItem>();
  for (const item of items) {
    const existing = byKey.get(item.mergeKey);
    if (!existing) {
      const { mergeKey: _mergeKey, ...publicItem } = item;
      byKey.set(item.mergeKey, {
        ...publicItem,
        backendIds: sortBackends(unique(publicItem.backendIds)),
        sources: sortSources(unique(publicItem.sources)),
        tags: unique(publicItem.tags ?? [])
      });
      continue;
    }
    const hadNativeSource = existing.sources.includes('native');
    existing.backendIds = sortBackends(unique([...existing.backendIds, ...item.backendIds]));
    existing.sources = sortSources(unique([...existing.sources, ...item.sources]));
    existing.tags = unique([...(existing.tags ?? []), ...(item.tags ?? [])]);
    if (!existing.description || (item.sources.includes('native') && !hadNativeSource)) {
      existing.description = item.description;
    }
  }

  const merged = [...byKey.values()].map((item) => ({
    ...item,
    tags: item.tags && item.tags.length > 0 ? item.tags : undefined
  }));
  merged.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return {
    mcp: merged.filter((item) => item.kind === 'mcp'),
    skills: merged.filter((item) => item.kind === 'skill')
  };
}

async function scanCcSwitchCapabilities(options: CapabilityDiscoveryOptions): Promise<DiscoveredCapability[]> {
  const dbPath = options.ccSwitchDbPath ?? join(options.homeDir, '.cc-switch', 'cc-switch.db');
  if (!existsSync(dbPath)) return [];
  const sqlite = options.sqliteCommand ?? 'sqlite3';
  const [mcpRows, skillRows] = await Promise.all([
    querySqliteJson(sqlite, dbPath, 'SELECT * FROM mcp_servers;').catch(() => []),
    querySqliteJson(sqlite, dbPath, 'SELECT * FROM skills;').catch(() => [])
  ]);
  return capabilitiesFromCcSwitchRows(mcpRows, skillRows);
}

async function querySqliteJson(sqliteCommand: string, dbPath: string, query: string): Promise<unknown[]> {
  const { stdout } = await execFileAsync(sqliteCommand, ['-json', dbPath, query], {
    encoding: 'utf8',
    timeout: 2500,
    maxBuffer: 1024 * 1024
  });
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

function ccSwitchMcpRow(row: unknown): DiscoveredCapability[] {
  if (!isRecord(row)) return [];
  const name = text(row.name) || text(row.id);
  if (!name) return [];
  const backends = ccSwitchBackends(row, 'mcp');
  if (backends.length === 0) return [];
  const tags = tagsFromValue(row.tags);
  const config = jsonRecord(row.server_config);
  const summary = summarizeMcpConfig(config);
  return [
    mcpItem({
      name,
      description: text(row.description),
      backendIds: backends,
      sources: ['cc-switch'],
      tags,
      summary
    })
  ];
}

function ccSwitchSkillRow(row: unknown): DiscoveredCapability[] {
  if (!isRecord(row)) return [];
  const name = text(row.name) || text(row.id) || text(row.directory);
  if (!name) return [];
  const backends = ccSwitchBackends(row, 'skill');
  if (backends.length === 0) return [];
  return [
    skillItem({
      name,
      description: text(row.description),
      directory: text(row.directory) || name,
      backendIds: backends,
      sources: ['cc-switch']
    })
  ];
}

function ccSwitchBackends(row: Record<string, unknown>, kind: 'mcp' | 'skill'): AgentBackendId[] {
  const backends: AgentBackendId[] = [];
  if (enabled(row.enabled_claude)) backends.push('claude-agent');
  if (enabled(row.enabled_codex)) backends.push('codex');
  if (enabled(row.enabled_opencode)) backends.push('opencode');
  if (enabled(row.enabled_hermes)) backends.push('hermes');
  if (kind === 'skill' && enabled(row.enabled_openclaw)) backends.push('openclaw');
  return backends;
}

async function scanCodexMcpConfig(path: string): Promise<DiscoveredCapability[]> {
  const content = await readOptionalText(path);
  if (!content) return [];
  return parseCodexMcpServers(content).map((server) =>
    mcpItem({
      name: server.name,
      backendIds: ['codex'],
      sources: ['native'],
      summary: summarizeMcpConfig(server.config)
    })
  );
}

async function scanJsonMcpConfig(path: string, backend: AgentBackendId): Promise<DiscoveredCapability[]> {
  const root = await readOptionalJson(path);
  if (!isRecord(root)) return [];
  const container = isRecord(root.mcpServers) ? root.mcpServers : isRecord(root.mcp) ? root.mcp : undefined;
  if (!container) return [];
  const items: DiscoveredCapability[] = [];
  for (const [name, config] of Object.entries(container)) {
    if (isRecord(config) && config.enabled === false) continue;
    items.push(
      mcpItem({
        name,
        backendIds: [backend],
        sources: ['native'],
        summary: summarizeMcpConfig(config)
      })
    );
  }
  return items;
}

function parseCodexMcpServers(content: string): Array<{ name: string; config: Record<string, unknown> }> {
  const servers: Array<{ name: string; config: Record<string, unknown> }> = [];
  let current: { name: string; config: Record<string, unknown> } | null = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const table = line.match(/^\[mcp_servers\.(.+)]$/);
    const tableName = table?.[1];
    if (tableName) {
      current = { name: stripQuotes(tableName.trim()), config: {} };
      servers.push(current);
      continue;
    }
    if (!current || !line || line.startsWith('#')) continue;
    const keyValue = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.+)$/);
    const key = keyValue?.[1];
    const rawValue = keyValue?.[2];
    if (!key || rawValue === undefined) continue;
    current.config[key] = parseTomlScalar(rawValue);
  }
  return servers;
}

async function scanSkillRoot(root: string, backend: AgentBackendId, maxDepth: number): Promise<DiscoveredCapability[]> {
  const files = await findSkillFiles(root, maxDepth);
  const items: DiscoveredCapability[] = [];
  for (const file of files) {
    const content = await readOptionalText(file);
    if (!content) continue;
    const directory = dirname(file);
    const metadata = parseSkillMetadata(content, basename(directory));
    items.push(
      skillItem({
        name: metadata.name,
        description: metadata.description,
        directory,
        backendIds: [backend],
        sources: ['native']
      })
    );
  }
  return items;
}

async function findSkillFiles(root: string, maxDepth: number): Promise<string[]> {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth < 0 || found.length >= 500) return;
    const entries = await safeReaddir(dir);
    if (entries.some((entry) => entry.name === 'SKILL.md' && entry.isFile())) {
      found.push(join(dir, 'SKILL.md'));
      return;
    }
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !shouldSkipDirectory(entry.name))
        .map((entry) => walk(join(dir, entry.name), depth - 1))
    );
  }
  await walk(root, maxDepth);
  return found;
}

function parseSkillMetadata(content: string, fallbackName: string): { name: string; description?: string } {
  const frontMatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontMatterBody = frontMatter?.[1];
  if (!frontMatterBody) return { name: fallbackName };
  const values = new Map<string, string>();
  for (const line of frontMatterBody.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+)$/);
    const key = match?.[1];
    const value = match?.[2];
    if (!key || value === undefined) continue;
    values.set(key, stripQuotes(value.trim()));
  }
  return {
    name: values.get('name') || fallbackName,
    description: values.get('description')
  };
}

function mcpItem(args: {
  name: string;
  description?: string;
  backendIds: AgentBackendId[];
  sources: CapabilitySource[];
  tags?: string[];
  summary: McpConfigSummary;
}): DiscoveredCapability {
  const name = args.name.trim();
  const mergeKey = ['mcp', normalizeKey(name), args.summary.transportKind, normalizeKey(args.summary.locator || name)].join(':');
  return {
    id: stableId(mergeKey),
    kind: 'mcp',
    name,
    description: args.description,
    backendIds: args.backendIds,
    sources: args.sources,
    tags: args.tags,
    mergeKey
  };
}

function skillItem(args: {
  name: string;
  description?: string;
  directory: string;
  backendIds: AgentBackendId[];
  sources: CapabilitySource[];
}): DiscoveredCapability {
  const name = args.name.trim();
  const mergeKey = ['skill', normalizeKey(name), normalizeKey(basename(args.directory) || name)].join(':');
  return {
    id: stableId(mergeKey),
    kind: 'skill',
    name,
    description: args.description,
    backendIds: args.backendIds,
    sources: args.sources,
    mergeKey
  };
}

function summarizeMcpConfig(config: unknown): McpConfigSummary {
  if (!isRecord(config)) return { transportKind: 'unknown', locator: '' };
  const url = text(config.url);
  if (url) return { transportKind: 'remote', locator: urlOrigin(url) || url };
  const command = commandName(config.command);
  if (command) return { transportKind: 'local', locator: command };
  const type = text(config.type).toLowerCase();
  if (type.includes('remote') || type.includes('http')) return { transportKind: 'remote', locator: '' };
  if (type.includes('local') || type.includes('stdio')) return { transportKind: 'local', locator: '' };
  return { transportKind: 'unknown', locator: '' };
}

function commandName(value: unknown): string {
  if (Array.isArray(value)) return basename(text(value[0]));
  return basename(text(value));
}

function parseTomlScalar(value: string): unknown {
  const trimmed = value.replace(/\s+#.*$/, '').trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return [...trimmed.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return stripQuotes(trimmed);
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function readOptionalJson(path: string): Promise<unknown> {
  const content = await readOptionalText(path);
  if (!content) return null;
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}

async function safeReaddir(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function shouldSkipDirectory(name: string): boolean {
  return name === 'node_modules' || name === '.git' || name === 'dist' || name === 'build';
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function tagsFromValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (typeof value !== 'string') return [];
  const parsed = jsonRecordOrArray(value);
  if (Array.isArray(parsed)) return parsed.map(text).filter(Boolean);
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function jsonRecordOrArray(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function enabled(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, '').trim();
}

function urlOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, '-').replace(/^-+|-+$/g, '');
}

function stableId(value: string): string {
  return value.replace(/[^a-z0-9\u4e00-\u9fa5]+/giu, '-').replace(/^-+|-+$/g, '') || 'capability';
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function sortSources(items: CapabilitySource[]): CapabilitySource[] {
  const order: CapabilitySource[] = ['native', 'cc-switch'];
  return [...items].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function sortBackends(items: AgentBackendId[]): AgentBackendId[] {
  const order: AgentBackendId[] = ['claude-agent', 'codex', 'opencode', 'openclaw', 'hermes', 'local-vlm', 'mock', 'auto'];
  return [...items].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
