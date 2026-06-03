import { afterEach, describe, expect, it, vi } from 'vitest';
import { CuaBroker } from './cua-broker.js';
import type { CuaToolResult } from './cua-sidecar.js';

const okResult: CuaToolResult = { content: [{ type: 'text', text: 'ok' }] };

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

  function createBroker(sidecarCall = vi.fn(async () => okResult)) {
    const broker = new CuaBroker({ callTool: sidecarCall } as never);
    brokers.push(broker);
    return { broker, sidecarCall };
  }

  it('rejects tools outside the session allowlist', async () => {
    const { broker, sidecarCall } = createBroker();
    const session = await broker.ensureStarted({
      requireApprovalBeforeCua: false,
      allowedTools: ['list_windows'],
      emit: vi.fn()
    });

    const response = await fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({ name: 'click', arguments: {} })
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'CUA tool "click" is not allowed.' });
    expect(sidecarCall).not.toHaveBeenCalled();
  });

  it('requires approval before state-changing tool calls', async () => {
    const { broker, sidecarCall } = createBroker();
    let approvalId = '';
    const session = await broker.ensureStarted({
      requireApprovalBeforeCua: true,
      allowedTools: ['click'],
      emit: (event) => {
        if (event.type === 'approval.requested') approvalId = event.id;
      }
    });

    const request = fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({ name: 'click', arguments: {} })
    });
    await waitFor(() => Boolean(approvalId));
    broker.approve(approvalId, 'deny');
    const response = await request;

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'CUA tool call denied by user.' });
    expect(sidecarCall).not.toHaveBeenCalled();
  });

  it('serializes state-changing desktop tool execution', async () => {
    const { broker } = createBroker();
    const firstRelease = deferred<void>();
    const started: string[] = [];
    const session = await broker.ensureStarted({
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
      body: JSON.stringify({ name: 'click', arguments: { label: 'first' } })
    });
    await waitFor(() => started.includes('first'));

    const second = fetch(session.endpoint, {
      method: 'POST',
      body: JSON.stringify({ name: 'click', arguments: { label: 'second' } })
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(started).toEqual(['first']);

    firstRelease.resolve();
    await expect(first).resolves.toMatchObject({ status: 200 });
    await expect(second).resolves.toMatchObject({ status: 200 });
    expect(started).toEqual(['first', 'second']);
  });
});
