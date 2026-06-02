import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Conversation } from '@openpointer/core';

type HistoryTabProps = {
  conversations: Conversation[];
  loadConversation(id: string): void;
  deleteConversation(id: string, event: ReactMouseEvent): void;
};

export function HistoryTab({ conversations, loadConversation, deleteConversation }: HistoryTabProps) {
  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-white/40 text-sm m-0">No past conversations yet.</p>
      </div>
    );
  }

  return (
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
  );
}
