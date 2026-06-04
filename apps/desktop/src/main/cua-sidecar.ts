import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type CuaToolResult = {
  content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
  structuredContent?: unknown;
};

export type CuaHealth = {
  transport: 'http';
  status: 'ready' | 'starting' | 'stopped' | 'unavailable';
  endpoint?: string;
  port: number;
  pid?: number;
  driverPath?: string;
  serverVersion?: string;
  toolCount?: number;
  lastError?: string;
};

export class CuaSidecarManager {
  private proc: ChildProcess | null = null;
  private startPromise: Promise<void> | null = null;
  private nextId = 1;
  private sessionToolsAvailable: boolean | null = null;
  private endpoint = '';
  private port = 0;
  private driverPath = '';
  private serverVersion = '';
  private toolCount = 0;
  private lastError = '';

  constructor(private readonly repoRoot: string) {}

  configure(options: { port?: number }): void {
    const nextPort = validPort(options.port) ?? 19771;
    if (this.port && this.port !== nextPort) this.stop();
    this.port = nextPort;
    this.endpoint = `http://127.0.0.1:${this.port}/mcp`;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<CuaToolResult> {
    await this.ensureStarted();
    const result = await this.request('tools/call', { name, arguments: args }, 20000);
    return result as CuaToolResult;
  }

  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    await this.ensureStarted();
    const result = (await this.request('tools/list', {}, 8000)) as { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> };
    return result.tools ?? [];
  }

  async startSession(sessionId: string): Promise<void> {
    await this.callSessionTool('start_session', sessionId);
  }

  async endSession(sessionId: string): Promise<void> {
    await this.callSessionTool('end_session', sessionId);
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
    this.startPromise = null;
    this.serverVersion = '';
    this.toolCount = 0;
  }

  getHealth(): CuaHealth {
    return {
      transport: 'http',
      status: this.proc && !this.proc.killed ? 'ready' : this.startPromise ? 'starting' : this.lastError ? 'unavailable' : 'stopped',
      endpoint: this.endpoint || undefined,
      port: this.port || 19771,
      pid: this.proc?.pid,
      driverPath: this.driverPath || undefined,
      serverVersion: this.serverVersion || undefined,
      toolCount: this.toolCount || undefined,
      lastError: this.lastError || undefined
    };
  }

  private async ensureStarted(): Promise<void> {
    if (!this.port) this.configure({});
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
      this.lastError = 'CUA driver binary not found. Install cua-driver >= 0.5.0 or set OP_CUA_DRIVER_PATH.';
      throw new Error(this.lastError);
    }
    this.driverPath = binary;

    const pipeName = process.platform === 'win32' ? `\\\\.\\pipe\\openpointer-cua-${process.pid}-${this.port}` : join(app.getPath('userData'), `openpointer-cua-${process.pid}-${this.port}.sock`);
    const proc = spawn(binary, ['serve', '--socket', pipeName], {
      cwd: this.repoRoot,
      windowsHide: true,
      env: { ...process.env, CUA_DRIVER_RS_MCP_HTTP_PORT: String(this.port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    this.proc = proc;
    proc.stdout.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) console.debug('[op:cua]', text);
    });
    proc.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) console.debug('[op:cua]', text);
    });
    proc.on('exit', () => {
      this.proc = null;
      this.startPromise = null;
    });

    try {
      const initialized = (await retry(
        () =>
          this.request(
            'initialize',
            {
              protocolVersion: '2025-06-18',
              capabilities: {},
              clientInfo: { name: 'OpenPointer', version: app.getVersion() }
            },
            5000
          ),
        25,
        120
      )) as { serverInfo?: { version?: string } };
      this.serverVersion = initialized.serverInfo?.version ?? '';
      if (!isAtLeastVersion(this.serverVersion, '0.5.0')) {
        throw new Error(`CUA HTTP driver requires cua-driver >= 0.5.0; found ${this.serverVersion || 'unknown'}.`);
      }
      const listed = (await this.request('tools/list', {}, 8000)) as { tools?: unknown[] };
      this.toolCount = listed.tools?.length ?? 0;
      this.lastError = '';
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.stop();
      throw error;
    }
  }

  private async request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`CUA HTTP ${response.status}: ${text || response.statusText}`);
      if (!text.trim()) return {};
      const parsed = JSON.parse(text) as { result?: unknown; error?: { message?: string } };
      if (parsed.error) throw new Error(parsed.error.message ?? 'CUA request failed.');
      return parsed.result;
    } finally {
      clearTimeout(timeout);
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
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate));
}

function validPort(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536 ? value : undefined;
}

async function retry<T>(work: () => Promise<T>, attempts: number, delayMs: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isAtLeastVersion(actual: string, required: string): boolean {
  const a = actual.split('.').map((part) => Number.parseInt(part, 10));
  const r = required.split('.').map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(a.length, r.length); index += 1) {
    const actualPart = a[index] ?? Number.NaN;
    const requiredPart = r[index] ?? Number.NaN;
    const av = Number.isFinite(actualPart) ? actualPart : 0;
    const rv = Number.isFinite(requiredPart) ? requiredPart : 0;
    if (av > rv) return true;
    if (av < rv) return false;
  }
  return true;
}
