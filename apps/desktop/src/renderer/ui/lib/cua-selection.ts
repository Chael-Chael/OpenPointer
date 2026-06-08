import type { PointerEntity } from '@openpointer/core';

function rectsEqual(a: PointerEntity['bbox'], b: PointerEntity['bbox']): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function cuaEntitySnapshotsEqual(a: PointerEntity, b: PointerEntity): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.text === b.text &&
    a.role === b.role &&
    a.name === b.name &&
    a.confidence === b.confidence &&
    a.origin === b.origin &&
    a.state?.selected === b.state?.selected &&
    rectsEqual(a.bbox, b.bbox) &&
    rectsEqual(a.groundingRef?.screenRect, b.groundingRef?.screenRect)
  );
}

function normalizedIdentityText(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function cuaEntityIdentityLabel(entity: PointerEntity): string {
  return normalizedIdentityText(entity.text || entity.name);
}

function cuaEntityActionsKey(entity: PointerEntity): string {
  return [...(entity.groundingRef?.actions ?? [])].sort().join('|');
}

function isCuaEntityIdentityCompatible(current: PointerEntity, latest: PointerEntity): boolean {
  if (current.id !== latest.id) return false;
  if (current.groundingRef?.provider !== 'cua' || latest.groundingRef?.provider !== 'cua') return false;
  if (current.groundingRef.pid !== latest.groundingRef.pid || current.groundingRef.windowId !== latest.groundingRef.windowId) return false;
  if (current.groundingRef.elementIndex !== latest.groundingRef.elementIndex) return false;
  if (current.kind !== latest.kind) return false;
  if (normalizedIdentityText(current.role) !== normalizedIdentityText(latest.role)) return false;

  const currentLabel = cuaEntityIdentityLabel(current);
  const latestLabel = cuaEntityIdentityLabel(latest);
  if (currentLabel || latestLabel) return currentLabel === latestLabel;

  return cuaEntityActionsKey(current) === cuaEntityActionsKey(latest);
}

function withoutCuaEntityGeometry(entity: PointerEntity): PointerEntity {
  if (!entity.bbox && !entity.groundingRef?.screenRect) return entity;
  if (!entity.groundingRef) return { ...entity, bbox: undefined };
  const { screenRect: _screenRect, ...groundingRef } = entity.groundingRef;
  return { ...entity, bbox: undefined, groundingRef };
}

export function selectedListItemsForContext(entities: PointerEntity[]): PointerEntity[] {
  const byId = new Map<string, PointerEntity>();
  for (const entity of entities) {
    if (entity.kind !== 'listitem' || entity.state?.selected !== true || byId.has(entity.id)) continue;
    byId.set(entity.id, entity);
  }
  return [...byId.values()];
}

export function selectedCuaAttachmentTitle(entities: PointerEntity[]): string {
  const selectedListItems = selectedListItemsForContext(entities);
  if (selectedListItems.length > 0) {
    const preview = selectedListItems.slice(0, 3).map(entityLabel).join(', ');
    const suffix = selectedListItems.length > 3 ? `, +${selectedListItems.length - 3} more` : '';
    return `Attached: ${selectedListItems.length} selected list item${selectedListItems.length === 1 ? '' : 's'}${preview ? ` - ${preview}${suffix}` : ''} (Click to remove)`;
  }
  return `Attached: ${entities.length} CUA element${entities.length === 1 ? '' : 's'} (Click to remove)`;
}

export function mergeCuaEntityGroup(current: PointerEntity[], additions: PointerEntity[], maxItems: number): PointerEntity[] {
  const byId = new Map<string, PointerEntity>();
  for (const entity of current) {
    byId.set(entity.id, entity);
  }
  for (const entity of additions) {
    byId.set(entity.id, entity);
  }
  const next = [...byId.values()];
  return maxItems > 0 && next.length > maxItems ? next.slice(next.length - maxItems) : next;
}

export function removeCuaEntityFromGroup(entities: PointerEntity[], entityId: string): PointerEntity[] {
  return entities.filter((entity) => entity.id !== entityId);
}

export function refreshCuaEntityRefsFromLatest(current: PointerEntity[], latestEntities: PointerEntity[]): PointerEntity[] {
  if (current.length === 0) return current;
  const latestById = new Map(latestEntities.map((entity) => [entity.id, entity]));
  let changed = false;
  const next = current.map((entity) => {
    if (entity.groundingRef?.provider !== 'cua') return entity;
    const latest = latestById.get(entity.id);
    const replacement = latest && isCuaEntityIdentityCompatible(entity, latest) ? latest : withoutCuaEntityGeometry(entity);
    if (replacement !== entity && !cuaEntitySnapshotsEqual(entity, replacement)) changed = true;
    return replacement;
  });
  return changed ? next : current;
}

export function entityLabel(entity: Pick<PointerEntity, 'text' | 'name' | 'role' | 'kind'>): string {
  return entity.text || entity.name || entity.role || entity.kind;
}
