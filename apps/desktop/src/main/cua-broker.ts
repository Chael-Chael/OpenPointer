import type { AgentEvent } from '@openmagicpointer/core';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { CuaSidecarManager } from './cua-sidecar.js';

type BrokerOptions = {
  requireApprovalBeforeCua: boolean;
  // Whitelist of CUA tool names the agent is permitted to invoke. The broker
  // rejects any call whose name is not in this set, so the agent cannot reach
  // unlisted driver tools even if it knows their names.
  allowedTools: string[];
  emit(event: AgentEvent): void;
};

type PendingApproval = {
  resolve(decision: 'approve' | 'deny'): void;
  timeout: NodeJS.Timeout;
};

type BrokerSession = {
  options: BrokerOptions;
  createdAt: number;
};

const STATE_CHANGING_TOOLS = new Set(['click', 'double_click', 'right_click', 'type_text', 'press_key', 'hotkey', 'scroll', 'drag', 'set_value', 'focus']);

export class CuaBroker {
  private server: Server | null = null;
  private serverPromise: Promise<void> | null = null;
  private endpoint: string | null = null;
  private sessions = new Map<string, BrokerSession>();
  private pendingApprovals = new Map<string, PendingApproval>();

  constructor(private readonly sidecar: CuaSidecarManager) {}

  async ensureStarted(options: BrokerOptions): Promise<{ endpoint: string; sessionId: string }> {
    if (!this.server || !this.endpoint) await this.ensureServer();
    const sessionId = randomUUID();
    this.sessions.set(sessionId, { options, createdAt: Date.now() });
    this.pruneSessions();
    return { endpoint: `${this.endpoint}/sessions/${sessionId}/tools/call`, sessionId };
  }

  hasPendingApproval(id: string): boolean {
    return this.pendingApprovals.has(id);
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
      const body = await readJson(req);
      const name = typeof body.name === 'string' ? body.name : '';
      const args = isRecord(body.arguments) ? body.arguments : isRecord(body.args) ? body.args : {};
      if (!name) {
        sendJson(res, 400, { error: 'Missing CUA tool name.' });
        return;
      }
      // Enforce the tool whitelist. The advertised tool list is not a security
      // boundary on its own; reject anything not explicitly allowed.
      const allowed = session.options.allowedTools;
      if (!allowed.includes(name)) {
        sendJson(res, 403, { error: `CUA tool "${name}" is not allowed.` });
        return;
      }
      if (session.options.requireApprovalBeforeCua && STATE_CHANGING_TOOLS.has(name)) {
        const approved = await this.requestApproval(session, name);
        if (!approved) {
          sendJson(res, 403, { error: 'CUA tool call denied by user.' });
          return;
        }
      }
      const result = await this.sidecar.callTool(name, args);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async requestApproval(session: BrokerSession, tool: string): Promise<boolean> {
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
  const match = /^\/sessions\/([^/]+)\/tools\/call(?:\?.*)?$/.exec(url);
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
