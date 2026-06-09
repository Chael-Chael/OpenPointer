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

  it('lists OpenPointer local text tools alongside sidecar tools', async () => {
    const sidecar = {
      callTool: vi.fn(async () => okResult),
      listTools: vi.fn(async () => [{ name: 'click', description: 'Click an element.' }])
    };
    const broker = new CuaBroker(sidecar as never);
    brokers.push(broker);
    const session = await broker.ensureStarted({
      ...brokerDefaults,
      requireApprovalBeforeCua: false,
      allowedTools: ['click', 'read_selected_text', 'insert_text', 'replace_text'],
      localTools: {
        read_selected_text: vi.fn(async () => okResult),
        insert_text: vi.fn(async () => okResult),
        replace_text: vi.fn(async () => okResult)
      },
      emit: vi.fn()
    });

    const response = await fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    const names = body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['click', 'read_selected_text', 'insert_text', 'replace_text']));
    expect(body.result.tools.find((tool: { name: string }) => tool.name === 'replace_text')).toMatchObject({
      description: expect.stringContaining('Replace or clear'),
      inputSchema: expect.objectContaining({ required: ['text'] })
    });
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

  it('allows all CUA tool calls without approval when approval mode is allow-all', async () => {
    const { broker, sidecarCall } = createBroker();
    const emit = vi.fn();
    const session = await broker.ensureStarted({
      ...brokerDefaults,
      approvalMode: 'allow-all',
      requireApprovalBeforeCua: true,
      allowedTools: ['kill_app'],
      emit
    });

    const response = await fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'kill_app', arguments: {} } })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { content: [{ text: 'ok' }] } });
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'approval.requested' }));
    expect(sidecarCall).toHaveBeenCalledWith('kill_app', { session: session.sessionId });
  });

  it('returns sidecar tool failures as MCP tool results', async () => {
    const sidecarFailure: CuaToolResult = {
      isError: true,
      content: [{ type: 'text', text: 'CUA tool "click" failed before Claude MCP timeout: CUA request timed out after 15000ms.' }],
      structuredContent: {
        openpointerCuaError: {
          tool: 'click',
          timeoutMs: 15000
        }
      }
    };
    const { broker } = createBroker(vi.fn(async () => sidecarFailure) as SidecarCall);
    const session = await broker.ensureStarted({
      ...brokerDefaults,
      requireApprovalBeforeCua: false,
      allowedTools: ['click'],
      emit: vi.fn()
    });

    const response = await fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'click', arguments: {} } })
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).not.toHaveProperty('error');
    expect(body).toMatchObject({
      result: {
        isError: true,
        content: [{ text: expect.stringContaining('failed before Claude MCP timeout') }],
        structuredContent: {
          openpointerCuaError: {
            tool: 'click',
            timeoutMs: 15000
          }
        }
      }
    });
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

  it('keeps post-tool verification inside the serialized path for parallel agent MCP tasks', async () => {
    const clickRelease = deferred<void>();
    const verificationStarted = deferred<void>();
    const verificationRelease = deferred<void>();
    const events: string[] = [];
    const sidecarCall = vi.fn(async (name: string) => {
      if (name === 'click') {
        events.push('click');
        await clickRelease.promise;
        return okResult;
      }
      if (name === 'get_window_state') {
        events.push('verify-start');
        verificationStarted.resolve();
        await verificationRelease.promise;
        events.push('verify-end');
        return {
          content: [{ type: 'text', text: 'verified' }],
          structuredContent: {
            elements: [{ id: 'submit' }],
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
      allowedTools: ['click', 'replace_text', 'list_windows'],
      localTools: {
        replace_text: async () => {
          events.push('replace');
          return okResult;
        }
      },
      emit: vi.fn()
    });

    const click = fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'click', arguments: { pid: 123, window_id: 456, element_index: 7 } }
      })
    });
    await waitFor(() => events.includes('click'));

    const replace = fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'replace_text', arguments: { text: 'updated value' } }
      })
    });

    clickRelease.resolve();
    await verificationStarted.promise;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(events).toEqual(['click', 'verify-start']);

    verificationRelease.resolve();
    await expect(click).resolves.toMatchObject({ status: 200 });
    await expect(replace).resolves.toMatchObject({ status: 200 });
    expect(events).toEqual(['click', 'verify-start', 'verify-end', 'replace']);
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
