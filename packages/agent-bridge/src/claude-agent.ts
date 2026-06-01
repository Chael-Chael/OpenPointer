import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AgentContextEnvelope, AgentEvent } from '@openmagicpointer/core';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { buildAgentInput, buildAgentInstructions, buildToolDiscoveryEvent } from './prompt.js';
import type { AgentBridge, AgentRunOptions, ApprovalDecision, ClaudeAgentBridgeConfig } from './types.js';

let cachedClaudePath: string | undefined;

type PendingToolApproval = {
  resolve(decision: ApprovalDecision): void;
  timeout: NodeJS.Timeout;
};

type PermissionRule = {
  toolName: string;
  ruleContent?: string;
};

type PermissionStore = {
  version: 1;
  rules: PermissionRule[];
};

const CUA_AGENT_TOOLS = [
  'list_windows',
  'get_window_state',
  'click',
  'double_click',
  'right_click',
  'type_text',
  'press_key',
  'hotkey',
  'scroll',
  'drag',
  'set_value'
];

class EventQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value: item });
    else this.items.push(item);
  }

  next(): Promise<IteratorResult<T>> {
    if (this.items.length > 0) return Promise.resolve({ done: false, value: this.items.shift() as T });
    if (this.closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  }
}

type PermissionResult =
  | { behavior: 'allow'; toolUseID?: string; updatedPermissions?: unknown[]; decisionClassification?: 'user_temporary' | 'user_permanent' }
  | { behavior: 'deny'; message: string; interrupt?: boolean; toolUseID?: string; decisionClassification?: 'user_reject' };

type PermissionRequestOptions = {
  toolUseID?: string;
  suggestions?: unknown[];
  title?: string;
  displayName?: string;
  description?: string;
};

