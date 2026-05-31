import type { SelectionDrag, SelectionRect } from '../state';

const SHELL_MARGIN = 12;
const CURSOR_OFFSET_X = 36;
// Height the panel tries to keep available below the pill before lifting the
// shell up. The hard upper bound (and the absolute clip guard) is PANEL_MAX.
const PANEL_COMFORT_HEIGHT = 360;
const PANEL_MAX_HEIGHT = 520;
const PANEL_MIN_HEIGHT = 160;

export function computeShellPosition(cursorX: number, cursorY: number, shellWidth = 520, pillHeight = 44, hasPanel = false) {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  // Horizontal: prefer the right of the cursor, flip to the left on overflow,
  // then clamp so the shell stays fully on-screen.
  let preferredX = cursorX + CURSOR_OFFSET_X;
  if (preferredX + shellWidth + SHELL_MARGIN > viewportW) {
    preferredX = cursorX - shellWidth - CURSOR_OFFSET_X;
  }
  const x = Math.min(Math.max(SHELL_MARGIN, preferredX), Math.max(SHELL_MARGIN, viewportW - shellWidth - SHELL_MARGIN));

  // Vertical: align the pill to the cursor, then lift the whole shell up if the
  // panel would not fit below, so it is never clipped by the bottom edge.
  const desiredHeight = hasPanel ? pillHeight + PANEL_COMFORT_HEIGHT : pillHeight;
  let y = cursorY - pillHeight / 2;
  if (y + desiredHeight + SHELL_MARGIN > viewportH) {
    y = viewportH - desiredHeight - SHELL_MARGIN;
  }
  // Keep the pill on screen at the top, and never push it past the bottom edge.
  const maxTop = Math.max(SHELL_MARGIN, viewportH - pillHeight - SHELL_MARGIN);
  y = Math.min(Math.max(SHELL_MARGIN, y), maxTop);

  return { x, y };
}

/**
 * Max height the stream panel may occupy, measured from its top (just below the
 * pill) down to the bottom margin. Keeps the panel scrolling internally instead
 * of being clipped off the bottom of the screen.
 */
export function availablePanelHeight(shellY: number, pillHeight = 44): number {
  const available = window.innerHeight - shellY - pillHeight - SHELL_MARGIN;
  return Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, available));
}

export function normalizeSelection(rect: SelectionRect): SelectionRect {
  return {
    x1: Math.min(rect.x1, rect.x2),
    y1: Math.min(rect.y1, rect.y2),
    x2: Math.max(rect.x1, rect.x2),
    y2: Math.max(rect.y1, rect.y2)
  };
}

export function clampSelection(rect: SelectionRect, width: number, height: number): SelectionRect {
  const normalized = normalizeSelection(rect);
  return {
    x1: Math.max(0, Math.min(width, normalized.x1)),
    y1: Math.max(0, Math.min(height, normalized.y1)),
    x2: Math.max(0, Math.min(width, normalized.x2)),
    y2: Math.max(0, Math.min(height, normalized.y2))
  };
}

export function selectionFromDrag(drag: SelectionDrag, clientX: number, clientY: number, width: number, height: number): SelectionRect {
  const dx = clientX - drag.startX;
  const dy = clientY - drag.startY;
  if (drag.kind === 'move') {
    const rectWidth = drag.initial.x2 - drag.initial.x1;
    const rectHeight = drag.initial.y2 - drag.initial.y1;
    const x1 = Math.max(0, Math.min(width - rectWidth, drag.initial.x1 + dx));
    const y1 = Math.max(0, Math.min(height - rectHeight, drag.initial.y1 + dy));
    return { x1, y1, x2: x1 + rectWidth, y2: y1 + rectHeight };
  }

  const next = { ...drag.initial };
  if (drag.handle.includes('w')) next.x1 += dx;
  if (drag.handle.includes('e')) next.x2 += dx;
  if (drag.handle.includes('n')) next.y1 += dy;
  if (drag.handle.includes('s')) next.y2 += dy;
  return clampSelection(next, width, height);
}

export function focusPromptInput(input: HTMLTextAreaElement | null) {
  input?.focus({ preventScroll: true });
}
