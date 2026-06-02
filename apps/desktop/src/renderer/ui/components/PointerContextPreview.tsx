import type { PointerContext } from '@openpointer/core';
import { entityLabel, imageSrcForContext, formatRect } from '../lib/entity-helpers';

export function PointerContextPreview({ context }: { context: PointerContext }) {
  const imageSrc = imageSrcForContext(context);
  const cuaEntities = context.nearby.filter((entity) => entity.groundingRef?.provider === 'cua');
  const target = context.target;
  const cropLabel = formatRect(context.visual?.crop);
  const windowSnapshotLabel = formatRect(context.windowSnapshot?.bounds);
  const targetLabel = target ? entityLabel(target) : undefined;
  const targetRect = formatRect(target?.bbox);
  const windowLabel = context.window?.title || context.window?.app || context.window?.process;

  if (!imageSrc && !context.grounding && !target && cuaEntities.length === 0 && !context.windowSnapshot) return null;

  return (
    <div className="pointer-context-card mt-2 max-w-[85%] self-end overflow-hidden rounded-[var(--radius-pill)] border border-white/12 bg-white/[0.08] text-white/[0.86] shadow-[0_6px_18px_rgba(0,0,0,0.08)]">
      {imageSrc && <img className="pointer-context-image" src={imageSrc} alt="Captured pointer context" />}
      <div className="grid gap-2 p-2.5 text-[11px] leading-[1.35]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="context-chip">Text</span>
          {context.visual && <span className="context-chip">Screenshot{cropLabel ? ` ${cropLabel}` : ''}</span>}
          {context.windowSnapshot && <span className="context-chip">Window shot{windowSnapshotLabel ? ` ${windowSnapshotLabel}` : ''}</span>}
          {context.grounding && (
            <span className={`context-chip ${context.grounding.status === 'matched' ? 'context-chip-cua' : ''}`}>
              CUA {context.grounding.status}
              {typeof context.grounding.elementCount === 'number' ? ` (${context.grounding.elementCount})` : ''}
            </span>
          )}
        </div>

        {windowLabel && (
          <div className="context-row">
            <span className="context-row-label">Window</span>
            <span className="min-w-0 truncate">
              {windowLabel}
              {context.window?.app && context.window.title ? ` - ${context.window.app}` : ''}
            </span>
          </div>
        )}

        {targetLabel && (
          <div className="context-row">
            <span className="context-row-label">Target</span>
            <span className="min-w-0 truncate">
              {targetLabel}
              {targetRect ? ` - ${targetRect}` : ''}
            </span>
          </div>
        )}

        {context.grounding && (
          <div className="context-row">
            <span className="context-row-label">CUA</span>
            <span className="min-w-0 truncate">
              {context.grounding.status}
              {context.grounding.pid ? ` pid ${context.grounding.pid}` : ''}
              {context.grounding.windowId ? ` window ${context.grounding.windowId}` : ''}
              {context.grounding.error ? ` - ${context.grounding.error}` : ''}
            </span>
          </div>
        )}

        {cuaEntities.length > 0 && (
          <div className="grid gap-1">
            <div className="text-white/[0.52] font-semibold uppercase tracking-[0.03em]">Recognized UI</div>
            {cuaEntities.slice(0, 5).map((entity) => (
              <div key={entity.id} className="context-entity-row">
                <span className="truncate">{entityLabel(entity)}</span>
                <span className="context-entity-meta">{entity.role || entity.kind}</span>
              </div>
            ))}
            {cuaEntities.length > 5 && <div className="text-white/[0.48]">+{cuaEntities.length - 5} more CUA elements</div>}
          </div>
        )}
      </div>
    </div>
  );
}
