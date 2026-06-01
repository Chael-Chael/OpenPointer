import type { Point, PointerContext, PointerEntity, PointerGesture, PointerGestureKind, Rect } from '@openmagicpointer/core';
import { bboxFromPoints, isClosedGesture, rectsIntersect } from '@openmagicpointer/gestures';

export type BuildContextInput = {
  cursor: PointerContext['cursor'];
  source?: PointerContext['source'];
  window?: PointerContext['window'];
  windowSnapshot?: PointerContext['windowSnapshot'];
  entities?: PointerEntity[];
  gesturePath?: Point[];
  gestureKind?: PointerGestureKind;
  screenshotId?: string;
  imageBase64?: string;
  mimeType?: 'image/png' | 'image/jpeg';
  crop?: Rect;
  selectionText?: string;
};

export function buildPointerContext(input: BuildContextInput): PointerContext {
  const entities = input.entities ?? [];
  const gesture = buildGesture(input.gesturePath ?? [], input.gestureKind, entities);
  const target = pickTarget(input.cursor.localX, input.cursor.localY, entities, gesture);
  const selectionText = input.selectionText?.trim() ? input.selectionText : undefined;
  const selection =
    selectionText || target?.kind === 'input'
      ? {
          text: selectionText,
          insertionTarget: target?.kind === 'input' ? target : undefined
        }
      : undefined;
  return {
    id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: input.source ?? 'desktop',
    cursor: input.cursor,
    window: input.window,
    target,
    entities,
    selection,
    visual:
      input.screenshotId || input.crop || input.imageBase64
        ? {
            screenshotId: input.screenshotId,
            crop: input.crop,
            imageBase64: input.imageBase64,
            mimeType: input.mimeType
          }
        : undefined,
    windowSnapshot: input.windowSnapshot,
    gesture,
    // Up to 24 elements (complex windows like browsers/IDEs far exceed 8) with
    // role/name and the grounding reference so the agent can target an element
    // by its index instead of relying solely on coordinates.
    nearby: entities.slice(0, 24).map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      text: entity.text,
      role: entity.role,
      name: entity.name,
      bbox: entity.bbox,
      confidence: entity.confidence,
      groundingRef: entity.groundingRef
    })),
    createdAt: Date.now()
  };
}

function pickTarget(x: number, y: number, entities: PointerEntity[], gesture?: PointerGesture): PointerEntity | undefined {
  if (gesture?.region?.bbox) {
    const hit = entities.find((entity) => entity.bbox && rectsIntersect(entity.bbox, gesture.region!.bbox));
    if (hit) return hit;
  }
  // Prefer the smallest entity that contains the point so nested controls
  // (e.g. a button inside a toolbar) resolve to the innermost target.
  const containing = entities
    .filter((entity): entity is PointerEntity & { bbox: Rect } => Boolean(entity.bbox))
    .filter((entity) => pointInRect(x, y, entity.bbox))
    .sort((a, b) => rectArea(a.bbox) - rectArea(b.bbox));
  return containing[0];
}

function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function rectArea(rect: Rect): number {
  return rect.width * rect.height;
}

function buildGesture(path: Point[], kind: PointerGestureKind | undefined, entities: PointerEntity[]): PointerGesture | undefined {
  if (!kind || path.length === 0) return undefined;
  const bbox = bboxFromPoints(path);
  const inferredKind = kind === 'lasso' && isClosedGesture(path) ? 'circle' : kind;
  const entityIds = entities.filter((entity) => entity.bbox && rectsIntersect(entity.bbox, bbox)).map((entity) => entity.id);
  return {
    id: `gesture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: inferredKind,
    path,
    region: { bbox, polygon: inferredKind === 'lasso' || inferredKind === 'circle' ? path : undefined },
    entityIds,
    confidence: entityIds.length > 0 ? 0.72 : 0.45,
    startedAt: path[0]?.t ?? Date.now(),
    endedAt: path[path.length - 1]?.t ?? Date.now()
  };
}
