import type { AgentBackendId, AgentEvent } from '@openmagicpointer/core';
import type { FetchLike } from './types.js';

export type RuntimeEvent = Record<string, unknown>;

export async function* postRunAndStream(args: {
  backend: AgentBackendId;
  baseUrl: string;
  apiKey?: string;
  path?: string;
  body: unknown;
  signal?: AbortSignal;
  fetch?: FetchLike;
}): AsyncIterable<AgentEvent> {
  const fetcher = args.fetch ?? fetch;
  if (!args.baseUrl.trim()) {
    yield { type: 'run.failed', error: `${args.backend} backend is not configured.`, recoverable: true };
    return;
  }

  try {
    const base = args.baseUrl.replace(/\/$/, '');
    const response = await fetcher(`${base}${args.path ?? '/runs'}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(args.apiKey ? { Authorization: `Bearer ${args.apiKey}` } : {})
      },
      body: JSON.stringify(args.body),
      signal: args.signal
    });
    if (!response.ok) {
      yield { type: 'run.failed', error: `${args.backend} run request failed with ${response.status}: ${await safeText(response)}`, recoverable: true };
      return;
    }

    const json = (await response.json().catch(() => ({}))) as RuntimeEvent;
    const runId = String(json.run_id ?? json.runId ?? json.id ?? `${args.backend}-${Date.now()}`);
    yield { type: 'run.started', runId, backend: args.backend };

    const eventsUrl = typeof json.events_url === 'string'
      ? absolutize(base, json.events_url)
      : typeof json.eventsUrl === 'string'
        ? absolutize(base, json.eventsUrl)
        : `${base}/runs/${encodeURIComponent(runId)}/events`;

    const streamResponse = await fetcher(eventsUrl, {
      headers: {
        Accept: 'text/event-stream, application/x-ndjson, application/json',
        ...(args.apiKey ? { Authorization: `Bearer ${args.apiKey}` } : {})
      },
      signal: args.signal
    }).catch(() => null);

    if (!streamResponse || !streamResponse.ok || !streamResponse.body) {
      const text = typeof json.message === 'string' ? json.message : undefined;
      if (text) yield { type: 'assistant.delta', text };
      yield { type: 'run.completed', text };
      return;
    }

    for await (const raw of parseRuntimeStream(streamResponse)) {
      yield mapRuntimeEvent(raw, args.backend);
    }
  } catch (error) {
    yield { type: 'run.failed', error: error instanceof Error ? error.message : String(error), recoverable: true };
  }
}

export async function* parseRuntimeStream(response: Response): AsyncIterable<RuntimeEvent> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let splitIndex = findEventBoundary(buffer);
    while (splitIndex >= 0) {
      const chunk = buffer.slice(0, splitIndex).trim();
      buffer = buffer.slice(splitIndex + (buffer[splitIndex] === '\r' ? 4 : 2));
      const parsed = parseRuntimeChunk(chunk);
      if (parsed) yield parsed;
      splitIndex = findEventBoundary(buffer);
    }
  }
  const parsed = parseRuntimeChunk(buffer.trim());
  if (parsed) yield parsed;
}

export function mapRuntimeEvent(raw: RuntimeEvent, backend: AgentBackendId): AgentEvent {
  const type = String(raw.type ?? raw.event ?? '');
  if (isAgentEvent(raw)) return raw;
  if (type.includes('delta') || type.includes('message')) {
    return { type: 'assistant.delta', text: String(raw.text ?? raw.delta ?? raw.content ?? raw.message ?? '') };
  }
  if (type.includes('tool') && (type.includes('start') || type.includes('call'))) {
    return { type: 'tool.started', name: String(raw.name ?? raw.tool ?? 'tool'), input: raw.input };
  }
  if (type.includes('tool') && (type.includes('complete') || type.includes('result'))) {
    return { type: 'tool.completed', name: String(raw.name ?? raw.tool ?? 'tool'), output: raw.output ?? raw.result };
  }
  if (type.includes('approval')) {
    return { type: 'approval.requested', id: String(raw.id ?? `approval-${Date.now()}`), reason: String(raw.reason ?? 'Agent requested approval.'), tool: typeof raw.tool === 'string' ? raw.tool : undefined };
  }
  if (type.includes('fail') || type.includes('error')) {
    return { type: 'run.failed', error: String(raw.error ?? raw.message ?? `${backend} run failed.`), recoverable: true };
  }
  if (type.includes('complete') || type.includes('done')) {
    return { type: 'run.completed', text: typeof raw.text === 'string' ? raw.text : undefined };
  }
  return { type: 'assistant.delta', text: JSON.stringify(raw) };
}

function parseRuntimeChunk(chunk: string): RuntimeEvent | null {
  if (!chunk) return null;
  const dataLines = chunk
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());
  const payload = dataLines.length > 0 ? dataLines.join('\n') : chunk;
  if (!payload || payload === '[DONE]') return payload === '[DONE]' ? { type: 'run.completed' } : null;
  try {
    return JSON.parse(payload) as RuntimeEvent;
  } catch {
    return { type: 'assistant.delta', text: payload };
  }
}

function findEventBoundary(buffer: string): number {
  const rn = buffer.indexOf('\r\n\r\n');
  const nn = buffer.indexOf('\n\n');
  if (rn === -1) return nn;
  if (nn === -1) return rn;
  return Math.min(rn, nn);
}

function isAgentEvent(raw: RuntimeEvent): raw is AgentEvent {
  return typeof raw.type === 'string' && [
    'run.started',
    'assistant.delta',
    'tool.discovery',
    'tool.started',
    'tool.completed',
    'approval.requested',
    'run.completed',
    'run.failed'
  ].includes(raw.type);
}

function absolutize(base: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return new URL(url, base).toString();
  return `${base}/${url}`;
}

async function safeText(response: Response): Promise<string> {
  return (await response.text().catch(() => '')).slice(0, 400);
}
