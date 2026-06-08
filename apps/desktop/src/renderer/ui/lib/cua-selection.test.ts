import { describe, expect, it } from 'vitest';
import type { PointerEntity } from '@openpointer/core';
import { mergeCuaEntityGroup, removeCuaEntityFromGroup, selectedCuaAttachmentTitle, selectedListItemsForContext } from './cua-selection';

function listItem(id: string, selected = true): PointerEntity {
  return {
    id,
    kind: 'listitem',
    text: id,
    confidence: 0.9,
    origin: 'accessibility',
    state: { selected },
    groundingRef: { provider: 'cua', pid: 1, windowId: '2', elementIndex: Number(id.replace(/\D/g, '')) || 0 }
  };
}

describe('selectedListItemsForContext', () => {
  it('keeps all selected list items in CUA order and dedupes by id', () => {
    const first = listItem('row-1');
    const selected = selectedListItemsForContext([
      first,
      { ...first },
      { ...listItem('button-1'), kind: 'button' },
      listItem('row-2'),
      listItem('row-3', false)
    ]);
    expect(selected.map((entity) => entity.id)).toEqual(['row-1', 'row-2']);
  });

  it('builds a compact attachment title for selected list items', () => {
    expect(selectedCuaAttachmentTitle([listItem('row-1'), listItem('row-2')])).toContain('2 selected list items');
  });
});

describe('CUA entity grouping', () => {
  it('appends new entities, dedupes by id, and keeps the latest capped group', () => {
    const merged = mergeCuaEntityGroup([listItem('row-1'), listItem('row-2')], [listItem('row-2'), listItem('row-3'), listItem('row-4')], 3);
    expect(merged.map((entity) => entity.id)).toEqual(['row-2', 'row-3', 'row-4']);
  });

  it('removes a grouped entity by id', () => {
    const remaining = removeCuaEntityFromGroup([listItem('row-1'), listItem('row-2'), listItem('row-3')], 'row-2');
    expect(remaining.map((entity) => entity.id)).toEqual(['row-1', 'row-3']);
  });
});
