import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { AgentBackendId, CapabilityItem, CapabilitySnapshot, CapabilitySource, SkillExecutionTemplate } from '@openpointer/core';

const execFileAsync = promisify(execFile);

type CapabilityDiscoveryOptions = {
  homeDir: string;
  appDataDir?: string;
  ccSwitchDbPath?: string;
  sqliteCommand?: string;
  now?: () => number;
};

export type DiscoveredCapability = CapabilityItem & {
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

  items.push(...builtInSkillCapabilities());

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
    existing.triggers = unique([...(existing.triggers ?? []), ...(item.triggers ?? [])]);
    existing.requiredTools = unique([...(existing.requiredTools ?? []), ...(item.requiredTools ?? [])]);
    existing.executionTemplate ??= item.executionTemplate;
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
  tags?: string[];
  triggers?: string[];
  requiredTools?: string[];
  executionTemplate?: SkillExecutionTemplate;
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
    tags: args.tags,
    triggers: args.triggers,
    requiredTools: args.requiredTools,
    executionTemplate: args.executionTemplate,
    mergeKey
  };
}

export function builtInSkillCapabilities(): DiscoveredCapability[] {
  const backends: AgentBackendId[] = ['claude-agent', 'codex', 'opencode', 'openclaw', 'hermes'];
  return [
    skillItem({
      name: 'openpointer.generic-cua',
      description: 'Operate grounded desktop UI elements through OpenPointer CUA with approval and verification.',
      directory: 'openpointer.generic-cua',
      backendIds: backends,
      sources: ['built-in'],
      tags: ['desktop', 'cua', 'click', 'type', 'scroll', 'drag', 'automation', '桌面', '操作'],
      triggers: ['click', 'type', 'fill', 'open', 'move', 'drag', 'scroll', '点击', '输入', '打开', '操作'],
      requiredTools: ['cua:get_window_state', 'cua:click', 'cua:type_text', 'cua:press_key', 'cua:scroll', 'cua:drag'],
      executionTemplate: {
        objective: 'Plan against CUA element indices and execute only through approved CUA tools.',
        steps: [
          'Bind the user instruction to target/destination entity bindings.',
          'Read current UI state with get_window_state when the target is ambiguous.',
          'Execute one small desktop action at a time through the CUA broker.',
          'Re-read UI state after state-changing tools and compare against the requested end state.'
        ],
        verification: {
          strategy: 'uia-state',
          successSignals: ['target element changed as requested', 'requested text/value appears', 'no unexpected window/app change']
        }
      }
    }),
    skillItem({
      name: 'openpointer.text-selection',
      description: 'Read, transform, copy, or insert text around the active selection or pointer target.',
      directory: 'openpointer.text-selection',
      backendIds: backends,
      sources: ['built-in'],
      tags: ['selection', 'text', 'rewrite', 'summarize', 'insert', 'selected', '选中文本', '改写'],
      triggers: ['selected text', 'selection', 'rewrite', 'summarize', 'insert text', '选中', '改写', '总结', '插入'],
      requiredTools: ['cua:read_selected_text', 'cua:insert_text'],
      executionTemplate: {
        objective: 'Prefer selected text and explicit insertion targets over screenshot-only interpretation.',
        steps: [
          'Read selected text when the envelope does not already contain it.',
          'Transform the text according to the instruction.',
          'Insert only after the target or insertion point is clear.',
          'Verify by reading the selection or nearby UI state after insertion.'
        ],
        verification: {
          strategy: 'read-selection',
          successSignals: ['inserted text matches the requested transformation', 'selection remains in the expected app/window']
        }
      }
    }),
    skillItem({
      name: 'openpointer.browser',
      description: 'Use browser page/DOM tools and CUA fallback for web navigation, extraction, and form tasks.',
      directory: 'openpointer.browser',
      backendIds: backends,
      sources: ['built-in'],
      tags: ['browser', 'web', 'chrome', 'edge', 'dom', 'form', '网页', '浏览器'],
      triggers: ['browser', 'webpage', 'link', 'tab', 'form', 'search', 'chrome', 'edge', '网页', '链接'],
      requiredTools: ['cua:page', 'cua:get_window_state', 'cua:click', 'cua:type_text'],
      executionTemplate: {
        objective: 'Prefer DOM/page tools for web semantics, with CUA only for unavailable page actions.',
        steps: [
          'Use page tools to inspect DOM text and element identities when available.',
          'Choose links, fields, and buttons by semantic labels instead of pixels.',
          'Use CUA fallback for browser chrome or non-DOM UI.',
          'Verify navigation or form state after each state-changing step.'
        ],
        verification: {
          strategy: 'recapture',
          successSignals: ['expected URL/title/content is visible', 'form field contains requested text', 'target page state changed']
        }
      }
    }),
    skillItem({
      name: 'openpointer.document-pdf',
      description: 'Handle document, PDF, paper, and office workflows using selection text, screenshots, and document skills.',
      directory: 'openpointer.document-pdf',
      backendIds: backends,
      sources: ['built-in'],
      tags: ['document', 'pdf', 'paper', 'word', 'office', '论文', '文档', '段落'],
      triggers: ['pdf', 'paper', 'document', 'paragraph', 'word', 'office', '论文', '文档', '段落', '摘要'],
      requiredTools: ['document-skill', 'cua:read_selected_text', 'cua:insert_text'],
      executionTemplate: {
        objective: 'Ground document tasks in selected text or document-specific tooling before using screenshots.',
        steps: [
          'Prefer selected text, document APIs, or PDF extraction over OCR from screenshots.',
          'Summarize, rewrite, or transform only the requested region.',
          'Insert edits through a confirmed insertion target.',
          'Verify by reading back selected text or visible document state.'
        ],
        verification: {
          strategy: 'read-selection',
          successSignals: ['edited passage appears in the target document', 'source text meaning is preserved when requested']
        }
      }
    }),
    skillItem({
      name: 'openpointer.code',
      description: 'Route code, repo, diff, terminal, and error tasks to coding agents with tests or static checks.',
      directory: 'openpointer.code',
      backendIds: ['codex', 'opencode', 'openclaw', 'claude-agent'],
      sources: ['built-in'],
      tags: ['code', 'repo', 'diff', 'error', 'terminal', 'test', '代码', '报错', '测试'],
      triggers: ['code', 'bug', 'error', 'stack trace', 'diff', 'test', 'build', 'repo', '代码', '报错', '修复'],
      requiredTools: ['coding-agent', 'shell', 'filesystem'],
      executionTemplate: {
        objective: 'Use a coding backend for repository-aware changes and verify with available checks.',
        steps: [
          'Identify the repo, file, diff, terminal, or error context from the pointer bindings.',
          'Inspect relevant files before editing.',
          'Make minimal changes through the coding backend.',
          'Run targeted tests, typechecks, or static checks when available.'
        ],
        verification: {
          strategy: 'test-command',
          successSignals: ['targeted tests pass', 'typecheck/lint passes or failures are reported with cause']
        }
      }
    }),
    skillItem({
      name: 'openpointer.image-region',
      description: 'Analyze or transform a selected screenshot/image region and ask for clarification when visual grounding is weak.',
      directory: 'openpointer.image-region',
      backendIds: backends,
      sources: ['built-in'],
      tags: ['image', 'screenshot', 'region', 'vision', '图片', '截图', '区域'],
      triggers: ['image', 'screenshot', 'region', 'photo', 'visual', '图片', '截图', '区域'],
      requiredTools: ['vision-model', 'cua:get_window_state'],
      executionTemplate: {
        objective: 'Use the selected image/screenshot crop as visual evidence and avoid unsupported object assumptions.',
        steps: [
          'Anchor the analysis to the provided crop or image entity.',
          'State uncertainty when the object/region is visually ambiguous.',
          'Use structured UI evidence when available before image-only reasoning.',
          'Verify any requested desktop action with CUA after execution.'
        ],
        verification: {
          strategy: 'recapture',
          successSignals: ['requested visual region remains the focus', 'post-action screenshot reflects the expected visual state']
        }
      }
    })
  ];
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
  const order: CapabilitySource[] = ['built-in', 'native', 'cc-switch'];
  return [...items].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function sortBackends(items: AgentBackendId[]): AgentBackendId[] {
  const order: AgentBackendId[] = ['claude-agent', 'codex', 'opencode', 'openclaw', 'hermes', 'local-vlm', 'mock', 'auto'];
  return [...items].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
