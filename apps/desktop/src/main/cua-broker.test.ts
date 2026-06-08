import { afterEach, describe, expect, it, vi } from 'vitest';
import { CuaBroker } from './cua-broker.js';
import type { CuaToolResult } from './cua-sidecar.js';

const okResult: CuaToolResult = { content: [{ type: 'text', text: 'ok' }] };
const brokerDefaults = {
  cuaAgentCursorEnabled: true,
  cuaPageJavascriptPolicy: 'ask' as const
};
type SidecarCall = (name: string, args?: Record<string, unknown>) => Promise<CuaToolResult>;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('CuaBroker', () => {
  const brokers: CuaBroker[] = [];

  afterEach(() => {
    for (const broker of brokers.splice(0)) broker.stop();
  });

  function createBroker(sidecarCall: SidecarCall = vi.fn(async () => okResult) as SidecarCall) {
    const broker = new CuaBroker({ callTool: sidecarCall } as never);
    brokers.push(broker);
    return { broker, sidecarCall };
  }

  it('rejects tools outside the session allowlist', async () => {
    const { broker, sidecarCall } = createBroker();
    const session = await broker.ensureStarted({
      ...brokerDefaults,
      requireApprovalBeforeCua: false,
      allowedTools: ['list_windows'],
      emit: vi.fn()
    });

    const response = await fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'click', arguments: {} } })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { isError: true, content: [{ text: 'CUA tool "click" is not allowed.' }] } });
    expect(sidecarCall).not.toHaveBeenCalled();
  });

  it('requires approval before state-changing tool calls', async () => {
    const { broker, sidecarCall } = createBroker();
    let approvalId = '';
    const session = await broker.ensureStarted({
      ...brokerDefaults,
      requireApprovalBeforeCua: true,
      allowedTools: ['click'],
      emit: (event) => {
        if (event.type === 'approval.requested') approvalId = event.id;
      }
    });

    const request = fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'click', arguments: {} } })
    });
    await waitFor(() => Boolean(approvalId));
    broker.approve(approvalId, 'deny');
    const response = await request;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { isError: true } });
    expect(sidecarCall).not.toHaveBeenCalled();
  });

  it('restores the overlay before emitting CUA approval requests', async () => {
    const { broker, sidecarCall } = createBroker();
    const events: string[] = [];
    let approvalId = '';
    const session = await broker.ensureStarted({
      ...brokerDefaults,
      requireApprovalBeforeCua: true,
      allowedTools: ['click'],
      showDesktopInteractionApproval: () => {
        events.push('show');
      },
      emit: (event) => {
        if (event.type === 'approval.requested') {
          approvalId = event.id;
          events.push('approval');
        }
      }
    });

    const request = fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'click', arguments: {} } })
    });
    await waitFor(() => Boolean(approvalId));

    expect(events).toEqual(['show', 'approval']);
    broker.approve(approvalId, 'deny');
    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(sidecarCall).not.toHaveBeenCalled();
  });

  it('serializes state-changing desktop tool execution', async () => {
    const { broker } = createBroker();
    const firstRelease = deferred<void>();
    const started: string[] = [];
    const session = await broker.ensureStarted({
      ...brokerDefaults,
      requireApprovalBeforeCua: false,
      allowedTools: ['click'],
      localTools: {
        click: async (args) => {
          const label = String(args.label);
          started.push(label);
          if (label === 'first') await firstRelease.promise;
          return okResult;
        }
      },
      emit: vi.fn()
    });

    const first = fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'click', arguments: { label: 'first' } } })
    });
    await waitFor(() => started.includes('first'));

    const second = fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'click', arguments: { label: 'second' } } })
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(started).toEqual(['first']);

    firstRelease.resolve();
    await expect(first).resolves.toMatchObject({ status: 200 });
    await expect(second).resolves.toMatchObject({ status: 200 });
    expect(started).toEqual(['first', 'second']);
  });

  it('hides the overlay around state-changing desktop tool execution', async () => {
    const events: string[] = [];
    const { broker } = createBroker(async (name) => {
      events.push(`tool:${name}`);
      return okResult;
    });
    const session = await broker.ensureStarted({
      ...brokerDefaults,
      requireApprovalBeforeCua: false,
      allowedTools: ['click'],
      withDesktopInteractionHidden: async (work) => {
        events.push('hide');
        try {
          return await work();
        } finally {
          events.push('restore');
        }
      },
      emit: vi.fn()
    });

    const response = await fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'click', arguments: {} } })
    });

    expect(response.status).toBe(200);
    expect(events).toEqual(['hide', 'tool:click', 'restore']);
  });

  it('hides the overlay around CUA window observation but not driver metadata reads', async () => {
    const events: string[] = [];
    const { broker } = createBroker(async (name) => {
      events.push(`tool:${name}`);
      return okResult;
    });
    const session = await broker.ensureStarted({
      ...brokerDefaults,
      requireApprovalBeforeCua: false,
      allowedTools: ['get_window_state', 'list_windows'],
      withDesktopInteractionHidden: async (work) => {
        events.push('hide');
        try {
          return await work();
        } finally {
          events.push('restore');
        }
      },
      emit: vi.fn()
    });

    const windowState = await fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_window_state', arguments: {} } })
    });
    const listWindows = await fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_windows', arguments: {} } })
    });

    expect(windowState.status).toBe(200);
    expect(listWindows.status).toBe(200);
    expect(events).toEqual(['hide', 'tool:get_window_state', 'restore', 'tool:list_windows']);
  });

  it('hides the overlay around replayed CUA recordings', async () => {
    const events: string[] = [];
    const { broker } = createBroker(async (name) => {
      events.push(`tool:${name}`);
      return okResult;
    });
    let approvalId = '';
    const session = await broker.ensureStarted({
      ...brokerDefaults,
      requireApprovalBeforeCua: true,
      allowedTools: ['replay_trajectory'],
      withDesktopInteractionHidden: async (work) => {
        events.push('hide');
        try {
          return await work();
        } finally {
          events.push('restore');
        }
      },
      emit: (event) => {
        if (event.type === 'approval.requested') approvalId = event.id;
      }
    });

    const replay = broker.replayRecording(session.sessionId, 'recording-dir');
    await waitFor(() => Boolean(approvalId));
    broker.approve(approvalId, 'approve');
    await expect(replay).resolves.toEqual(okResult);

    expect(events).toEqual(['hide', 'tool:replay_trajectory', 'restore']);
  });

  it('declares and reuses a CUA driver session for cursor tools', async () => {
    const sidecarCall = vi.fn(async () => okResult);
    const startSession = vi.fn(async () => undefined);
    const endSession = vi.fn(async () => undefined);
    const broker = new CuaBroker({ callTool: sidecarCall, startSession, endSession } as never);
    brokers.push(broker);

    const session = await broker.ensureStarted({
      ...brokerDefaults,
      requireApprovalBeforeCua: false,
      allowedTools: ['click', 'list_windows'],
      emit: vi.fn()
    });

    expect(startSession).toHaveBeenCalledWith(session.sessionId);

    const clickResponse = await fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'click', arguments: { pid: 123, window_id: 456, element_index: 7 } }
      })
    });
    expect(clickResponse.status).toBe(200);
    expect(sidecarCall).toHaveBeenCalledWith(
      'click',
      expect.objectContaining({
        pid: 123,
        window_id: 456,
        element_index: 7,
        session: session.sessionId
      })
    );

    const listResponse = await fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_windows', arguments: {} } })
    });
    expect(listResponse.status).toBe(200);
    expect(sidecarCall).toHaveBeenCalledWith('list_windows', { session: session.sessionId });

    broker.releaseSession(session.sessionId);
    expect(endSession).toHaveBeenCalledWith(session.sessionId);
  });

  it('emits post-tool verification after grounded state-changing calls', async () => {
    const events: string[] = [];
    const emitted: unknown[] = [];
    const sidecarCall = vi.fn(async (name: string) => {
      events.push(`tool:${name}`);
      if (name === 'get_window_state') {
        return {
          content: [{ type: 'text', text: 'window observed' }],
          structuredContent: {
            elements: [{ id: 1 }, { id: 2 }],
            screenshot_width: 800,
            screenshot_height: 600
          }
        };
      }
      return okResult;
    });
    const { broker } = createBroker(sidecarCall);
    const session = await broker.ensureStarted({
      ...brokerDefaults,
      requireApprovalBeforeCua: false,
      allowedTools: ['click'],
      withDesktopInteractionHidden: async (work) => {
        events.push('hide');
        try {
          return await work();
        } finally {
          events.push('restore');
        }
      },
      emit: (event) => {
        emitted.push(event);
      }
    });

    const response = await fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'click', arguments: { pid: 123, window_id: 456, element_index: 7 } }
      })
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.structuredContent.openpointerVerification).toMatchObject({
      status: 'observed',
      strategy: 'uia-state',
      target: { pid: 123, windowId: 456, elementIndex: 7 },
      summary: { elementCount: 2, screenshotWidth: 800, screenshotHeight: 600 }
    });
    expect(events).toEqual(['hide', 'tool:click', 'restore', 'hide', 'tool:get_window_state', 'restore']);
    expect(emitted).toEqual([
      expect.objectContaining({ type: 'tool.started', name: 'click' }),
      expect.objectContaining({
        type: 'tool.completed',
        name: 'click',
        output: expect.objectContaining({
          verification: expect.objectContaining({ status: 'observed', strategy: 'uia-state' })
        })
      })
    ]);
  });
});
