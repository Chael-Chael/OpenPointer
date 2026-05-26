import type { Point } from '@openmagicpointer/core';

export type WiggleOptions = {
  windowMs: number;
  minAmplitudePx: number;
  minReversals: number;
  sampleTtlMs: number;
  cooldownMs: number;
};

export const DEFAULT_WIGGLE_OPTIONS: WiggleOptions = {
  windowMs: 1000,
  minAmplitudePx: 48,
  minReversals: 3,
  sampleTtlMs: 1400,
  cooldownMs: 1200
};

export class WiggleDetector {
  private samples: Point[] = [];
  private lastFireAt = 0;

  constructor(private readonly options: WiggleOptions = DEFAULT_WIGGLE_OPTIONS) {}

  push(sample: Point): boolean {
    const now = sample.t ?? Date.now();
    if (now - this.lastFireAt < this.options.cooldownMs) return false;
    this.samples.push({ ...sample, t: now });
    this.samples = this.samples.filter((p) => now - (p.t ?? now) <= this.options.sampleTtlMs).slice(-240);
    if (this.samples.length < 4) return false;
    if (!this.hasRecentReversals()) return false;
    this.lastFireAt = now;
    this.samples = [];
    return true;
  }

  reset(): void {
    this.samples = [];
  }

  private hasRecentReversals(): boolean {
    const first = this.samples[0];
    if (!first) return false;
    const extremes: Point[] = [first];
    let direction: 1 | -1 | 0 = 0;
    let lastExtremeX = first.x;

    for (const sample of this.samples.slice(1)) {
      const dx = sample.x - lastExtremeX;
      if (Math.abs(dx) < this.options.minAmplitudePx) continue;
      const nextDirection: 1 | -1 = dx > 0 ? 1 : -1;
      if (direction === 0 || nextDirection !== direction) {
        extremes.push(sample);
        direction = nextDirection;
        lastExtremeX = sample.x;
      }
    }

    const reversals = Math.max(0, extremes.length - 2);
    if (reversals < this.options.minReversals) return false;
    const tailStart = extremes[extremes.length - 1 - this.options.minReversals];
    const tailEnd = extremes[extremes.length - 1];
    if (!tailStart || !tailEnd) return false;
    return (tailEnd.t ?? 0) - (tailStart.t ?? 0) <= this.options.windowMs;
  }
}
