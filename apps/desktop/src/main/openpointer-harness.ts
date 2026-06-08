import {
  buildAgentContextEnvelope,
  createAgentBridge,
  resolveBackendForEnvelope,
  type AgentBridge,
  type AgentBridgeRegistryConfig,
  type ApprovalDecision
} from '@openpointer/agent-bridge';
import type { AgentBackendId, AgentContextEnvelope, AgentEvent, CapabilityHints, ChatTurn, Conversation, PointerContext } from '@openpointer/core';
import type { AppSettings } from '@openpointer/storage';
import type { CuaToolResult } from './cua-sidecar.js';
import type { CuaBroker } from './cua-broker.js';
import type { CuaTaskManager, CuaTaskRuntime, CuaTaskRunner } from './cua-task-manager.js';
import { backendSessionKey } from './history.js';

type ChatHistoryLike = {
  appendTurn(conversationId: string, turn: ChatTurn): Promise<Conversation>;
  getConversation(conversationId: string): Promise<Conversation | null>;
  setBackendSession(conversationId: string, backend: AgentBackendId, sessionId: string): Promise<Conversation | null>;
  setClaudeAgentSession(conversationId: string, sessionId: string): Promise<Conversation | null>;
};

type CuaBrokerLike = Pick<CuaBroker, 'ensureStarted' | 'releaseSession' | 'hasPendingApproval' | 'approve'>;
type AgentTaskManagerLike = Pick<CuaTaskManager, 'submit' | 'emitAgentEvent' | 'approve'>;

export type OpenPointerHarnessOptions = {
  taskManager: AgentTaskManagerLike;
  cuaBroker: CuaBrokerLike;
  chatHistory: ChatHistoryLike;
  getSettings: () => AppSettings;
  bridgeConfig: (settings?: AppSettings) => AgentBridgeRegistryConfig;
  createOpenPointerTools: (context: PointerContext) => Record<string, (args: Record<string, unknown>) => Promise<CuaToolResult>>;
  allowedCuaTools: string[];
  withDesktopInteractionHidden?: <T>(work: () => Promise<T>) => Promise<T>;
  showDesktopInteractionApproval?: () => void | Promise<void>;
  createBridge?: (backend: AgentBackendId, config: AgentBridgeRegistryConfig) => AgentBridge;
  resolveBackend?: (envelope: AgentContextEnvelope, config: AgentBridgeRegistryConfig) => AgentBackendId;
};

export type SubmitHarnessInput = {
  text: string;
  mode: AgentContextEnvelope['instruction']['mode'];
  context: PointerContext;
  backend?: AgentBackendId;
  capabilityHints?: CapabilityHints;
  conversationId?: string;
};

export type SubmitHarnessResult = {
  requestId: string;
  backend: AgentBackendId;
  conversationId: string;
  taskId: string;
};

export class OpenPointerHarness {
  private readonly createBridge: (backend: AgentBackendId, config: AgentBridgeRegistryConfig) => AgentBridge;
  private readonly resolveBackend: (envelope: AgentContextEnvelope, config: AgentBridgeRegistryConfig) => AgentBackendId;

  constructor(private readonly options: OpenPointerHarnessOptions) {
    this.createBridge = options.createBridge ?? createAgentBridge;
    this.resolveBackend = options.resolveBackend ?? resolveBackendForEnvelope;
  }

  async approve(id: string, decision: ApprovalDecision): Promise<void> {
    if (this.options.cuaBroker.hasPendingApproval(id)) {
      this.options.cuaBroker.approve(id, decision === 'deny' ? 'deny' : 'approve');
      return;
    }
    await this.options.taskManager.approve(id, decision);
  }

