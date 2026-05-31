import { useEffect, useMemo, useRef, useState } from 'react';
import { nextTrail } from '@openmagicpointer/gestures';
import type { Point } from '@openmagicpointer/core';

type Props = {
  x: number;
  y: number;
  enabled: boolean;
};

export function CursorTrail({ x, y, enabled }: Props) {
  const [points, setPoints] = useState<Point[]>([]);
  const posRef = useRef({ x, y });
  posRef.current = { x, y };

  useEffect(() => {
    if (!enabled) {
      setPoints([]);
      return;
    }
    setPoints((prev) => nextTrail(prev, { x, y, t: Date.now() }));
  }, [enabled, x, y]);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      const { x: cx, y: cy } = posRef.current;
      setPoints((prev) => nextTrail(prev, { x: cx, y: cy, t: Date.now() }).filter((p) => Date.now() - (p.t ?? 0) < 430));
    }, 80);
    return () => window.clearInterval(id);
  }, [enabled]);

  const segments = useMemo(() => {
    if (points.length < 2) return [];

    const result = [];
    const now = Date.now();
    const lifetime = 430;

    if (points.length === 2) {
      const p1 = points[0];
      const p2 = points[1];
      if (p1 && p2) {
        const age = now - (p2.t ?? now);
        const ageRatio = Math.max(0.01, Math.min(1, 1 - age / lifetime));
        result.push({
          d: `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`,
          ratio: ageRatio
        });
      }
      return result;
    }

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

      const indexRatio = (i + 1) / (points.length - 1);
      const age = now - (p2.t ?? now);
      const ageRatio = Math.max(0.01, Math.min(1, 1 - age / lifetime));
      const ratio = indexRatio * ageRatio;

      result.push({
        d: `M ${p1.x} ${p1.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`,
        ratio
      });
    }
    return result;
  }, [points]);

  if (!enabled) return null;

  return (
    <svg className="cursor-trail" aria-hidden="true">
      <defs>
        <linearGradient id="ompTrail" gradientUnits="userSpaceOnUse" x1={points[0]?.x ?? x} y1={points[0]?.y ?? y} x2={x} y2={y}>
          <stop offset="0%" stopColor="rgba(52, 120, 246, 0)" />
          <stop offset="48%" stopColor="rgba(74, 163, 255, 0.26)" />
          <stop offset="100%" stopColor="rgba(0, 132, 255, 0.95)" />
        </linearGradient>
        <filter id="ompTrailBlur" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      {segments.length > 0 && (
        <>
          {/* Outer Glow Layer */}
          <g opacity="0.26" filter="url(#ompTrailBlur)">
            {segments.map((seg, idx) => (
              <path
                key={idx}
                d={seg.d}
                stroke="url(#ompTrail)"
                strokeWidth={28 * Math.pow(seg.ratio, 1.2)}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
          </g>

          {/* Medium Glow Layer */}
          <g opacity="0.34" filter="url(#ompTrailBlur)">
            {segments.map((seg, idx) => (
              <path
                key={idx}
                d={seg.d}
                stroke="url(#ompTrail)"
                strokeWidth={11 * Math.pow(seg.ratio, 1.2)}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
          </g>

          {/* Sharp Core Layer */}
          <g opacity="0.92">
            {segments.map((seg, idx) => (
              <path
                key={idx}
                d={seg.d}
                stroke="url(#ompTrail)"
                strokeWidth={4.5 * Math.pow(seg.ratio, 1.2)}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
          </g>
        </>
      )}
    </svg>
  );
}
