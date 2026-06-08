import { describe, expect, it } from 'vitest';
import type { PointerEntity } from '@openpointer/core';
import {
  mergeCuaEntityGroup,
  refreshCuaEntityRefsFromLatest,
  removeCuaEntityFromGroup,
  selectedCuaAttachmentTitle,
  selectedListItemsForContext
} from './cua-selection';

function listItem(id: string, selected = true): PointerEntity {
  return {
    id,
    kind: 'listitem',
    text: id,
    confidence: 0.9,
    origin: 'accessibility',
    bbox: { x: 0, y: 0, width: 80, height: 24 },
    state: { selected },
    groundingRef: {
      provider: 'cua',
      pid: 1,
      windowId: '2',
      elementIndex: Number(id.replace(/\D/g, '')) || 0,
      screenRect: { x: 0, y: 0, width: 80, height: 24 }
    }
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

  it('refreshes grouped CUA entity geometry from the latest grounding tree', () => {
    const current = listItem('row-1');
    const latest = {
      ...current,
      bbox: { x: 0, y: 120, width: 80, height: 24 },
      groundingRef: {
        ...current.groundingRef!,
        screenRect: { x: 0, y: 120, width: 80, height: 24 }
      }
    };

    const refreshed = refreshCuaEntityRefsFromLatest([current], [latest]);
    const refreshedEntity = refreshed[0]!;
    expect(refreshedEntity).not.toBe(current);
    expect(refreshedEntity.bbox?.y).toBe(120);
    expect(refreshedEntity.groundingRef?.screenRect?.y).toBe(120);
  });

  it('drops stale geometry when a grouped CUA entity is missing from the latest tree', () => {
    const refreshed = refreshCuaEntityRefsFromLatest([listItem('row-1')], [listItem('row-2')]);
    const refreshedEntity = refreshed[0]!;
    expect(refreshedEntity.id).toBe('row-1');
    expect(refreshedEntity.bbox).toBeUndefined();
    expect(refreshedEntity.groundingRef?.screenRect).toBeUndefined();
  });

  it('does not refresh geometry when the same CUA id now describes a different element', () => {
    const current = listItem('row-1');
    const reusedIndex = {
      ...current,
      text: 'row-99',
      bbox: { x: 0, y: 120, width: 80, height: 24 },
      groundingRef: {
        ...current.groundingRef!,
        screenRect: { x: 0, y: 120, width: 80, height: 24 }
      }
    };

    const refreshed = refreshCuaEntityRefsFromLatest([current], [reusedIndex]);
    const refreshedEntity = refreshed[0]!;
    expect(refreshedEntity.text).toBe('row-1');
    expect(refreshedEntity.bbox).toBeUndefined();
    expect(refreshedEntity.groundingRef?.screenRect).toBeUndefined();
  });

  it('drops stale geometry when the latest grounding tree is empty', () => {
    const refreshed = refreshCuaEntityRefsFromLatest([listItem('row-1')], []);
    const refreshedEntity = refreshed[0]!;
    expect(refreshedEntity.id).toBe('row-1');
    expect(refreshedEntity.bbox).toBeUndefined();
    expect(refreshedEntity.groundingRef?.screenRect).toBeUndefined();
  });
});
