import { describe, expect, it } from 'vitest';
import { WiggleDetector } from './wiggle.js';

describe('WiggleDetector', () => {
  it('fires for repeated horizontal reversals', () => {
    const detector = new WiggleDetector({
      windowMs: 1000,
      minAmplitudePx: 20,
      minReversals: 3,
      sampleTtlMs: 1200,
      cooldownMs: 0
    });
    const samples = [0, 40, -5, 45, -10, 50].map((x, i) => ({ x, y: 0, t: i * 100 }));
    expect(samples.some((p) => detector.push(p))).toBe(true);
  });
});
