import { describe, expect, it } from 'vitest';
import type { Conversation } from '@openpointer/core';
import { backgroundDockPositionStyle, parkBackgroundConversation, removeBackgroundConversation, resolveBackgroundConversations } from './background-processes';

function conversation(id: string, updatedAt: number): Conversation {
  return {
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    turns: []
  };
}

describe('background process conversations', () => {
  it('parks conversations newest-first without duplicates', () => {
    expect(parkBackgroundConversation(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
    expect(parkBackgroundConversation(['a', 'b'], 'b')).toEqual(['b', 'a']);
  });

  it('ignores missing conversation ids when parking', () => {
    expect(parkBackgroundConversation(['a'], null)).toEqual(['a']);
    expect(parkBackgroundConversation(['a'], undefined)).toEqual(['a']);
  });

  it('removes conversations from the dock list', () => {
    expect(removeBackgroundConversation(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('resolves dock conversations in parked order and drops stale ids', () => {
    const conversations = [conversation('a', 1), conversation('b', 2), conversation('c', 3)];
    expect(resolveBackgroundConversations(['c', 'missing', 'a'], conversations).map((item) => item.id)).toEqual(['c', 'a']);
  });
});

describe('backgroundDockPositionStyle', () => {
  it('maps corners to fixed-position offsets', () => {
    expect(backgroundDockPositionStyle('bottom-left')).toEqual({ left: '14px', bottom: '14px' });
    expect(backgroundDockPositionStyle('bottom-right')).toEqual({ right: '14px', bottom: '14px' });
    expect(backgroundDockPositionStyle('top-left', 20)).toEqual({ left: '20px', top: '20px' });
    expect(backgroundDockPositionStyle('top-right')).toEqual({ right: '14px', top: '14px' });
  });
});
