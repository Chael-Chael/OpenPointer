import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexBridge, HermesBridge } from './http-bridges.js';
import { buildAgentContextEnvelope } from './routing.js';
import type { PointerContext } from '@openpointer/core';

const servers: Array<{ close(cb?: () => void): void }> = [];

const context: PointerContext = {
  id: 'ctx',
  source: 'desktop',
  cursor: { x: 1, y: 2, localX: 1, localY: 2, displayId: 1, dpr: 1 },
  entities: [],
  nearby: [],
  createdAt: 1
};

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.length = 0;
});

describe('HermesBridge', () => {
  it('maps run events from a Hermes-style SSE endpoint', async () => {
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/v1/runs') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ id: 'run-1', events_url: '/v1/runs/run-1/events' }));
        return;
      }
      if (req.method === 'GET' && req.url === '/v1/runs/run-1/events') {
        res.setHeader('Content-Type', 'text/event-stream');
        res.end(
          [
            'data: {"type":"assistant.delta","text":"hello"}',
            '',
            'data: {"type":"tool.started","name":"mcp"}',
            '',
            'data: {"type":"run.completed","text":"done"}',
            '',
            ''
          ].join('\n')
        );
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    servers.push(server);
    const port = await new Promise<number>((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const bridge = new HermesBridge({ baseUrl: `http://127.0.0.1:${port}/v1` });
    const envelope = buildAgentContextEnvelope({ instruction: 'explain this', mode: 'text', context, backend: 'hermes' });
    const events = [];
    for await (const event of bridge.run(envelope)) events.push(event);
    expect(events.map((event) => event.type)).toEqual(['tool.discovery', 'run.started', 'assistant.delta', 'tool.started', 'run.completed']);
  });
});

describe('CodexBridge', () => {
  it('posts OpenPointer context to the Python SDK adapter shape', async () => {
    let requestBody: Record<string, unknown> | null = null;
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/v1/runs') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
          requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ id: 'codex-run-1', events_url: '/v1/runs/codex-run-1/events' }));
        });
        return;
      }
      if (req.method === 'GET' && req.url === '/v1/runs/codex-run-1/events') {
        res.setHeader('Content-Type', 'text/event-stream');
        res.end(['data: {"type":"backend.session","backend":"codex","sessionId":"thr_123"}', '', 'data: {"type":"run.completed","text":"done"}', '', ''].join('\n'));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    servers.push(server);
    const port = await new Promise<number>((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const bridge = new CodexBridge({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'gpt-5.4', effort: 'low' });
    const envelope = buildAgentContextEnvelope({ instruction: 'fix the bug', mode: 'text', context, backend: 'codex' });
    const events = [];
    for await (const event of bridge.run(envelope, { sessionKey: 'openpointer-session' })) events.push(event);

    const postedBody = requestBody as Record<string, unknown> | null;
    expect(postedBody?.thread).toBe('openpointer-session');
    expect(postedBody?.cwd).toBe(process.cwd());
    expect(postedBody?.model).toBe('gpt-5.4');
    expect(postedBody?.effort).toBe('low');
    expect(postedBody?.sandbox).toBe('workspace-write');
    expect(events.map((event) => event.type)).toEqual(['tool.discovery', 'run.started', 'backend.session', 'run.completed']);
  });
});
