import { describe, expect, it, vi } from 'vitest';
import type { AgentBackendId, AgentContextEnvelope, AgentEvent, Conversation, PointerContext } from '@openpointer/core';
import type { AgentBridge, AgentBridgeRegistryConfig } from '@openpointer/agent-bridge';
import type { AppSettings } from '@openpointer/storage';
import { OpenPointerHarness } from './openpointer-harness.js';

function baseSettings(patch: Partial<AppSettings> = {}): AppSettings {
  return {
    agentBackend: 'codex',
    localVlmEnabled: true,
    approvalMode: 'request',
    requireApprovalBeforeCua: true,
    cuaMode: 'prefer',
    cuaAgentCursorEnabled: true,
    cuaBrowserPageToolsEnabled: true,
    cuaPageJavascriptPolicy: 'ask',
    cuaRecordingMode: 'manual',
    cuaDriverHttpPort: 19771,
    ...patch
  } as AppSettings;
}

function pointerContext(patch: Partial<PointerContext> = {}): PointerContext {
  return {
    id: 'ctx-1',
    source: 'desktop',
    cursor: { x: 100, y: 120, localX: 20, localY: 30, displayId: 1, dpr: 1 },
    window: { title: 'Target App', app: 'Target', windowId: '42' },
    entities: [],
    nearby: [],
    createdAt: Date.now(),
    ...patch
  };
}

function createHarness(settings: AppSettings) {
  const submitted: Array<Parameters<OpenPointerHarnessTestTaskManager['submit']>[0]> = [];
  const released: string[] = [];
  const emitted: AgentEvent[] = [];
  const approvals: Array<{ id: string; decision: string; target: 'broker' | 'task' }> = [];
  let brokerPending = false;

  const taskManager: OpenPointerHarnessTestTaskManager = {
    submit: (options) => {
      submitted.push(options);
      return 'task-1';
    },
    emitAgentEvent: (_taskId, event) => {
      emitted.push(event);
    },
    approve: async (id, decision) => {
      approvals.push({ id, decision, target: 'task' });
    }
  };

  const broker = {
    ensureStarted: vi.fn(async () => ({ endpoint: 'http://127.0.0.1:9999/sessions/broker-session/mcp', sessionId: 'broker-session' })),
    releaseSession: (sessionId: string) => {
      released.push(sessionId);
    },
    hasPendingApproval: () => brokerPending,
    approve: (id: string, decision: 'approve' | 'deny') => {
      approvals.push({ id, decision, target: 'broker' });
    }
  };

  const conversation: Conversation = {
    id: 'conv-1',
    turns: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  const chatHistory = {
    appendTurn: vi.fn(async (_conversationId: string, turn: Conversation['turns'][number]) => {
      conversation.turns.push(turn);
      return conversation;
    }),
    getConversation: vi.fn(async () => conversation),
    setBackendSession: vi.fn(async (_conversationId: string, backend: AgentBackendId, sessionId: string) => {
      if (backend === 'claude-agent') conversation.backendSessions = { ...conversation.backendSessions, claudeAgent: { sessionId } };
      if (backend === 'codex') conversation.backendSessions = { ...conversation.backendSessions, codex: { sessionId } };
      return conversation;
    }),
    setClaudeAgentSession: vi.fn(async (_conversationId: string, sessionId: string) => {
      conversation.backendSessions = { claudeAgent: { sessionId } };
      return conversation;
    })
  };

  const bridge: AgentBridge = {
    id: 'mock',
    async *run(): AsyncIterable<AgentEvent> {
      yield { type: 'run.started', runId: 'run-1', backend: 'mock' };
      yield { type: 'assistant.delta', text: 'done' };
      yield { type: 'run.completed', text: 'done' };
    }
  };

  const harness = new OpenPointerHarness({
    taskManager,
    cuaBroker: broker,
    chatHistory,
    getSettings: () => settings,
    bridgeConfig: () => ({}) satisfies AgentBridgeRegistryConfig,
    createOpenPointerTools: () => ({}),
    allowedCuaTools: ['list_windows', 'click'],
    createBridge: () => bridge,
    resolveBackend: () => 'mock'
  });

  return {
    harness,
    submitted,
    broker,
    released,
    emitted,
    approvals,
    setBrokerPending: (value: boolean) => {
      brokerPending = value;
    }
  };
}

type OpenPointerHarnessTestTaskManager = {
  submit(options: {
    conversationId: string;
    instruction: string;
    windowTitle?: string;
    bridge: AgentBridge;
    envelope: AgentContextEnvelope;
    brokerSessionId?: string;
    backendSessionId?: string;
    allowLocalFallback: boolean;
    cleanup?: () => void;
    runner: (task: never, emitAgentEvent: (event: AgentEvent) => void) => Promise<void>;
  }): string;
  emitAgentEvent(taskId: string, event: AgentEvent): void;
  approve(id: string, decision: 'approve' | 'deny' | 'always_allow'): Promise<void>;
};

describe('OpenPointerHarness', () => {
  it('builds an envelope and attaches the CUA tool server for desktop-control intent', async () => {
    const { harness, submitted, broker } = createHarness(baseSettings());

    const result = await harness.submit({
      text: 'click the selected button',
      mode: 'text',
      context: pointerContext(),
      backend: 'auto'
    });

    expect(result).toMatchObject({ backend: 'mock', conversationId: expect.stringMatching(/^conv-/), taskId: 'task-1' });
    expect(broker.ensureStarted).toHaveBeenCalledOnce();
    expect(broker.ensureStarted).toHaveBeenCalledWith(expect.objectContaining({ approvalMode: 'request' }));
    expect(submitted).toHaveLength(1);
    const task = submitted[0];
    expect(task).toBeDefined();
    expect(task!.envelope.toolServers).toEqual([
      {
        id: 'cua',
        transport: 'local-http',
        sessionId: 'broker-session',
        endpoint: 'http://127.0.0.1:9999/sessions/broker-session/mcp',
        tools: ['list_windows', 'click']
      }
    ]);
    expect(task!.envelope.routing.backend).toBe('mock');
  });

  it('does not attach the CUA tool server when CUA mode is off', async () => {
    const { harness, submitted, broker } = createHarness(baseSettings({ cuaMode: 'off' }));

    await harness.submit({
      text: 'click the selected button',
      mode: 'text',
      context: pointerContext()
    });

    expect(broker.ensureStarted).not.toHaveBeenCalled();
    expect(submitted[0]?.envelope.toolServers).toBeUndefined();
  });

  it('attaches submitted capability hints to the agent envelope', async () => {
    const { harness, submitted } = createHarness(baseSettings());

    await harness.submit({
      text: 'summarize the selected paper',
      mode: 'text',
      context: pointerContext(),
      capabilityHints: {
        mcp: [
          {
            id: 'mcp-zotero',
            kind: 'mcp',
            name: 'zotero',
            description: 'Reference manager MCP',
            backendIds: ['mock'],
            sources: ['native'],
            matchedKeywords: ['paper']
          }
        ],
        skills: []
      }
    });

    expect(submitted[0]?.envelope.capabilityHints?.mcp[0]?.name).toBe('zotero');
  });

  it('routes approvals to the broker before backend bridges', async () => {
    const { harness, approvals, setBrokerPending } = createHarness(baseSettings());

    setBrokerPending(true);
    await harness.approve('approval-1', 'always_allow');
    setBrokerPending(false);
    await harness.approve('approval-2', 'deny');

    expect(approvals).toEqual([
      { id: 'approval-1', decision: 'approve', target: 'broker' },
      { id: 'approval-2', decision: 'deny', target: 'task' }
    ]);
  });
});
