import type { PointerEntity } from '@openpointer/core';
import {
  CUA_BRUSH_ACTIVATION_GRACE_MS,
  CUA_BRUSH_HIT_MARGIN,
  CUA_BRUSH_IDLE_CLEAR_MS,
  CUA_BRUSH_MIN_REPEAT_PATH_LENGTH,
  CUA_BRUSH_MIN_REVISITS,
  CUA_BRUSH_PATH_WINDOW_MS,
  CUA_BRUSH_REVISIT_EXIT_DISTANCE,
  CUA_LASSO_CLOSE_DISTANCE,
  CUA_LASSO_MIN_AREA,
  CUA_LASSO_MIN_PATH_LENGTH,
  CUA_LASSO_MIN_SAMPLES,
  type LocalRect
} from './cua-constants';

export type CuaBrushPoint = {
  x: number;
  y: number;
  t: number;
};

export type CuaBrushCandidate = {
  entity: PointerEntity;
  rect: LocalRect;
};

export type CuaBrushHitState = {
  inside: boolean;
  revisits: number;
  lastExit?: CuaBrushPoint;
};

export type CuaBrushState = {
  activatedAt: number;
  lastActivityAt: number;
  windowKey?: string | null;
  points: CuaBrushPoint[];
  hits: Record<string, CuaBrushHitState>;
};

export type CuaBrushOptions = {
  activationGraceMs: number;
  pathWindowMs: number;
  hitMargin: number;
  revisitExitDistance: number;
  minRevisits: number;
  minRepeatPathLength: number;
  lassoMinSamples: number;
  lassoMinPathLength: number;
  lassoCloseDistance: number;
  lassoMinArea: number;
  idleClearMs: number;
};

export const DEFAULT_CUA_BRUSH_OPTIONS: CuaBrushOptions = {
  activationGraceMs: CUA_BRUSH_ACTIVATION_GRACE_MS,
  pathWindowMs: CUA_BRUSH_PATH_WINDOW_MS,
  hitMargin: CUA_BRUSH_HIT_MARGIN,
  revisitExitDistance: CUA_BRUSH_REVISIT_EXIT_DISTANCE,
  minRevisits: CUA_BRUSH_MIN_REVISITS,
  minRepeatPathLength: CUA_BRUSH_MIN_REPEAT_PATH_LENGTH,
  lassoMinSamples: CUA_LASSO_MIN_SAMPLES,
  lassoMinPathLength: CUA_LASSO_MIN_PATH_LENGTH,
  lassoCloseDistance: CUA_LASSO_CLOSE_DISTANCE,
  lassoMinArea: CUA_LASSO_MIN_AREA,
  idleClearMs: CUA_BRUSH_IDLE_CLEAR_MS
};

export function createCuaBrushState(now: number, windowKey?: string | null): CuaBrushState {
  return {
    activatedAt: now,
    lastActivityAt: 0,
    windowKey,
    points: [],
    hits: {}
  };
}

export function isCuaBrushIdleExpired(state: CuaBrushState, now: number, options: Partial<CuaBrushOptions> = {}): boolean {
  const resolved = { ...DEFAULT_CUA_BRUSH_OPTIONS, ...options };
  return state.lastActivityAt > 0 && now - state.lastActivityAt >= resolved.idleClearMs;
}

export function updateCuaBrushState(
  state: CuaBrushState,
  input: {
    point: CuaBrushPoint;
    candidates: CuaBrushCandidate[];
    windowKey?: string | null;
    options?: Partial<CuaBrushOptions>;
  }
): { state: CuaBrushState; matchedEntities: PointerEntity[]; hadBrushActivity: boolean } {
  const options = { ...DEFAULT_CUA_BRUSH_OPTIONS, ...input.options };
  if (state.windowKey && input.windowKey && state.windowKey !== input.windowKey) {
    return { state: createCuaBrushState(input.point.t, input.windowKey), matchedEntities: [], hadBrushActivity: false };
  }

  if (input.point.t - state.activatedAt < options.activationGraceMs) {
    return {
      state: {
        ...state,
        windowKey: input.windowKey ?? state.windowKey,
        points: [],
        hits: {}
      },
      matchedEntities: [],
      hadBrushActivity: false
    };
  }

  const points = prunePoints([...state.points, input.point], input.point.t, options.pathWindowMs);
  const pathLength = totalPathLength(points);
  const lasso = lassoInfo(points);
  const hits: Record<string, CuaBrushHitState> = {};
  let hadBrushActivity = false;
  const repeatedIds = new Set<string>();

  for (const candidate of input.candidates) {
    const previous = state.hits[candidate.entity.id] ?? { inside: false, revisits: 0 };
    const inside = pointInRect(input.point, candidate.rect, options.hitMargin);
    let revisits = previous.revisits;
    let lastExit = previous.lastExit;

    if (previous.inside && !inside) {
      lastExit = input.point;
    }

    if (!previous.inside && inside) {
      const movedAway = !lastExit || distance(input.point, lastExit) >= options.revisitExitDistance;
      if (movedAway) {
        revisits += 1;
        hadBrushActivity = true;
      }
    }

    if (revisits >= options.minRevisits && pathLength >= options.minRepeatPathLength) {
      repeatedIds.add(candidate.entity.id);
    }

    hits[candidate.entity.id] = { inside, revisits, lastExit };
  }

  const lassoMatches =
    points.length >= options.lassoMinSamples &&
    pathLength >= options.lassoMinPathLength &&
    lasso.closeDistance <= options.lassoCloseDistance &&
    lasso.area >= options.lassoMinArea
      ? input.candidates.filter((candidate) => rectInLasso(candidate.rect, points)).map((candidate) => candidate.entity)
      : [];

  const repeatedMatches = input.candidates.filter((candidate) => repeatedIds.has(candidate.entity.id)).map((candidate) => candidate.entity);
  const matchedEntities = preferSpecificEntities([...repeatedMatches, ...lassoMatches], input.candidates);
  const nextActivityAt = hadBrushActivity || matchedEntities.length > 0 ? input.point.t : state.lastActivityAt;

  return {
    state: {
      activatedAt: state.activatedAt,
      lastActivityAt: nextActivityAt,
      windowKey: input.windowKey ?? state.windowKey,
      points,
      hits
    },
    matchedEntities,
    hadBrushActivity
  };
}

