import { screen } from 'electron';
import type { PointerContext, PointerEntity, Rect } from '@openpointer/core';
import type { CursorPayload, GroundingPreviewResponse, WindowPreviewResponse } from '../shared/types.js';
import { CuaSidecarManager, type CuaToolResult } from './cua-sidecar.js';
import {
  type DisplayBounds,
  type ParsedTreeElement,
  firstNonEmpty,
  isNoiseEntity,
  kindFromControlType,
  normalizeRect,
  normalizeText,
  parseTreeMarkdown,
  providerPointForCursor,
  pointInRect,
  resolveHoveredEntity,
  screenRectToLocal,
  selectedStateFromCuaElement
} from './cua-geometry.js';

type CuaWindowRecord = {
  window_id?: number;
  pid?: number;
  app_name?: string;
  title?: string;
  bounds?: Rect;
};

type CuaElementRecord = {
  element_index?: number;
  control_type?: string;
  name?: string;
  value?: string;
  automation_id?: string;
  help_text?: string;
  actions?: string[];
  rect?: Rect | [number, number, number, number];
  bounds?: Rect | [number, number, number, number];
  bounding_rect?: Rect | [number, number, number, number];
  boundingRect?: Rect | [number, number, number, number];
  frame?: Rect | [number, number, number, number];
  center?: { x: number; y: number };
  is_selected?: unknown;
  selected?: unknown;
  isSelected?: unknown;
  source?: 'uia' | 'msaa';
};

export type CuaGroundingSnapshot = GroundingPreviewResponse & {
  matchedWindow?: { pid: number; windowId: string };
};

export class CuaGroundingProvider {
  constructor(private readonly sidecar: CuaSidecarManager) {}

