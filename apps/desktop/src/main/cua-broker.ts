import type { AgentEvent } from '@openmagicpointer/core';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { CuaSidecarManager } from './cua-sidecar.js';

type BrokerOptions = {
  requireApprovalBeforeCua: boolean;
  emit(event: AgentEvent): void;
};

type PendingApproval = {
  resolve(decision: 'approve' | 'deny'): void;
};

const STATE_CHANGING_TOOLS = new Set([
  'click',
  'double_click',
  'type_text',
  'press_key',
  'scroll',
  'drag',
  'set_value',
  'focus'
]);

export class CuaBroker {
  private server: Server | null = null;
  private endpoint: string | null = null;
  private sessionId = randomUUID();
  private options: BrokerOptions | null = null;
  private pendingApprovals = new Map<string, PendingApproval>();

  constructor(private readonly sidecar: CuaSidecarManager) {}

  async ensureStarted(options: BrokerOptions): Promise<{ endpoint: string; sessionId: string }> {
    this.options = options;
    if (this.server && this.endpoint) return { endpoint: this.endpoint, sessionId: this.sessionId };
    this.sessionId = randomUUID();
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address() as AddressInfo;
    this.endpoint = `http://127.0.0.1:${address.port}/sessions/${this.sessionId}/tools/call`;
    return { endpoint: this.endpoint, sessionId: this.sessionId };
  }

  hasPendingApproval(id: string): boolean {
    return this.pendingApprovals.has(id);
  }

  approve(id: string, decision: 'approve' | 'deny'): void {
    const pending = this.pendingApprovals.get(id);
    if (!pending) return;
    this.pendingApprovals.delete(id);
    pending.resolve(decision);
  }

  stop(): void {
    for (const [id, pending] of this.pendingApprovals) {
      pending.resolve('deny');
      this.pendingApprovals.delete(id);
    }
    this.server?.close();
    this.server = null;
    this.endpoint = null;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.method !== 'POST' || req.url !== `/sessions/${this.sessionId}/tools/call`) {
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
      if (this.options?.requireApprovalBeforeCua && STATE_CHANGING_TOOLS.has(name)) {
        const approved = await this.requestApproval(name);
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

  private async requestApproval(tool: string): Promise<boolean> {
    const id = `cua-approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.options?.emit({
      type: 'approval.requested',
      id,
      reason: `CUA tool "${tool}" can change desktop state.`,
      tool
    });
    const decision = await new Promise<'approve' | 'deny'>((resolve) => {
      this.pendingApprovals.set(id, { resolve });
      setTimeout(() => {
        if (!this.pendingApprovals.has(id)) return;
        this.pendingApprovals.delete(id);
        resolve('deny');
      }, 120000);
    });
    return decision === 'approve';
  }
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
