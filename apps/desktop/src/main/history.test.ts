import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PointerContext } from '@openpointer/core';

let userDataDir = '';

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}));

const context: PointerContext = {
  id: 'ctx',
  source: 'desktop',
  cursor: { x: 1, y: 2, localX: 1, localY: 2, displayId: 1, dpr: 1 },
  entities: [],
  nearby: [],
  createdAt: 1
};

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'op-history-'));
  vi.resetModules();
});

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true });
  userDataDir = '';
});

describe('ChatHistoryManager backend sessions', () => {
  it('persists a Claude Agent session id on an existing conversation', async () => {
    const { ChatHistoryManager } = await import('./history.js');
    const history = new ChatHistoryManager();

    await history.appendTurn('conv-1', {
      id: 'turn-1',
      role: 'user',
      text: 'hello',
      pointerContext: context,
      timestamp: 1
    });
    await history.setClaudeAgentSession('conv-1', '550e8400-e29b-41d4-a716-446655440000');

    const conversation = await history.getConversation('conv-1');
    expect(conversation?.backendSessions?.claudeAgent?.sessionId).toBe('550e8400-e29b-41d4-a716-446655440000');

    const persisted = JSON.parse(readFileSync(join(userDataDir, 'chat_history.json'), 'utf8'));
    expect(persisted[0].backendSessions.claudeAgent.sessionId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('persists a Codex session id on an existing conversation', async () => {
    const { ChatHistoryManager } = await import('./history.js');
    const history = new ChatHistoryManager();

    await history.appendTurn('conv-1', {
      id: 'turn-1',
      role: 'user',
      text: 'hello',
      pointerContext: context,
      timestamp: 1
    });
    await history.setBackendSession('conv-1', 'codex', 'thr_123');

    const conversation = await history.getConversation('conv-1');
    expect(conversation?.backendSessions?.codex?.sessionId).toBe('thr_123');

    const persisted = JSON.parse(readFileSync(join(userDataDir, 'chat_history.json'), 'utf8'));
    expect(persisted[0].backendSessions.codex.sessionId).toBe('thr_123');
  });

  it('returns null when asked to store a Claude session for a missing conversation', async () => {
    const { ChatHistoryManager } = await import('./history.js');
    const history = new ChatHistoryManager();

    await expect(history.setClaudeAgentSession('missing', '550e8400-e29b-41d4-a716-446655440000')).resolves.toBeNull();
  });
});
