import type { Point, PointerContext, PointerEntity, PointerGesture, PointerGestureKind, Rect } from '@openmagicpointer/core';
import { bboxFromPoints, isClosedGesture, rectsIntersect } from '@openmagicpointer/gestures';

export type BuildContextInput = {
  cursor: PointerContext['cursor'];
  source?: PointerContext['source'];
  window?: PointerContext['window'];
  entities?: PointerEntity[];
  gesturePath?: Point[];
  gestureKind?: PointerGestureKind;
  screenshotId?: string;
  imageBase64?: string;
  mimeType?: 'image/png' | 'image/jpeg';
  crop?: Rect;
};

export function buildPointerContext(input: BuildContextInput): PointerContext {
  const entities = input.entities ?? [];
  const gesture = buildGesture(input.gesturePath ?? [], input.gestureKind, entities);
  const target = pickTarget(input.cursor.localX, input.cursor.localY, entities, gesture);
  return {
    id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: input.source ?? 'desktop',
    cursor: input.cursor,
    window: input.window,
    target,
    entities,
    selection: target?.kind === 'input' ? { insertionTarget: target } : undefined,
    visual: input.screenshotId || input.crop || input.imageBase64
      ? {
          screenshotId: input.screenshotId,
          crop: input.crop,
          imageBase64: input.imageBase64,
          mimeType: input.mimeType
        }
      : undefined,
    gesture,
    nearby: entities.slice(0, 8).map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      text: entity.text,
      bbox: entity.bbox,
      confidence: entity.confidence
    })),
    createdAt: Date.now()
  };
}

function pickTarget(x: number, y: number, entities: PointerEntity[], gesture?: PointerGesture): PointerEntity | undefined {
  if (gesture?.region?.bbox) {
    const hit = entities.find((entity) => entity.bbox && rectsIntersect(entity.bbox, gesture.region!.bbox));
    if (hit) return hit;
  }
  return entities.find((entity) => {
    const bbox = entity.bbox;
    if (!bbox) return false;
    return x >= bbox.x && x <= bbox.x + bbox.width && y >= bbox.y && y <= bbox.y + bbox.height;
  }) ?? entities[0];
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
