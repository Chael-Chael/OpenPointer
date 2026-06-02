import type { Point } from '@openpointer/core';

export type TrailOptions = {
  lifetimeMs: number;
  maxPoints: number;
};

export const DEFAULT_TRAIL_OPTIONS: TrailOptions = {
  lifetimeMs: 450,
  maxPoints: 20
};

export function nextTrail(points: Point[], point: Point, options: TrailOptions = DEFAULT_TRAIL_OPTIONS): Point[] {
  const now = point.t ?? Date.now();
  const last = points[points.length - 1];
  if (last && last.x === point.x && last.y === point.y) {
    return points.filter((p) => now - (p.t ?? now) <= options.lifetimeMs);
  }
  return [...points, { ...point, t: now }].filter((p) => now - (p.t ?? now) <= options.lifetimeMs).slice(-options.maxPoints);
}

export function toSmoothSvgPath(points: Point[]): string {
  if (points.length < 2) return '';
  const [first] = points;
  if (!first) return '';
  if (points.length === 2) {
    const second = points[1];
    return second ? `M ${first.x} ${first.y} L ${second.x} ${second.y}` : '';
  }
  let d = `M ${first.x} ${first.y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    if (!p0 || !p1 || !p2 || !p3) continue;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}
