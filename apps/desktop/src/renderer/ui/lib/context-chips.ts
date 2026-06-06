import type { ContextChip, PointerEntity, Rect } from '@openpointer/core';
import type { WindowPreviewResponse } from '../../../shared/types';
import { entityLabel, windowPreviewLabel } from './entity-helpers';

export const MAX_PINNED_CONTEXT_CHIPS = 4;

export function contextChipFromWindowPreview(preview: WindowPreviewResponse, status: ContextChip['status'] = 'candidate'): ContextChip | undefined {
  if (preview.status !== 'matched' || !preview.window) return undefined;
  const now = Date.now();
  const label = windowPreviewLabel(preview) ?? 'Current window';
  const subtitle = preview.window.app || preview.window.process || preview.source;
  return {
    id: contextWindowChipId(preview),
    kind: 'window',
    status,
    label,
    subtitle,
    windowRef: {
      title: preview.window.title,
      app: preview.window.app,
      process: preview.window.process,
      windowId: preview.windowId ?? preview.window.windowId,
      pid: preview.pid,
      bounds: preview.bounds
    },
    createdAt: now,
    lastSeenAt: now
  };
}

export function contextChipFromEntity(entity: PointerEntity, status: ContextChip['status'] = 'candidate'): ContextChip {
  const now = Date.now();
  const ref = entity.groundingRef;
  return {
    id: `entity:${entity.id}`,
    kind: 'entity',
    status,
    label: entityLabel(entity),
    subtitle: entity.role || entity.kind,
    entityRefs: [entity],
    windowRef: ref
      ? {
          pid: ref.pid,
          windowId: ref.windowId,
          bounds: ref.screenRect
        }
      : undefined,
    createdAt: now,
    lastSeenAt: now
  };
}

export function contextChipFromRegion(region: Rect, status: ContextChip['status'] = 'candidate'): ContextChip {
  const now = Date.now();
  return {
    id: `region:${Math.round(region.x)}:${Math.round(region.y)}:${Math.round(region.width)}:${Math.round(region.height)}`,
    kind: 'region',
    status,
    label: 'Selected region',
    subtitle: `${Math.round(region.width)}x${Math.round(region.height)}`,
    region,
    createdAt: now,
    lastSeenAt: now
  };
}

export function pinContextChip(current: ContextChip[], chip: ContextChip, max = MAX_PINNED_CONTEXT_CHIPS): ContextChip[] {
  const now = Date.now();
  const pinned: ContextChip = {
    ...chip,
    status: 'pinned',
    createdAt: chip.createdAt || now,
    lastSeenAt: now
  };
  const withoutExisting = current.filter((item) => item.id !== pinned.id);
  return [...withoutExisting, pinned].slice(-max);
}

export function removeContextChip(current: ContextChip[], chipId: string): ContextChip[] {
  return current.filter((chip) => chip.id !== chipId);
}

export function contextChipTitle(chip: ContextChip): string {
  const pieces = [chip.label, chip.subtitle].filter(Boolean);
  return pieces.join(' - ');
}

function contextWindowChipId(preview: WindowPreviewResponse): string {
  const windowId = preview.windowId ?? preview.window?.windowId;
  if (typeof preview.pid === 'number' && windowId) return `window:${preview.pid}:${windowId}`;
  if (windowId) return `window:${windowId}`;
  const title = preview.window?.title || preview.window?.app || 'unknown';
  return `window:${title}`;
}
