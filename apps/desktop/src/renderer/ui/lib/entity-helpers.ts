import type { PointerContext, PointerEntity } from '@openpointer/core';
import type { WindowPreviewResponse } from '../../../shared/types';

export function entityKindTitle(entity: PointerEntity): string {
  if (entity.kind === 'listitem') return 'Attached list item';
  if (entity.kind === 'text' || entity.kind === 'input') return 'Attached text';
  if (entity.kind === 'image') return 'Attached image';
  if (entity.kind === 'container') return 'Attached window';
  return 'Attached element';
}

export function imageSrcForContext(context: PointerContext): string | undefined {
  if (context.visual?.imageBase64 && context.visual.mimeType) {
    return `data:${context.visual.mimeType};base64,${context.visual.imageBase64}`;
  }
  if (context.windowSnapshot?.imageBase64 && context.windowSnapshot.mimeType) {
    return `data:${context.windowSnapshot.mimeType};base64,${context.windowSnapshot.imageBase64}`;
  }
  return undefined;
}

export function entityLabel(entity: Pick<PointerEntity, 'text' | 'name' | 'role' | 'kind'>): string {
  return entity.text || entity.name || entity.role || entity.kind;
}

export function formatRect(rect: { x: number; y: number; width: number; height: number } | undefined): string | undefined {
  if (!rect) return undefined;
  return `${Math.round(rect.width)}x${Math.round(rect.height)} @ ${Math.round(rect.x)},${Math.round(rect.y)}`;
}

export function entityDebugDetails(entity: PointerEntity): string[] {
  const ref = entity.groundingRef;
  const lines = [
    entityLabel(entity),
    `id: ${entity.id}`,
    `kind: ${entity.kind}`,
    entity.role ? `role: ${entity.role}` : undefined,
    entity.name ? `name: ${entity.name}` : undefined,
    entity.text ? `text: ${entity.text}` : undefined,
    `origin: ${entity.origin}`,
    `confidence: ${Math.round(entity.confidence * 100)}%`,
    entity.bbox ? `bbox: ${formatRect(entity.bbox)}` : undefined,
    ref?.screenRect ? `screen: ${formatRect(ref.screenRect)}` : undefined,
    ref?.pid ? `pid: ${ref.pid}` : undefined,
    ref?.windowId ? `window: ${ref.windowId}` : undefined,
    typeof ref?.elementIndex === 'number' ? `element: ${ref.elementIndex}` : undefined,
    ref?.actions?.length ? `actions: ${ref.actions.join(', ')}` : undefined
  ];
  return lines.filter((line): line is string => Boolean(line));
}

export function windowPreviewLabel(preview: WindowPreviewResponse | null): string | undefined {
  const info = preview?.window;
  if (!info) return undefined;
  return info.title || info.app || info.process || (info.windowId ? `Window ${info.windowId}` : undefined);
}
