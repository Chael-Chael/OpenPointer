import { describe, expect, it } from 'vitest';
import { MockAgentBridge } from './mock.js';
import { buildAgentContextEnvelope } from './routing.js';
import type { PointerContext } from '@openpointer/core';

const context: PointerContext = {
  id: 'ctx',
  source: 'desktop',
  cursor: { x: 1, y: 2, localX: 1, localY: 2, displayId: 1, dpr: 1 },
  entities: [],
  nearby: [],
  createdAt: 1
};

describe('MockAgentBridge', () => {
  it('simulates a full event lifecycle', async () => {
    const bridge = new MockAgentBridge();
    const envelope = buildAgentContextEnvelope({
      instruction: 'click this item',
      mode: 'text',
      context,
      backend: 'mock'
    });
    const events = [];
    for await (const event of bridge.run(envelope)) events.push(event.type);
    expect(events).toContain('run.started');
    expect(events).toContain('tool.discovery');
    expect(events).toContain('approval.requested');
    expect(events).toContain('run.completed');
  });
});
