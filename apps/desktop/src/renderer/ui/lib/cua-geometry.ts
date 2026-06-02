import type { PointerEntity } from '@openpointer/core';
import type { CursorPayload } from '../../../shared/types';
import { CUA_HIGHLIGHT_RADIUS_X, CUA_HIGHLIGHT_RADIUS_Y, type LocalRect } from './cua-constants';

export function cursorDistanceSquared(a: CursorPayload, b: CursorPayload): number {
  const dx = a.localX - b.localX;
  const dy = a.localY - b.localY;
  return dx * dx + dy * dy;
}

export function rectsIntersect(a: LocalRect, b: LocalRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function pointInLocalRect(x: number, y: number, rect: LocalRect, margin = 0): boolean {
  return x >= rect.x - margin && x <= rect.x + rect.width + margin && y >= rect.y - margin && y <= rect.y + rect.height + margin;
}

export function distanceToLocalRectSquared(x: number, y: number, rect: LocalRect): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
  return dx * dx + dy * dy;
}

export function contextRegionAroundCursor(cursor: CursorPayload): LocalRect {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const width = Math.min(viewportW, CUA_HIGHLIGHT_RADIUS_X * 2);
  const height = Math.min(viewportH, CUA_HIGHLIGHT_RADIUS_Y * 2);
  return {
    x: Math.max(0, Math.min(viewportW - width, cursor.localX - width / 2)),
    y: Math.max(0, Math.min(viewportH - height, cursor.localY - height / 2)),
    width,
    height
  };
}

export function highlightRectForEntity(entity: PointerEntity): LocalRect | undefined {
  const rect = entity.bbox;
  if (!rect || !entity.groundingRef?.screenRect) return undefined;
  if (rect.width < 3 || rect.height < 3) return undefined;
  if (rect.width > window.innerWidth * 0.95 && rect.height > window.innerHeight * 0.75) return undefined;
  return rect;
}

export function hasPreciseCuaRect(entity: PointerEntity): boolean {
  return Boolean(highlightRectForEntity(entity));
}

export function defaultContextInstruction(hasSelectionContext: boolean, hasCuaContext: boolean, hasWindowContext: boolean): string {
  if (hasSelectionContext && hasCuaContext) return 'Analyze the current screenshot selection and CUA-recognized UI context.';
  if (hasSelectionContext) return 'Analyze the current screenshot selection.';
  if (hasCuaContext) return 'Analyze the current CUA-recognized UI context.';
  if (hasWindowContext) return 'Analyze the current window context.';
  return 'Analyze the current pointer context.';
}
