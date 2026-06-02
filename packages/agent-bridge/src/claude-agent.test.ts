import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeAgentBridge } from './claude-agent.js';
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

const tempDirs: string[] = [];

function tempPermissionStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'op-claude-permissions-'));
  tempDirs.push(dir);
  return join(dir, 'claude-permissions.json');
}

afterEach(() => {
  delete process.env.OP_CUA_DRIVER_PATH;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('ClaudeAgentBridge', () => {
  it('surfaces SDK tool permission requests and resolves one-time approval decisions', async () => {
    let decision: unknown;
    const bridge = new ClaudeAgentBridge({
      enabled: true,
      sdk: {
        async *query(args: unknown) {
          const options = (args as { options: { canUseTool: (...args: unknown[]) => Promise<unknown> } }).options;
          decision = await options.canUseTool(
            'mcp__zotero__search',
            {},
            {
              toolUseID: 'tool-1',
              title: 'Claude wants to use Zotero MCP.',
              displayName: 'Zotero MCP',
              suggestions: [{ type: 'addRules', rules: [{ toolName: 'mcp__zotero__search' }], behavior: 'allow', destination: 'session' }]
            }
          );
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
          decision = await options.canUseTool(
            'mcp__zotero__search',
            {},
            {
              toolUseID: 'tool-2',
              title: 'Claude wants to use Zotero MCP.',
              displayName: 'Zotero MCP',
              suggestions: [{ type: 'addRules', rules: [{ toolName: 'mcp__zotero__search' }], behavior: 'allow', destination: 'session' }]
            }
          );
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

  it('persists always-allow rules across bridge instances', async () => {
    const permissionStorePath = tempPermissionStorePath();
    const suggestions = [{ type: 'addRules', rules: [{ toolName: 'mcp__zotero__search' }], behavior: 'allow', destination: 'session' }];
    const firstBridge = new ClaudeAgentBridge({
      enabled: true,
      permissionStorePath,
      sdk: {
        async *query(args: unknown) {
          const options = (args as { options: { canUseTool: (...args: unknown[]) => Promise<unknown> } }).options;
          await options.canUseTool(
            'mcp__zotero__search',
            {},
            {
              toolUseID: 'tool-3',
              title: 'Claude wants to use Zotero MCP.',
              displayName: 'Zotero MCP',
              suggestions
            }
          );
          yield { type: 'result', result: 'done' };
        }
      }
    });
    const envelope = buildAgentContextEnvelope({ instruction: 'summarize this paper', mode: 'text', context, backend: 'claude-agent' });
    const firstIterator = firstBridge.run(envelope)[Symbol.asyncIterator]();

    expect((await firstIterator.next()).value.type).toBe('tool.discovery');
    expect((await firstIterator.next()).value.type).toBe('run.started');
    const approval = (await firstIterator.next()).value;
    expect(approval).toMatchObject({ type: 'approval.requested', id: 'tool-3', tool: 'Zotero MCP' });
    await firstBridge.approve('tool-3', 'always_allow');
    expect((await firstIterator.next()).value).toMatchObject({ type: 'run.completed', text: 'done' });
    await firstIterator.return?.();

    expect(JSON.parse(readFileSync(permissionStorePath, 'utf8'))).toMatchObject({
      version: 1,
      rules: [{ toolName: 'mcp__zotero__search' }]
    });

    let secondDecision: unknown;
    const secondBridge = new ClaudeAgentBridge({
      enabled: true,
      permissionStorePath,
      sdk: {
        async *query(args: unknown) {
          const options = (args as { options: { canUseTool: (...args: unknown[]) => Promise<unknown> } }).options;
          secondDecision = await options.canUseTool(
            'mcp__zotero__search',
            {},
            {
              toolUseID: 'tool-4',
              title: 'Claude wants to use Zotero MCP.',
              displayName: 'Zotero MCP',
              suggestions
            }
          );
          yield { type: 'result', result: 'done' };
        }
      }
    });
    const secondIterator = secondBridge.run(envelope)[Symbol.asyncIterator]();

    expect((await secondIterator.next()).value.type).toBe('tool.discovery');
    expect((await secondIterator.next()).value.type).toBe('run.started');
    expect((await secondIterator.next()).value).toMatchObject({ type: 'run.completed', text: 'done' });
    expect(secondDecision).toMatchObject({
      behavior: 'allow',
      toolUseID: 'tool-4',
      decisionClassification: 'user_permanent'
    });
    await secondIterator.return?.();
  });

  it('injects the local CUA MCP server when the envelope carries CUA context', async () => {
    const driverDir = mkdtempSync(join(tmpdir(), 'op-cua-driver-'));
    tempDirs.push(driverDir);
    const driverPath = join(driverDir, process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver');
    writeFileSync(driverPath, '');
    process.env.OP_CUA_DRIVER_PATH = driverPath;

    let capturedOptions: Record<string, unknown> | undefined;
    const bridge = new ClaudeAgentBridge({
      enabled: true,
      sdk: {
        async *query(args: unknown) {
          capturedOptions = (args as { options?: Record<string, unknown> }).options;
          yield { type: 'result', result: 'done' };
        }
      }
    });
    const envelope = buildAgentContextEnvelope({ instruction: 'click this button', mode: 'text', context, backend: 'claude-agent' });
    const events: unknown[] = [];
    for await (const event of bridge.run(envelope)) events.push(event);

    expect(events.at(-1)).toMatchObject({ type: 'run.completed' });
    expect(capturedOptions?.allowedTools).toBeUndefined();
    expect(capturedOptions?.mcpServers).toMatchObject({
      cua: {
        type: 'stdio',
        command: driverPath,
        args: ['mcp'],
        alwaysLoad: true
      }
    });
  });

  it('resolves Windows npm Claude wrappers to the real JS CLI for SDK spawning', async () => {
    const wrapperDir = mkdtempSync(join(tmpdir(), 'op-claude-wrapper-'));
    tempDirs.push(wrapperDir);
    const wrapperPath = join(wrapperDir, process.platform === 'win32' ? 'claude.cmd' : 'claude');
    const cliPath = join(wrapperDir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    mkdirSync(join(wrapperDir, 'node_modules', '@anthropic-ai', 'claude-code'), { recursive: true });
    writeFileSync(wrapperPath, '');
    writeFileSync(cliPath, '', { flag: 'wx' });

    let capturedOptions: Record<string, unknown> | undefined;
    const bridge = new ClaudeAgentBridge({
      enabled: true,
      executable: wrapperPath,
      sdk: {
        async *query(args: unknown) {
          capturedOptions = (args as { options?: Record<string, unknown> }).options;
          yield { type: 'result', result: 'done' };
        }
      }
    });
    const events: unknown[] = [];
    for await (const event of bridge.run(buildAgentContextEnvelope({ instruction: 'summarize this paper', mode: 'text', context, backend: 'claude-agent' }))) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({ type: 'run.completed' });
    expect(capturedOptions?.pathToClaudeCodeExecutable).toBe(cliPath);
  });
});