  async previewWindow(cursor: CursorPayload, windowInfo?: PointerContext['window']): Promise<WindowPreviewResponse> {
    try {
      const windows = await this.listWindows();
      const displays = currentDisplayBounds();
      const cursorDisplay = displays.find((display) => display.id === cursor.displayId) ?? displayForCursor(cursor, displays);
      const matched = matchWindow(windows, cursor, windowInfo, displays, cursorDisplay);
      if (!matched || typeof matched.pid !== 'number' || typeof matched.window_id !== 'number') {
        return { status: 'fallback', source: 'cua', error: 'No confident CUA window match.' };
      }
      return {
        status: 'matched',
        source: 'cua',
        window: {
          title: matched.title,
          app: matched.app_name,
          process: matched.app_name,
          windowId: String(matched.window_id)
        },
        pid: matched.pid,
        windowId: String(matched.window_id),
        bounds: matched.bounds
      };
    } catch (error) {
      return {
        status: 'unavailable',
        source: 'cua',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async preview(cursor: CursorPayload, windowInfo?: PointerContext['window']): Promise<CuaGroundingSnapshot> {
    try {
      const windows = await this.listWindows();
      // Fetch displays once and reuse across every element; resolving them
      // per-element via screen.getDisplayMatching is a costly native call.
      const displays = currentDisplayBounds();
      const cursorDisplay = displays.find((display) => display.id === cursor.displayId) ?? displayForCursor(cursor, displays);
      const matched = matchWindow(windows, cursor, windowInfo, displays, cursorDisplay);
      if (!matched || typeof matched.pid !== 'number' || typeof matched.window_id !== 'number') {
        return { status: 'fallback', entities: [], error: 'No confident CUA window match.' };
      }

      const state = await this.sidecar.callTool('get_window_state', {
        pid: matched.pid,
        window_id: matched.window_id,
        // 'ax' = accessibility tree only, no screenshot. Grounding preview only
        // consumes the structured element list, so skipping the WGC/BitBlt capture
        // avoids redundant screenshots (and their warnings) on every cursor move.
        capture_mode: 'ax'
      });
      if (state.isError) {
        return { status: 'unavailable', entities: [], error: cuaErrorText(state) ?? 'CUA get_window_state reported an error.' };
      }
      const structured = state.structuredContent as { elements?: CuaElementRecord[]; element_count?: number; tree_markdown?: string } | undefined;
      const coordinateScale = usesPhysicalCoordinates(matched.bounds, cursor, cursorDisplay, displays)
        ? Math.max(1, cursorDisplay?.scaleFactor ?? cursor.dpr ?? 1)
        : 1;
      let entities = (structured?.elements ?? [])
        .map((element) => entityFromCuaElement(element, matched.pid!, String(matched.window_id), coordinateScale, displays, cursorDisplay))
        .filter((entity): entity is PointerEntity => Boolean(entity))
        // Drop pure layout containers with no actions and no label; they add
        // noise to the element list and the model's `nearby` context.
        .filter((entity) => !isNoiseEntity(entity));

      // Release builds of cua-driver omit the structured `elements` array (it is
      // added by the source patch) but still render `tree_markdown`. Fall back to
      // parsing that so grounding works without a patched/compiled driver. These
      // elements have no per-element bbox, so they remain list-only instead of
      // rendering inaccurate window-sized highlights.
      let coordinateless = false;
      if (entities.length === 0 && structured?.tree_markdown) {
        entities = parseTreeMarkdown(structured.tree_markdown).map((element) => entityFromTreeElement(element, matched.pid!, String(matched.window_id)));
        entities = entities.filter((entity) => !isNoiseEntity(entity));
        coordinateless = entities.length > 0;
      }

      if (entities.length === 0) {
        return {
          status: 'fallback',
          entities: [],
          pid: matched.pid,
          windowId: String(matched.window_id),
          error: 'CUA matched a window but returned no usable elements.'
        };
      }
      // With only window-level bounds, cursor hit-testing is meaningless, so
      // leave the hovered entity unset and let the user pick from the list.
      const hoveredEntityId = coordinateless ? undefined : resolveHoveredEntity(cursor, entities);
      return {
        status: 'matched',
        entities,
        hoveredEntityId,
        pid: matched.pid,
        windowId: String(matched.window_id),
        matchedWindow: { pid: matched.pid, windowId: String(matched.window_id) }
      };
    } catch (error) {
      return {
        status: 'unavailable',
        entities: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async listWindows(): Promise<CuaWindowRecord[]> {
    const result = await this.sidecar.callTool('list_windows', {});
    const structured = result.structuredContent as { windows?: CuaWindowRecord[]; _legacy_windows?: CuaWindowRecord[] } | undefined;
    return structured?.windows ?? structured?._legacy_windows ?? [];
  }
}

function currentDisplayBounds(): DisplayBounds[] {
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    scaleFactor: display.scaleFactor
  }));
}

function matchWindow(
  windows: CuaWindowRecord[],
  cursor: CursorPayload,
  windowInfo: PointerContext['window'] | undefined,
  displays: DisplayBounds[],
  cursorDisplay: DisplayBounds | undefined
): CuaWindowRecord | undefined {
  let best: { record: CuaWindowRecord; score: number } | undefined;
  for (const record of windows) {
    if (!record.bounds || typeof record.pid !== 'number' || typeof record.window_id !== 'number') continue;

    // Ignore our own transparent overlay
    if (record.title === 'OpenPointer' || record.app_name === 'OpenPointer.exe' || record.title?.includes('Cua.AgentCursorOverlay')) {
      continue;
    }

    let score = 0;
    if (pointInProviderRect(cursor, record.bounds, cursorDisplay, displays)) score += 6;
    const title = normalizeText(record.title);
    const appName = normalizeText(record.app_name);
    const currentTitle = normalizeText(windowInfo?.title);
    const currentApp = normalizeText(windowInfo?.app ?? windowInfo?.process);
    if (title && currentTitle && (title.includes(currentTitle) || currentTitle.includes(title))) score += 3;
    if (appName && currentApp && (appName.includes(currentApp) || currentApp.includes(appName))) score += 2;
    if (!best || score > best.score) best = { record, score };
  }
  return best && best.score >= 6 ? best.record : undefined;
}

function entityFromCuaElement(
  element: CuaElementRecord,
  pid: number,
  windowId: string,
  coordinateScale: number,
  displays: DisplayBounds[],
  displayHint: DisplayBounds | undefined
): PointerEntity | undefined {
  if (typeof element.element_index !== 'number') return undefined;
  const screenRect = rectFromCuaElement(element);
  if (!screenRect) return undefined;
  const localRect = screenRectToLocal(screenRect, coordinateScale, displays, displayHint);
  const role = element.control_type ?? 'Unknown';
  const label = firstNonEmpty(element.name, element.value, element.help_text, element.automation_id, role);
  return {
    id: `cua-${pid}-${windowId}-${element.element_index}`,
    kind: kindFromControlType(role),
    text: label,
    role,
    name: element.name,
    bbox: localRect,
    accessibilityPath: `cua:${pid}:${windowId}:${element.element_index}`,
    confidence: 0.9,
    origin: 'accessibility',
    state: selectedStateFromCuaElement(element),
    groundingRef: {
      provider: 'cua',
      pid,
      windowId,
      elementIndex: element.element_index,
      actions: element.actions ?? [],
      screenRect
    }
  };
}

function rectFromCuaElement(element: CuaElementRecord): Rect | undefined {
  return (
    normalizeRectLike(element.rect) ??
    normalizeRectLike(element.bounds) ??
    normalizeRectLike(element.bounding_rect) ??
    normalizeRectLike(element.boundingRect) ??
    normalizeRectLike(element.frame) ??
    rectFromCenter(element.center)
  );
}

function normalizeRectLike(value: Rect | [number, number, number, number] | undefined): Rect | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const a = Number(value[0]);
    const b = Number(value[1]);
    const c = Number(value[2]);
    const d = Number(value[3]);
    if (![a, b, c, d].every(Number.isFinite)) return undefined;
    const leftTopRightBottom = normalizeRect({ x: a, y: b, width: c - a, height: d - b });
    if (leftTopRightBottom) return leftTopRightBottom;
    return normalizeRect({ x: a, y: b, width: c, height: d });
  }
  return normalizeRect(value);
}

function rectFromCenter(center: CuaElementRecord['center']): Rect | undefined {
  if (!center) return undefined;
  const x = Number(center.x);
  const y = Number(center.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x: x - 9, y: y - 9, width: 18, height: 18 };
}

function entityFromTreeElement(element: ParsedTreeElement, pid: number, windowId: string): PointerEntity {
  const role = element.control_type || 'Unknown';
  const label = firstNonEmpty(element.name, element.value, element.help_text, element.automation_id, role);
  return {
    id: `cua-${pid}-${windowId}-${element.element_index}`,
    kind: kindFromControlType(role),
    text: label,
    role,
    name: element.name,
    accessibilityPath: `cua:${pid}:${windowId}:${element.element_index}`,
    confidence: 0.6,
    origin: 'accessibility',
    groundingRef: {
      provider: 'cua',
      pid,
      windowId,
      elementIndex: element.element_index,
      actions: element.actions ?? []
    }
  };
}

function displayForCursor(cursor: CursorPayload, displays: DisplayBounds[]): DisplayBounds | undefined {
  return displays.find((display) => pointInRect(cursor.x, cursor.y, display));
}

function pointInProviderRect(cursor: CursorPayload, rect: Rect, cursorDisplay: DisplayBounds | undefined, displays: DisplayBounds[]): boolean {
  if (pointInRect(cursor.x, cursor.y, rect)) return true;
  if (cursorDisplay) {
    const providerPoint = providerPointForCursor(cursor, cursorDisplay, displays);
    if (pointInRect(providerPoint.x, providerPoint.y, rect)) return true;
  }
  return pointInRect(cursor.x * cursor.dpr, cursor.y * cursor.dpr, rect);
}

function usesPhysicalCoordinates(rect: Rect | undefined, cursor: CursorPayload, cursorDisplay: DisplayBounds | undefined, displays: DisplayBounds[]): boolean {
  if (!rect || cursor.dpr <= 1) return false;
  if (pointInRect(cursor.x, cursor.y, rect)) return false;
  if (cursorDisplay) {
    const providerPoint = providerPointForCursor(cursor, cursorDisplay, displays);
    if (pointInRect(providerPoint.x, providerPoint.y, rect)) return true;
  }
  return pointInRect(cursor.x * cursor.dpr, cursor.y * cursor.dpr, rect);
}

function cuaErrorText(result: CuaToolResult): string | undefined {
  const text = result.content
    ?.map((part) => part.text)
    .filter(Boolean)
    .join(' ')
    .trim();
  return text || undefined;
}
