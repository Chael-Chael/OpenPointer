import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Conversation } from '@openpointer/core';
import type { AppSettings } from '@openpointer/storage';
import type { CuaTaskSummary } from '../../../shared/types';
import { backgroundDockPositionStyle } from '../lib/background-processes';

type BackgroundProcessDockProps = {
  conversations: Conversation[];
  tasks?: CuaTaskSummary[];
  pinnedConversationIds?: string[];
  corner: AppSettings['backgroundProcessCorner'];
  theme?: AppSettings['modalTheme'];
  terminalErrors?: Record<string, string>;
  onOpen(id: string): void;
  onTerminal(id: string): void;
  onStop(taskId: string): void;
  onStartRecording(taskId: string): void;
  onStopRecording(taskId: string): void;
  onReplayRecording(taskId: string): void;
  onDelete(id: string): void;
};

export function BackgroundProcessDock({
  conversations,
  tasks = [],
  pinnedConversationIds = [],
  corner,
  theme = 'blue',
  terminalErrors = {},
  onOpen,
  onTerminal,
  onStop,
  onStartRecording,
  onStopRecording,
  onReplayRecording,
  onDelete
}: BackgroundProcessDockProps) {
  const activeTasks = tasks
    .filter((task) => task.status === 'pending' || task.status === 'running')
    .sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt));
  const orderedConversations = orderConversations(conversations, pinnedConversationIds);
  const totalCount = activeTasks.length + orderedConversations.length;

  return (
    <section
      className="background-process-dock"
      data-pill-theme={theme}
      data-corner={corner}
      style={backgroundDockPositionStyle(corner)}
      aria-label="Background tasks"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="background-process-trigger"
        aria-label={`Background tasks, ${activeTasks.length} active, ${orderedConversations.length} history`}
      >
        <span className={`background-process-dot${activeTasks.length > 0 ? ' is-active' : ''}`} />
        <span className="background-process-label">BG</span>
        <span className="background-process-count">{totalCount}</span>
      </button>

      <div className="background-process-panel">
        <div className="background-process-header">
          <span>Agent work</span>
          <span>{activeTasks.length} active</span>
        </div>
        <div className="background-process-list">
          {activeTasks.length > 0 && (
            <div className="background-process-section">
              <div className="background-process-section-title">Ongoing</div>
              {activeTasks.map((task) => (
                <article key={task.id} className="background-process-item is-task">
                  <div className="background-process-main">
                    <span className="background-process-title">{task.instruction}</span>
                    <span className="background-process-meta">
                      <span className={`background-process-status is-${task.status}`}>{STATUS_LABELS[task.status]}</span>
                      <span>{task.windowTitle || task.backend}</span>
                    </span>
                  </div>
                  <div className="background-process-actions">
                    {task.conversationId && (
                      <button type="button" onClick={() => onOpen(task.conversationId)}>
                        Open
                      </button>
                    )}
                    {task.recording?.status === 'recording' ? (
                      <button type="button" onClick={() => onStopRecording(task.id)}>
                        Stop rec
                      </button>
                    ) : (
                      <button type="button" onClick={() => onStartRecording(task.id)}>
                        Rec
                      </button>
                    )}
                    {task.recording?.status === 'available' && (
                      <button type="button" onClick={() => onReplayRecording(task.id)}>
                        Replay
                      </button>
                    )}
                    <button type="button" onClick={() => onStop(task.id)}>
                      Stop
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="background-process-section">
            <div className="background-process-section-title">History</div>
            {orderedConversations.length === 0 ? (
              <p className="background-process-empty">No task history yet.</p>
            ) : (
              orderedConversations.map((conversation) => {
                const task = taskForConversation(tasks, conversation.id);
                const activeTask = task && (task.status === 'pending' || task.status === 'running') ? task : undefined;
                return (
                  <article key={conversation.id} className="background-process-item">
                    <button type="button" className="background-process-main" onClick={() => onOpen(conversation.id)}>
                      <span className="background-process-title">{conversation.title || task?.instruction || 'Untitled conversation'}</span>
                      <span className="background-process-meta">
                        <span
                          className={`background-process-status is-${activeTask ? activeTask.status : pinnedConversationIds.includes(conversation.id) ? 'parked' : 'history'}`}
                        >
                          {activeTask ? STATUS_LABELS[activeTask.status] : pinnedConversationIds.includes(conversation.id) ? 'Parked' : 'History'}
                        </span>
                        <span>{new Date(conversation.updatedAt).toLocaleString()}</span>
                      </span>
                    </button>
                    <div className="background-process-actions">
                      <button type="button" onClick={() => onOpen(conversation.id)}>
                        Open
                      </button>
                      {activeTask ? (
                        <button type="button" onClick={() => onStop(activeTask.id)}>
                          Stop
                        </button>
                      ) : (
                        <button type="button" onClick={() => onTerminal(conversation.id)}>
                          Terminal
                        </button>
                      )}
                      <button type="button" onClick={(event) => handleDelete(event, conversation.id, onDelete)}>
                        Delete
                      </button>
                    </div>
                    {terminalErrors[conversation.id] && <p className="background-process-error">{terminalErrors[conversation.id]}</p>}
                  </article>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function handleDelete(event: ReactMouseEvent<HTMLButtonElement>, id: string, onDelete: (id: string) => void): void {
  event.stopPropagation();
  onDelete(id);
}

const STATUS_LABELS: Record<CuaTaskSummary['status'], string> = {
  pending: 'Queued',
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped'
};

function taskForConversation(tasks: CuaTaskSummary[], conversationId: string): CuaTaskSummary | undefined {
  return tasks
    .filter((task) => task.conversationId === conversationId)
    .sort((a, b) => (b.endedAt ?? b.startedAt ?? b.createdAt) - (a.endedAt ?? a.startedAt ?? a.createdAt))[0];
}

function orderConversations(conversations: Conversation[], pinnedConversationIds: string[]): Conversation[] {
  const pinnedRank = new Map(pinnedConversationIds.map((id, index) => [id, index]));
  return [...conversations].sort((a, b) => {
    const aPinned = pinnedRank.get(a.id);
    const bPinned = pinnedRank.get(b.id);
    if (aPinned !== undefined || bPinned !== undefined) {
      if (aPinned === undefined) return 1;
      if (bPinned === undefined) return -1;
      return aPinned - bPinned;
    }
    return b.updatedAt - a.updatedAt;
  });
}
