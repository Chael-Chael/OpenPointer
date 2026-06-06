import { describe, expect, it } from 'vitest';
import { WiggleDetector, type WiggleOptions } from './wiggle.js';

const options: WiggleOptions = {
  windowMs: 1000,
  minAmplitudePx: 20,
  minReversals: 4,
  minTotalDistancePx: 140,
  maxNetDistancePx: 80,
  sampleTtlMs: 1200,
  cooldownMs: 500
};

describe('WiggleDetector', () => {
  it('fires for repeated horizontal reversals', () => {
    const detector = new WiggleDetector(options);
    const samples = [0, 44, -4, 48, -8, 52, -6].map((x, i) => ({ x, y: 0, t: i * 100, displayId: 1 }));
    expect(samples.some((p) => detector.push(p))).toBe(true);
  });

  it('fires for repeated vertical reversals', () => {
    const detector = new WiggleDetector(options);
    const samples = [0, 42, -6, 44, -8, 46, -4].map((y, i) => ({ x: 5, y, t: i * 100, displayId: 1 }));
    expect(samples.some((p) => detector.push(p))).toBe(true);
  });

  it('does not fire for fast straight movement', () => {
    const detector = new WiggleDetector(options);
    const samples = [0, 30, 60, 90, 120, 150, 180].map((x, i) => ({ x, y: 0, t: i * 60, displayId: 1 }));
    expect(samples.some((p) => detector.push(p))).toBe(false);
  });

  it('does not fire for slow wandering movement', () => {
    const detector = new WiggleDetector(options);
    const samples = [0, 42, -4, 44, -6, 46, -5].map((x, i) => ({ x, y: 0, t: i * 420, displayId: 1 }));
    expect(samples.some((p) => detector.push(p))).toBe(false);
  });

  it('does not fire for large back-and-forth travel with high net movement', () => {
    const detector = new WiggleDetector(options);
    const samples = [0, 45, 10, 70, 35, 100, 65, 135].map((x, i) => ({ x, y: 0, t: i * 100, displayId: 1 }));
    expect(samples.some((p) => detector.push(p))).toBe(false);
  });

  it('does not fire across displays', () => {
    const detector = new WiggleDetector(options);
    const samples = [0, 44, -4, 48, -8, 52, -6].map((x, i) => ({ x, y: 0, t: i * 100, displayId: i < 3 ? 1 : 2 }));
    expect(samples.some((p) => detector.push(p))).toBe(false);
  });

  it('respects cooldown', () => {
    const detector = new WiggleDetector(options);
    const samples = [0, 44, -4, 48, -8, 52, -6].map((x, i) => ({ x, y: 0, t: i * 100, displayId: 1 }));
    expect(samples.some((p) => detector.push(p))).toBe(true);
    const second = [0, 44, -4, 48, -8, 52, -6].map((x, i) => ({ x, y: 0, t: 700 + i * 40, displayId: 1 }));
    expect(second.some((p) => detector.push(p))).toBe(false);
  });
});
