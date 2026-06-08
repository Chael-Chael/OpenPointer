import { describe, expect, it } from 'vitest';
import type { PointerEntity } from '@openpointer/core';
import { createCuaBrushState, isCuaBrushIdleExpired, updateCuaBrushState, type CuaBrushCandidate, type CuaBrushPoint, type CuaBrushState } from './cua-brush';
import type { LocalRect } from './cua-constants';

const testOptions = { activationGraceMs: 0 };

function entity(id: string, rect: LocalRect, kind: PointerEntity['kind'] = 'button'): CuaBrushCandidate {
  return {
    entity: {
      id,
      kind,
      text: id,
      confidence: 0.92,
      origin: 'accessibility',
      bbox: rect,
      groundingRef: { provider: 'cua', pid: 1, windowId: 'w', elementIndex: Number(id.replace(/\D/g, '')) || 1, screenRect: rect }
    },
    rect
  };
}

function point(x: number, y: number, t: number): CuaBrushPoint {
  return { x, y, t };
}

function feed(points: CuaBrushPoint[], candidates: CuaBrushCandidate[], state: CuaBrushState = createCuaBrushState(0, 'w')) {
  let current = state;
  let matched: PointerEntity[] = [];
  for (const nextPoint of points) {
    const result = updateCuaBrushState(current, {
      point: nextPoint,
      candidates,
      windowKey: 'w',
      options: testOptions
    });
    current = result.state;
    if (result.matchedEntities.length > 0) matched = result.matchedEntities;
  }
  return { state: current, matched };
}

describe('CUA brush intent detection', () => {
  it('does not select on a single hover or slow stay', () => {
    const target = entity('button-1', { x: 20, y: 20, width: 42, height: 24 });
    const samples = Array.from({ length: 12 }, (_, index) => point(34 + (index % 2), 30, index * 120));

    expect(feed(samples, [target]).matched).toEqual([]);
  });

  it('requires repeated passes through the same element before matching', () => {
    const target = entity('button-1', { x: 20, y: 20, width: 42, height: 24 });
    const samples = [point(-40, 32, 0), point(32, 32, 100), point(100, 32, 200), point(32, 32, 300), point(-40, 32, 400), point(32, 32, 500)];

    expect(feed(samples, [target]).matched.map((item) => item.id)).toEqual(['button-1']);
  });

  it('does not match a single straight sweep through an element', () => {
    const target = entity('button-1', { x: 80, y: 20, width: 42, height: 24 });
    const samples = [-40, 0, 40, 80, 120, 160, 200].map((x, index) => point(x, 32, index * 80));

    expect(feed(samples, [target]).matched).toEqual([]);
  });

  it('matches elements inside a closed freeform lasso', () => {
    const target = entity('button-1', { x: 80, y: 80, width: 24, height: 24 });
    const samples = Array.from({ length: 17 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 16;
      return point(92 + Math.cos(angle) * 72, 92 + Math.sin(angle) * 58, index * 90);
    });

    expect(feed(samples, [target]).matched.map((item) => item.id)).toEqual(['button-1']);
  });

  it('does not match an unclosed lasso path', () => {
    const target = entity('button-1', { x: 80, y: 80, width: 24, height: 24 });
    const samples = Array.from({ length: 14 }, (_, index) => {
      const angle = (Math.PI * 1.35 * index) / 13;
      return point(92 + Math.cos(angle) * 72, 92 + Math.sin(angle) * 58, index * 90);
    });

    expect(feed(samples, [target]).matched).toEqual([]);
  });

  it('prefers a smaller child element over its containing parent', () => {
    const parent = entity('container-1', { x: 40, y: 40, width: 120, height: 90 }, 'container');
    const child = entity('button-2', { x: 78, y: 70, width: 30, height: 22 }, 'button');
    const samples = Array.from({ length: 17 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 16;
      return point(92 + Math.cos(angle) * 72, 82 + Math.sin(angle) * 58, index * 90);
    });

    expect(feed(samples, [parent, child]).matched.map((item) => item.id)).toEqual(['button-2']);
  });

  it('exposes idle expiry for stale draft clearing', () => {
    const target = entity('button-1', { x: 20, y: 20, width: 42, height: 24 });
    const { state } = feed([point(-40, 32, 0), point(32, 32, 100), point(100, 32, 200), point(32, 32, 300), point(-40, 32, 400), point(32, 32, 500)], [target]);

    expect(isCuaBrushIdleExpired(state, 6499)).toBe(false);
    expect(isCuaBrushIdleExpired(state, 6500)).toBe(true);
  });

  it('resets scoring when the grounded window changes', () => {
    const target = entity('button-1', { x: 20, y: 20, width: 42, height: 24 });
    const primed = feed([point(-40, 32, 0), point(32, 32, 100)], [target]).state;
    const result = updateCuaBrushState(primed, {
      point: point(32, 32, 200),
      candidates: [target],
      windowKey: 'other',
      options: testOptions
    });

    expect(result.matchedEntities).toEqual([]);
    expect(result.state.points).toEqual([]);
    expect(result.state.windowKey).toBe('other');
  });
});