// Hardcoded default paths per platform (npm global install locations)
const DEFAULT_PATHS: Record<string, string[]> = {
  win32: [
    join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    join(process.env.LOCALAPPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    join(process.env.LOCALAPPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    'C:\\Program Files\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\cli.js',
    'C:\\Program Files\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'
  ],
  darwin: [
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    join(process.env.HOME || '', '.npm-global', 'bin', 'claude'),
    join(process.env.HOME || '', '.nvm', 'current', 'bin', 'claude')
  ],
  linux: [
    '/usr/local/bin/claude',
    join(process.env.HOME || '', '.npm-global', 'bin', 'claude'),
    join(process.env.HOME || '', '.nvm', 'current', 'bin', 'claude')
  ]
};

export class ClaudeAgentBridge implements AgentBridge {
  id = 'claude-agent' as const;
  private pendingToolApprovals = new Map<string, PendingToolApproval>();
  private persistedPermissionRules: PermissionRule[] | null = null;
  private resolvedPermissionResults = new Map<string, PermissionResult>();
  private inFlightPermissionResults = new Map<string, Promise<PermissionResult>>();
  private approvalEvents: EventQueue<AgentEvent> | null = null;
  private permissionServer: Server | null = null;
  private permissionEndpoint: string | null = null;
  private permissionToken = randomUUID();

  constructor(private readonly config: ClaudeAgentBridgeConfig | undefined) {}

  async *run(envelope: AgentContextEnvelope, options: AgentRunOptions = {}): AsyncIterable<AgentEvent> {
    if (!this.config?.enabled) {
      yield { type: 'run.failed', error: 'Claude Code bridge is disabled.', recoverable: true };
      return;
    }
    const sdk = this.config.sdk ?? (await loadClaudeSdk());
    if (!sdk) {
      yield { type: 'run.failed', error: '@anthropic-ai/claude-agent-sdk is not installed in this workspace.', recoverable: true };
      return;
    }

    const claudePath = findClaudeExecutable(this.config);
    yield buildToolDiscoveryEvent(envelope);
    const runId = `claude-agent-${Date.now()}`;
    yield { type: 'run.started', runId, backend: this.id };

    const controller = new AbortController();
    if (options.signal) {
      if (options.signal.aborted) controller.abort(options.signal.reason);
      else options.signal.addEventListener('abort', () => controller.abort(options.signal!.reason), { once: true });
    }
    const approvalEvents = new EventQueue<AgentEvent>();
    this.approvalEvents = approvalEvents;
    this.resolvedPermissionResults.clear();
    this.inFlightPermissionResults.clear();
    const permissionEnv = await this.ensurePermissionServer();

    try {
      const sdkMessages = sdk.query({
        prompt: `${buildAgentInstructions(envelope)}\n\n${buildAgentInput(envelope)}`,
        options: {
          allowedTools: allowedToolsForEnvelope(envelope),
          canUseTool: (toolName: string, input: Record<string, unknown>, permissionOptions: Record<string, unknown>) =>
            this.requestToolApproval(toolName, input, permissionOptions, approvalEvents),
          includePartialMessages: true,
          maxTurns: 12,
          mcpServers: mcpServersForEnvelope(envelope),
          abortController: controller,
          env: { ...buildSdkEnv(this.config), ...permissionEnv },
          pathToClaudeCodeExecutable: claudePath,
          ...(this.config?.model ? { model: this.config.model } : {}),
          ...(this.config?.effort ? { effort: this.config.effort } : {})
        }
      });

      for await (const raw of mergeSdkMessagesWithEvents(sdkMessages, approvalEvents)) {
        yield mapClaudeMessage(raw);
      }
      yield { type: 'run.completed' };
    } catch (error) {
      yield { type: 'run.failed', error: error instanceof Error ? error.message : String(error), recoverable: true };
    } finally {
      approvalEvents.close();
      this.approvalEvents = null;
      this.denyPendingToolApprovals();
    }
  }

  async approve(approvalId: string, decision: ApprovalDecision): Promise<void> {
    const pending = this.pendingToolApprovals.get(approvalId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingToolApprovals.delete(approvalId);
    pending.resolve(decision);
  }

  private async requestToolApproval(
    toolName: string,
    input: Record<string, unknown>,
    permissionOptions: PermissionRequestOptions | Record<string, unknown>,
    approvalEvents: EventQueue<AgentEvent>
  ): Promise<PermissionResult> {
    const toolUseID = typeof permissionOptions.toolUseID === 'string' ? permissionOptions.toolUseID : undefined;
    const permissionKey = toolUseID || `${toolName}:${JSON.stringify(input)}`;
    const updatedPermissions = Array.isArray(permissionOptions.suggestions) ? permissionOptions.suggestions : undefined;
    if (this.resolvedPermissionResults.has(permissionKey)) {
      return this.resolvedPermissionResults.get(permissionKey) as PermissionResult;
    }
    if (this.inFlightPermissionResults.has(permissionKey)) {
      return this.inFlightPermissionResults.get(permissionKey) as Promise<PermissionResult>;
    }
    if (this.isPersistentlyAllowed(toolName, input)) {
      return { behavior: 'allow', toolUseID, decisionClassification: 'user_permanent' };
    }
    const id = toolUseID || `claude-approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const title = typeof permissionOptions.title === 'string' ? permissionOptions.title : '';
    const description = typeof permissionOptions.description === 'string' ? permissionOptions.description : '';
    const reason = [title || `Claude wants to use ${formatToolName(toolName)}.`, description].filter(Boolean).join('\n');

    approvalEvents.push({
      type: 'approval.requested',
      id,
      reason,
      tool: typeof permissionOptions.displayName === 'string' ? permissionOptions.displayName : toolName
    });

    const resultPromise = new Promise<PermissionResult>((resolve) => {
      const timeout = setTimeout(() => {
        if (!this.pendingToolApprovals.has(id)) return;
        this.pendingToolApprovals.delete(id);
        resolve({
          behavior: 'deny',
          message: `Timed out waiting for permission for ${formatToolName(toolName)}.`,
          interrupt: true,
          toolUseID,
          decisionClassification: 'user_reject'
        });
      }, 120000);
      this.pendingToolApprovals.set(id, {
        resolve: (decision) => {
          if (decision === 'always_allow') {
            this.rememberPersistentAlwaysAllowed(toolName, input, updatedPermissions);
            resolve({ behavior: 'allow', toolUseID, updatedPermissions, decisionClassification: 'user_permanent' });
            return;
          }
          if (decision === 'approve') {
            resolve({ behavior: 'allow', toolUseID, decisionClassification: 'user_temporary' });
            return;
          }
          resolve({
            behavior: 'deny',
            message: `User denied permission for ${formatToolName(toolName)}.`,
            interrupt: true,
            toolUseID,
            decisionClassification: 'user_reject'
          });
        },
        timeout
      });
    });
    this.inFlightPermissionResults.set(permissionKey, resultPromise);
    const result = await resultPromise;
    this.inFlightPermissionResults.delete(permissionKey);
    this.resolvedPermissionResults.set(permissionKey, result);
    return result;
  }

  private denyPendingToolApprovals(): void {
    for (const [id, pending] of this.pendingToolApprovals) {
      clearTimeout(pending.timeout);
      this.pendingToolApprovals.delete(id);
      pending.resolve('deny');
    }
  }

  private isPersistentlyAllowed(toolName: string, input: Record<string, unknown>): boolean {
    return this.loadPersistentPermissionRules().some((rule) => permissionRuleMatches(rule, toolName, input));
  }

  private rememberPersistentAlwaysAllowed(toolName: string, input: Record<string, unknown>, updates: unknown[] | undefined): void {
    const storePath = this.config?.permissionStorePath;
    if (!storePath) return;
    const nextRules = permissionRulesFromUpdates(updates);
    if (nextRules.length === 0) {
      nextRules.push({ toolName, ruleContent: typeof input.command === 'string' ? input.command : undefined });
    }
    const rules = this.loadPersistentPermissionRules();
    let changed = false;
    for (const rule of nextRules) {
      if (!rules.some((existing) => existing.toolName === rule.toolName && existing.ruleContent === rule.ruleContent)) {
        rules.push(rule);
        changed = true;
      }
    }
    if (!changed) return;
    this.persistedPermissionRules = rules;
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, JSON.stringify({ version: 1, rules } satisfies PermissionStore, null, 2), 'utf8');
  }

  private loadPersistentPermissionRules(): PermissionRule[] {
    if (this.persistedPermissionRules) return this.persistedPermissionRules;
    const storePath = this.config?.permissionStorePath;
    if (!storePath || !existsSync(storePath)) {
      this.persistedPermissionRules = [];
      return this.persistedPermissionRules;
    }
    try {
      const parsed = JSON.parse(readFileSync(storePath, 'utf8'));
      if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.rules)) {
        this.persistedPermissionRules = [];
        return this.persistedPermissionRules;
      }
      this.persistedPermissionRules = parsed.rules.filter(isPermissionRule);
      return this.persistedPermissionRules;
    } catch {
      this.persistedPermissionRules = [];
      return this.persistedPermissionRules;
    }
  }

  private async ensurePermissionServer(): Promise<Record<string, string>> {
    if (!this.permissionServer || !this.permissionEndpoint) {
      this.permissionToken = randomUUID();
      this.permissionServer = createServer((req, res) => {
        void this.handlePermissionRequest(req, res);
      });
      await new Promise<void>((resolve, reject) => {
        this.permissionServer?.once('error', reject);
        this.permissionServer?.listen(0, '127.0.0.1', () => resolve());
      });
      const address = this.permissionServer.address() as AddressInfo;
      this.permissionEndpoint = `http://127.0.0.1:${address.port}/permission`;
    }
    return {
      OPENMAGICPOINTER_SESSION: '1',
      OPENMAGICPOINTER_PERMISSION_URL: this.permissionEndpoint,
      OPENMAGICPOINTER_PERMISSION_TOKEN: this.permissionToken
    };
  }

  private async handlePermissionRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.method !== 'POST' || req.url !== '/permission') {
        sendJson(res, 404, { error: 'Not found.' });
        return;
      }
      if (req.headers.authorization !== `Bearer ${this.permissionToken}`) {
        sendJson(res, 401, { error: 'Unauthorized.' });
        return;
      }
      const body = await readJson(req);
      const event = typeof body.event === 'string' ? body.event : '';
      const toolName = typeof body.tool_name === 'string' ? body.tool_name : '';
      const input = isRecord(body.tool_input) ? body.tool_input : {};
      if (!toolName) {
        sendJson(res, 400, { error: 'Missing tool_name.' });
        return;
      }
      const approvalEvents = this.approvalEvents;
      if (!approvalEvents) {
        sendJson(res, 204, {});
        return;
      }
      const result = await this.requestToolApproval(
        toolName,
        input,
        {
          toolUseID: typeof body.tool_use_id === 'string' ? body.tool_use_id : undefined,
          suggestions: Array.isArray(body.permission_suggestions) ? body.permission_suggestions : undefined,
          title: typeof body.title === 'string' ? body.title : undefined,
          displayName: typeof body.display_name === 'string' ? body.display_name : undefined,
          description: typeof body.description === 'string' ? body.description : undefined
        },
        approvalEvents
      );
      sendJson(res, 200, hookOutputForPermissionResult(event, result));
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

async function* mergeSdkMessagesWithEvents(sdkMessages: AsyncIterable<unknown>, eventQueue: EventQueue<AgentEvent>): AsyncIterable<unknown> {
  const sdkIterator = sdkMessages[Symbol.asyncIterator]();
  let sdkNext = sdkIterator.next();
  let eventNext = eventQueue.next();

  while (true) {
    const result = await Promise.race([
      sdkNext.then((value) => ({ source: 'sdk' as const, value })),
      eventNext.then((value) => ({ source: 'event' as const, value }))
    ]);

    if (result.source === 'event') {
      eventNext = eventQueue.next();
      if (!result.value.done) yield result.value.value;
      continue;
    }

    if (result.value.done) {
      eventQueue.close();
      return;
    }
    sdkNext = sdkIterator.next();
    yield result.value.value;
  }
}

function formatToolName(toolName: string): string {
  return toolName.replace(/^mcp__/, '').replace(/__/g, ' / ');
}

function hookOutputForPermissionResult(event: string, result: PermissionResult): unknown {
  if (event === 'PreToolUse') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: result.behavior === 'allow' ? 'allow' : 'deny',
        ...(result.behavior === 'deny' ? { permissionDecisionReason: result.message } : {})
      }
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision:
        result.behavior === 'allow'
          ? {
              behavior: 'allow',
              ...(result.updatedPermissions ? { updatedPermissions: result.updatedPermissions } : {})
            }
          : {
              behavior: 'deny',
              message: result.message,
              ...(result.interrupt !== undefined ? { interrupt: result.interrupt } : {})
            }
    }
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  return isRecord(parsed) ? parsed : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (status === 204) {
    res.writeHead(204);
    res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPermissionRule(value: unknown): value is PermissionRule {
  return (
    isRecord(value) &&
    typeof value.toolName === 'string' &&
    (value.ruleContent === undefined || typeof value.ruleContent === 'string')
  );
}

function permissionRulesFromUpdates(updates: unknown[] | undefined): PermissionRule[] {
  const rules: PermissionRule[] = [];
  if (!updates) return rules;
  for (const update of updates) {
    if (!isRecord(update) || update.behavior !== 'allow' || !Array.isArray(update.rules)) continue;
    for (const rule of update.rules) {
      if (!isPermissionRule(rule)) continue;
      rules.push({
        toolName: rule.toolName,
        ruleContent: rule.ruleContent
      });
    }
  }
  return rules;
}

function permissionRuleMatches(rule: PermissionRule, toolName: string, input: Record<string, unknown>): boolean {
  if (rule.toolName !== toolName) return false;
  if (!rule.ruleContent) return true;
  if (typeof input.command === 'string') return input.command === rule.ruleContent;
  return Object.values(input).some((value) => value === rule.ruleContent);
}

function isAgentEventType(type: string): type is AgentEvent['type'] {
  return ['run.started', 'assistant.delta', 'tool.discovery', 'tool.started', 'tool.completed', 'approval.requested', 'run.completed', 'run.failed'].includes(type);
}

function getRealBinaryPath(inputPath: string): string | undefined {
  if (!inputPath) return undefined;
  const resolved = resolve(inputPath);
  if (!existsSync(resolved)) return undefined;

  const ext = process.platform === 'win32' ? '.exe' : '';

  // If it's already a native executable file, return it
  if (resolved.toLowerCase().endsWith(ext) && !resolved.toLowerCase().endsWith('.js') && !resolved.toLowerCase().endsWith('.cmd') && !resolved.toLowerCase().endsWith('.ps1') && !resolved.toLowerCase().endsWith('.bat')) {
    return resolved;
  }

  // If it's a directory, check common binary locations inside it
  const isDir = existsSync(resolved) && existsSync(join(resolved, '..')) && !resolved.toLowerCase().endsWith('.cmd') && !resolved.toLowerCase().endsWith('.ps1') && !resolved.toLowerCase().endsWith('.bat') && !resolved.toLowerCase().endsWith('.js');
  if (isDir) {
    const candidates = [
      join(resolved, `claude${ext}`),
      join(resolved, 'bin', `claude${ext}`),
      join(resolved, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', `claude${ext}`),
      join(resolved, 'node_modules', '@anthropic-ai', 'claude-code-win32-x64', 'bin', `claude${ext}`),
      join(resolved, 'node_modules', '@anthropic-ai', 'claude-code', 'node_modules', '@anthropic-ai', 'claude-code-win32-x64', 'bin', `claude${ext}`)
    ];
    for (const cand of candidates) {
      if (existsSync(cand)) return cand;
    }
  } else {
    // It's a wrapper file (e.g. claude.cmd, claude.ps1, claude.bat, claude.js, or extensionless wrapper)
    // Check siblings and children of the parent directory
    const parentDir = dirname(resolved);
    const candidates = [
      join(parentDir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      join(parentDir, `claude${ext}`),
      join(parentDir, 'bin', `claude${ext}`),
      join(parentDir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', `claude${ext}`),
      join(parentDir, 'node_modules', '@anthropic-ai', 'claude-code-win32-x64', 'bin', `claude${ext}`),
      join(parentDir, 'node_modules', '@anthropic-ai', 'claude-code', 'node_modules', '@anthropic-ai', 'claude-code-win32-x64', 'bin', `claude${ext}`)
    ];
    for (const cand of candidates) {
      if (existsSync(cand)) return cand;
    }
  }

  return resolved; // Fallback to whatever exists
}

function findClaudeExecutable(config?: ClaudeAgentBridgeConfig): string | undefined {
  const ext = process.platform === 'win32' ? '.exe' : '';

  // 1) User-provided path from settings - ALWAYS evaluate fresh, do not globally cache!
  const userPath = config?.executable?.trim();
  if (userPath) {
    const realPath = getRealBinaryPath(userPath);
    if (realPath) return realPath;
  }

  // 2) Environment variable override
  const envPath = process.env.OMP_CLAUDE_EXECUTABLE || process.env.OP_CLAUDE_EXECUTABLE;
  if (envPath) {
    const realPath = getRealBinaryPath(envPath);
    if (realPath) return realPath;
  }

  // 3) Cached auto-discovered path
  if (cachedClaudePath && existsSync(cachedClaudePath)) return cachedClaudePath;

  // 4) Find via `where` / `which` (resolves PATH)
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const result = execSync(`${cmd} claude`, { encoding: 'utf-8', timeout: 5000 }).trim().split('\n')[0];
    if (result) {
      const realPath = getRealBinaryPath(result);
      if (realPath) {
        cachedClaudePath = realPath;
        return realPath;
      }
    }
  } catch {
    /* ignore error if command not found */
  }

  // 5) Check hardcoded default paths for this platform
  const defaults = DEFAULT_PATHS[process.platform] || [];
  for (const p of defaults) {
    const realPath = getRealBinaryPath(p);
    if (realPath) {
      cachedClaudePath = realPath;
      return realPath;
    }
  }

  // 6) Walk up from npm wrapper to find the real binary
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const wrapper = execSync(`${cmd} claude`, { encoding: 'utf-8', timeout: 5000 }).trim().split('\n')[0];
    if (wrapper) {
      const candidate = join(dirname(wrapper), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      const realPath = getRealBinaryPath(candidate);
      if (realPath) {
        cachedClaudePath = realPath;
        return realPath;
      }
    }
  } catch {
    /* ignore error if npm wrapper cannot be resolved */
  }

  return undefined;
}

async function loadClaudeSdk(): Promise<ClaudeAgentBridgeConfig['sdk'] | null> {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
    const mod = (await dynamicImport('@anthropic-ai/claude-agent-sdk')) as { query?: (args: unknown) => AsyncIterable<unknown> };
    return mod.query ? { query: mod.query } : null;
  } catch {
    return null;
  }
}

function allowedToolsForEnvelope(envelope: AgentContextEnvelope): string[] | undefined {
  if (envelope.routing.toolPolicy !== 'require') return undefined;
  const allowedTools = envelope.routing.preferredTools
    // CUA can change desktop state, so keep it behind Claude Code's permission
    // callback instead of auto-allowing it through the SDK `allowedTools` list.
    .filter((tool) => tool !== 'cua' && tool !== 'mcp__cua__*')
    .map((tool) => (tool.includes('*') ? tool : `mcp__${tool}__*`));
  return allowedTools.length > 0 ? allowedTools : undefined;
}

function mcpServersForEnvelope(envelope: AgentContextEnvelope): Record<string, unknown> | undefined {
  if (!hasCuaContext(envelope)) return undefined;
  const command = findCuaDriverExecutable();
  if (!command) return undefined;
  return {
    cua: {
      type: 'stdio',
      command,
      args: ['mcp'],
      timeout: 20000,
      alwaysLoad: true,
      tools: CUA_AGENT_TOOLS.map((name) => ({
        name,
        permission_policy: 'always_ask'
      }))
    }
  };
}

function hasCuaContext(envelope: AgentContextEnvelope): boolean {
  return Boolean(
    envelope.cuaDirective?.enabled ||
      envelope.toolServers?.some((server) => server.id === 'cua') ||
      envelope.pointerContext.grounding?.provider === 'cua' ||
      envelope.pointerContext.target?.groundingRef?.provider === 'cua' ||
      envelope.pointerContext.entities.some((entity) => entity.groundingRef?.provider === 'cua') ||
      envelope.pointerContext.nearby.some((entity) => entity.groundingRef?.provider === 'cua')
  );
}

function findCuaDriverExecutable(): string | undefined {
  const exe = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver';
  const maybeProcess = process as NodeJS.Process & { resourcesPath?: string };
  const override = process.env.OMP_CUA_DRIVER_PATH?.trim() || process.env.CUA_DRIVER_PATH?.trim();
  const cwd = process.cwd();
  const candidates = [
    override,
    join(cwd, 'vendor', 'cua', 'libs', 'cua-driver', 'rust', 'target', 'release', exe),
    join(cwd, 'vendor', 'cua', 'libs', 'cua-driver', 'rust', 'target', 'debug', exe),
    join(cwd, '..', '..', 'vendor', 'cua', 'libs', 'cua-driver', 'rust', 'target', 'release', exe),
    join(cwd, '..', '..', 'vendor', 'cua', 'libs', 'cua-driver', 'rust', 'target', 'debug', exe),
    maybeProcess.resourcesPath ? join(maybeProcess.resourcesPath, exe) : undefined,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'Cua', 'cua-driver', 'bin', exe) : undefined,
    process.env.HOME ? join(process.env.HOME, '.cua-driver', 'packages', 'current', exe) : undefined
  ].filter((candidate): candidate is string => Boolean(candidate));
  const direct = candidates.find((candidate) => existsSync(candidate));
  if (direct) return direct;
  try {
    const cmd = process.platform === 'win32' ? 'where cua-driver' : 'which cua-driver';
    const found = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim().split(/\r?\n/)[0];
    if (found && existsSync(found)) return found;
  } catch {
    /* ignore missing cua-driver on PATH */
  }
  return undefined;
}

function mapClaudeMessage(raw: unknown): AgentEvent {
  if (!raw || typeof raw !== 'object') return { type: 'assistant.delta', text: String(raw) };
  const msg = raw as Record<string, unknown>;
  const type = String(msg.type ?? '');
  if (isAgentEventType(type)) return raw as AgentEvent;

  // Handle user messages that contain tool results
  if (type === 'user' && msg.message && typeof msg.message === 'object') {
    const message = msg.message as Record<string, unknown>;
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block && typeof block === 'object') {
          const blockRecord = block as Record<string, unknown>;
          if (blockRecord.type === 'tool_result') {
            // Extract the tool result content
            const toolResult = blockRecord;
            const content = toolResult.content;
            let resultText = '';

            if (typeof content === 'string') {
              resultText = content;
            } else if (Array.isArray(content)) {
              resultText = content
                .map((item: unknown) => {
                  if (item && typeof item === 'object') {
                    const itemRecord = item as Record<string, unknown>;
                    if (itemRecord.type === 'text' && typeof itemRecord.text === 'string') {
                      return itemRecord.text;
                    }
                  }
                  return '';
                })
                .filter(Boolean)
                .join('\n');
            }

            // Also check tool_use_result field
            if (!resultText && msg.tool_use_result && typeof msg.tool_use_result === 'object') {
              const toolUseResult = msg.tool_use_result as Record<string, unknown>;
              if (typeof toolUseResult.stdout === 'string') {
                resultText = toolUseResult.stdout;
              }
            }

            return {
              type: 'tool.completed',
              name: 'Bash', // The tool that was called
              output: resultText || JSON.stringify(content)
            };
          }
        }
      }
    }
    // Skip other user messages
    return { type: 'assistant.delta', text: '' };
  }

  // Handle tool result events (standalone)
  if (type === 'tool_result') {
    return { type: 'tool.completed', name: String(msg.tool_use_id ?? msg.name ?? 'tool'), output: msg.content ?? msg.result };
  }

  // Handle assistant messages with structured content
  if (type === 'assistant' && msg.message && typeof msg.message === 'object') {
    const message = msg.message as Record<string, unknown>;
    const content = message.content;
    if (Array.isArray(content)) {
      // Extract thinking blocks
      const thinkingParts: string[] = [];
      for (const block of content) {
        if (block && typeof block === 'object') {
          const blockRecord = block as Record<string, unknown>;
          if (blockRecord.type === 'thinking' && typeof blockRecord.thinking === 'string') {
            thinkingParts.push(blockRecord.thinking);
          }
        }
      }
      // Emit thinking content as special formatted text
      if (thinkingParts.length > 0) {
        const thinkingText = thinkingParts.join('\n');
        return { type: 'assistant.delta', text: `\n\n> 💭 **Thinking:**\n> ${thinkingText.split('\n').join('\n> ')}\n\n` };
      }
    }
    // Skip text blocks from assistant messages (they come from stream events)
    return { type: 'assistant.delta', text: '' };
  }

  // Handle stream events
  if (type === 'stream_event' && msg.event && typeof msg.event === 'object') {
    const event = msg.event as Record<string, unknown>;
    const eventType = String(event.type ?? '');

    // Content block start - may be tool_use or text
    if (eventType === 'content_block_start' && event.content_block && typeof event.content_block === 'object') {
      const block = event.content_block as Record<string, unknown>;
      const blockType = String(block.type ?? '');

      // Tool use block starting
      if (blockType === 'tool_use') {
        return { type: 'tool.started', name: String(block.name ?? 'unknown_tool'), input: undefined };
      }
      // Text block starting - skip
      return { type: 'assistant.delta', text: '' };
    }

    // Content block delta - actual content
    if (eventType === 'content_block_delta' && event.delta && typeof event.delta === 'object') {
      const delta = event.delta as Record<string, unknown>;
      const deltaType = String(delta.type ?? '');

      // Text delta - actual response text
      if (deltaType === 'text_delta' && typeof delta.text === 'string') {
        return { type: 'assistant.delta', text: delta.text };
      }

      // Input JSON delta - tool input streaming (accumulate, don't display)
      if (deltaType === 'input_json_delta') {
        return { type: 'assistant.delta', text: '' };
      }

      // Thinking delta - skip (we use the complete thinking from assistant message)
      if (deltaType === 'thinking_delta') {
        return { type: 'assistant.delta', text: '' };
      }

      // Signature delta - skip
      return { type: 'assistant.delta', text: '' };
    }

    // Content block stop
    if (eventType === 'content_block_stop') {
      return { type: 'assistant.delta', text: '' };
    }

    // Message start, message delta, message stop - skip
    return { type: 'assistant.delta', text: '' };
  }

  // Handle final result
  if (type === 'result') {
    const text = typeof msg.result === 'string' ? msg.result : '';
    return { type: 'run.completed', text };
  }

  // Skip system messages
  if (type === 'system') {
    return { type: 'assistant.delta', text: '' };
  }

  // Fallback - try to extract any text content
  const text = extractText(msg);
  return { type: 'assistant.delta', text };
}

function extractText(msg: Record<string, unknown>): string {
  if (typeof msg.text === 'string') return msg.text;
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((item) => {
        if (item && typeof item === 'object' && 'text' in item) return String((item as { text?: unknown }).text ?? '');
        return '';
      })
      .join('');
  }
  return JSON.stringify(msg);
}

function buildSdkEnv(config: ClaudeAgentBridgeConfig | undefined): Record<string, string> | undefined {
  if (!config) return undefined;
  const env: Record<string, string> = {};
  if (config.apiKey) env.ANTHROPIC_API_KEY = config.apiKey;
  if (config.baseUrl) env.ANTHROPIC_BASE_URL = config.baseUrl;
  if (Object.keys(env).length === 0) return undefined;
  const inherited: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) inherited[k] = v;
  }
  return { ...inherited, ...env };
}
