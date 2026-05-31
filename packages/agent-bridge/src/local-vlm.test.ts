import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalVlmBridge } from './local-vlm.js';
import { buildAgentContextEnvelope } from './routing.js';
import type { PointerContext } from '@openmagicpointer/core';

const originalFetch = globalThis.fetch;

const context: PointerContext = {
  id: 'ctx',
  source: 'desktop',
  cursor: { x: 1, y: 2, localX: 1, localY: 2, displayId: 1, dpr: 1 },
  visual: {
    screenshotId: 'screen',
    imageBase64: 'abc',
    mimeType: 'image/jpeg'
  },
  entities: [],
  nearby: [],
  createdAt: 1
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('LocalVlmBridge', () => {
  it('returns a recoverable error when not configured', async () => {
    const bridge = new LocalVlmBridge(undefined);
    const events = [];
    for await (const event of bridge.run(buildAgentContextEnvelope({ instruction: 'what is this', mode: 'text', context }))) events.push(event);
    expect(events).toEqual([{ type: 'run.failed', error: 'Local VLM is not configured. Add a local VLM base URL and API key.', recoverable: true }]);
  });

  it('answers without emitting tool events', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: 'answer' } }], model: 'vlm' }), { status: 200 })
    ) as typeof fetch;
    const bridge = new LocalVlmBridge({ baseUrl: 'http://local/v1', apiKey: 'key', model: 'vlm' });
    const events = [];
    for await (const event of bridge.run(buildAgentContextEnvelope({ instruction: 'what is this', mode: 'text', context }))) events.push(event);
    expect(events.map((event) => event.type)).toEqual(['run.started', 'assistant.delta', 'run.completed']);
    expect(events.some((event) => event.type.startsWith('tool.'))).toBe(false);
  });
});
