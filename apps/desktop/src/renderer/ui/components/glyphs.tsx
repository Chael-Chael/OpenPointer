import type { PointerEntity } from '@openpointer/core';

export function ChevronIcon({ size = 8, isOpen = false, direction = 'down' }: { size?: number; isOpen?: boolean; direction?: 'down' | 'right' }) {
  const rotation = direction === 'right' ? -90 : isOpen ? 180 : 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: `rotate(${rotation}deg)`,
        transition: 'transform 180ms ease'
      }}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function WindowGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.5 6H12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="5" cy="4.75" r="0.55" fill="currentColor" />
      <circle cx="6.8" cy="4.75" r="0.55" fill="currentColor" />
    </svg>
  );
}

export function EntityKindGlyph({ kind, size = 14 }: { kind: PointerEntity['kind']; size?: number }) {
  if (kind === 'listitem') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M6 4h7M6 8h7M6 12h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="3" cy="4" r="0.8" fill="currentColor" />
        <circle cx="3" cy="8" r="0.8" fill="currentColor" />
        <circle cx="3" cy="12" r="0.8" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'text' || kind === 'input') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4 3h8M8 3v10M5.5 13h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'image') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2.5" y="3" width="11" height="10" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3.5 11l3-3 2 2 1.5-1.5 2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="10.8" cy="5.8" r="0.8" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'container') return <WindowGlyph size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.5v3M8 10.5v3M2.5 8h3M10.5 8h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
