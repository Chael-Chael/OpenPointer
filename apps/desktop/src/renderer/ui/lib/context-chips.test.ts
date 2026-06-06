import { describe, expect, it } from 'vitest';
import type { ContextChip, PointerEntity } from '@openpointer/core';
import { contextChipFromEntity, contextChipFromRegion, contextChipFromWindowPreview, pinContextChip, removeContextChip } from './context-chips';

describe('context chips', () => {
  it('creates a lightweight window chip from preview metadata', () => {
    const chip = contextChipFromWindowPreview({
      status: 'matched',
      source: 'cua',
      window: { title: 'AI Pointer', app: 'Chrome', process: 'chrome.exe', windowId: '88' },
      pid: 123,
      windowId: '88',
      bounds: { x: 10, y: 20, width: 800, height: 600 }
    });

    expect(chip).toMatchObject({
      id: 'window:123:88',
      kind: 'window',
      status: 'candidate',
      label: 'AI Pointer',
      subtitle: 'Chrome',
      windowRef: { pid: 123, windowId: '88' }
    });
    expect(chip?.windowSnapshot).toBeUndefined();
  });

  it('pins, dedupes, and caps chips', () => {
    const chip = (id: string): ContextChip => ({
      id,
      kind: 'window',
      status: 'candidate',
      label: id,
      createdAt: 1,
      lastSeenAt: 1
    });

    const pinned = ['a', 'b', 'c', 'd'].reduce((current, id) => pinContextChip(current, chip(id)), [] as ContextChip[]);
    expect(pinned.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);

    const deduped = pinContextChip(pinned, chip('b'));
    expect(deduped.map((item) => item.id)).toEqual(['a', 'c', 'd', 'b']);

    const capped = pinContextChip(deduped, chip('e'));
    expect(capped.map((item) => item.id)).toEqual(['c', 'd', 'b', 'e']);
  });

  it('creates entity and region chips', () => {
    const entity: PointerEntity = {
      id: 'button-1',
      kind: 'button',
      text: 'Submit',
      role: 'Button',
      confidence: 0.9,
      origin: 'accessibility',
      groundingRef: { provider: 'cua', pid: 1, windowId: '2', elementIndex: 4 }
    };

    expect(contextChipFromEntity(entity)).toMatchObject({ id: 'entity:button-1', label: 'Submit', subtitle: 'Button' });
    expect(contextChipFromRegion({ x: 1, y: 2, width: 30, height: 40 })).toMatchObject({ id: 'region:1:2:30:40', label: 'Selected region' });
  });

  it('removes a pinned chip by id', () => {
    const chips: ContextChip[] = [
      { id: 'a', kind: 'window', status: 'pinned', label: 'a', createdAt: 1, lastSeenAt: 1 },
      { id: 'b', kind: 'window', status: 'pinned', label: 'b', createdAt: 1, lastSeenAt: 1 }
    ];

    expect(removeContextChip(chips, 'a').map((chip) => chip.id)).toEqual(['b']);
  });
});
