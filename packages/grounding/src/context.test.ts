import { describe, expect, it } from 'vitest';
import type { PointerEntity } from '@openmagicpointer/core';
import { buildPointerContext } from './context.js';

function entity(id: string, bbox: PointerEntity['bbox']): PointerEntity {
  return { id, kind: 'button', text: id, confidence: 0.9, origin: 'accessibility', bbox };
}

const cursor = { x: 15, y: 15, localX: 15, localY: 15, displayId: 0, dpr: 1 };

describe('buildPointerContext target selection', () => {
  it('selects the smallest entity containing the cursor', () => {
    const big = entity('big', { x: 0, y: 0, width: 100, height: 100 });
    const small = entity('small', { x: 10, y: 10, width: 20, height: 20 });
    const context = buildPointerContext({ cursor, entities: [big, small] });
    expect(context.target?.id).toBe('small');
  });

  it('falls back to the first entity when none contain the cursor', () => {
    const a = entity('a', { x: 200, y: 200, width: 10, height: 10 });
    const b = entity('b', { x: 300, y: 300, width: 10, height: 10 });
    const context = buildPointerContext({ cursor, entities: [a, b] });
    expect(context.target?.id).toBe('a');
  });

  it('marks input targets as the insertion target', () => {
    const input: PointerEntity = { id: 'field', kind: 'input', confidence: 0.9, origin: 'accessibility', bbox: { x: 0, y: 0, width: 50, height: 50 } };
    const context = buildPointerContext({ cursor, entities: [input] });
    expect(context.selection?.insertionTarget?.id).toBe('field');
  });

  it('preserves selected text in the pointer context', () => {
    const context = buildPointerContext({ cursor, selectionText: 'selected text' });
    expect(context.selection?.text).toBe('selected text');
  });

  it('caps nearby at 24 entities', () => {
    const entities = Array.from({ length: 30 }, (_, i) => entity(`e${i}`, { x: i * 10, y: 0, width: 5, height: 5 }));
    const context = buildPointerContext({ cursor, entities });
    expect(context.nearby).toHaveLength(24);
  });

  it('keeps all nearby entities when under the cap', () => {
    const entities = Array.from({ length: 12 }, (_, i) => entity(`e${i}`, { x: i * 10, y: 0, width: 5, height: 5 }));
    const context = buildPointerContext({ cursor, entities });
    expect(context.nearby).toHaveLength(12);
  });
});