  async submit(input: SubmitHarnessInput): Promise<SubmitHarnessResult> {
    const settings = this.options.getSettings();
    const conversationId = input.conversationId || `conv-${Date.now()}`;
    await this.options.chatHistory.appendTurn(conversationId, {
      id: `turn-${Date.now()}-user`,
      role: 'user',
      text: input.text,
      pointerContext: input.context,
      timestamp: Date.now()
    });
    const conversation = await this.options.chatHistory.getConversation(conversationId);

    const initialEnvelope = buildAgentContextEnvelope({
      instruction: input.text,
      mode: input.mode,
      context: input.context,
      backend: input.backend ?? settings.agentBackend
    });
    if (conversation) {
      initialEnvelope.conversationId = conversationId;
      initialEnvelope.history = conversation.turns;
    }

    const config = this.options.bridgeConfig(settings);
    const backend = this.resolveBackend(initialEnvelope, config);
    const sessionKey = backendSessionKey(backend);
    const backendSessionId = sessionKey ? conversation?.backendSessions?.[sessionKey]?.sessionId : undefined;

    const submittedTask = { id: undefined as string | undefined };
    const allowedCuaTools = allowedCuaToolsForSettings(this.options.allowedCuaTools, settings);
    const cuaBrokerSession = shouldAttachCuaToolServer(input.context, initialEnvelope, settings)
      ? await this.options.cuaBroker.ensureStarted({
          requireApprovalBeforeCua: settings.requireApprovalBeforeCua,
          cuaAgentCursorEnabled: settings.cuaAgentCursorEnabled,
          cuaPageJavascriptPolicy: settings.cuaPageJavascriptPolicy,
          allowedTools: allowedCuaTools,
          localTools: this.options.createOpenPointerTools(input.context),
          withDesktopInteractionHidden: this.options.withDesktopInteractionHidden,
          showDesktopInteractionApproval: this.options.showDesktopInteractionApproval,
          emit: (agentEvent) => {
            if (submittedTask.id) this.options.taskManager.emitAgentEvent(submittedTask.id, agentEvent);
          }
        })
      : undefined;

    const envelope: AgentContextEnvelope = {
      ...initialEnvelope,
      history: backend === 'claude-agent' ? undefined : initialEnvelope.history,
      routing: { ...initialEnvelope.routing, backend },
      capabilityHints: input.capabilityHints,
      toolServers: cuaBrokerSession
        ? [
            {
              id: 'cua',
              transport: 'local-http',
              sessionId: cuaBrokerSession.sessionId,
              endpoint: cuaBrokerSession.endpoint,
              tools: allowedCuaTools
            }
          ]
        : initialEnvelope.toolServers
    };

    submittedTask.id = this.options.taskManager.submit({
      conversationId,
      instruction: input.text,
      windowTitle: input.context.window?.title || input.context.window?.app || input.context.window?.process,
      bridge: this.createBridge(backend, config),
      envelope,
      brokerSessionId: cuaBrokerSession?.sessionId,
      backendSessionId,
      allowLocalFallback: settings.localVlmEnabled && backend !== 'local-vlm',
      cleanup: cuaBrokerSession ? () => this.options.cuaBroker.releaseSession(cuaBrokerSession.sessionId) : undefined,
      runner: this.streamBridgeEvents
    });

    return { requestId: envelope.requestId, backend, conversationId, taskId: submittedTask.id };
  }

