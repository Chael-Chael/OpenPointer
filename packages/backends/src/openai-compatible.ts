import type { PointerContext } from '@openpointer/core';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
};

export type OpenAICompatibleConfig = {
  baseUrl: string;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
};

export type CompletionResult = {
  text: string;
  model: string;
};

export class OpenAICompatibleBackend {
  constructor(private readonly config: OpenAICompatibleConfig) {}

  async *streamComplete(messages: ChatMessage[], signal?: AbortSignal): AsyncIterable<string> {
    const model = this.config.model || 'gpt-4o-mini';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 60000);
    const combinedSignal = combineSignals(signal, controller.signal);
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          stream: true
        }),
        signal: combinedSignal
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Provider error ${response.status}: ${text.slice(0, 400)}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!response.body || !/text\/event-stream|application\/x-ndjson/i.test(contentType)) {
        const json = (await response.json().catch(() => ({}))) as {
          choices?: Array<{ message?: { content?: string }; text?: string }>;
        };
        const text = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? '';
        if (text) yield text;
        return;
      }

      yield* parseChatCompletionStream(response);
    } finally {
      clearTimeout(timeout);
    }
  }

  async complete(messages: ChatMessage[], signal?: AbortSignal): Promise<CompletionResult> {
    const model = this.config.model || 'gpt-4o-mini';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 60000);
    const combinedSignal = combineSignals(signal, controller.signal);
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2
        }),
        signal: combinedSignal
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Provider error ${response.status}: ${text.slice(0, 400)}`);
      }
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
      };
      return {
        text: json.choices?.[0]?.message?.content ?? '',
        model: json.model ?? model
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function combineSignals(external: AbortSignal | undefined, internal: AbortSignal): AbortSignal {
  if (!external) return internal;
  // Node 18.17+/20+ provides AbortSignal.any to merge multiple signals.
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') return anyFn([external, internal]);
  // Fallback: forward both signals into a fresh controller.
  const controller = new AbortController();
  const abort = (reason?: unknown) => controller.abort(reason);
  if (external.aborted) abort(external.reason);
  else external.addEventListener('abort', () => abort(external.reason), { once: true });
  if (internal.aborted) abort(internal.reason);
  else internal.addEventListener('abort', () => abort(internal.reason), { once: true });
  return controller.signal;
}

async function* parseChatCompletionStream(response: Response): AsyncIterable<string> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = findBoundary(buffer);
    while (boundary >= 0) {
      const chunk = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + (buffer[boundary] === '\r' ? 4 : 2));
      const delta = parseStreamChunk(chunk);
      if (delta) yield delta;
      boundary = findBoundary(buffer);
    }
  }
  const tail = parseStreamChunk(buffer.trim());
  if (tail) yield tail;
}

function parseStreamChunk(chunk: string): string {
  if (!chunk) return '';
  const payloads = chunk
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());
  const rawPayloads =
    payloads.length > 0
      ? payloads
      : chunk
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
  let text = '';
  for (const payload of rawPayloads) {
    if (!payload || payload === '[DONE]') continue;
    try {
      const json = JSON.parse(payload) as {
        choices?: Array<{
          delta?: { content?: string };
          message?: { content?: string };
          text?: string;
        }>;
      };
      text += json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? '';
    } catch {
      text += payload;
    }
  }
  return text;
}

function findBoundary(buffer: string): number {
  const rn = buffer.indexOf('\r\n\r\n');
  const nn = buffer.indexOf('\n\n');
  if (rn === -1) return nn;
  if (nn === -1) return rn;
  return Math.min(rn, nn);
}

export function buildPointerMessages(context: PointerContext, userPrompt: string, options: { includeImage?: boolean } = {}): ChatMessage[] {
  const target = context.target;
  const contextSummary = [
    `Source: ${context.source}`,
    target ? `Target: ${target.kind} ${target.text || target.name || target.role || ''}` : 'Target: unknown',
    context.gesture ? `Gesture: ${context.gesture.kind}` : '',
    context.nearby.length > 0
      ? `Nearby: ${context.nearby
          .map((item) => item.text)
          .filter(Boolean)
          .join(' | ')}`
      : ''
  ]
    .filter(Boolean)
    .join('\n');

  const userText = `Pointer context:\n${contextSummary}\n\nUser request:\n${userPrompt}`;
  const image =
    options.includeImage !== false && context.visual?.imageBase64 && context.visual.mimeType
      ? {
          type: 'image_url' as const,
          image_url: { url: `data:${context.visual.mimeType};base64,${context.visual.imageBase64}` }
        }
      : null;

  const visualNote =
    context.visual?.imageBase64 && !image
      ? '\nVisual screenshot is available locally but was not attached to this request because the current model/provider does not support image input.'
      : '';

  return [
    {
      role: 'system',
      content:
        'You are OpenPointer. Answer based on the pointer context and attached screenshot. Do not claim to execute actions. If an action is needed, describe the intended action clearly for local preview.'
    },
    {
      role: 'user',
      content: image ? [{ type: 'text', text: userText }, image] : `${userText}${visualNote}`
    }
  ];
}

export function isUnsupportedImageInputError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /support image input|image input|unsupported.*image|vision/i.test(message) && /404|unsupported|No endpoints/i.test(message);
}
