import { screen } from 'electron';
import type { PointerContext, PointerEntity, Rect } from '@openmagicpointer/core';
import type { CursorPayload, GroundingPreviewResponse } from '../shared/types.js';
import { CuaSidecarManager, type CuaToolResult } from './cua-sidecar.js';
import {
  type DisplayBounds,
  type ParsedTreeElement,
  firstNonEmpty,
  isInteractiveEntity,
  isNoiseEntity,
  kindFromControlType,
  normalizeRect,
  normalizeText,
  parseTreeMarkdown,
  pointInRect,
  resolveHoveredEntity,
  screenRectToLocal
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
  rect?: Rect;
  center?: { x: number; y: number };
  source?: 'uia' | 'msaa';
};

export type CuaGroundingSnapshot = GroundingPreviewResponse & {
  matchedWindow?: { pid: number; windowId: string };
};

export class CuaGroundingProvider {
  constructor(private readonly sidecar: CuaSidecarManager) {}

  async preview(cursor: CursorPayload, windowInfo?: PointerContext['window']): Promise<CuaGroundingSnapshot> {
    try {
      const windows = await this.listWindows();
      const matched = matchWindow(windows, cursor, windowInfo);
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
      const coordinateScale = usesPhysicalCoordinates(matched.bounds, cursor) ? Math.max(1, cursor.dpr || 1) : 1;
      // Fetch displays once and reuse across every element; resolving them
      // per-element via screen.getDisplayMatching is a costly native call.
      const displays: DisplayBounds[] = screen.getAllDisplays().map((display) => ({ ...display.bounds }));
      let entities = (structured?.elements ?? [])
        .map((element) => entityFromCuaElement(element, matched.pid!, String(matched.window_id), coordinateScale, displays))
        .filter((entity): entity is PointerEntity => Boolean(entity))
        // Drop pure layout containers with no actions and no label; they add
        // noise to the element list and the model's `nearby` context.
        .filter((entity) => !isNoiseEntity(entity))
        .filter((entity) => isInteractiveEntity(entity));

      // Release builds of cua-driver omit the structured `elements` array (it is
      // added by the source patch) but still render `tree_markdown`. Fall back to
      // parsing that so grounding works without a patched/compiled driver. These
      // elements have no per-element bbox, so they inherit the window bounds and
      // resolve at the window level instead of pixel-precise hover.
      let coordinateless = false;
      if (entities.length === 0 && structured?.tree_markdown) {
        const windowRect = matched.bounds ? screenRectToLocal(normalizeRect(matched.bounds) ?? matched.bounds, coordinateScale, displays) : undefined;
        entities = parseTreeMarkdown(structured.tree_markdown).map((element) =>
          entityFromTreeElement(element, matched.pid!, String(matched.window_id), windowRect)
        );
        entities = entities.filter((entity) => isInteractiveEntity(entity));
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

function matchWindow(windows: CuaWindowRecord[], cursor: CursorPayload, windowInfo?: PointerContext['window']): CuaWindowRecord | undefined {
  let best: { record: CuaWindowRecord; score: number } | undefined;
  for (const record of windows) {
    if (!record.bounds || typeof record.pid !== 'number' || typeof record.window_id !== 'number') continue;

    // Ignore our own transparent overlay
    if (record.title === 'OpenMagicPointer' || record.app_name === 'OpenMagicPointer.exe' || record.title?.includes('Cua.AgentCursorOverlay')) {
      continue;
    }

    let score = 0;
    if (pointInProviderRect(cursor, record.bounds)) score += 6;
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
  displays: DisplayBounds[]
): PointerEntity | undefined {
  if (typeof element.element_index !== 'number' || !element.rect) return undefined;
  const screenRect = normalizeRect(element.rect);
  if (!screenRect) return undefined;
  const localRect = screenRectToLocal(screenRect, coordinateScale, displays);
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

function entityFromTreeElement(element: ParsedTreeElement, pid: number, windowId: string, windowRect: Rect | undefined): PointerEntity {
  const role = element.control_type || 'Unknown';
  const label = firstNonEmpty(element.name, element.value, element.help_text, element.automation_id, role);
  return {
    id: `cua-${pid}-${windowId}-${element.element_index}`,
    kind: kindFromControlType(role),
    text: label,
    role,
    name: element.name,
    // Release driver gives no per-element bbox; inherit the window bounds so the
    // element still has a location for the agent and any window-level overlay.
    bbox: windowRect,
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

function pointInProviderRect(cursor: CursorPayload, rect: Rect): boolean {
  return pointInRect(cursor.x, cursor.y, rect) || pointInRect(cursor.x * cursor.dpr, cursor.y * cursor.dpr, rect);
}

function usesPhysicalCoordinates(rect: Rect | undefined, cursor: CursorPayload): boolean {
  if (!rect || cursor.dpr <= 1) return false;
  return !pointInRect(cursor.x, cursor.y, rect) && pointInRect(cursor.x * cursor.dpr, cursor.y * cursor.dpr, rect);
}

function cuaErrorText(result: CuaToolResult): string | undefined {
  const text = result.content
    ?.map((part) => part.text)
    .filter(Boolean)
    .join(' ')
    .trim();
  return text || undefined;
}
