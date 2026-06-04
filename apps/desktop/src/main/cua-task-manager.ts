import { EventEmitter } from 'node:events';
import type { AgentBridge } from '@openpointer/agent-bridge';
import type { AgentContextEnvelope, AgentEvent } from '@openpointer/core';
import type { CuaTaskEventPayload, CuaTaskStatus, CuaTaskSummary } from '../shared/types.js';

export type CuaTaskRuntime = {
  id: string;
  conversationId: string;
  instruction: string;
  windowTitle?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  controller: AbortController;
  bridge: AgentBridge;
  envelope: AgentContextEnvelope;
  brokerSessionId?: string;
  backendSessionId?: string;
  allowLocalFallback: boolean;
  cleanup?: () => void;
  events: AgentEvent[];
  recording?: {
    status: 'off' | 'recording' | 'available';
    outputDir?: string;
  };
};

export type CuaTaskRunner = (task: CuaTaskRuntime, emitAgentEvent: (event: AgentEvent) => void) => Promise<void>;

type QueuedTask = CuaTaskRuntime & {
  status: CuaTaskStatus;
  runner: CuaTaskRunner;
};

type TaskManagerEvents = {
  taskEvent: [payload: CuaTaskEventPayload];
  agentEvent: [taskId: string, event: AgentEvent];
};

export class CuaTaskManager extends EventEmitter {
  private tasks = new Map<string, QueuedTask>();
  private running = new Set<string>();
  private foregroundTaskId: string | null = null;

  constructor(private readonly maxConcurrent = 4) {
    super();
  }

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
    runner: CuaTaskRunner;
  }): string {
    const id = `cua-task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const task: QueuedTask = {
      id,
      conversationId: options.conversationId,
      instruction: options.instruction,
      windowTitle: options.windowTitle,
      createdAt: Date.now(),
      controller: new AbortController(),
      bridge: options.bridge,
      envelope: options.envelope,
      brokerSessionId: options.brokerSessionId,
      backendSessionId: options.backendSessionId,
      allowLocalFallback: options.allowLocalFallback,
      cleanup: options.cleanup,
      events: [],
      status: 'pending',
      runner: options.runner
    };
    this.tasks.set(id, task);
    this.foregroundTaskId = id;
    this.emitTask(task);
    this.pump();
    return id;
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return false;
    task.controller.abort();
    if (task.status === 'pending') {
      task.status = 'cancelled';
      task.endedAt = Date.now();
      task.cleanup?.();
      this.emitTask(task);
    }
    return true;
  }

  cancelForeground(): void {
    if (this.foregroundTaskId) this.cancel(this.foregroundTaskId);
  }

  cancelAll(): void {
    for (const taskId of this.tasks.keys()) this.cancel(taskId);
  }

  async approve(approvalId: string, decision: 'approve' | 'deny' | 'always_allow'): Promise<void> {
    await Promise.all(
      [...this.tasks.values()]
        .filter((task) => task.status === 'running' && !task.controller.signal.aborted)
        .map((task) => task.bridge.approve?.(approvalId, decision))
        .filter((promise): promise is Promise<void> => Boolean(promise))
    );
  }

  list(): CuaTaskSummary[] {
    return [...this.tasks.values()].map((task) => this.summary(task));
  }

  get(taskId: string): CuaTaskRuntime | undefined {
    return this.tasks.get(taskId);
  }

  markRecording(taskId: string, recording: NonNullable<CuaTaskRuntime['recording']>): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.recording = recording;
    this.emitTask(task);
  }

  emitAgentEvent(taskId: string, event: AgentEvent): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.recordAgentEvent(task, event);
  }

  isForeground(taskId: string): boolean {
    return this.foregroundTaskId === taskId;
  }

  on<K extends keyof TaskManagerEvents>(eventName: K, listener: (...args: TaskManagerEvents[K]) => void): this {
    return super.on(eventName, listener);
  }

  private pump(): void {
    while (this.running.size < this.maxConcurrent) {
      const next = [...this.tasks.values()].find((task) => task.status === 'pending');
      if (!next) return;
      this.start(next);
    }
  }

  private start(task: QueuedTask): void {
    task.status = 'running';
    task.startedAt = Date.now();
    this.running.add(task.id);
    this.emitTask(task);

    const emitAgentEvent = (event: AgentEvent) => this.recordAgentEvent(task, event);

    void task
      .runner(task, emitAgentEvent)
      .then(() => {
        if (task.status === 'running') {
          task.status = task.controller.signal.aborted ? 'cancelled' : 'completed';
        }
      })
      .catch((error: unknown) => {
        if (task.controller.signal.aborted) {
          task.status = 'cancelled';
        } else {
          task.status = 'failed';
          task.error = error instanceof Error ? error.message : String(error);
        }
      })
      .finally(() => {
        task.endedAt = Date.now();
        this.running.delete(task.id);
        task.cleanup?.();
        this.emitTask(task);
        this.pump();
      });
  }

  private emitTask(task: QueuedTask): void {
    this.emit('taskEvent', { type: 'task.updated', task: this.summary(task) });
  }

  private recordAgentEvent(task: QueuedTask, event: AgentEvent): void {
    task.events.push(event);
    if (event.type === 'run.failed') {
        task.status = 'failed';
        task.error = event.error;
    } else if (event.type === 'run.completed') {
      task.status = 'completed';
    }
    this.emit('agentEvent', task.id, event);
    this.emit('taskEvent', { type: 'agent-event', task: this.summary(task), agentEvent: event });
  }

  private summary(task: QueuedTask): CuaTaskSummary {
    return {
      id: task.id,
      conversationId: task.conversationId,
      instruction: task.instruction,
      windowTitle: task.windowTitle,
      status: task.status,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      endedAt: task.endedAt,
      error: task.error,
      requestId: task.envelope.requestId,
      backend: task.envelope.routing.backend,
      eventCount: task.events.length,
      recording: task.recording
    };
  }
}
