import { describe, expect, it } from 'vitest';
import type { PointerContext } from './types.js';
import { createPointerMemory, rememberCurrent, rememberInsertion, rememberSelected, resolvePronoun } from './memory.js';

function context(id: string): PointerContext {
  return {
    id,
    source: 'desktop',
    cursor: { x: 0, y: 0, displayId: 1, localX: 0, localY: 0, dpr: 1 },
    entities: [],
    nearby: [],
    createdAt: 1
  };
}

describe('pointer memory', () => {
  it('tracks this and that as current context changes', () => {
    const first = context('first');
    const second = context('second');
    const memory = rememberCurrent(rememberCurrent(createPointerMemory(), first), second);

    expect(resolvePronoun(memory, 'this')).toBe(second);
    expect(resolvePronoun(memory, 'that')).toBe(first);
  });

  it('tracks these without duplicating selected contexts', () => {
    const first = context('first');
    const second = context('second');
    const memory = rememberSelected(rememberSelected(rememberSelected(createPointerMemory(), first), second), first);

    expect(resolvePronoun(memory, 'these')).toEqual([second, first]);
  });

  it('tracks here as the current insertion context', () => {
    const target = context('target');
    const memory = rememberInsertion(createPointerMemory(), target);

    expect(resolvePronoun(memory, 'here')).toBe(target);
  });
});
