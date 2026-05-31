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
            <p className="m-0 mb-1 text-cyan-200/90 text-[11px] font-bold uppercase tracking-[0.04em]">Chat history</p>
            <h2 className="m-0 text-xl font-extrabold leading-tight text-white">Past conversations</h2>
          </div>
          <button className="ghost-button" onClick={onClose}>
            Close
          </button>
        </header>

        {conversations.length === 0 ? (
          <div className="history-empty flex flex-col items-center justify-center py-12 text-center">
            <div className="history-empty-icon text-4xl mb-3 text-white/40">🕒</div>
            <p className="text-white/65 text-sm m-0">No past conversations found. Start a new chat to begin!</p>
          </div>
        ) : (
          <div className="history-list">
            {conversations.map((conv) => (
              <div key={conv.id} className="history-item" onClick={() => loadConversation(conv.id)}>
                <div className="history-item-info">
                  <span className="history-item-title">{conv.title || 'Untitled Conversation'}</span>
                  <span className="history-item-date">{new Date(conv.updatedAt).toLocaleString()}</span>
                </div>
                <div className="history-item-actions">
                  <button
                    className="history-item-btn primary-button"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      loadConversation(conv.id);
                    }}
                  >
                    Open
                  </button>
                  <button className="history-item-btn ghost-button" type="button" onClick={(e) => deleteConversation(conv.id, e)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
