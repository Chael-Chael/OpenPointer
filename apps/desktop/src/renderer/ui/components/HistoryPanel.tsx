import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Conversation } from '@openmagicpointer/core';

type HistoryPanelProps = {
  conversations: Conversation[];
  onClose(): void;
  loadConversation(id: string): void;
  deleteConversation(id: string, event: ReactMouseEvent): void;
};

export function HistoryPanel({ conversations, onClose, loadConversation, deleteConversation }: HistoryPanelProps) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="OpenMagicPointer conversation history">
      <div className="modal-card">
        <header className="flex items-center justify-between gap-3 mb-4">
          <div>
            <p className="m-0 mb-1 text-accent text-[11px] font-bold uppercase tracking-[0.04em]">Chat history</p>
            <h2 className="m-0 text-xl font-bold leading-tight text-ink">Past conversations</h2>
          </div>
          <button className="ghost-button" onClick={onClose}>Close</button>
        </header>

        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center text-muted">
            <div className="text-3xl mb-3 opacity-80">🕒</div>
            <p>No past conversations found. Start a new chat to begin!</p>
          </div>
        ) : (
          <div className="grid gap-2.5 max-h-[480px] overflow-y-auto my-4 pr-1.5 scrollbar-thin-history">
            {conversations.map((conv) => (
              <div key={conv.id} className="history-item" onClick={() => loadConversation(conv.id)}>
                <div className="flex flex-col gap-1 min-w-0 text-left">
                  <span className="text-ink text-sm font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{conv.title || 'Untitled Conversation'}</span>
                  <span className="text-muted text-[11px] font-medium">{new Date(conv.updatedAt).toLocaleString()}</span>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button className="history-item-btn primary-button" type="button" onClick={(e) => { e.stopPropagation(); loadConversation(conv.id); }}>Open</button>
                  <button className="history-item-btn ghost-button" type="button" onClick={(e) => deleteConversation(conv.id, e)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
