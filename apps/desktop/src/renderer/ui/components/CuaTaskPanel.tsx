import { useEffect, useMemo, useState } from 'react';
import type { CuaTaskEventPayload, CuaTaskSummary } from '../../../shared/types';

type CuaTaskPanelProps = {
  tasks: CuaTaskSummary[];
  theme?: string;
  onCancel(taskId: string): void;
  onStartRecording(taskId: string): void;
  onStopRecording(taskId: string): void;
  onReplayRecording(taskId: string): void;
};

const STATUS_LABELS: Record<CuaTaskSummary['status'], string> = {
  pending: 'Queued',
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled'
};

export function CuaTaskPanel({ tasks, theme = 'blue', onCancel, onStartRecording, onStopRecording, onReplayRecording }: CuaTaskPanelProps) {
  const visibleTasks = useMemo(() => tasks.filter((task) => task.status === 'pending' || task.status === 'running'), [tasks]);
  if (visibleTasks.length === 0) return null;

  return (
    <section className="cua-task-panel" data-pill-theme={theme}>
      <div className="cua-task-panel-header">
        <h2>CUA Tasks</h2>
        <span className="cua-task-count">{visibleTasks.length}</span>
      </div>
      <div className="cua-task-list">
        {visibleTasks.map((task) => (
          <article key={task.id} className="cua-task-card">
            <div className="cua-task-row">
              <span className={`cua-task-dot${task.status === 'running' ? ' is-running' : ''}`} />
              <span className="cua-task-title">{task.instruction}</span>
              <span className="cua-task-status">{STATUS_LABELS[task.status]}</span>
            </div>
            {task.windowTitle && <div className="cua-task-window">{task.windowTitle}</div>}
            <div className="cua-task-actions-row">
              <span className="cua-task-backend">{task.backend}</span>
              <div className="cua-task-actions">
                {task.recording?.status === 'recording' ? (
                  <button type="button" className="cua-task-button" onClick={() => onStopRecording(task.id)}>
                    Stop rec
                  </button>
                ) : (
                  <button type="button" className="cua-task-button" onClick={() => onStartRecording(task.id)}>
                    Rec
                  </button>
                )}
                {task.recording?.status === 'available' && (
                  <button type="button" className="cua-task-button" onClick={() => onReplayRecording(task.id)}>
                    Replay
                  </button>
                )}
                <button type="button" className="cua-task-button" onClick={() => onCancel(task.id)}>
                  Cancel
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function useCuaTasks() {
  const [tasks, setTasks] = useState<CuaTaskSummary[]>([]);

  useEffect(() => {
    let mounted = true;
    void window.openPointer.listCuaTasks().then((items) => {
      if (mounted) setTasks(items);
    });
    const off = window.openPointer.onCuaTaskEvent((payload: CuaTaskEventPayload) => {
      setTasks((prev) => upsertTask(prev, payload.task));
      if (payload.type === 'task.updated' && payload.task.status === 'completed') {
        notifyTaskComplete(payload.task);
      }
    });
    return () => {
      mounted = false;
      off();
    };
  }, []);

  return {
    tasks,
    cancelTask: (taskId: string) => {
      void window.openPointer.cancelCuaTask(taskId);
    },
    startRecording: (taskId: string) => {
      void window.openPointer.startCuaTaskRecording(taskId);
    },
    stopRecording: (taskId: string) => {
      void window.openPointer.stopCuaTaskRecording(taskId);
    },
    replayRecording: (taskId: string) => {
      void window.openPointer.replayCuaTaskRecording(taskId);
    }
  };
}

function upsertTask(tasks: CuaTaskSummary[], next: CuaTaskSummary): CuaTaskSummary[] {
  const index = tasks.findIndex((task) => task.id === next.id);
  if (index === -1) return [next, ...tasks].slice(0, 20);
  const copy = [...tasks];
  copy[index] = next;
  return copy;
}

function notifyTaskComplete(task: CuaTaskSummary): void {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    new Notification('CUA task completed', { body: task.instruction });
    return;
  }
  if (Notification.permission === 'default') {
    void Notification.requestPermission().then((permission) => {
      if (permission === 'granted') new Notification('CUA task completed', { body: task.instruction });
    });
  }
}
