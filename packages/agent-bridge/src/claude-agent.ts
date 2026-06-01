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

    // The SDK expects an AbortController (with .signal), not a raw AbortSignal.
    const controller = new AbortController();
    if (options.signal) {
      if (options.signal.aborted) controller.abort(options.signal.reason);
      else options.signal.addEventListener('abort', () => controller.abort(options.signal!.reason), { once: true });
    }

    try {
      for await (const raw of sdk.query({
        prompt: `${buildAgentInstructions(envelope)}\n\n${buildAgentInput(envelope)}`,
        options: {
          allowedTools: allowedToolsForEnvelope(envelope),
          includePartialMessages: true,
          maxTurns: 12,
          abortController: controller,
          env: buildSdkEnv(this.config),
          pathToClaudeCodeExecutable: claudePath,
          ...(this.config?.model ? { model: this.config.model } : {}),
          ...(this.config?.effort ? { effort: this.config.effort } : {})
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
            const toolUseId = String(toolResult.tool_use_id ?? '');
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
