import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Conversation } from '@openpointer/core';
import type { AppSettings } from '@openpointer/storage';
import { backgroundDockPositionStyle } from '../lib/background-processes';

type BackgroundProcessDockProps = {
  conversations: Conversation[];
  corner: AppSettings['backgroundProcessCorner'];
  theme?: AppSettings['modalTheme'];
  terminalErrors?: Record<string, string>;
  onOpen(id: string): void;
  onTerminal(id: string): void;
  onDelete(id: string): void;
};

export function BackgroundProcessDock({
  conversations,
  corner,
  theme = 'blue',
  terminalErrors = {},
  onOpen,
  onTerminal,
  onDelete
}: BackgroundProcessDockProps) {
  if (conversations.length === 0) return null;

  return (
    <section
      className="background-process-dock"
      data-pill-theme={theme}
      data-corner={corner}
      style={backgroundDockPositionStyle(corner)}
      aria-label="Background conversations"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button type="button" className="background-process-trigger" aria-label={`${conversations.length} background conversations`}>
        <span className="background-process-dot" />
        <span className="background-process-label">BG</span>
        <span className="background-process-count">{conversations.length}</span>
      </button>

      <div className="background-process-panel">
        <div className="background-process-header">
          <span>Background</span>
          <span>{conversations.length}</span>
        </div>
        <div className="background-process-list">
          {conversations.map((conversation) => (
            <article key={conversation.id} className="background-process-item">
              <button type="button" className="background-process-main" onClick={() => onOpen(conversation.id)}>
                <span className="background-process-title">{conversation.title || 'Untitled conversation'}</span>
                <span className="background-process-meta">{new Date(conversation.updatedAt).toLocaleString()}</span>
              </button>
              <div className="background-process-actions">
                <button type="button" onClick={() => onOpen(conversation.id)}>
                  Open
                </button>
                <button type="button" onClick={() => onTerminal(conversation.id)}>
                  Terminal
                </button>
                <button type="button" onClick={(event) => handleDelete(event, conversation.id, onDelete)}>
                  Delete
                </button>
              </div>
              {terminalErrors[conversation.id] && <p className="background-process-error">{terminalErrors[conversation.id]}</p>}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function handleDelete(event: ReactMouseEvent<HTMLButtonElement>, id: string, onDelete: (id: string) => void): void {
  event.stopPropagation();
  onDelete(id);
}