  private readonly streamBridgeEvents: CuaTaskRunner = async (task, forward) => {
    let emittedStarted = false;
    let sawTerminal = false;
    let fullAnswer = '';

    const startTime = Date.now();
    const toolEvents: Array<Extract<AgentEvent, { type: 'tool.started' | 'tool.completed' }>> = [];
    const events: AgentEvent[] = [];

    const record = (agentEvent: AgentEvent) => {
      if (task.controller.signal.aborted) return;
      forward(agentEvent);
      if (agentEvent.type === 'run.completed' || agentEvent.type === 'run.failed') sawTerminal = true;
      if (agentEvent.type === 'tool.started' || agentEvent.type === 'tool.completed') toolEvents.push(agentEvent);
      events.push(agentEvent);
    };

    try {
      for await (const agentEvent of task.bridge.run(task.envelope, {
        signal: task.controller.signal,
        sessionKey: sessionKeyForContext(task.envelope.pointerContext),
        backendSessionId: task.backendSessionId
      })) {
        if (task.controller.signal.aborted) break;
        if (agentEvent.type === 'run.failed' && agentEvent.recoverable && task.allowLocalFallback && !emittedStarted) {
          const localEnvelope: AgentContextEnvelope = { ...task.envelope, routing: { ...task.envelope.routing, backend: 'local-vlm' } };
          record({ type: 'assistant.delta', text: 'Agent backend is unavailable. Falling back to local VLM.' });
          const localBridge = this.createBridge('local-vlm', this.options.bridgeConfig(this.options.getSettings()));
          for await (const localEvent of localBridge.run(localEnvelope, { signal: task.controller.signal })) {
            if (task.controller.signal.aborted) break;
            record(localEvent);
            if (localEvent.type === 'assistant.delta') fullAnswer += localEvent.text;
          }
          break;
        }

        record(agentEvent);
        if (agentEvent.type === 'backend.session' && task.envelope.conversationId) {
          await this.options.chatHistory.setBackendSession(task.envelope.conversationId, agentEvent.backend, agentEvent.sessionId);
        }
        if (agentEvent.type === 'run.started') emittedStarted = true;
        if (agentEvent.type === 'assistant.delta') fullAnswer += agentEvent.text;
      }

      if (!task.controller.signal.aborted && !sawTerminal) {
        record({ type: 'run.completed', text: fullAnswer || undefined });
      }
    } catch (error) {
      if (!task.controller.signal.aborted && !sawTerminal) {
        record({
          type: 'run.failed',
          error: error instanceof Error ? error.message : String(error),
          recoverable: true
        });
      }
    }

    await this.persistAssistantTurn(task, fullAnswer, startTime, toolEvents, events);
  };

  private async persistAssistantTurn(
    task: CuaTaskRuntime,
    fullAnswer: string,
    startTime: number,
    toolEvents: Array<Extract<AgentEvent, { type: 'tool.started' | 'tool.completed' }>>,
    events: AgentEvent[]
  ): Promise<void> {
    if (task.controller.signal.aborted || !task.envelope.conversationId || !fullAnswer) return;
    const thinkingTime = Math.round((Date.now() - startTime) / 1000);
    try {
      await this.options.chatHistory.appendTurn(task.envelope.conversationId, {
        id: `turn-${Date.now()}-assistant`,
        role: 'assistant',
        text: fullAnswer,
        timestamp: Date.now(),
        thinkingTime: thinkingTime > 0 ? thinkingTime : undefined,
        toolEvents: toolEvents.length > 0 ? toolEvents : undefined,
        events: events.length > 0 ? events : undefined
      });
    } catch (error) {
      console.warn('[omp] failed to persist assistant turn', error);
    }
  }
}

export function shouldAttachCuaToolServer(context: PointerContext, envelope: AgentContextEnvelope, settings: Pick<AppSettings, 'cuaMode'>): boolean {
  if (settings.cuaMode === 'off') return false;
  return Boolean(
    envelope.cuaDirective?.enabled ||
      context.grounding?.status === 'matched' ||
      context.target?.groundingRef?.provider === 'cua' ||
      context.entities.some((entity) => entity.groundingRef?.provider === 'cua') ||
      context.nearby.some((entity) => entity.groundingRef?.provider === 'cua')
  );
}

function allowedCuaToolsForSettings(tools: string[], settings: Pick<AppSettings, 'cuaBrowserPageToolsEnabled'>): string[] {
  return settings.cuaBrowserPageToolsEnabled ? tools : tools.filter((tool) => tool !== 'page');
}

function sessionKeyForContext(context: PointerContext): string {
  return [context.source, context.window?.app, context.window?.windowId].filter(Boolean).join(':') || 'desktop';
}
