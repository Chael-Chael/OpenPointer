import type { Conversation } from '@openpointer/core';
import type { AppSettings } from '@openpointer/storage';

export type BackgroundProcessCorner = AppSettings['backgroundProcessCorner'];

export type BackgroundDockPositionStyle = Partial<Record<'left' | 'right' | 'top' | 'bottom', string>>;

export function parkBackgroundConversation(ids: string[], conversationId: string | null | undefined): string[] {
  if (!conversationId) return ids;
  return [conversationId, ...ids.filter((id) => id !== conversationId)];
}

export function removeBackgroundConversation(ids: string[], conversationId: string): string[] {
  return ids.filter((id) => id !== conversationId);
}

export function resolveBackgroundConversations(ids: string[], conversations: Conversation[]): Conversation[] {
  if (ids.length === 0 || conversations.length === 0) return [];
  const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  return ids.flatMap((id) => {
    const conversation = byId.get(id);
    return conversation ? [conversation] : [];
  });
}

export function backgroundDockPositionStyle(corner: BackgroundProcessCorner, offsetPx = 14): BackgroundDockPositionStyle {
  const offset = `${offsetPx}px`;
  switch (corner) {
    case 'bottom-right':
      return { right: offset, bottom: offset };
    case 'top-left':
      return { left: offset, top: offset };
    case 'top-right':
      return { right: offset, top: offset };
    case 'bottom-left':
    default:
      return { left: offset, bottom: offset };
  }
}
