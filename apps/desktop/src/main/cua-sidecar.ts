import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

type PendingCall = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
};

export type CuaToolResult = {
  content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
  structuredContent?: unknown;
};

export class CuaSidecarManager {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private reader: Interface | null = null;
  private startPromise: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private sessionToolsAvailable: boolean | null = null;

  constructor(private readonly repoRoot: string) {}

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<CuaToolResult> {
    await this.ensureStarted();
    const result = await this.request('tools/call', { name, arguments: args }, 8000);
    return result as CuaToolResult;
  }

  async startSession(sessionId: string): Promise<void> {
    await this.callSessionTool('start_session', sessionId);
  }

  async endSession(sessionId: string): Promise<void> {
    await this.callSessionTool('end_session', sessionId);
  }

  stop(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('CUA sidecar stopped.'));
      this.pending.delete(id);
    }
    this.reader?.close();
    this.reader = null;
    this.proc?.kill();
    this.proc = null;
    this.startPromise = null;
  }

  private async ensureStarted(): Promise<void> {
    if (this.proc && !this.proc.killed) {
      if (this.startPromise) await this.startPromise;
      return;
    }
    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    this.startPromise = this.startProcess();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async callSessionTool(name: 'start_session' | 'end_session', sessionId: string): Promise<void> {
    if (!sessionId || this.sessionToolsAvailable === false) return;
    try {
      const result = await this.callTool(name, { session: sessionId });
      if (result.isError) {
        this.sessionToolsAvailable = false;
        console.debug('[op:cua]', `${name} unavailable; continuing without CUA session lifecycle.`);
        return;
      }
      this.sessionToolsAvailable = true;
    } catch (error) {
      this.sessionToolsAvailable = false;
      console.debug('[op:cua]', `${name} failed; continuing without CUA session lifecycle.`, error);
    }
  }

  private async startProcess(): Promise<void> {
    const binary = resolveCuaDriverPath(this.repoRoot);
    if (!binary) {
      throw new Error('CUA driver binary not found. Build vendor/cua or set OP_CUA_DRIVER_PATH.');
    }

    const proc = spawn(binary, ['mcp'], {
      cwd: this.repoRoot,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.proc = proc;
    this.reader = createInterface({ input: proc.stdout });
    this.reader.on('line', (line) => this.handleLine(line));
    proc.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) console.debug('[op:cua]', text);
    });
    proc.on('exit', () => {
      this.proc = null;
      this.startPromise = null;
      this.reader?.close();
      this.reader = null;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('CUA sidecar exited.'));
        this.pending.delete(id);
      }
    });

    try {
      await this.request(
        'initialize',
        {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'OpenPointer', version: app.getVersion() }
        },
        5000
      );
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (!this.proc || this.proc.killed) return Promise.reject(new Error('CUA sidecar is not running.'));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CUA request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.proc?.stdin.write(`${payload}\n`);
    });
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let parsed: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof parsed.id !== 'number') return;
    const pending = this.pending.get(parsed.id);
    if (!pending) return;
    this.pending.delete(parsed.id);
    clearTimeout(pending.timeout);
    if (parsed.error) {
      pending.reject(new Error(parsed.error.message ?? 'CUA request failed.'));
    } else {
      pending.resolve(parsed.result);
    }
  }
}

function resolveCuaDriverPath(repoRoot: string): string | undefined {
  const override = process.env.OP_CUA_DRIVER_PATH?.trim();
  if (override && existsSync(override)) return override;
  const exe = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver';
  const candidates = [
    join(repoRoot, 'vendor', 'cua', 'libs', 'cua-driver', 'rust', 'target', 'release', exe),
    join(repoRoot, 'vendor', 'cua', 'libs', 'cua-driver', 'rust', 'target', 'debug', exe),
    join(process.resourcesPath ?? '', exe),
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'Cua', 'cua-driver', 'bin', exe) : ''
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}
