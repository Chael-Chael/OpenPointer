import { useEffect, useMemo, useState } from 'react';
import { nextTrail, toSmoothSvgPath } from '@openmagicpointer/gestures';
import type { Point } from '@openmagicpointer/core';

type Props = {
  x: number;
  y: number;
  enabled: boolean;
};

export function CursorTrail({ x, y, enabled }: Props) {
  const [points, setPoints] = useState<Point[]>([]);

  useEffect(() => {
    if (!enabled) {
      setPoints([]);
      return;
    }
    setPoints((prev) => nextTrail(prev, { x, y, t: Date.now() }));
  }, [enabled, x, y]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setPoints((prev) => nextTrail(prev, { x, y, t: Date.now() }).filter((p) => Date.now() - (p.t ?? 0) < 430));
    }, 80);
    return () => window.clearInterval(id);
  }, [x, y]);

  const path = useMemo(() => toSmoothSvgPath(points), [points]);
  if (!enabled) return null;

  return (
    <>
      <svg className="cursor-trail" aria-hidden="true">
        <defs>
          <linearGradient id="ompTrail" gradientUnits="userSpaceOnUse" x1={points[0]?.x ?? x} y1={points[0]?.y ?? y} x2={x} y2={y}>
            <stop offset="0%" stopColor="rgba(74, 222, 128, 0)" />
            <stop offset="55%" stopColor="rgba(74, 222, 128, 0.25)" />
            <stop offset="100%" stopColor="rgba(74, 222, 128, 0.9)" />
          </linearGradient>
          <filter id="ompTrailBlur" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        {path && (
          <>
            <path d={path} stroke="url(#ompTrail)" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.34" filter="url(#ompTrailBlur)" />
            <path d={path} stroke="url(#ompTrail)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.88" />
          </>
        )}
      </svg>
      <div className="cursor-halo" style={{ transform: `translate3d(${x - 24}px, ${y - 24}px, 0)` }} />
    </>
  );
}
