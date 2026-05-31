import type { AgentContextEnvelope, AgentEvent } from '@openmagicpointer/core';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { buildAgentInput, buildAgentInstructions, buildToolDiscoveryEvent } from './prompt.js';
import type { AgentBridge, AgentRunOptions, ClaudeAgentBridgeConfig } from './types.js';

let cachedClaudePath: string | undefined;

// Hardcoded default paths per platform (npm global install locations)
const DEFAULT_PATHS: Record<string, string[]> = {
  win32: [
    join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    join(process.env.LOCALAPPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
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
    try {
      for await (const raw of sdk.query({
        prompt: `${buildAgentInstructions(envelope)}\n\n${buildAgentInput(envelope)}`,
        options: {
          allowedTools: allowedToolsForEnvelope(envelope),
          includePartialMessages: true,
          maxTurns: 12,
          abortController: options.signal,
          env: buildSdkEnv(this.config),
          pathToClaudeCodeExecutable: claudePath
        }
      })) {
        yield mapClaudeMessage(raw);
      }
      yield { type: 'run.completed' };
    } catch (error) {
      yield { type: 'run.failed', error: error instanceof Error ? error.message : String(error), recoverable: true };
    }
  }
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
      const candidate = join(dirname(wrapper), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', `claude${ext}`);
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
  if (envelope.cuaDirective?.mode === 'require') return ['mcp__cua__*'];
  return envelope.routing.preferredTools.map((tool) => (tool.includes('*') ? tool : `mcp__${tool}__*`));
}

function mapClaudeMessage(raw: unknown): AgentEvent {
  if (!raw || typeof raw !== 'object') return { type: 'assistant.delta', text: String(raw) };
  const msg = raw as Record<string, unknown>;
  const type = String(msg.type ?? '');
  if (type.includes('assistant') || type.includes('message')) {
    return { type: 'assistant.delta', text: extractText(msg) };
  }
  if (type.includes('tool') && type.includes('result')) {
    return { type: 'tool.completed', name: String(msg.name ?? msg.tool ?? 'tool'), output: msg.result ?? msg.content };
  }
  if (type.includes('tool')) {
    return { type: 'tool.started', name: String(msg.name ?? msg.tool ?? 'tool'), input: msg.input };
  }
  return { type: 'assistant.delta', text: extractText(msg) };
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
