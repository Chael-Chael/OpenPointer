import type { PointerEntity, PointerEntityKind, Rect } from '@openpointer/core';
import type { CursorPayload } from '../shared/types.js';

export type DisplayBounds = { id?: number; x: number; y: number; width: number; height: number; scaleFactor?: number };

/**
 * Pure geometry + matching helpers for CUA grounding. Kept free of Electron
 * imports so the coordinate math can be unit-tested in isolation.
 */

export function normalizeRect(rect: Rect): Rect | undefined {
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  const x = Number(rect.x);
  const y = Number(rect.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y, width, height };
}

export function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function area(rect: Rect): number {
  return rect.width * rect.height;
}

export function rectCenter(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Squared distance from a point to the nearest edge of a rect (0 when inside).
 * Squared avoids a sqrt and is monotonic for comparison purposes.
 */
export function distanceToRectSquared(x: number, y: number, rect: Rect): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
  return dx * dx + dy * dy;
}

export function normalizeText(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

export function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value?.trim())?.trim();
}

export function kindFromControlType(controlType: string): PointerEntityKind {
  const value = controlType.toLowerCase();
  // Order matters: match specific control types before broad ones. 'input' is
  // relied on by grounding (context.ts) to mark text-insertion targets.
  if (value.includes('edit')) return 'input';
  if (value.includes('hyperlink')) return 'link';
  if (value.includes('checkbox')) return 'checkbox';
  if (value.includes('radiobutton') || value === 'radio') return 'radio';
  if (value.includes('togglebutton') || value === 'toggle') return 'toggle';
  if (value.includes('combobox')) return 'combobox';
  if (value.includes('menuitem')) return 'menuitem';
  if (value.includes('menubar') || value === 'menu') return 'menu';
  if (value.includes('tabitem') || value === 'tab') return 'tab';
  if (value.includes('treeitem')) return 'treeitem';
  if (value.includes('listitem') || value.includes('dataitem')) return 'listitem';
  if (value.includes('slider') || value.includes('spinner') || value.includes('scrollbar')) return 'slider';
  if (value.includes('toolbar')) return 'toolbar';
  if (value.includes('table') || value.includes('datagrid')) return 'table';
  if (value.includes('image')) return 'image';
  if (/(button|splitbutton)/i.test(value)) return 'button';
  if (value.includes('text') || value.includes('document')) return 'text';
  if (/(pane|group|window|custom|panel)/i.test(value)) return 'container';
  return 'unknown';
}

/**
 * A grounded entity is "noise" when it is a pure layout container (or unknown)
 * that the user can neither act on nor read: no actions and no text label. These
 * add clutter to the element list and to the model's `nearby` context without
 * providing an actionable or informative target, so callers can filter them out.
 */
export function isNoiseEntity(entity: Pick<PointerEntity, 'kind' | 'text' | 'groundingRef'>): boolean {
  const hasActions = (entity.groundingRef?.actions?.length ?? 0) > 0;
  if (hasActions) return false;
  const hasText = Boolean(entity.text?.trim());
  if (hasText) return false;
  return entity.kind === 'container' || entity.kind === 'unknown';
}

/**
 * Pick the display whose bounds contain the rect's top-left, falling back to
 * the display with the largest overlap, then the first display. Replaces
 * Electron's per-element screen.getDisplayMatching with a cheap pure lookup so
 * the caller can fetch displays once and reuse them across all elements.
 */
export function displayForRect(rect: Rect, displays: DisplayBounds[]): DisplayBounds | undefined {
  if (displays.length === 0) return undefined;
  let best: { display: DisplayBounds; overlap: number } | undefined;
  for (const display of displays) {
    const overlapX = Math.max(0, Math.min(rect.x + rect.width, display.x + display.width) - Math.max(rect.x, display.x));
    const overlapY = Math.max(0, Math.min(rect.y + rect.height, display.y + display.height) - Math.max(rect.y, display.y));
    const overlap = overlapX * overlapY;
    if (!best || overlap > best.overlap) best = { display, overlap };
  }
  return best?.display ?? displays[0];
}

function displayScale(display: DisplayBounds, fallback = 1): number {
  return Math.max(1, display.scaleFactor ?? fallback);
}

function physicalWidth(display: DisplayBounds, fallbackScale = 1): number {
  return display.width * displayScale(display, fallbackScale);
}

