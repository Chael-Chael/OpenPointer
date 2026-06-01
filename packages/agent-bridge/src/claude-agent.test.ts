import { describe, expect, it } from 'vitest';
import { ClaudeAgentBridge } from './claude-agent.js';
import { buildAgentContextEnvelope } from './routing.js';
import type { PointerContext } from '@openmagicpointer/core';

const context: PointerContext = {
  id: 'ctx',
  source: 'desktop',
  cursor: { x: 1, y: 2, localX: 1, localY: 2, displayId: 1, dpr: 1 },
  entities: [],
  nearby: [],
  createdAt: 1
};

describe('ClaudeAgentBridge', () => {
  it('surfaces SDK tool permission requests and resolves one-time approval decisions', async () => {
    let decision: unknown;
    const bridge = new ClaudeAgentBridge({
      enabled: true,
      sdk: {
        async *query(args: unknown) {
          const options = (args as { options: { canUseTool: (...args: unknown[]) => Promise<unknown> } }).options;
          decision = await options.canUseTool('mcp__zotero__search', {}, {
            toolUseID: 'tool-1',
            title: 'Claude wants to use Zotero MCP.',
            displayName: 'Zotero MCP',
            suggestions: [{ type: 'addRules', rules: [{ toolName: 'mcp__zotero__search' }], behavior: 'allow', destination: 'session' }]
          });
          yield { type: 'result', result: 'done' };
        }
      }
    });
    const envelope = buildAgentContextEnvelope({ instruction: 'summarize this paper', mode: 'text', context, backend: 'claude-agent' });
    const iterator = bridge.run(envelope)[Symbol.asyncIterator]();

    expect((await iterator.next()).value.type).toBe('tool.discovery');
    expect((await iterator.next()).value.type).toBe('run.started');
    const approval = (await iterator.next()).value;
    expect(approval).toMatchObject({ type: 'approval.requested', id: 'tool-1', tool: 'Zotero MCP' });

    await bridge.approve('tool-1', 'approve');
    expect((await iterator.next()).value).toMatchObject({ type: 'run.completed', text: 'done' });
    expect(decision).toMatchObject({ behavior: 'allow', toolUseID: 'tool-1' });
    expect(decision).not.toHaveProperty('updatedPermissions');
    await iterator.return?.();
  });

  it('returns SDK permission suggestions only for always-allow approvals', async () => {
    let decision: unknown;
    const bridge = new ClaudeAgentBridge({
      enabled: true,
      sdk: {
        async *query(args: unknown) {
          const options = (args as { options: { canUseTool: (...args: unknown[]) => Promise<unknown> } }).options;
          decision = await options.canUseTool('mcp__zotero__search', {}, {
            toolUseID: 'tool-2',
            title: 'Claude wants to use Zotero MCP.',
            displayName: 'Zotero MCP',
            suggestions: [{ type: 'addRules', rules: [{ toolName: 'mcp__zotero__search' }], behavior: 'allow', destination: 'session' }]
          });
          yield { type: 'result', result: 'done' };
        }
      }
    });
    const envelope = buildAgentContextEnvelope({ instruction: 'summarize this paper', mode: 'text', context, backend: 'claude-agent' });
    const iterator = bridge.run(envelope)[Symbol.asyncIterator]();

    expect((await iterator.next()).value.type).toBe('tool.discovery');
    expect((await iterator.next()).value.type).toBe('run.started');
    const approval = (await iterator.next()).value;
    expect(approval).toMatchObject({ type: 'approval.requested', id: 'tool-2', tool: 'Zotero MCP' });

    await bridge.approve('tool-2', 'always_allow');
    expect((await iterator.next()).value).toMatchObject({ type: 'run.completed', text: 'done' });
    expect(decision).toMatchObject({
      behavior: 'allow',
      toolUseID: 'tool-2',
      decisionClassification: 'user_permanent',
      updatedPermissions: [{ type: 'addRules', rules: [{ toolName: 'mcp__zotero__search' }], behavior: 'allow', destination: 'session' }]
    });
    await iterator.return?.();
  });
});
