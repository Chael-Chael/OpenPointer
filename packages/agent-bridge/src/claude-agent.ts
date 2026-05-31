import type { AgentContextEnvelope, AgentEvent } from '@openmagicpointer/core';
import { buildAgentInput, buildAgentInstructions, buildToolDiscoveryEvent } from './prompt.js';
import type { AgentBridge, AgentRunOptions, ClaudeAgentBridgeConfig } from './types.js';

export class ClaudeAgentBridge implements AgentBridge {
  id = 'claude-agent' as const;

  constructor(private readonly config: ClaudeAgentBridgeConfig | undefined) {}

  async *run(envelope: AgentContextEnvelope, options: AgentRunOptions = {}): AsyncIterable<AgentEvent> {
    if (!this.config?.enabled) {
      yield { type: 'run.failed', error: 'Claude Agent bridge is disabled. Enable it and configure the Anthropic API key.', recoverable: true };
      return;
    }
    if (!this.config.apiKey && !process.env.ANTHROPIC_API_KEY) {
      yield { type: 'run.failed', error: 'Claude Agent bridge needs ANTHROPIC_API_KEY or a configured API key.', recoverable: true };
      return;
    }
    const sdk = this.config.sdk ?? (await loadClaudeSdk());
    if (!sdk) {
      yield { type: 'run.failed', error: '@anthropic-ai/claude-agent-sdk is not installed in this workspace.', recoverable: true };
      return;
    }

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
          abortController: options.signal
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
