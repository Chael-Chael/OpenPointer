import type { AgentEvent } from '@openpointer/core';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { CuaSidecarManager, type CuaToolResult } from './cua-sidecar.js';

type BrokerOptions = {
  requireApprovalBeforeCua: boolean;
  cuaAgentCursorEnabled: boolean;
  cuaPageJavascriptPolicy: 'ask' | 'off';
  // Whitelist of CUA tool names the agent is permitted to invoke. The broker
  // rejects any call whose name is not in this set, so the agent cannot reach
  // unlisted driver tools even if it knows their names.
  allowedTools: string[];
  localTools?: Record<string, (args: Record<string, unknown>) => Promise<CuaToolResult>>;
  withDesktopInteractionHidden?: <T>(work: () => Promise<T>) => Promise<T>;
  showDesktopInteractionApproval?: () => void | Promise<void>;
  emit(event: AgentEvent): void;
};

type PendingApproval = {
  resolve(decision: 'approve' | 'deny'): void;
  timeout: NodeJS.Timeout;
};

type BrokerSession = {
  id: string;
  options: BrokerOptions;
  createdAt: number;
  recordingDir?: string;
};

const STATE_CHANGING_TOOLS = new Set([
  'bring_to_front',
  'click',
  'double_click',
  'drag',
  'focus',
  'hotkey',
  'insert_text',
  'kill_app',
  'launch_app',
  'move_cursor',
  'press_key',
  'read_selected_text',
  'replay_trajectory',
  'right_click',
  'scroll',
  'set_agent_cursor_enabled',
  'set_agent_cursor_motion',
  'set_agent_cursor_style',
  'set_config',
  'set_value',
  'start_recording',
  'stop_recording',
  'type_text',
  'zoom'
]);

const ALWAYS_APPROVAL_TOOLS = new Set(['kill_app', 'replay_trajectory', 'set_config']);
const PAGE_STATE_CHANGING_ACTIONS = new Set(['click_element', 'type_text', 'scroll', 'execute_javascript', 'enable_javascript_apple_events']);
const OVERLAY_SENSITIVE_READ_TOOLS = new Set(['debug_window_info', 'get_accessibility_tree', 'get_window_state']);

export class CuaBroker {
  private server: Server | null = null;
  private serverPromise: Promise<void> | null = null;
  private endpoint: string | null = null;
  private sessions = new Map<string, BrokerSession>();
  private pendingApprovals = new Map<string, PendingApproval>();
  private stateChangingTail: Promise<void> = Promise.resolve();

  constructor(private readonly sidecar: CuaSidecarManager) {}

  async ensureStarted(options: BrokerOptions): Promise<{ endpoint: string; sessionId: string }> {
    if (!this.server || !this.endpoint) await this.ensureServer();
    const sessionId = randomUUID();
    this.sessions.set(sessionId, { id: sessionId, options, createdAt: Date.now() });
    await this.sidecar.startSession?.(sessionId);
    if (!options.cuaAgentCursorEnabled) {
      await this.sidecar.callTool('set_agent_cursor_enabled', { session: sessionId, enabled: false }).catch(() => undefined);
    }
    this.pruneSessions();
    return { endpoint: `${this.endpoint}/sessions/${sessionId}/mcp`, sessionId };
  }

  hasPendingApproval(id: string): boolean {
    return this.pendingApprovals.has(id);
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  approve(id: string, decision: 'approve' | 'deny'): void {
    const pending = this.pendingApprovals.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingApprovals.delete(id);
    pending.resolve(decision);
  }

  releaseSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    void this.sidecar.endSession?.(sessionId);
  }

  async startRecording(sessionId: string, outputDir: string): Promise<CuaToolResult> {
    const session = this.requireSession(sessionId);
    session.recordingDir = outputDir;
    return await this.sidecar.callTool('start_recording', { session: sessionId, output_dir: outputDir });
  }

  async stopRecording(sessionId: string): Promise<CuaToolResult> {
    const session = this.requireSession(sessionId);
    const result = await this.sidecar.callTool('stop_recording', { session: sessionId });
    session.recordingDir = undefined;
    return result;
  }

