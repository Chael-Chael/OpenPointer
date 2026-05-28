import { screen } from 'electron';
import type { PointerContext, PointerEntity, PointerEntityKind, Rect } from '@openmagicpointer/core';
import type { CursorPayload, GroundingPreviewResponse } from '../shared/types.js';
import { CuaSidecarManager } from './cua-sidecar.js';

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
        capture_mode: 'som'
      });
      const structured = state.structuredContent as { elements?: CuaElementRecord[]; element_count?: number } | undefined;
      const coordinateScale = usesPhysicalCoordinates(matched.bounds, cursor) ? Math.max(1, cursor.dpr || 1) : 1;
      const entities = (structured?.elements ?? [])
        .map((element) => entityFromCuaElement(element, matched.pid!, String(matched.window_id), coordinateScale))
        .filter((entity): entity is PointerEntity => Boolean(entity));
      const hoveredEntityId = nearestEntityId(cursor, entities);
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

function entityFromCuaElement(element: CuaElementRecord, pid: number, windowId: string, coordinateScale: number): PointerEntity | undefined {
  if (typeof element.element_index !== 'number' || !element.rect) return undefined;
  const screenRect = normalizeRect(element.rect);
  if (!screenRect) return undefined;
  const localRect = screenRectToLocal(screenRect, coordinateScale);
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

function nearestEntityId(cursor: CursorPayload, entities: PointerEntity[]): string | undefined {
  const hits = entities
    .filter((entity) => entity.bbox && pointInRect(cursor.localX, cursor.localY, entity.bbox))
    .sort((a, b) => area(a.bbox!) - area(b.bbox!));
  return hits[0]?.id;
}

function screenRectToLocal(rect: Rect, coordinateScale: number): Rect {
  const scale = Math.max(1, coordinateScale || 1);
  const dipRect = {
    x: rect.x / scale,
    y: rect.y / scale,
    width: rect.width / scale,
    height: rect.height / scale
  };
  const display = screen.getDisplayMatching({ x: dipRect.x, y: dipRect.y, width: Math.max(1, dipRect.width), height: Math.max(1, dipRect.height) });
  return {
    x: dipRect.x - display.bounds.x,
    y: dipRect.y - display.bounds.y,
    width: dipRect.width,
    height: dipRect.height
  };
}

function pointInProviderRect(cursor: CursorPayload, rect: Rect): boolean {
  return pointInRect(cursor.x, cursor.y, rect) || pointInRect(cursor.x * cursor.dpr, cursor.y * cursor.dpr, rect);
}

function usesPhysicalCoordinates(rect: Rect | undefined, cursor: CursorPayload): boolean {
  if (!rect || cursor.dpr <= 1) return false;
  return !pointInRect(cursor.x, cursor.y, rect) && pointInRect(cursor.x * cursor.dpr, cursor.y * cursor.dpr, rect);
}

function kindFromControlType(controlType: string): PointerEntityKind {
  const value = controlType.toLowerCase();
  if (value.includes('edit')) return 'input';
  if (value.includes('hyperlink')) return 'link';
  if (value.includes('text') || value.includes('document')) return 'text';
  if (value.includes('table') || value.includes('datagrid')) return 'table';
  if (value.includes('image')) return 'image';
  if (/(button|menuitem|checkbox|radiobutton|combobox|tabitem|splitbutton)/i.test(controlType)) return 'button';
  return 'unknown';
}

function normalizeRect(rect: Rect): Rect | undefined {
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  return { x: Number(rect.x), y: Number(rect.y), width, height };
}

function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function area(rect: Rect): number {
  return rect.width * rect.height;
}

function normalizeText(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value?.trim())?.trim();
}
