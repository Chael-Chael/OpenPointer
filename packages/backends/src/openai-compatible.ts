import type { PointerContext } from '@openmagicpointer/core';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
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

  async complete(messages: ChatMessage[], signal?: AbortSignal): Promise<CompletionResult> {
    const model = this.config.model || 'gpt-4o-mini';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 60000);
    const combinedSignal = signal ?? controller.signal;
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

export function buildPointerMessages(context: PointerContext, userPrompt: string, options: { includeImage?: boolean } = {}): ChatMessage[] {
  const target = context.target;
  const contextSummary = [
    `Source: ${context.source}`,
    target ? `Target: ${target.kind} ${target.text || target.name || target.role || ''}` : 'Target: unknown',
    context.gesture ? `Gesture: ${context.gesture.kind}` : '',
    context.nearby.length > 0 ? `Nearby: ${context.nearby.map((item) => item.text).filter(Boolean).join(' | ')}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  const userText = `Pointer context:\n${contextSummary}\n\nUser request:\n${userPrompt}`;
  const image = options.includeImage !== false && context.visual?.imageBase64 && context.visual.mimeType
    ? {
        type: 'image_url' as const,
        image_url: { url: `data:${context.visual.mimeType};base64,${context.visual.imageBase64}` }
      }
    : null;

  const visualNote = context.visual?.imageBase64 && !image
    ? '\nVisual screenshot is available locally but was not attached to this request because the current model/provider does not support image input.'
    : '';

  return [
    {
      role: 'system',
      content:
        'You are OpenMagicPointer. Answer based on the pointer context and attached screenshot. Do not claim to execute actions. If an action is needed, describe the intended action clearly for local preview.'
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
