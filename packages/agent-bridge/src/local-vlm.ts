import { OpenAICompatibleBackend, isUnsupportedImageInputError, type ChatMessage } from '@openmagicpointer/backends';
import { estimateTextTokens, type AgentContextEnvelope, type AgentEvent } from '@openmagicpointer/core';
import { buildLocalVlmPrompt, dataUrlsFromEnvelope } from './prompt.js';
import type { AgentBridge, AgentRunOptions, LocalVlmBridgeConfig } from './types.js';

export class LocalVlmBridge implements AgentBridge {
  id = 'local-vlm' as const;

  constructor(private readonly config: LocalVlmBridgeConfig | undefined) {}

  async *run(envelope: AgentContextEnvelope, options: AgentRunOptions = {}): AsyncIterable<AgentEvent> {
    if (!this.config?.apiKey || !this.config.baseUrl) {
      yield { type: 'run.failed', error: 'Local VLM is not configured. Add a local VLM base URL and API key.', recoverable: true };
      return;
    }

    const runId = `local-vlm-${Date.now()}`;
    yield { type: 'run.started', runId, backend: this.id };
    const backend = new OpenAICompatibleBackend(this.config);

    const limit = this.config.contextWindow ?? 32768;
    let messages = buildLocalMessages(envelope, true);
    const estimatedTokens = estimateTokensForMessages(messages);

    if (estimatedTokens > limit && envelope.history && envelope.history.length > 2) {
      yield {
        type: 'assistant.delta',
        text: `⚠️ **[System Info]** Current conversation history has exceeded the model's context window limit (${limit} tokens). Automatically summarizing the prior context to continue...\n\n`
      };

      const historicalTurns = envelope.history.slice(0, -1);
      const summaryText = await summarizeHistory(backend, historicalTurns);

      yield {
        type: 'assistant.delta',
        text: `*Context successfully compressed. Resuming conversation with summarized history context...*\n\n---\n\n`
      };

      messages = [
        {
          role: 'system',
          content: 'You are OpenMagicPointer local VLM fallback. Answer only. Here is a summary of the conversation context so far:\n\n' + summaryText
        },
        buildLocalMessages(envelope, true).pop()!
      ];
    }

    try {
      const text = yield* streamLocalAnswer(backend, messages, options.signal);
      yield { type: 'run.completed', text };
    } catch (error) {
      if (!isUnsupportedImageInputError(error)) {
        yield { type: 'run.failed', error: error instanceof Error ? error.message : String(error), recoverable: true };
        return;
      }
      yield { type: 'assistant.delta', text: 'The configured local provider does not support image input, so I used text-only pointer context.\n\n' };
      const result = await streamLocalAnswer(backend, buildLocalMessages(envelope, false), options.signal);
      const text = `The configured local provider does not support image input, so I used text-only pointer context.\n\n${result}`;
      yield { type: 'run.completed', text };
    }
  }
}

async function* streamLocalAnswer(
  backend: OpenAICompatibleBackend,
  messages: ChatMessage[],
  signal?: AbortSignal
): AsyncGenerator<AgentEvent, string, unknown> {
  let text = '';
  for await (const delta of backend.streamComplete(messages, signal)) {
    if (!delta) continue;
    text += delta;
    yield { type: 'assistant.delta', text: delta };
  }
  if (!text) {
    text = 'The local VLM returned an empty response.';
    yield { type: 'assistant.delta', text };
  }
  return text;
}

function buildLocalMessages(envelope: AgentContextEnvelope, includeImage: boolean): ChatMessage[] {
  const prompt = buildLocalVlmPrompt(envelope);
  const dataUrls = includeImage ? dataUrlsFromEnvelope(envelope) : [];

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: 'You are OpenMagicPointer local VLM fallback. Answer only; do not use tools or claim execution.'
    }
  ];

  if (envelope.history) {
    const previousTurns = envelope.history.slice(0, -1);
    for (const turn of previousTurns) {
      if (turn.role === 'user') {
        const turnDataUrls = includeImage ? dataUrlsFromPointerContext(turn.pointerContext) : [];
        messages.push({
          role: 'user',
          content: turnDataUrls.length > 0
            ? [
                { type: 'text', text: turn.text },
                ...turnDataUrls.map((dataUrl) => ({ type: 'image_url' as const, image_url: { url: dataUrl } }))
              ]
            : turn.text
        });
      } else {
        messages.push({
          role: 'assistant',
          content: turn.text
        });
      }
    }
  }

  messages.push({
    role: 'user',
    content: dataUrls.length > 0
      ? [
          { type: 'text', text: prompt },
          ...dataUrls.map((dataUrl) => ({ type: 'image_url' as const, image_url: { url: dataUrl } }))
        ]
      : prompt
  });

  return messages;
}

function dataUrlsFromPointerContext(context: import('@openmagicpointer/core').PointerContext | undefined): string[] {
  if (!context) return [];
  const urls: string[] = [];
  if (context.visual?.imageBase64) urls.push(`data:${context.visual.mimeType || 'image/jpeg'};base64,${context.visual.imageBase64}`);
  if (context.windowSnapshot?.imageBase64) {
    urls.push(`data:${context.windowSnapshot.mimeType || 'image/jpeg'};base64,${context.windowSnapshot.imageBase64}`);
  }
  return urls;
}

async function summarizeHistory(backend: OpenAICompatibleBackend, history: import('@openmagicpointer/core').ChatTurn[]): Promise<string> {
  const summaryPrompt: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a context compression assistant. Summarize the following dialogue history briefly but comprehensively. Retain all user requirements, instructions, and outcomes. Keep the summary under 600 words.'
    },
    {
      role: 'user',
      content: history.map((t) => `${t.role}: ${t.text}`).join('\n\n')
    }
  ];
  try {
    const res = await backend.complete(summaryPrompt);
    return res.text;
  } catch (e) {
    console.error('Failed to summarize history:', e);
    return 'Summary unavailable due to an error.';
  }
}

function estimateTokensForMessages(messages: ChatMessage[]): number {
  let tokens = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      tokens += estimateTextTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          tokens += estimateTextTokens(part.text);
        } else if (part.type === 'image_url') {
          tokens += 1000;
        }
      }
    }
  }
  return tokens;
}
