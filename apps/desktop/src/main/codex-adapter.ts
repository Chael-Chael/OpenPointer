import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppSettings } from '@openpointer/storage';
import { DEFAULT_CODEX_ADAPTER_URL } from './settings.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 5050;

export class CodexAdapterManager {
  private proc: ChildProcess | null = null;
  private starting: Promise<void> | null = null;

  constructor(private readonly repoRoot: string) {}

  ensure(settings: AppSettings): Promise<void> {
    if (!shouldManageLocalAdapter(settings)) return Promise.resolve();
    if (this.proc && !this.proc.killed) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.ensureRunning(settings).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  stop(): void {
    if (!this.proc || this.proc.killed) return;
    this.proc.kill();
    this.proc = null;
  }

  private async ensureRunning(settings: AppSettings): Promise<void> {
    if (await adapterHealthy(settings.codexAppServerUrl)) return;

    const scriptPath = join(this.repoRoot, 'scripts', 'codex-python-adapter.py');
    if (!existsSync(scriptPath)) {
      console.warn('[omp] Codex Python adapter script not found', scriptPath);
      return;
    }

    const python = process.env.OP_CODEX_PYTHON || 'python';
    this.proc = spawn(python, [scriptPath, '--host', DEFAULT_HOST, '--port', String(DEFAULT_PORT)], {
      cwd: this.repoRoot,
      env: {
        ...process.env,
        OP_CODEX_MODEL: settings.codexModel || process.env.OP_CODEX_MODEL || 'gpt-5.4',
        OP_CODEX_EFFORT: settings.codexEffort || process.env.OP_CODEX_EFFORT || 'low',
        OP_CODEX_SANDBOX: process.env.OP_CODEX_SANDBOX || 'workspace-write',
        OP_CODEX_WORKSPACE: process.env.OP_CODEX_WORKSPACE || this.repoRoot
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.proc.stdout?.on('data', (data) => console.info('[omp:codex-adapter]', String(data).trim()));
    this.proc.stderr?.on('data', (data) => console.warn('[omp:codex-adapter]', String(data).trim()));
    this.proc.on('exit', () => {
      this.proc = null;
    });

    const ready = await waitForAdapter(settings.codexAppServerUrl, 8000);
    if (!ready) console.warn('[omp] Codex Python adapter did not become ready before timeout.');
  }
}

export function shouldManageLocalAdapter(settings: AppSettings): boolean {
  return settings.codexAppServerTransport === 'http-adapter' && normalizeAdapterUrl(settings.codexAppServerUrl) === normalizeAdapterUrl(DEFAULT_CODEX_ADAPTER_URL);
}

async function waitForAdapter(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await adapterHealthy(baseUrl)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function adapterHealthy(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(healthUrl(baseUrl), { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

function healthUrl(baseUrl: string): string {
  const url = new URL(baseUrl || DEFAULT_CODEX_ADAPTER_URL);
  url.pathname = url.pathname.replace(/\/v1\/?$/, '') + '/healthz';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function normalizeAdapterUrl(url: string): string {
  try {
    const parsed = new URL(url || DEFAULT_CODEX_ADAPTER_URL);
    parsed.hostname = parsed.hostname === 'localhost' ? DEFAULT_HOST : parsed.hostname;
    parsed.pathname = parsed.pathname.replace(/\/$/, '');
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}
