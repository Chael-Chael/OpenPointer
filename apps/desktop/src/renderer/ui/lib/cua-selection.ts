import type { PointerEntity } from '@openpointer/core';

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

export function entityLabel(entity: Pick<PointerEntity, 'text' | 'name' | 'role' | 'kind'>): string {
  return entity.text || entity.name || entity.role || entity.kind;
}