function prunePoints(points: CuaBrushPoint[], now: number, windowMs: number): CuaBrushPoint[] {
  return points.filter((point) => now - point.t <= windowMs);
}

function pointInRect(point: Pick<CuaBrushPoint, 'x' | 'y'>, rect: LocalRect, margin: number): boolean {
  return point.x >= rect.x - margin && point.x <= rect.x + rect.width + margin && point.y >= rect.y - margin && point.y <= rect.y + rect.height + margin;
}

function rectInLasso(rect: LocalRect, polygon: CuaBrushPoint[]): boolean {
  const probes = [
    { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    { x: rect.x + rect.width * 0.35, y: rect.y + rect.height * 0.35 },
    { x: rect.x + rect.width * 0.65, y: rect.y + rect.height * 0.35 },
    { x: rect.x + rect.width * 0.65, y: rect.y + rect.height * 0.65 },
    { x: rect.x + rect.width * 0.35, y: rect.y + rect.height * 0.65 }
  ];
  return probes.some((point) => pointInPolygon(point, polygon));
}

function pointInPolygon(point: Pick<CuaBrushPoint, 'x' | 'y'>, polygon: CuaBrushPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const current = polygon[i]!;
    const previous = polygon[j]!;
    const intersects =
      current.y > point.y !== previous.y > point.y && point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function preferSpecificEntities(entities: PointerEntity[], candidates: CuaBrushCandidate[]): PointerEntity[] {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const rectById = new Map(candidates.map((candidate) => [candidate.entity.id, candidate.rect]));
  const result: PointerEntity[] = [];

  for (const entity of byId.values()) {
    const rect = rectById.get(entity.id);
    if (!rect) continue;
    const area = rectArea(rect);
    const containsMoreSpecific = [...byId.values()].some((other) => {
      if (other.id === entity.id) return false;
      const otherRect = rectById.get(other.id);
      return Boolean(otherRect && area > rectArea(otherRect) * 1.6 && rectContainsRect(rect, otherRect));
    });
    if (!containsMoreSpecific) result.push(entity);
  }

  return result.sort((a, b) => rectArea(rectById.get(a.id)!) - rectArea(rectById.get(b.id)!));
}

function rectContainsRect(outer: LocalRect, inner: LocalRect): boolean {
  const innerCenter = { x: inner.x + inner.width / 2, y: inner.y + inner.height / 2 };
  return innerCenter.x >= outer.x && innerCenter.x <= outer.x + outer.width && innerCenter.y >= outer.y && innerCenter.y <= outer.y + outer.height;
}

function lassoInfo(points: CuaBrushPoint[]): { area: number; closeDistance: number } {
  if (points.length < 2) return { area: 0, closeDistance: Number.POSITIVE_INFINITY };
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i]!;
    const next = points[(i + 1) % points.length]!;
    sum += current.x * next.y - next.x * current.y;
  }
  return { area: Math.abs(sum) / 2, closeDistance: distance(first, last) };
}

function totalPathLength(points: CuaBrushPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += distance(points[i - 1]!, points[i]!);
  }
  return length;
}

function distance(a: Pick<CuaBrushPoint, 'x' | 'y'>, b: Pick<CuaBrushPoint, 'x' | 'y'>): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function rectArea(rect: LocalRect): number {
  return rect.width * rect.height;
}
