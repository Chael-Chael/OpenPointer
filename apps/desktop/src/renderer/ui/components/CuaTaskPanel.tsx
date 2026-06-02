import { useEffect, useMemo, useState } from 'react';
import type { CuaTaskEventPayload, CuaTaskSummary } from '../../../shared/types';

type CuaTaskPanelProps = {
  tasks: CuaTaskSummary[];
  onCancel(taskId: string): void;
};

const STATUS_LABELS: Record<CuaTaskSummary['status'], string> = {
  pending: 'Queued',
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled'
};

export function CuaTaskPanel({ tasks, onCancel }: CuaTaskPanelProps) {
  const visibleTasks = useMemo(() => tasks.filter((task) => task.status === 'pending' || task.status === 'running'), [tasks]);
  if (visibleTasks.length === 0) return null;

  return (
    <section className="pointer-events-auto fixed right-5 top-5 z-50 w-[320px] max-w-[calc(100vw-40px)] rounded-[8px] border border-white/12 bg-black/70 p-3 text-white shadow-[0_14px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-white/70">CUA Tasks</h2>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/65">{visibleTasks.length}</span>
      </div>
      <div className="grid gap-2">
        {visibleTasks.map((task) => (
          <article key={task.id} className="rounded-[6px] border border-white/10 bg-white/[0.06] p-2.5">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${task.status === 'running' ? 'bg-cyan-300' : 'bg-white/35'}`} />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-white/90">{task.instruction}</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-white/50">{STATUS_LABELS[task.status]}</span>
            </div>
            {task.windowTitle && <div className="mt-1 truncate text-[11px] text-white/45">{task.windowTitle}</div>}
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[10px] text-white/35">{task.backend}</span>
              <button
                type="button"
                className="rounded-[6px] border border-white/12 px-2 py-1 text-[11px] font-semibold text-white/70 hover:bg-white/10"
                onClick={() => onCancel(task.id)}
              >
                Cancel
              </button>
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