function physicalHeight(display: DisplayBounds, fallbackScale = 1): number {
  return display.height * displayScale(display, fallbackScale);
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function physicalOriginForDisplay(
  display: DisplayBounds,
  displays: DisplayBounds[],
  fallbackScale = display.scaleFactor ?? 1
): { x: number; y: number } {
  const leftEdge = display.x;
  const topEdge = display.y;
  const rightEdge = display.x + display.width;
  const bottomEdge = display.y + display.height;
  const physicalX =
    leftEdge >= 0
      ? displays
          .filter(
            (candidate) =>
              candidate.x >= 0 && candidate.x + candidate.width <= leftEdge && rangesOverlap(candidate.y, candidate.y + candidate.height, topEdge, bottomEdge)
          )
          .reduce((sum, candidate) => sum + physicalWidth(candidate, fallbackScale), 0)
      : -displays
          .filter((candidate) => candidate.x >= leftEdge && candidate.x < 0 && rangesOverlap(candidate.y, candidate.y + candidate.height, topEdge, bottomEdge))
          .reduce((sum, candidate) => sum + physicalWidth(candidate, fallbackScale), 0);
  const physicalY =
    topEdge >= 0
      ? displays
          .filter(
            (candidate) =>
              candidate.y >= 0 && candidate.y + candidate.height <= topEdge && rangesOverlap(candidate.x, candidate.x + candidate.width, leftEdge, rightEdge)
          )
          .reduce((sum, candidate) => sum + physicalHeight(candidate, fallbackScale), 0)
      : -displays
          .filter((candidate) => candidate.y >= topEdge && candidate.y < 0 && rangesOverlap(candidate.x, candidate.x + candidate.width, leftEdge, rightEdge))
          .reduce((sum, candidate) => sum + physicalHeight(candidate, fallbackScale), 0);

  return { x: physicalX, y: physicalY };
}

export function providerPointForCursor(
  cursor: Pick<CursorPayload, 'localX' | 'localY' | 'dpr'>,
  display: DisplayBounds,
  displays: DisplayBounds[]
): { x: number; y: number } {
  const scale = displayScale(display, cursor.dpr);
  const origin = physicalOriginForDisplay(display, displays, scale);
  return {
    x: origin.x + cursor.localX * scale,
    y: origin.y + cursor.localY * scale
  };
}

/**
 * Convert a physical (or DIP) screen rect to display-local DIP coordinates.
 * `coordinateScale` collapses physical pixels back to DIPs; the matching
 * display origin is then subtracted so the rect is local to that display.
 */
export function screenRectToLocal(rect: Rect, coordinateScale: number, displays: DisplayBounds[], displayHint?: DisplayBounds): Rect {
  const scale = Math.max(1, coordinateScale || 1);
  if (displayHint && scale > 1) {
    const displaySpecificScale = displayScale(displayHint, scale);
    const physicalOrigin = physicalOriginForDisplay(displayHint, displays, displaySpecificScale);
    const localRect = {
      x: (rect.x - physicalOrigin.x) / displaySpecificScale,
      y: (rect.y - physicalOrigin.y) / displaySpecificScale,
      width: rect.width / displaySpecificScale,
      height: rect.height / displaySpecificScale
    };
    if (isPlausibleDisplayLocalRect(localRect, displayHint)) return localRect;
  }

  const dipRect = {
    x: rect.x / scale,
    y: rect.y / scale,
    width: rect.width / scale,
    height: rect.height / scale
  };
  const display = displayForRect(dipRect, displays);
  const originX = display?.x ?? 0;
  const originY = display?.y ?? 0;
  return {
    x: dipRect.x - originX,
    y: dipRect.y - originY,
    width: dipRect.width,
    height: dipRect.height
  };
}

function isPlausibleDisplayLocalRect(rect: Rect, display: DisplayBounds): boolean {
  const margin = Math.max(96, Math.min(display.width, display.height) * 0.08);
  return rect.x + rect.width >= -margin && rect.x <= display.width + margin && rect.y + rect.height >= -margin && rect.y <= display.height + margin;
}

/**
 * Resolve the entity under the cursor. Prefers the smallest entity that
 * actually contains the cursor; if none contain it, falls back to the closest
 * entity within `maxFallbackDistance` DIPs so a near-miss still resolves.
 */
export function resolveHoveredEntity(
  cursor: Pick<CursorPayload, 'localX' | 'localY'>,
  entities: PointerEntity[],
  maxFallbackDistance = 24
): string | undefined {
  const withBbox = entities.filter((entity): entity is PointerEntity & { bbox: Rect } => Boolean(entity.bbox));
  const contained = withBbox.filter((entity) => pointInRect(cursor.localX, cursor.localY, entity.bbox)).sort((a, b) => area(a.bbox) - area(b.bbox));
  if (contained[0]) return contained[0].id;

  let nearest: { id: string; distanceSquared: number } | undefined;
  for (const entity of withBbox) {
    const distanceSquared = distanceToRectSquared(cursor.localX, cursor.localY, entity.bbox);
    if (!nearest || distanceSquared < nearest.distanceSquared) {
      nearest = { id: entity.id, distanceSquared };
    }
  }
  if (nearest && nearest.distanceSquared <= maxFallbackDistance * maxFallbackDistance) {
    return nearest.id;
  }
  return undefined;
}

export type ParsedTreeElement = {
  element_index: number;
  control_type: string;
  name?: string;
  automation_id?: string;
  help_text?: string;
  value?: string;
  actions: string[];
};

/**
 * Parse the `tree_markdown` emitted by `get_window_state`. The release build of
 * cua-driver does not return a structured `elements` array (that field is added
 * by the OpenPointer source patch), but it always renders an indented
 * markdown tree where actionable nodes look like:
 *
 *   - [3] Button "Close tab" [id=CloseButton actions=[invoke]]
 *
 * We extract those `[index]` rows so grounding works against an unpatched
 * release driver, just without per-element coordinates.
 */
export function parseTreeMarkdown(markdown: string | undefined): ParsedTreeElement[] {
  if (!markdown) return [];
  const out: ParsedTreeElement[] = [];
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const head = line.match(/^[-*]?\s*\[(\d+)\]\s+([A-Za-z][\w-]*)/);
    if (!head) continue;
    const rest = line.slice(head[0].length);
    const name = rest.match(/^\s+"([^"]*)"/)?.[1];
    const actions = rest.match(/actions=\[([^\]]*)\]/)?.[1];
    out.push({
      element_index: Number(head[1]),
      control_type: head[2] ?? 'Unknown',
      name,
      automation_id: rest.match(/\bid=([^\s\]]+)/)?.[1],
      help_text: rest.match(/help="([^"]*)"/)?.[1],
      value: rest.match(/value="([^"]*)"/)?.[1],
      actions: actions
        ? actions
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean)
        : []
    });
  }
  return out;
}