  async replayRecording(sessionId: string, dir: string): Promise<CuaToolResult> {
    const session = this.requireSession(sessionId);
    const approved = await this.requestApproval(session, 'replay_trajectory');
    if (!approved) return { isError: true, content: [{ type: 'text', text: 'CUA replay denied by user.' }] };
    return await this.withStateChangingLock(() =>
      this.withDesktopInteractionHidden(session, () => this.sidecar.callTool('replay_trajectory', { session: sessionId, dir }))
    );
  }

  stop(): void {
    for (const [id, pending] of this.pendingApprovals) {
      clearTimeout(pending.timeout);
      pending.resolve('deny');
      this.pendingApprovals.delete(id);
    }
    this.server?.close();
    this.server = null;
    this.serverPromise = null;
    this.endpoint = null;
    this.sessions.clear();
  }

  private requireSession(sessionId: string): BrokerSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('CUA broker session not found.');
    return session;
  }

  private async ensureServer(): Promise<void> {
    if (this.server && this.endpoint) return;
    if (this.serverPromise) {
      await this.serverPromise;
      return;
    }
    this.serverPromise = this.startServer();
    try {
      await this.serverPromise;
    } finally {
      this.serverPromise = null;
    }
  }

  private async startServer(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        this.server?.once('error', reject);
        this.server?.listen(0, '127.0.0.1', () => resolve());
      });
      const address = this.server.address() as AddressInfo;
      this.endpoint = `http://127.0.0.1:${address.port}`;
    } catch (error) {
      this.server?.close();
      this.server = null;
      this.endpoint = null;
      throw error;
    }
  }

  private pruneSessions(maxSessions = 32): void {
    if (this.sessions.size <= maxSessions) return;
    const stale = [...this.sessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt).slice(0, this.sessions.size - maxSessions);
    for (const [sessionId] of stale) this.sessions.delete(sessionId);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const sessionId = sessionIdFromUrl(req.url);
      const session = sessionId ? this.sessions.get(sessionId) : undefined;
      if (req.method !== 'POST' || !sessionId || !session) {
        sendJson(res, 404, { error: 'Not found.' });
        return;
      }
      if (req.url?.includes('/mcp')) {
        await this.handleMcpRequest(session, req, res);
        return;
      }
      await this.handleLegacyToolRequest(session, req, res);
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async handleLegacyToolRequest(session: BrokerSession, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req);
    const name = typeof body.name === 'string' ? body.name : '';
    const args = isRecord(body.arguments) ? body.arguments : isRecord(body.args) ? body.args : {};
    if (!name) {
      sendJson(res, 400, { error: 'Missing CUA tool name.' });
      return;
    }
    if (!session.options.allowedTools.includes(name)) {
      sendJson(res, 403, { error: `CUA tool "${name}" is not allowed.` });
      return;
    }
    if (await this.requiresApproval(session, name, args)) {
      const approved = await this.requestApproval(session, toolApprovalLabel(name, args));
      if (!approved) {
        sendJson(res, 403, { error: 'CUA tool call denied by user.' });
        return;
      }
    }
    const result = await this.callAllowedTool(session, name, args);
    sendJson(res, 200, result);
  }

  private async handleMcpRequest(session: BrokerSession, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req);
    const id = body.id;
    const method = typeof body.method === 'string' ? body.method : '';
    try {
      if (method === 'initialize') {
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'openpointer-cua', version: '0.1.0' },
            instructions: 'OpenPointer CUA broker. All desktop tools are session-scoped and approval-gated by OpenPointer.'
          }
        });
        return;
      }
      if (method === 'notifications/initialized') {
        sendJson(res, 202, {});
        return;
      }
      if (method === 'tools/list') {
        const allowed = new Set(session.options.allowedTools);
        const tools = (await this.sidecar.listTools()).filter((tool) => allowed.has(tool.name));
        sendJson(res, 200, { jsonrpc: '2.0', id, result: { tools } });
        return;
      }
      if (method === 'tools/call') {
        const params = isRecord(body.params) ? body.params : {};
        const name = typeof params.name === 'string' ? params.name : '';
        const args = isRecord(params.arguments) ? params.arguments : {};
        if (!name) throw new Error('Missing CUA tool name.');
        const result = await this.callAllowedToolWithPolicy(session, name, args);
        sendJson(res, 200, { jsonrpc: '2.0', id, result });
        return;
      }
      sendJson(res, 200, { jsonrpc: '2.0', id, error: { code: -32601, message: `Unsupported MCP method: ${method}` } });
    } catch (error) {
      sendJson(res, 200, {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  private async callAllowedToolWithPolicy(session: BrokerSession, name: string, args: Record<string, unknown>): Promise<CuaToolResult> {
    if (!session.options.allowedTools.includes(name)) {
      return { isError: true, content: [{ type: 'text', text: `CUA tool "${name}" is not allowed.` }] };
    }
    if (await this.requiresApproval(session, name, args)) {
      const approved = await this.requestApproval(session, toolApprovalLabel(name, args));
      if (!approved) return { isError: true, content: [{ type: 'text', text: 'CUA tool call denied by user.' }] };
    }
    return await this.callAllowedTool(session, name, args);
  }

  private async callAllowedTool(session: BrokerSession, name: string, args: Record<string, unknown>): Promise<CuaToolResult> {
    const execute = async () => {
      const localTool = session.options.localTools?.[name];
      return localTool ? await localTool(args) : await this.sidecar.callTool(name, withCuaSessionArg(args, session.id));
    };
    const maybeHideOverlay = () => (isOverlaySensitiveTool(name, args) ? this.withDesktopInteractionHidden(session, execute) : execute());
    return isSerializedTool(name, args) ? this.withStateChangingLock(maybeHideOverlay) : maybeHideOverlay();
  }

  private async requiresApproval(session: BrokerSession, name: string, args: Record<string, unknown>): Promise<boolean> {
    if (name === 'page' && String(args.action) === 'execute_javascript' && session.options.cuaPageJavascriptPolicy === 'off') {
      throw new Error('CUA page.execute_javascript is disabled in Settings.');
    }
    if (ALWAYS_APPROVAL_TOOLS.has(name)) return true;
    if (name === 'page' && PAGE_STATE_CHANGING_ACTIONS.has(String(args.action))) return true;
    return session.options.requireApprovalBeforeCua && isSerializedTool(name, args);
  }

  private async withStateChangingLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.stateChangingTail;
    let release!: () => void;
    this.stateChangingTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
    }
  }

  private async withDesktopInteractionHidden<T>(session: BrokerSession, work: () => Promise<T>): Promise<T> {
    return session.options.withDesktopInteractionHidden ? await session.options.withDesktopInteractionHidden(work) : await work();
  }

  private async requestApproval(session: BrokerSession, tool: string): Promise<boolean> {
    await session.options.showDesktopInteractionApproval?.();
    const id = `cua-approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    session.options.emit({
      type: 'approval.requested',
      id,
      reason: `CUA tool "${tool}" can change desktop state.`,
      tool
    });
    const decision = await new Promise<'approve' | 'deny'>((resolve) => {
      const timeout = setTimeout(() => {
        if (!this.pendingApprovals.has(id)) return;
        this.pendingApprovals.delete(id);
        resolve('deny');
      }, 120000);
      this.pendingApprovals.set(id, { resolve, timeout });
    });
    return decision === 'approve';
  }
}

function sessionIdFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const match = /^\/sessions\/([^/]+)\/(?:mcp|tools\/call)(?:\?.*)?$/.exec(url);
  return match?.[1];
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

function withCuaSessionArg(args: Record<string, unknown>, sessionId: string): Record<string, unknown> {
  if (typeof args.session === 'string') return args;
  return { ...args, session: sessionId };
}

function isSerializedTool(name: string, args: Record<string, unknown>): boolean {
  if (STATE_CHANGING_TOOLS.has(name)) return true;
  if (name === 'page' && PAGE_STATE_CHANGING_ACTIONS.has(String(args.action))) return true;
  return false;
}

function isOverlaySensitiveTool(name: string, args: Record<string, unknown>): boolean {
  return isSerializedTool(name, args) || OVERLAY_SENSITIVE_READ_TOOLS.has(name);
}

function toolApprovalLabel(name: string, args: Record<string, unknown>): string {
  if (name === 'page' && typeof args.action === 'string') return `page.${args.action}`;
  return name;
}
