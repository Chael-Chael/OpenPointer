import type { Point } from '@openpointer/core';

export type WiggleSensitivity = 'low' | 'medium' | 'high';

export type WiggleSample = Point & {
  displayId?: number;
};

export type WiggleOptions = {
  windowMs: number;
  minAmplitudePx: number;
  minReversals: number;
  minTotalDistancePx: number;
  maxNetDistancePx: number;
  sampleTtlMs: number;
  cooldownMs: number;
};

export const DEFAULT_WIGGLE_OPTIONS: WiggleOptions = {
  windowMs: 850,
  minAmplitudePx: 72,
  minReversals: 4,
  minTotalDistancePx: 320,
  maxNetDistancePx: 160,
  sampleTtlMs: 1200,
  cooldownMs: 1400
};

export const WIGGLE_SENSITIVITY_OPTIONS: Record<WiggleSensitivity, WiggleOptions> = {
  low: DEFAULT_WIGGLE_OPTIONS,
  medium: {
    windowMs: 900,
    minAmplitudePx: 60,
    minReversals: 4,
    minTotalDistancePx: 260,
    maxNetDistancePx: 180,
    sampleTtlMs: 1250,
    cooldownMs: 1200
  },
  high: {
    windowMs: 950,
    minAmplitudePx: 48,
    minReversals: 4,
    minTotalDistancePx: 220,
    maxNetDistancePx: 200,
    sampleTtlMs: 1300,
    cooldownMs: 1000
  }
};

export function wiggleOptionsForSensitivity(sensitivity: WiggleSensitivity): WiggleOptions {
  return WIGGLE_SENSITIVITY_OPTIONS[sensitivity] ?? DEFAULT_WIGGLE_OPTIONS;
}

export class WiggleDetector {
  private samples: WiggleSample[] = [];
  private lastFireAt = Number.NEGATIVE_INFINITY;
  private lastProgress = 0;

  constructor(private readonly options: WiggleOptions = DEFAULT_WIGGLE_OPTIONS) {}

  push(sample: WiggleSample): boolean {
    const now = sample.t ?? Date.now();
    if (now - this.lastFireAt < this.options.cooldownMs) {
      this.lastProgress = 0;
      return false;
    }
    this.samples.push({ ...sample, t: now });
    this.samples = this.samples.filter((p) => now - (p.t ?? now) <= this.options.sampleTtlMs).slice(-240);
    const result = this.analyze();
    this.lastProgress = result.progress;
    if (!result.detected) return false;
    this.lastFireAt = now;
    this.samples = [];
    this.lastProgress = 0;
    return true;
  }

  progress(): number {
    return this.lastProgress;
  }

  reset(): void {
    this.samples = [];
    this.lastProgress = 0;
  }

  private analyze(): { detected: boolean; progress: number } {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || this.samples.length < 4) return { detected: false, progress: 0 };
    if (!this.isSingleDisplayWindow()) return { detected: false, progress: 0 };

    const axis = this.primaryAxis();
    const extremes: WiggleSample[] = [first];
    let direction: 1 | -1 | 0 = 0;
    let lastExtremeValue = axisValue(first, axis);

    for (const sample of this.samples.slice(1)) {
      const delta = axisValue(sample, axis) - lastExtremeValue;
      if (Math.abs(delta) < this.options.minAmplitudePx) continue;
      const nextDirection: 1 | -1 = delta > 0 ? 1 : -1;
      if (direction === 0 || nextDirection !== direction) {
        extremes.push(sample);
        direction = nextDirection;
        lastExtremeValue = axisValue(sample, axis);
      }
    }

    const reversals = Math.max(0, extremes.length - 2);
    const progress = Math.min(1, reversals / this.options.minReversals);
    if (reversals < this.options.minReversals) return { detected: false, progress };
    const tailStart = extremes[extremes.length - 1 - this.options.minReversals];
    const tailEnd = extremes[extremes.length - 1];
    if (!tailStart || !tailEnd) return { detected: false, progress };
    if ((tailEnd.t ?? 0) - (tailStart.t ?? 0) > this.options.windowMs) return { detected: false, progress };

    const tailSamples = this.samples.filter((sample) => (sample.t ?? 0) >= (tailStart.t ?? 0) && (sample.t ?? 0) <= (tailEnd.t ?? 0));
    const totalDistance = pathLength(tailSamples);
    if (totalDistance < this.options.minTotalDistancePx) return { detected: false, progress };
    if (distance(tailStart, tailEnd) > this.options.maxNetDistancePx) return { detected: false, progress };
    if (Math.abs(axisValue(tailEnd, axis) - axisValue(tailStart, axis)) > this.options.minAmplitudePx * 2) return { detected: false, progress };
    return { detected: true, progress: 1 };
  }

  private primaryAxis(): 'x' | 'y' {
    const first = this.samples[0];
    if (!first) return 'x';
    const xs = this.samples.map((sample) => sample.x);
    const ys = this.samples.map((sample) => sample.y);
    const xRange = Math.max(...xs) - Math.min(...xs);
    const yRange = Math.max(...ys) - Math.min(...ys);
    return yRange > xRange ? 'y' : 'x';
  }

  private isSingleDisplayWindow(): boolean {
    const displayIds = this.samples.map((sample) => sample.displayId).filter((displayId): displayId is number => displayId !== undefined);
    return displayIds.length === 0 || new Set(displayIds).size === 1;
  }
}

function axisValue(sample: Point, axis: 'x' | 'y'): number {
  return axis === 'x' ? sample.x : sample.y;
}

function pathLength(samples: Point[]): number {
  let total = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const previous = samples[i - 1];
    const current = samples[i];
    if (previous && current) total += distance(previous, current);
  }
  return total;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
