import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { clampNumber, type AgentBackendId, type AgentEvent, type PointerContext, type PointerEntity } from '@openmagicpointer/core';
import type { AppSettings } from '@openmagicpointer/storage';
import { parseVoiceCommand } from '@openmagicpointer/voice';
import type { CursorPayload, HoldProgressPayload } from '../../shared/types';
import { CursorTrail } from './CursorTrail';
import { MarkdownRenderer } from './MarkdownRenderer';
import {
  emptyClearSecretFlags,
  emptySecretDrafts,
  selectableBackends,
  type ClearSecretFlags,
  type SecretDrafts,
  type SelectionDrag,
  type SelectionHandle,
  type SelectionRect,
  type UiState
} from './state';
import { backendLabel, backendReadiness, isToolEvent, latestEvent, placeholderForState, secretConfigured, statusLabel } from './lib/backend-status';
import { availablePanelHeight, computeShellPosition, focusPromptInput, normalizeSelection, selectionFromDrag } from './lib/geometry';
import { HoldRing, ToolRows } from './components/fields';
import { SettingsPanel } from './components/SettingsPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { getBackendIcon } from './components/icons';

function ChevronIcon({ size = 8, isOpen = false }: { size?: number; isOpen?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 180ms ease'
      }}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

const initialCursor: CursorPayload = { x: 300, y: 300, localX: 300, localY: 300, displayId: 0, dpr: 1 };

function imageSrcForContext(context: PointerContext): string | undefined {
  if (!context.visual?.imageBase64 || !context.visual.mimeType) return undefined;
  return `data:${context.visual.mimeType};base64,${context.visual.imageBase64}`;
}

function entityLabel(entity: Pick<PointerEntity, 'text' | 'name' | 'role' | 'kind'>): string {
  return entity.text || entity.name || entity.role || entity.kind;
}

function formatRect(rect: { x: number; y: number; width: number; height: number } | undefined): string | undefined {
  if (!rect) return undefined;
  return `${Math.round(rect.width)}x${Math.round(rect.height)} @ ${Math.round(rect.x)},${Math.round(rect.y)}`;
}

type LocalRect = { x: number; y: number; width: number; height: number };

const CUA_HIGHLIGHT_RADIUS_X = 560;
const CUA_HIGHLIGHT_RADIUS_Y = 420;
const MAX_CUA_HIGHLIGHTS = 40;
const MAX_CUA_PICKER_ITEMS = 12;
const CUA_GROUNDING_INITIAL_DELAY_MS = 60;
const CUA_GROUNDING_REFRESH_MS = 420;
const CUA_GROUNDING_STALE_MS = 1600;
const CUA_GROUNDING_MIN_CURSOR_DELTA = 36;
const DEFAULT_CUA_PICKER_SIZE = { width: 340, height: 360 };
const CUA_PICKER_MIN_WIDTH = 280;
const CUA_PICKER_MIN_HEIGHT = 160;

function cursorDistanceSquared(a: CursorPayload, b: CursorPayload): number {
  const dx = a.localX - b.localX;
  const dy = a.localY - b.localY;
  return dx * dx + dy * dy;
}

function rectsIntersect(a: LocalRect, b: LocalRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function distanceToLocalRectSquared(x: number, y: number, rect: LocalRect): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
  return dx * dx + dy * dy;
}

function contextRegionAroundCursor(cursor: CursorPayload): LocalRect {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const width = Math.min(viewportW, CUA_HIGHLIGHT_RADIUS_X * 2);
  const height = Math.min(viewportH, CUA_HIGHLIGHT_RADIUS_Y * 2);
  return {
    x: Math.max(0, Math.min(viewportW - width, cursor.localX - width / 2)),
    y: Math.max(0, Math.min(viewportH - height, cursor.localY - height / 2)),
    width,
    height
  };
}

function highlightRectForEntity(entity: PointerEntity): LocalRect | undefined {
  const rect = entity.bbox;
  if (!rect || !entity.groundingRef?.screenRect) return undefined;
  if (rect.width < 3 || rect.height < 3) return undefined;
  if (rect.width > window.innerWidth * 0.95 && rect.height > window.innerHeight * 0.75) return undefined;
  return rect;
}

function hasPreciseCuaRect(entity: PointerEntity): boolean {
  return Boolean(highlightRectForEntity(entity));
}

function defaultContextInstruction(hasSelectionContext: boolean, hasCuaContext: boolean): string {
  if (hasSelectionContext && hasCuaContext) return 'Analyze the current screenshot selection and CUA-recognized UI context.';
  if (hasSelectionContext) return 'Analyze the current screenshot selection.';
  if (hasCuaContext) return 'Analyze the current CUA-recognized UI context.';
  return 'Analyze the current pointer context.';
}

function PointerContextPreview({ context }: { context: PointerContext }) {
  const imageSrc = imageSrcForContext(context);
  const cuaEntities = context.nearby.filter((entity) => entity.groundingRef?.provider === 'cua');
  const target = context.target;
  const cropLabel = formatRect(context.visual?.crop);
  const targetLabel = target ? entityLabel(target) : undefined;
  const targetRect = formatRect(target?.bbox);
  const windowLabel = context.window?.title || context.window?.app || context.window?.process;

  if (!imageSrc && !context.grounding && !target && cuaEntities.length === 0) return null;

  return (
    <div className="pointer-context-card mt-2 max-w-[85%] self-end overflow-hidden rounded-[var(--radius-pill)] border border-white/12 bg-white/[0.08] text-white/[0.86] shadow-[0_6px_18px_rgba(0,0,0,0.08)]">
      {imageSrc && <img className="pointer-context-image" src={imageSrc} alt="Captured pointer context" />}
      <div className="grid gap-2 p-2.5 text-[11px] leading-[1.35]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="context-chip">Text</span>
          {context.visual && <span className="context-chip">Screenshot{cropLabel ? ` ${cropLabel}` : ''}</span>}
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

export function App() {
  const [cursor, setCursor] = useState<CursorPayload>(initialCursor);
  const [hold, setHold] = useState<HoldProgressPayload | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const pillWidth = clampNumber(settings?.pillWidth, 280, 900, 520);
  const pillHeight = clampNumber(settings?.pillHeight, 24, 96, 24);

  // Dynamic sizing responsive to pillHeight
  const menuSize = Math.max(20, Math.min(32, pillHeight - 6));
  const inputFontSize = Math.max(12, Math.min(14, pillHeight - 12));
  const gap = Math.max(8, Math.min(24, pillHeight - 12));
  const padY = Math.max(2, Math.min(8, (pillHeight - menuSize) / 2));
  const padXRight = Math.max(12, Math.min(24, pillHeight / 1.5));
  const padXLeft = Math.max(8, Math.min(12, pillHeight / 3));
  const smallPillHeight = Math.max(22, Math.min(28, pillHeight - 2));
  const previewCardBottom = 12 + smallPillHeight;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [secretDrafts, setSecretDrafts] = useState<SecretDrafts>(emptySecretDrafts);
  const [clearSecrets, setClearSecrets] = useState<ClearSecretFlags>(emptyClearSecretFlags);
  const [active, setActive] = useState(false);
  const [state, setState] = useState<UiState>('idle');
  const [prompt, setPrompt] = useState('');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [backend, setBackend] = useState<AgentBackendId>('auto');
  const [menuOpen, setMenuOpen] = useState(false);
  const [backendDropdownOpen, setBackendDropdownOpen] = useState(false);
  const [detached, setDetached] = useState(false);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [detachedPos, setDetachedPos] = useState<{ x: number; y: number } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectionOrigin, setSelectionOrigin] = useState<{ x: number; y: number } | null>(null);
  const [selectionDrag, setSelectionDrag] = useState<SelectionDrag | null>(null);
  const [cuaEntities, setCuaEntities] = useState<PointerEntity[]>([]);
  const [cuaPickerAnchor, setCuaPickerAnchor] = useState<CursorPayload>(initialCursor);
  const [cuaPickerLocked, setCuaPickerLocked] = useState(false);
  const [cuaPickerPosition, setCuaPickerPosition] = useState<{ left: number; top: number } | null>(null);
  const [cuaPickerSize, setCuaPickerSize] = useState(DEFAULT_CUA_PICKER_SIZE);
  const [cuaPickerResizeDrag, setCuaPickerResizeDrag] = useState<{ startX: number; startY: number; startWidth: number; startHeight: number } | null>(
    null
  );
  const [hoveredCuaEntityId, setHoveredCuaEntityId] = useState<string | null>(null);
  const [selectedCuaEntities, setSelectedCuaEntities] = useState<PointerEntity[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  conversationIdRef.current = conversationId;
  const lastConversationIdRef = useRef<string | null>(null);
  const lastDeactivatedAtRef = useRef<number>(0);
  const newConversationRequestedRef = useRef(false);
  const conversationRestoreEpochRef = useRef(0);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const [panelResizeDrag, setPanelResizeDrag] = useState<{ startY: number; startHeight: number } | null>(null);
  const [thinkingTime, setThinkingTime] = useState<number>(0);
  const [showTools, setShowTools] = useState<boolean>(false);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkingStartRef = useRef<number>(0);
  const streamPanelRef = useRef<HTMLDivElement | null>(null);
  const groundingRequestSeqRef = useRef(0);
  const lastCuaSelectEventRef = useRef<{ id: string; at: number; type: string } | null>(null);
  // Submit-time screenshot signal from the main process (see CaptureActivity IPC).
  const [captureActivity, setCaptureActivity] = useState<{ active: boolean; withCua: boolean }>({ active: false, withCua: false });
  const [historyTurns, setHistoryTurns] = useState<import('@openmagicpointer/core').ChatTurn[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversationsList, setConversationsList] = useState<import('@openmagicpointer/core').Conversation[]>([]);
  const [pillDrag, setPillDrag] = useState<{ startX: number; startY: number; initialPos: { x: number; y: number } } | null>(null);

  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const [hoveredAttachment, setHoveredAttachment] = useState<'selection' | 'entity' | 'cua' | null>(null);

  async function fetchModels() {
    if (!settings?.localVlmBaseUrl) return;
    setIsFetchingModels(true);
    setFetchModelsError(null);
    setFetchedModels(null);
    try {
      const key = secretDrafts.localVlmApiKey || (settings.hasLocalVlmApiKey ? 'STORED' : '');
      const res = await window.openMagicPointer.fetchVisionModels({
        baseUrl: settings.localVlmBaseUrl,
        apiKey: key === 'STORED' ? '' : key
      });
      if (res.success && res.models) {
        setFetchedModels(res.models);
      } else {
        setFetchModelsError(res.error || 'Failed to fetch models.');
      }
    } catch (e: unknown) {
      setFetchModelsError(e instanceof Error ? e.message : 'Error occurred.');
    } finally {
      setIsFetchingModels(false);
    }
  }
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const activeRef = useRef(false);
  activeRef.current = active;
  const lastInteractiveRef = useRef(false);
  const lastGlobalContextMenuAtRef = useRef(0);
  const liveCuaPreview =
    active &&
    state === 'composing' &&
    settings?.cuaMode !== 'off' &&
    !detached &&
    !selecting &&
    !selectionDrag &&
    !selection &&
    !settingsOpen &&
    !historyOpen &&
    !menuOpen &&
    !captureActivity.active &&
    !cuaPickerLocked &&
    selectedCuaEntities.length === 0;

  useEffect(() => {
    void window.openMagicPointer.getSettings().then((value) => {
      setSettings(value);
      setBackend(value.agentBackend);
    });
    const offCursor = window.openMagicPointer.onCursor(setCursor);
    const offHold = window.openMagicPointer.onHoldProgress((payload) => {
      if (payload.state === 'canceled') {
        setHold(null);
        // Cancel in-progress selection
        setSelecting(false);
        setSelectionOrigin(null);
        setSelectionDrag(null);
        return;
      }
      if (payload.state === 'holding') {
        setHold(payload);
        if (!activeRef.current) setState('holding');
        // If already active, show hold ring but don't change UiState
      }
      if (payload.state === 'completed') {
        setCursor(payload.cursor);
        setHold(null);
        if (payload.startedWhileActive) {
          // Second long-press while popup is open → start rectangle selection
          const origin = { x: payload.cursor.localX, y: payload.cursor.localY };
          setCuaPickerLocked(false);
          setCuaPickerPosition(null);
          setSelectionOrigin(origin);
          setSelecting(true);
          setSelection({ x1: origin.x, y1: origin.y, x2: origin.x, y2: origin.y });
          // Freeze shell position during selection
          setDetachedPos(computeShellPosition(payload.cursor.localX, payload.cursor.localY));
        } else {
          setState('composing');
        }
      }
    });
    const offActivate = window.openMagicPointer.onActivate((payload) => {
      setCursor(payload);
      setCuaPickerAnchor(payload);
      setCuaPickerLocked(false);
      setCuaPickerPosition(null);
      setActive(true);
      const restoreEpoch = conversationRestoreEpochRef.current;
      window.openMagicPointer.getSettings().then(async (currentSettings) => {
        setSettings(currentSettings);
        if (newConversationRequestedRef.current || restoreEpoch !== conversationRestoreEpochRef.current) {
          setConversationId(null);
          setHistoryTurns([]);
          return;
        }

        const behavior = currentSettings?.newDialogBehavior ?? 'continue';
        const interval = currentSettings?.newDialogInterval ?? 300;

        let restoreId = lastConversationIdRef.current;
        let lastDeactivatedAt = lastDeactivatedAtRef.current;

        if (!restoreId) {
          const list = await window.openMagicPointer.getConversations();
          if (list.length > 0) {
            const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
            const first = sorted[0];
            if (first) {
              restoreId = first.id;
              lastDeactivatedAt = first.updatedAt;
            }
          }
        }

        let shouldRestore = false;
        if (restoreId) {
          if (behavior === 'continue') {
            shouldRestore = true;
          } else if (behavior === 'interval') {
            const elapsedSeconds = (Date.now() - lastDeactivatedAt) / 1000;
            if (elapsedSeconds <= interval) {
              shouldRestore = true;
            }
          }
        }

        if (newConversationRequestedRef.current || restoreEpoch !== conversationRestoreEpochRef.current) return;

        if (shouldRestore && restoreId) {
          conversationIdRef.current = restoreId;
          lastConversationIdRef.current = restoreId;
          lastDeactivatedAtRef.current = lastDeactivatedAt;
          setConversationId(restoreId);
          const conv = await window.openMagicPointer.getConversation(restoreId);
          if (!newConversationRequestedRef.current && restoreEpoch === conversationRestoreEpochRef.current && conversationIdRef.current === restoreId && conv) {
            setHistoryTurns(conv.turns);
          }
        } else {
          conversationIdRef.current = null;
          setConversationId(null);
          setHistoryTurns([]);
        }
      });

      setState('composing');
      window.setTimeout(() => focusPromptInput(inputRef.current), 0);
    });
    const offDeactivate = window.openMagicPointer.onDeactivate(() => {
      if (conversationIdRef.current) {
        lastConversationIdRef.current = conversationIdRef.current;
        lastDeactivatedAtRef.current = Date.now();
      } else if (newConversationRequestedRef.current) {
        lastConversationIdRef.current = null;
        lastDeactivatedAtRef.current = 0;
      }
      setActive(false);
      setState('idle');
      setPrompt('');
      setEvents([]);
      setHold(null);
      setMenuOpen(false);
      setSettingsOpen(false);
      setBackendDropdownOpen(false);
      setConversationId(null);
      setHistoryTurns([]);
      setHistoryOpen(false);
      setDetached(false);
      setSelection(null);
      setCuaEntities([]);
      setCuaPickerAnchor(initialCursor);
      setCuaPickerLocked(false);
      setCuaPickerPosition(null);
      setCuaPickerResizeDrag(null);
      setHoveredCuaEntityId(null);
      setSelectedCuaEntities([]);
      setDetachedPos(null);
      setSelecting(false);
      setSelectionOrigin(null);
      setSelectionDrag(null);
      setPanelHeight(null);
      setThinkingTime(0);
      setShowTools(false);
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
    });
    const offEvent = window.openMagicPointer.onAgentEvent((event) => {
      setEvents((prev) => [...prev, event].slice(-80));
      if (event.type === 'run.started' || event.type === 'assistant.delta' || event.type === 'tool.started' || event.type === 'tool.completed')
        setState('streaming');
      if (event.type === 'approval.requested') setState('approval');
      if (event.type === 'run.completed') setState('completed');
      if (event.type === 'run.failed') setState('failed');
    });
    window.openMagicPointer.ready();
    return () => {
      offCursor();
      offHold();
      offActivate();
      offDeactivate();
      offEvent();
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (conversationId && (state === 'completed' || state === 'composing' || state === 'idle' || state === 'failed')) {
      // Guard against a stale response from a previous conversationId/state
      // overwriting the history after a rapid switch.
      let cancelled = false;
      window.openMagicPointer
        .getConversation(conversationId)
        .then((conv) => {
          if (!cancelled && conversationIdRef.current === conversationId && conv) setHistoryTurns(conv.turns);
        })
        .catch(() => {
          /* transient IPC failure; history simply isn't refreshed */
        });
      return () => {
        cancelled = true;
      };
    }
  }, [conversationId, state]);
  // Dynamic interactive region logic
  useEffect(() => {
    // We want to force interactive mode if dragging/selecting/detached etc.
    const forceInteractive =
      active &&
      (detached ||
        menuOpen ||
        backendDropdownOpen ||
        settingsOpen ||
        historyOpen ||
        Boolean(selection) ||
        selecting ||
        Boolean(selectionDrag) ||
        Boolean(panelResizeDrag) ||
        Boolean(cuaPickerResizeDrag) ||
        (state === 'composing' &&
          settings?.cuaMode !== 'off' &&
          !settingsOpen &&
          !historyOpen &&
          !menuOpen &&
          !selecting &&
          !selectionDrag &&
          !selection &&
          cuaEntities.length > 0));

    function checkTarget(target: EventTarget | null) {
      if (forceInteractive) return true;
      if (!target) return false;
      const el = target as Element;
      // If the mouse is over the main container or body, pass clicks through
      if (el.tagName === 'HTML' || el.tagName === 'BODY' || el.classList.contains('app-container')) {
        return false;
      }
      return true;
    }

    function updateInteractive(shouldCapture: boolean) {
      // Never switch the overlay to interactive (capture) mode when the
      // pointer is not active.  This prevents the forwarded mouse events
      // from toggling setIgnoreMouseEvents repeatedly, which would
      // interfere with uIOhook's global long-press detection and cause
      // the pill to pop up unexpectedly when the user just moves the mouse.
      if (shouldCapture && !active) return;
      if (shouldCapture !== lastInteractiveRef.current) {
        lastInteractiveRef.current = shouldCapture;
        window.openMagicPointer.setInteractive(shouldCapture);
      }
    }

    function onMouseOver(e: MouseEvent) {
      updateInteractive(checkTarget(e.target));
    }

    function onMouseOut(e: MouseEvent) {
      updateInteractive(checkTarget(e.relatedTarget));
    }

    window.addEventListener('mouseover', onMouseOver);
    window.addEventListener('mouseout', onMouseOut);

    updateInteractive(forceInteractive);

    // Ensure window has keyboard focus when interactive UI is open
    if (forceInteractive) window.focus();

    return () => {
      window.removeEventListener('mouseover', onMouseOver);
      window.removeEventListener('mouseout', onMouseOut);
    };
  }, [
    active,
    detached,
    menuOpen,
    backendDropdownOpen,
    settingsOpen,
    historyOpen,
    selection,
    selecting,
    selectionDrag,
    panelResizeDrag,
    cuaPickerResizeDrag,
    state,
    settings?.cuaMode,
    cuaEntities.length
  ]);

  // Esc = deactivate; Right-click = toggle detach/reattach (enter/exit edit) or cancel local selection.
  useEffect(() => {
    function toggleEditDialog(contextCursor = cursorRef.current) {
      setCuaPickerLocked(false);
      setCuaPickerPosition(null);
      if (menuOpen) {
        setMenuOpen(false);
        return;
      }
      if (selecting || selectionDrag) {
        setSelecting(false);
        setSelectionOrigin(null);
        setSelectionDrag(null);
        setDetachedPos(null);
        window.setTimeout(() => focusPromptInput(inputRef.current), 0);
        return;
      }
      if (!activeRef.current) return;
      setDetached((d) => {
        if (d) {
          // Reattach shell position (exit edit).
          setDetachedPos(null);
          setSelection(null);
          return false;
        }
        // Detach shell position (enter edit).
        setDetachedPos(computeShellPosition(contextCursor.localX, contextCursor.localY));
        return true;
      });
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setSettingsOpen(false);
      window.openMagicPointer.cancelRun();
      window.openMagicPointer.deactivate();
    }
    // Toggle the edit dialog with the right mouse button. This is a pure
    // toggle, so it can be triggered to enter/exit any number of times.
    function onContextMenu(event: MouseEvent) {
      // Always suppress the native right-click menu on the overlay.
      event.preventDefault();
      if (Date.now() - lastGlobalContextMenuAtRef.current < 300) return;
      toggleEditDialog();
    }
    const offGlobalContextMenu = window.openMagicPointer.onGlobalContextMenu((payload) => {
      lastGlobalContextMenuAtRef.current = Date.now();
      setCursor(payload);
      setCuaPickerAnchor(payload);
      toggleEditDialog(payload);
    });
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    return () => {
      offGlobalContextMenu();
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
    };
  }, [menuOpen, selecting, selectionDrag]);

  // Live-update selection rectangle while selecting (cursor comes via IPC)
  useEffect(() => {
    if (!selecting || !selectionOrigin) return;
    setSelection(
      normalizeSelection({
        x1: Math.min(selectionOrigin.x, cursor.localX),
        y1: Math.min(selectionOrigin.y, cursor.localY),
        x2: Math.max(selectionOrigin.x, cursor.localX),
        y2: Math.max(selectionOrigin.y, cursor.localY)
      })
    );
  }, [selecting, selectionOrigin, cursor.localX, cursor.localY]);

  // End selection on mouseup → return to composing (following mode)
  useEffect(() => {
    if (!selecting) return;
    function onMouseUp() {
      setSelecting(false);
      setSelectionOrigin(null);
      setDetachedPos(null); // Unfreeze shell, resume following
      // selection rect stays visible until submit or dismissed
      window.setTimeout(() => focusPromptInput(inputRef.current), 0);
    }
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [selecting]);

  useEffect(() => {
    if (!selectionDrag) return;
    const activeDrag = selectionDrag;
    function onMouseMove(event: MouseEvent) {
      setSelection(selectionFromDrag(activeDrag, event.clientX, event.clientY, window.innerWidth, window.innerHeight));
    }
    function onMouseUp() {
      setSelectionDrag(null);
      window.setTimeout(() => focusPromptInput(inputRef.current), 0);
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [selectionDrag]);

  useEffect(() => {
    if (!pillDrag) return;
    const activeDrag = pillDrag;
    function onMouseMove(event: MouseEvent) {
      const dx = event.clientX - activeDrag.startX;
      const dy = event.clientY - activeDrag.startY;
      const nextX = activeDrag.initialPos.x + dx;
      const nextY = activeDrag.initialPos.y + dy;
      setDetachedPos({
        x: Math.min(Math.max(12, nextX), Math.max(12, window.innerWidth - pillWidth - 12)),
        y: Math.min(Math.max(12, nextY), Math.max(12, window.innerHeight - pillHeight - 12))
      });
    }
    function onMouseUp() {
      setPillDrag(null);
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [pillDrag, pillWidth, pillHeight]);

  useEffect(() => {
    if (state === 'composing' && active && !selecting && !selectionDrag && !settingsOpen && !captureActivity.active) {
      const requestId = window.requestAnimationFrame(() => focusPromptInput(inputRef.current));
      return () => window.cancelAnimationFrame(requestId);
    }
  }, [active, selecting, selectionDrag, settingsOpen, captureActivity.active, state]);

  useEffect(() => {
    if (liveCuaPreview) setCuaPickerAnchor(cursor);
  }, [cursor, liveCuaPreview]);

  useEffect(() => {
    const shouldClearPreview =
      !active ||
      state !== 'composing' ||
      settings?.cuaMode === 'off' ||
      detached ||
      selecting ||
      Boolean(selectionDrag) ||
      Boolean(selection) ||
      settingsOpen ||
      historyOpen ||
      menuOpen ||
      captureActivity.active;

    if (shouldClearPreview) {
      if (selectedCuaEntities.length === 0) {
        setCuaEntities([]);
        setHoveredCuaEntityId(null);
        setCuaPickerLocked(false);
        setCuaPickerPosition(null);
        setCuaPickerResizeDrag(null);
      }
      return;
    }
    if (!liveCuaPreview) return;

    // Keep the CUA tree fresh while the user is moving the pointer in
    // discovery mode. The picker itself is derived from the latest tree and the
    // current cursor, so it follows the pointer without making every mousemove
    // block on a native accessibility traversal.
    let cancelled = false;
    let inFlight = false;
    let lastRequestedCursor: CursorPayload | null = null;
    let lastCompletedAt = 0;
    const requestSeq = ++groundingRequestSeqRef.current;
    const minCursorDeltaSquared = CUA_GROUNDING_MIN_CURSOR_DELTA * CUA_GROUNDING_MIN_CURSOR_DELTA;

    const shouldRequestGrounding = (force = false) => {
      if (force || !lastRequestedCursor) return true;
      const now = Date.now();
      const current = cursorRef.current;
      return cursorDistanceSquared(current, lastRequestedCursor) >= minCursorDeltaSquared || now - lastCompletedAt >= CUA_GROUNDING_STALE_MS;
    };

    const refreshGrounding = (force = false) => {
      if (cancelled || inFlight || !shouldRequestGrounding(force)) return;
      const requestCursor = cursorRef.current;
      lastRequestedCursor = requestCursor;
      inFlight = true;
      void window.openMagicPointer
        .requestGrounding({ cursor: requestCursor })
        .then((preview) => {
          if (cancelled || groundingRequestSeqRef.current !== requestSeq) return;
          setCuaEntities(preview.entities);
          setHoveredCuaEntityId(cursorDistanceSquared(cursorRef.current, requestCursor) < minCursorDeltaSquared ? (preview.hoveredEntityId ?? null) : null);
          lastCompletedAt = Date.now();
        })
        .catch(() => {
          if (cancelled || groundingRequestSeqRef.current !== requestSeq) return;
          setCuaEntities([]);
          setHoveredCuaEntityId(null);
          lastCompletedAt = Date.now();
        })
        .finally(() => {
          inFlight = false;
          if (!cancelled && cursorDistanceSquared(cursorRef.current, requestCursor) >= minCursorDeltaSquared) {
            refreshGrounding();
          }
        });
    };

    const timer = window.setTimeout(() => refreshGrounding(true), CUA_GROUNDING_INITIAL_DELAY_MS);
    const interval = window.setInterval(() => refreshGrounding(false), CUA_GROUNDING_REFRESH_MS);
    return () => {
      cancelled = true;
      groundingRequestSeqRef.current += 1;
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [
    active,
    captureActivity.active,
    detached,
    historyOpen,
    liveCuaPreview,
    menuOpen,
    selectedCuaEntities.length,
    selecting,
    selection,
    selectionDrag,
    settings?.cuaMode,
    settingsOpen,
    state
  ]);

  // Track submit-time screenshot capture so the pointer can tint while it runs.
  useEffect(() => {
    const off = window.openMagicPointer.onCaptureActivity((payload) => {
      setCaptureActivity({ active: payload.phase === 'start', withCua: payload.withCua });
    });
    return off;
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    function onClick(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest('.bubble-dropdown') && !target.closest('.bubble-menu')) {
        setMenuOpen(false);
      }
    }
    window.addEventListener('click', onClick, { capture: true });
    return () => window.removeEventListener('click', onClick, { capture: true });
  }, [menuOpen]);

  // Close backend dropdown when clicking outside
  useEffect(() => {
    if (!backendDropdownOpen) return;
    function onClick(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest('.backend-dropdown') && !target.closest('.small-pill')) {
        setBackendDropdownOpen(false);
      }
    }
    window.addEventListener('click', onClick, { capture: true });
    return () => window.removeEventListener('click', onClick, { capture: true });
  }, [backendDropdownOpen]);

  const showFullContext = detached || state !== 'composing';
  const hasPanel = showFullContext;
  const shellPosition = useMemo(
    () => computeShellPosition(cursor.localX, cursor.localY, pillWidth, pillHeight, hasPanel),
    [cursor.localX, cursor.localY, pillWidth, pillHeight, hasPanel]
  );
  const effectiveShellPos = detachedPos ?? shellPosition;
  const shouldUseLagFollow = active && !detachedPos && !pillDrag && !panelResizeDrag && !cuaPickerResizeDrag && !selecting && !selectionDrag;
  const transcript = useMemo(
    () =>
      events
        .filter((event) => event.type === 'assistant.delta')
        .map((event) => event.text)
        .join(''),
    [events]
  );
  const readiness = useMemo(() => backendReadiness(settings, backend), [backend, settings]);
  const draftAwareSettings = useMemo(
    () =>
      settings
        ? {
            ...settings,
            hasLocalVlmApiKey: secretConfigured(settings.hasLocalVlmApiKey, secretDrafts.localVlmApiKey, clearSecrets.localVlmApiKey),
            hasHermesApiKey: secretConfigured(settings.hasHermesApiKey, secretDrafts.hermesApiKey, clearSecrets.hermesApiKey),
            hasOpenCodeApiKey: secretConfigured(settings.hasOpenCodeApiKey, secretDrafts.opencodeApiKey, clearSecrets.opencodeApiKey),
            hasClaudeAgentApiKey: secretConfigured(settings.hasClaudeAgentApiKey, secretDrafts.claudeAgentApiKey, clearSecrets.claudeAgentApiKey),
            hasCodexApiKey: secretConfigured(settings.hasCodexApiKey, secretDrafts.codexApiKey, clearSecrets.codexApiKey)
          }
        : null,
    [clearSecrets, secretDrafts, settings]
  );
  const discovery = latestEvent(events, 'tool.discovery');
  const approval = latestEvent(events, 'approval.requested');
  const latestFailure = latestEvent(events, 'run.failed');
  const toolEvents = useMemo(() => events.filter(isToolEvent), [events]);
  useEffect(() => {
    if (state === 'completed' || state === 'failed') {
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
    }
  }, [state]);

  useEffect(() => {
    if (streamPanelRef.current) {
      streamPanelRef.current.scrollTop = streamPanelRef.current.scrollHeight;
    }
  }, [transcript, events.length, historyTurns.length, state, showTools]);

  useEffect(() => {
    if (!panelResizeDrag) return;
    const activeDrag = panelResizeDrag;
    function onMouseMove(event: MouseEvent) {
      const dy = event.clientY - activeDrag.startY;
      const nextHeight = Math.max(120, Math.min(800, activeDrag.startHeight + dy));
      setPanelHeight(nextHeight);
    }
    function onMouseUp() {
      setPanelResizeDrag(null);
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [panelResizeDrag]);

  useEffect(() => {
    if (!cuaPickerResizeDrag) return;
    const activeDrag = cuaPickerResizeDrag;
    function onMouseMove(event: MouseEvent) {
      const maxWidth = Math.max(CUA_PICKER_MIN_WIDTH, window.innerWidth - 24);
      const maxHeight = Math.max(CUA_PICKER_MIN_HEIGHT, window.innerHeight - 24);
      setCuaPickerSize({
        width: clampNumber(activeDrag.startWidth + event.clientX - activeDrag.startX, CUA_PICKER_MIN_WIDTH, maxWidth, DEFAULT_CUA_PICKER_SIZE.width),
        height: clampNumber(activeDrag.startHeight + event.clientY - activeDrag.startY, CUA_PICKER_MIN_HEIGHT, maxHeight, DEFAULT_CUA_PICKER_SIZE.height)
      });
    }
    function onMouseUp() {
      setCuaPickerResizeDrag(null);
      window.setTimeout(() => focusPromptInput(inputRef.current), 0);
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [cuaPickerResizeDrag]);

  const streamPanelStyle = useMemo<CSSProperties>(() => {
    // Cap the panel to the space actually left below the pill so it scrolls
    // internally instead of being clipped by the screen's bottom edge.
    const maxHeight = availablePanelHeight(effectiveShellPos.y, pillHeight);
    if (panelHeight !== null) {
      return {
        height: `${Math.min(panelHeight, maxHeight)}px`,
        maxHeight: `${maxHeight}px`
      };
    }
    return { maxHeight: `${maxHeight}px` };
  }, [panelHeight, effectiveShellPos.y, pillHeight]);
  function onResizeMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const panelEl = streamPanelRef.current;
    const currentHeight = panelEl ? panelEl.getBoundingClientRect().height : 320;
    setPanelResizeDrag({
      startY: event.clientY,
      startHeight: currentHeight
    });
  }

  function onCuaPickerResizeMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const layout = computeCuaPickerLayout();
    setCuaPickerLocked(true);
    setCuaPickerPosition({ left: layout.left, top: layout.top });
    setCuaPickerResizeDrag({
      startX: event.clientX,
      startY: event.clientY,
      startWidth: layout.width,
      startHeight: layout.height
    });
  }

  async function submit(mode: 'text' | 'voice' = 'text', overrideText = prompt) {
    const text = overrideText.trim();
    const submittedCuaEntities = selectedCuaEntities;
    const selectedEntity = submittedCuaEntities[0];
    const hasSelectionContext = Boolean(selection);
    const cuaEnabled = settings?.cuaMode !== 'off';
    const hasCuaContext = submittedCuaEntities.length > 0;
    const instructionText = text || defaultContextInstruction(hasSelectionContext, hasCuaContext);
    if ((!text && !hasSelectionContext && !hasCuaContext) || state === 'submitting') return;
    if (!readiness.configured) {
      setEvents([{ type: 'run.failed', error: readiness.detail, recoverable: true }]);
      setState('failed');
      return;
    }
    setEvents([]);
    setState('submitting');
    setMenuOpen(false);

    setThinkingTime(0);
    setShowTools(false);
    if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    thinkingStartRef.current = Date.now();
    thinkingTimerRef.current = setInterval(() => {
      setThinkingTime(Math.round((Date.now() - thinkingStartRef.current) / 1000));
    }, 1000);

    const targetPath = selection
      ? [
          { x: selection.x1, y: selection.y1 },
          { x: selection.x2, y: selection.y1 },
          { x: selection.x2, y: selection.y2 },
          { x: selection.x1, y: selection.y2 }
        ]
      : undefined;
    setSelection(null);
    setSelectedCuaEntities([]);
    setCuaPickerLocked(false);
    setCuaPickerPosition(null);
    setHoveredCuaEntityId(null);
    setCuaEntities([]);
    // Clear the composer now that the message has been sent, so its text does
    // not linger in the input box after submission.
    setPrompt('');
    try {
      const currentConversationId = conversationIdRef.current;
      const res = await window.openMagicPointer.submitInstruction({
        text: instructionText,
        mode,
        backend,
        cursor,
        targetPath: selectedEntity ? undefined : targetPath,
        selectedEntity,
        includeScreenshot: hasSelectionContext,
        includeCua: cuaEnabled && hasCuaContext,
        cuaEntities: submittedCuaEntities,
        conversationId: currentConversationId ?? undefined
      });
      newConversationRequestedRef.current = false;
      conversationIdRef.current = res.conversationId;
      lastConversationIdRef.current = res.conversationId;
      lastDeactivatedAtRef.current = Date.now();
      setConversationId(res.conversationId);
      const conv = await window.openMagicPointer.getConversation(res.conversationId);
      if (conversationIdRef.current === res.conversationId && conv) setHistoryTurns(conv.turns);
    } catch (error) {
      // Without this the UI is stuck in the submitting state forever (no agent
      // events arrive when the submit IPC itself fails) and the thinking timer
      // keeps ticking.
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      setEvents([{ type: 'run.failed', error: error instanceof Error ? error.message : 'Failed to submit instruction.', recoverable: true }]);
      setState('failed');
    }
  }

  function startVoice() {
    setMenuOpen(false);
    if (!settings?.voiceEnabled) {
      setEvents([{ type: 'run.failed', error: 'Voice input is disabled in Settings.', recoverable: true }]);
      setState('failed');
      return;
    }
    const SpeechRecognitionCtor = (window.SpeechRecognition || window.webkitSpeechRecognition) as
      | (new () => {
          lang: string;
          interimResults: boolean;
          maxAlternatives: number;
          start(): void;
          onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
          onerror: (() => void) | null;
          onend: (() => void) | null;
        })
      | undefined;
    if (!SpeechRecognitionCtor) {
      setEvents([{ type: 'run.failed', error: 'Speech recognition is not available in this runtime.', recoverable: true }]);
      setState('failed');
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript ?? '';
      const command = parseVoiceCommand(text);
      setPrompt(command.text);
      if (command.kind === 'instruction') void submit('voice', command.text);
    };
    recognition.onerror = () => {
      setEvents([{ type: 'run.failed', error: 'Voice input failed.', recoverable: true }]);
      setState('failed');
    };
    recognition.onend = () => {
      if (state === 'composing') inputRef.current?.focus();
    };
    recognition.start();
  }

  async function saveSettings() {
    if (!settings) return;
    const next = await window.openMagicPointer.saveSettings({
      ...settings,
      agentBackend: backend === 'mock' ? 'auto' : backend,
      localVlmApiKey: secretDrafts.localVlmApiKey || undefined,
      hermesApiKey: secretDrafts.hermesApiKey || undefined,
      opencodeApiKey: secretDrafts.opencodeApiKey || undefined,
      claudeAgentApiKey: secretDrafts.claudeAgentApiKey || undefined,
      codexApiKey: secretDrafts.codexApiKey || undefined,
      clearLocalVlmApiKey: clearSecrets.localVlmApiKey || undefined,
      clearHermesApiKey: clearSecrets.hermesApiKey || undefined,
      clearOpenCodeApiKey: clearSecrets.opencodeApiKey || undefined,
      clearClaudeAgentApiKey: clearSecrets.claudeAgentApiKey || undefined,
      clearCodexApiKey: clearSecrets.codexApiKey || undefined
    });
    setSettings(next);
    setBackend(next.agentBackend);
    setSecretDrafts(emptySecretDrafts);
    setClearSecrets(emptyClearSecretFlags);
    setSettingsOpen(false);
  }

  function updateSettings(patch: Partial<AppSettings>) {
    setSettings((current) => (current ? { ...current, ...patch } : current));
  }

  function updateSecret(key: keyof SecretDrafts, value: string) {
    setSecretDrafts((current) => ({ ...current, [key]: value }));
    setClearSecrets((current) => ({ ...current, [key]: false }));
  }

  function clearSecret(key: keyof SecretDrafts) {
    setSecretDrafts((current) => ({ ...current, [key]: '' }));
    setClearSecrets((current) => ({ ...current, [key]: true }));
  }

  function onPillMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (!detached || !detachedPos) return;
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('textarea') || target.closest('select')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setPillDrag({
      startX: event.clientX,
      startY: event.clientY,
      initialPos: detachedPos
    });
  }

  function startNewConversation() {
    conversationRestoreEpochRef.current += 1;
    newConversationRequestedRef.current = true;
    conversationIdRef.current = null;
    lastConversationIdRef.current = null;
    lastDeactivatedAtRef.current = 0;
    window.openMagicPointer.cancelRun();
    if (thinkingTimerRef.current) {
      clearInterval(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    setMenuOpen(false);
    setConversationId(null);
    setHistoryTurns([]);
    setEvents([]);
    setPrompt('');
    setState('composing');
    setSelection(null);
    setSelectionDrag(null);
    setSelectedCuaEntities([]);
    setCuaPickerLocked(false);
    setCuaPickerPosition(null);
    setHoveredCuaEntityId(null);
    setThinkingTime(0);
    setShowTools(false);
    window.setTimeout(() => focusPromptInput(inputRef.current), 0);
  }

  async function loadConversation(id: string) {
    const conv = await window.openMagicPointer.getConversation(id);
    if (conv) {
      conversationRestoreEpochRef.current += 1;
      newConversationRequestedRef.current = false;
      conversationIdRef.current = conv.id;
      lastConversationIdRef.current = conv.id;
      lastDeactivatedAtRef.current = conv.updatedAt;
      setConversationId(conv.id);
      setHistoryTurns(conv.turns);
      setEvents([]);
      setPrompt('');
      setState('composing');
      setSelectedCuaEntities([]);
      setCuaPickerLocked(false);
      setCuaPickerPosition(null);
      setHoveredCuaEntityId(null);
      setHistoryOpen(false);
      window.setTimeout(() => focusPromptInput(inputRef.current), 0);
    }
  }

  async function handleDeleteConversation(id: string, event: ReactMouseEvent) {
    event.stopPropagation();
    await window.openMagicPointer.deleteConversation(id);
    const list = await window.openMagicPointer.getConversations();
    setConversationsList(list);
    if (conversationId === id) {
      conversationIdRef.current = null;
      lastConversationIdRef.current = null;
      lastDeactivatedAtRef.current = 0;
      setConversationId(null);
      setHistoryTurns([]);
    }
  }

  function beginSelectionMove(event: ReactMouseEvent<HTMLDivElement>) {
    if (!selection || selecting) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectionDrag({ kind: 'move', startX: event.clientX, startY: event.clientY, initial: selection });
  }

  function beginSelectionResize(handle: SelectionHandle, event: ReactMouseEvent<HTMLButtonElement>) {
    if (!selection || selecting) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectionDrag({ kind: 'resize', handle, startX: event.clientX, startY: event.clientY, initial: selection });
  }

  function clearSelection(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setSelection(null);
    setSelectionDrag(null);
    setSelectedCuaEntities([]);
    window.setTimeout(() => focusPromptInput(inputRef.current), 0);
  }

  function selectCuaEntity(entity: PointerEntity, event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const now = Date.now();
    const last = lastCuaSelectEventRef.current;
    if (event.type === 'click' && last?.id === entity.id && now - last.at < 300) return;
    lastCuaSelectEventRef.current = { id: entity.id, at: now, type: event.type };
    setSelectedCuaEntities((current) =>
      current.some((selected) => selected.id === entity.id)
        ? current.filter((selected) => selected.id !== entity.id)
        : [...current.filter((selected) => selected.id !== entity.id), entity]
    );
    setHoveredCuaEntityId(entity.id);
    setSelection(null);
    window.setTimeout(() => focusPromptInput(inputRef.current), 0);
  }

  const selectedCuaEntityIds = useMemo(() => new Set(selectedCuaEntities.map((entity) => entity.id)), [selectedCuaEntities]);

  const highlightedCuaEntity = useMemo(() => {
    const id = hoveredCuaEntityId ?? selectedCuaEntities[0]?.id;
    const pool = [...selectedCuaEntities, ...cuaEntities];
    return id ? pool.find((entity) => entity.id === id && entity.bbox) : undefined;
  }, [cuaEntities, hoveredCuaEntityId, selectedCuaEntities]);

  const selectedEntity = useMemo(() => {
    return selectedCuaEntities[0];
  }, [selectedCuaEntities]);

  const cuaCandidateCursor = liveCuaPreview ? cursor : cuaPickerAnchor;
  const cuaHighlightRegion = useMemo(() => contextRegionAroundCursor(cuaCandidateCursor), [cuaCandidateCursor]);
  const visibleCuaCandidates = useMemo(
    () =>
      cuaEntities
        .filter((entity) => {
          const rect = highlightRectForEntity(entity);
          return rect ? rectsIntersect(rect, cuaHighlightRegion) : false;
        })
        .sort((a, b) => {
          const aRect = highlightRectForEntity(a)!;
          const bRect = highlightRectForEntity(b)!;
          const distanceDelta =
            distanceToLocalRectSquared(cuaCandidateCursor.localX, cuaCandidateCursor.localY, aRect) -
            distanceToLocalRectSquared(cuaCandidateCursor.localX, cuaCandidateCursor.localY, bRect);
          if (distanceDelta !== 0) return distanceDelta;
          return aRect.width * aRect.height - bRect.width * bRect.height;
        })
        .slice(0, MAX_CUA_HIGHLIGHTS),
    [cuaCandidateCursor.localX, cuaCandidateCursor.localY, cuaEntities, cuaHighlightRegion]
  );

  const cuaPickerCandidates = useMemo(() => {
    if (visibleCuaCandidates.length > 0) return visibleCuaCandidates.slice(0, MAX_CUA_PICKER_ITEMS);
    return cuaEntities.filter((entity) => entity.groundingRef?.provider === 'cua').slice(0, MAX_CUA_PICKER_ITEMS);
  }, [cuaEntities, visibleCuaCandidates]);

  const highlightedCuaCandidates = useMemo(() => {
    const byId = new Map<string, PointerEntity>();
    for (const entity of visibleCuaCandidates) {
      if (hasPreciseCuaRect(entity)) byId.set(entity.id, entity);
    }
    for (const entity of cuaPickerCandidates) {
      if (hasPreciseCuaRect(entity)) byId.set(entity.id, entity);
    }
    for (const entity of selectedCuaEntities) {
      if (hasPreciseCuaRect(entity)) byId.set(entity.id, entity);
    }
    return [...byId.values()];
  }, [cuaPickerCandidates, selectedCuaEntities, visibleCuaCandidates]);

  const showCuaPicker =
    active &&
    state === 'composing' &&
    settings?.cuaMode !== 'off' &&
    !detached &&
    !selecting &&
    !selectionDrag &&
    !settingsOpen &&
    !historyOpen &&
    !menuOpen &&
    !selection &&
    cuaPickerCandidates.length > 0;

  function computeCuaPickerLayout() {
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const maxWidth = Math.max(CUA_PICKER_MIN_WIDTH, viewportW - 24);
    const maxHeight = Math.max(CUA_PICKER_MIN_HEIGHT, viewportH - 24);
    const width = clampNumber(cuaPickerSize.width, CUA_PICKER_MIN_WIDTH, maxWidth, DEFAULT_CUA_PICKER_SIZE.width);
    const height = clampNumber(cuaPickerSize.height, CUA_PICKER_MIN_HEIGHT, maxHeight, DEFAULT_CUA_PICKER_SIZE.height);

    if (cuaPickerPosition) {
      return {
        left: clampNumber(cuaPickerPosition.left, 12, Math.max(12, viewportW - width - 12), 12),
        top: clampNumber(cuaPickerPosition.top, 12, Math.max(12, viewportH - height - 12), 12),
        width,
        height
      };
    }

    const left = clampNumber(cuaPickerAnchor.localX + 18, 12, Math.max(12, viewportW - width - 12), 12);
    const below = cuaPickerAnchor.localY + 28;
    const above = cuaPickerAnchor.localY - height - 18;
    const top = below + height <= viewportH - 12 ? below : clampNumber(above, 12, Math.max(12, viewportH - height - 12), 12);
    return { left, top, width, height };
  }

  const cuaPickerLayout = computeCuaPickerLayout();
  const cuaPickerStyle: CSSProperties = {
    left: cuaPickerLayout.left,
    top: cuaPickerLayout.top,
    width: cuaPickerLayout.width,
    height: cuaPickerLayout.height,
    maxHeight: cuaPickerLayout.height
  };

  useEffect(() => {
    if (!showCuaPicker || !liveCuaPreview || cuaPickerLocked) return;
    function onMouseDown(event: MouseEvent) {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('.cua-picker-resize-handle')) return;
      event.preventDefault();
      event.stopPropagation();
      setCuaPickerAnchor(cursorRef.current);
      setCuaPickerLocked(true);
      setCuaPickerPosition({
        left: typeof cuaPickerStyle.left === 'number' ? cuaPickerStyle.left : Number(cuaPickerStyle.left) || 12,
        top: typeof cuaPickerStyle.top === 'number' ? cuaPickerStyle.top : Number(cuaPickerStyle.top) || 12
      });
      setHoveredCuaEntityId(null);
      window.setTimeout(() => focusPromptInput(inputRef.current), 0);
    }
    window.addEventListener('mousedown', onMouseDown, { capture: true });
    return () => window.removeEventListener('mousedown', onMouseDown, { capture: true });
  }, [cuaPickerLocked, cuaPickerStyle.left, cuaPickerStyle.top, liveCuaPreview, showCuaPicker]);

  // Pointer tint state, by actual timing/priority:
  //   'both'    teal   – submit-time screenshot taken with a selected CUA element
  //   'capture' purple – submit-time screenshot only
  //   'cua'     blue   – hovering over a CUA-grounded element (no screenshot yet)
  //   'none'           – default glow
  const pointerActivity = useMemo<'both' | 'capture' | 'cua' | 'none'>(() => {
    if (captureActivity.active) return captureActivity.withCua ? 'both' : 'capture';
    if (cuaEntities.length > 0) return 'cua';
    return 'none';
  }, [captureActivity.active, captureActivity.withCua, cuaEntities.length]);

  const glowFillColor = useMemo(() => {
    if (pointerActivity === 'capture') return '#8b5cf6';
    if (pointerActivity === 'cua' || pointerActivity === 'both') return '#14b8a6';
    return '#0D6FFF';
  }, [pointerActivity]);
  const modalOpen = settingsOpen || historyOpen;
  const shellHiddenForContextCapture = selecting || Boolean(selectionDrag) || captureActivity.active;
  const overlayNeedsPointerEvents =
    detached ||
    menuOpen ||
    modalOpen ||
    selecting ||
    Boolean(selection) ||
    Boolean(selectionDrag) ||
    Boolean(cuaPickerResizeDrag) ||
    Boolean(highlightedCuaEntity) ||
    highlightedCuaCandidates.length > 0 ||
    showCuaPicker;
  const menuStyle = useMemo<CSSProperties>(() => {
    const width = 220;
    const estimatedHeight = 232;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const shellWidth = Math.min(pillWidth, viewportW - 32);
    const left = Math.min(Math.max(12, effectiveShellPos.x + shellWidth - width), Math.max(12, viewportW - width - 12));
    const belowY = effectiveShellPos.y + pillHeight + 8;
    const aboveY = effectiveShellPos.y - estimatedHeight - 8;
    const shouldOpenAbove = hasPanel || belowY + estimatedHeight > viewportH;
    const top = shouldOpenAbove && aboveY >= 12 ? aboveY : Math.min(belowY, Math.max(12, viewportH - estimatedHeight - 12));
    return { left, top, width };
  }, [effectiveShellPos.x, effectiveShellPos.y, hasPanel, pillHeight, pillWidth]);

  return (
    <div
      className={`app-container fixed inset-0 text-ink pointer-events-none${overlayNeedsPointerEvents ? ' pointer-events-auto' : ''}${detached || selecting ? ' cursor-crosshair' : ''}`}
      style={
        {
          '--pill-width': `${pillWidth}px`,
          '--pill-height': `${pillHeight}px`,
          '--radius-pill': `${pillHeight / 2}px`
        } as CSSProperties
      }
    >
      {hold?.state === 'holding' && <HoldRing cursor={hold.cursor} progress={hold.progress} />}

      {active && (
        <>
          <CursorTrail x={cursor.localX} y={cursor.localY} enabled={active} />
          <svg
            className="absolute pointer-events-none z-0 animate-glow-breathe"
            style={{
              left: cursor.localX - 40,
              top: cursor.localY - 40,
              width: 80,
              height: 80
            }}
            viewBox="0 0 80 80"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <g filter="url(#filter0_f_42_128)">
              <circle cx="40" cy="40" r="14" fill={glowFillColor} style={{ transition: 'fill 160ms ease' }} />
            </g>
            <defs>
              <filter id="filter0_f_42_128" x="0" y="0" width="80" height="80" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                <feFlood floodOpacity="0" result="BackgroundImageFix" />
                <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
                <feGaussianBlur stdDeviation="6.75" result="effect1_foregroundBlur_42_128" />
              </filter>
            </defs>
          </svg>

          {highlightedCuaCandidates.map((entity) => {
            const rect = highlightRectForEntity(entity);
            if (!rect) return null;
            const isSelected = selectedCuaEntityIds.has(entity.id);
            const isHovered = hoveredCuaEntityId === entity.id;
            return (
              <div
                key={entity.id}
                className={`cua-element-highlight cua-element-candidate${isSelected ? ' is-selected' : ''}${isHovered ? ' is-hovered' : ''}`}
                style={{
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height
                }}
                title={entity.text ?? entity.name ?? entity.role ?? 'CUA element'}
                onMouseEnter={() => setHoveredCuaEntityId(entity.id)}
                onMouseLeave={() => setHoveredCuaEntityId(null)}
                onMouseDown={(event) => selectCuaEntity(entity, event)}
                onClick={(event) => selectCuaEntity(entity, event)}
              />
            );
          })}

          {selectedEntity && !highlightedCuaCandidates.some((entity) => entity.id === selectedEntity.id) && highlightRectForEntity(selectedEntity) && (
            <div
              className="cua-element-highlight cua-element-candidate is-selected"
              style={{
                left: highlightRectForEntity(selectedEntity)!.x,
                top: highlightRectForEntity(selectedEntity)!.y,
                width: highlightRectForEntity(selectedEntity)!.width,
                height: highlightRectForEntity(selectedEntity)!.height
              }}
              title={selectedEntity.text ?? selectedEntity.name ?? selectedEntity.role ?? 'CUA element'}
              onMouseDown={(event) => selectCuaEntity(selectedEntity, event)}
              onClick={(event) => selectCuaEntity(selectedEntity, event)}
            />
          )}

          {showCuaPicker && (
            <div className="cua-picker-panel" style={cuaPickerStyle}>
              <div className="cua-picker-header">
                <span>CUA</span>
                <span>
                  {selectedCuaEntities.length > 0 ? `${selectedCuaEntities.length} selected / ` : ''}
                  {cuaEntities.length} elements
                </span>
              </div>
              <div className="cua-picker-list">
                {cuaPickerCandidates.map((entity) => {
                  const isSelected = selectedCuaEntityIds.has(entity.id);
                  const isHovered = hoveredCuaEntityId === entity.id;
                  const hasRect = hasPreciseCuaRect(entity);
                  return (
                    <button
                      key={entity.id}
                      type="button"
                      className={`cua-picker-row${isSelected ? ' is-selected' : ''}${isHovered ? ' is-hovered' : ''}`}
                      onMouseEnter={() => setHoveredCuaEntityId(entity.id)}
                      onMouseLeave={() => setHoveredCuaEntityId(null)}
                      onMouseDown={(event) => selectCuaEntity(entity, event)}
                      onClick={(event) => selectCuaEntity(entity, event)}
                      title={entity.text ?? entity.name ?? entity.role ?? entity.kind}
                    >
                      <span className="cua-picker-main">
                        <span className="cua-picker-label">{entityLabel(entity)}</span>
                        <span className="cua-picker-meta">
                          {entity.role || entity.kind}
                          {hasRect ? ' - rect' : ' - ax'}
                        </span>
                      </span>
                      <span className="cua-picker-kind">{entity.kind}</span>
                    </button>
                  );
                })}
              </div>
              <div className="cua-picker-resize-handle" onMouseDown={onCuaPickerResizeMouseDown} />
            </div>
          )}

          {/* Selection rectangle overlay */}
          {selection && (
            <div
              className={`selection-rect${selecting ? ' pointer-events-none cursor-crosshair' : ''}${selectionDrag ? ' bg-[rgba(52,120,246,0.09)]' : ''}`}
              style={{ left: selection.x1, top: selection.y1, width: selection.x2 - selection.x1, height: selection.y2 - selection.y1 }}
              onMouseDown={beginSelectionMove}
            >
              {!selecting && (
                <>
                  <button
                    className="selection-clear"
                    type="button"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={clearSelection}
                    aria-label="Clear selection"
                  >
                    x
                  </button>
                  {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((handle) => {
                    const handlePos: Record<string, string> = {
                      n: 'handle-ns left-1/2 -translate-x-1/2 -top-1.5',
                      s: 'handle-ns left-1/2 -translate-x-1/2 -bottom-1.5',
                      e: 'handle-ew -right-1.5',
                      w: 'handle-ew -left-1.5',
                      nw: 'handle-corner -left-1.5 -top-1.5',
                      ne: 'handle-corner-alt -right-1.5 -top-1.5',
                      se: 'handle-corner -right-1.5 -bottom-1.5',
                      sw: 'handle-corner-alt -left-1.5 -bottom-1.5'
                    };
                    return (
                      <button
                        key={handle}
                        className={`selection-handle ${handlePos[handle]}`}
                        type="button"
                        aria-label={`Resize selection ${handle}`}
                        onMouseDown={(event) => beginSelectionResize(handle, event)}
                      />
                    );
                  })}
                </>
              )}
            </div>
          )}

          {!shellHiddenForContextCapture && (
            <section
              className={`absolute left-0 top-0 pointer-events-auto will-change-transform w-[min(var(--pill-width,520px),calc(100vw-32px))] state-${state}${selecting ? ' is-selecting' : ''}`}
              style={
                {
                  transform: `translate3d(${effectiveShellPos.x}px, ${effectiveShellPos.y}px, 0)`,
                  transition: shouldUseLagFollow ? 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
                  '--pill-width': `${pillWidth}px`,
                  '--pill-height': `${pillHeight}px`
                } as CSSProperties
              }
            >
              {/* Context attachment preview card */}
              {hoveredAttachment === 'selection' && selection && (
                <div
                  className="absolute left-0 z-10 w-[240px] p-3 text-white bg-[rgba(13,111,255,0.85)] backdrop-blur-[6.8px] shadow-[0px_8px_6px_0px_rgba(0,0,0,0.05)] border border-glass-border rounded-[var(--radius-pill)] flex flex-col gap-1.5 pointer-events-none animate-elastic-pop origin-bottom-left"
                  style={{ bottom: `calc(100% + ${previewCardBottom}px)` }}
                >
                  {/* Inner Shadow Layer covering the ENTIRE card, inheriting border-radius */}
                  <div className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_2px_3px_3px_-3px_rgba(255,255,255,0.6),inset_0px_-1px_1px_0px_rgba(255,255,255,0.25),inset_0px_1px_1px_0px_rgba(255,255,255,0.25)]" />
                  <div className="flex items-center gap-2">
                    <span className="text-base text-white/90">📸</span>
                    <div className="flex flex-col">
                      <span className="text-[12px] font-bold text-white/95 leading-tight">截图区域</span>
                      <span className="text-[9px] text-white/60 leading-none">Selected Region</span>
                    </div>
                  </div>
                  <div className="h-px bg-white/12 my-0.5" />
                  <div className="flex flex-col gap-0.5 text-[11px] text-white/85 font-mono">
                    <div>宽度: {selection.x2 - selection.x1} px</div>
                    <div>高度: {selection.y2 - selection.y1} px</div>
                    <div className="text-[9px] text-white/50 mt-0.5">
                      X: {selection.x1} - {selection.x2}
                    </div>
                    <div className="text-[9px] text-white/50">
                      Y: {selection.y1} - {selection.y2}
                    </div>
                  </div>
                </div>
              )}

              {hoveredAttachment === 'entity' && selectedEntity && (
                <div
                  className="absolute left-0 z-10 w-[280px] p-3 text-white bg-[rgba(13,111,255,0.85)] backdrop-blur-[6.8px] shadow-[0px_8px_6px_0px_rgba(0,0,0,0.05)] border border-glass-border rounded-[var(--radius-pill)] flex flex-col gap-1.5 pointer-events-none animate-elastic-pop origin-bottom-left"
                  style={{ bottom: `calc(100% + ${previewCardBottom}px)` }}
                >
                  {/* Inner Shadow Layer covering the ENTIRE card, inheriting border-radius */}
                  <div className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_2px_3px_3px_-3px_rgba(255,255,255,0.6),inset_0px_-1px_1px_0px_rgba(255,255,255,0.25),inset_0px_1px_1px_0px_rgba(255,255,255,0.25)]" />
                  <div className="flex items-center gap-2">
                    <span className="text-base text-white/90">
                      {selectedEntity.kind === 'text' ? '📝' : selectedEntity.kind === 'image' ? '🖼️' : selectedEntity.kind === 'container' ? '💻' : '🎯'}
                    </span>
                    <div className="flex flex-col">
                      <span className="text-[12px] font-bold text-white/95 leading-tight">
                        {selectedEntity.kind === 'text'
                          ? '已附带文本'
                          : selectedEntity.kind === 'image'
                            ? '已附带图像'
                            : selectedEntity.kind === 'container'
                              ? '已附带窗口'
                              : '已附带元素'}
                      </span>
                      <span className="text-[9px] text-white/60 leading-none">Attached Context</span>
                    </div>
                  </div>
                  <div className="h-px bg-white/12 my-0.5" />
                  <div className="flex flex-col gap-1 text-[11px] text-white/85">
                    {selectedEntity.name && (
                      <div>
                        <span className="text-white/50">名称:</span> {selectedEntity.name}
                      </div>
                    )}
                    {selectedEntity.role && (
                      <div>
                        <span className="text-white/50">角色:</span> {selectedEntity.role}
                      </div>
                    )}
                    {selectedEntity.text && (
                      <div className="max-h-[80px] overflow-hidden text-ellipsis line-clamp-4 bg-white/5 p-1.5 rounded-lg text-white/90 leading-[1.4] select-text pointer-events-auto break-all font-sans">
                        {selectedEntity.text}
                      </div>
                    )}
                    {selectedEntity.bbox && (
                      <div className="font-mono text-[9px] text-white/55 mt-1 border-t border-white/5 pt-1">
                        BBox: {Math.round(selectedEntity.bbox.width)}x{Math.round(selectedEntity.bbox.height)} px
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[9px] text-white/50 mt-1">
                      <span>来源: {selectedEntity.origin}</span>
                      <span>置信度: {Math.round(selectedEntity.confidence * 100)}%</span>
                    </div>
                  </div>
                </div>
              )}

              {hoveredAttachment === 'cua' && cuaEntities.length > 0 && (
                <div
                  className="absolute left-0 z-10 w-[300px] p-3 text-white bg-[rgba(13,111,255,0.85)] backdrop-blur-[6.8px] shadow-[0px_8px_6px_0px_rgba(0,0,0,0.05)] border border-glass-border rounded-[var(--radius-pill)] flex flex-col gap-1.5 pointer-events-none animate-elastic-pop origin-bottom-left"
                  style={{ bottom: `calc(100% + ${previewCardBottom}px)` }}
                >
                  <div className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_2px_3px_3px_-3px_rgba(255,255,255,0.6),inset_0px_-1px_1px_0px_rgba(255,255,255,0.25),inset_0px_1px_1px_0px_rgba(255,255,255,0.25)]" />
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-[12px] font-bold text-white/95 leading-tight">CUA elements</span>
                      <span className="text-[9px] text-white/60 leading-none">{cuaEntities.length} recognized near the pointer</span>
                    </div>
                    <span className="rounded-full bg-white/12 px-2 py-0.5 text-[10px] font-bold text-white/80">AX</span>
                  </div>
                  <div className="h-px bg-white/12 my-0.5" />
                  <div className="grid gap-1 text-[11px] text-white/[0.84]">
                    {cuaEntities.slice(0, 5).map((entity) => (
                      <div key={entity.id} className="grid grid-cols-[1fr_auto] gap-2 rounded-[var(--radius-pill)] bg-white/[0.08] px-2 py-1">
                        <span className="truncate">{entityLabel(entity)}</span>
                        <span className="text-[9px] uppercase text-white/55">{entity.role || entity.kind}</span>
                      </div>
                    ))}
                    {cuaEntities.length > 5 && <div className="text-[10px] text-white/50">+{cuaEntities.length - 5} more</div>}
                  </div>
                </div>
              )}

              {/* Small Pill above the main capsule to switch backend source */}
              <div
                className="small-pill absolute bottom-[calc(100%+6px)] left-0 z-10 flex items-center gap-1.5 px-3 py-1 bg-[rgba(13,111,255,0.85)] backdrop-blur-[6.8px] shadow-[0px_4px_12px_rgba(0,0,0,0.08)] border border-glass-border rounded-full w-fit cursor-pointer hover:bg-[rgba(13,111,255,0.95)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 text-white font-semibold select-none animate-elastic-pop origin-bottom-left"
                style={{
                  height: `${smallPillHeight}px`,
                  fontSize: `${Math.max(9, Math.min(11, pillHeight - 14))}px`
                }}
                onClick={() => setBackendDropdownOpen(!backendDropdownOpen)}
              >
                {/* Inner Shadow Layer covering the ENTIRE small pill, inheriting border-radius */}
                <div className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_1.5px_2px_2px_-2px_rgba(255,255,255,0.55),inset_0px_-0.5px_0.5px_0px_rgba(255,255,255,0.2),inset_0px_0.5px_0.5px_0px_rgba(255,255,255,0.2)]" />
                <span className="flex items-center gap-1">
                  {getBackendIcon(backend, Math.max(10, Math.min(12, pillHeight - 14)))}
                  <span>{backendLabel(backend)}</span>
                </span>
                <ChevronIcon size={7} isOpen={backendDropdownOpen} />
              </div>

              {/* Custom glassmorphic backend selector dropdown list, hovering above the small pill */}
              {backendDropdownOpen && (
                <div
                  className="backend-dropdown absolute left-0 z-10 min-w-[140px] p-1 border border-glass-border rounded-[var(--radius-pill)] bg-[rgba(13,111,255,0.95)] backdrop-blur-[40px] shadow-[0px_8px_32px_rgba(0,0,0,0.15)] animate-dropdown-appear flex flex-col gap-0.5"
                  style={{ bottom: `calc(100% + ${previewCardBottom}px)` }}
                >
                  {/* Inner Shadow Layer covering the ENTIRE dropdown, inheriting border-radius */}
                  <div className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_2px_3px_3px_-3px_rgba(255,255,255,0.6),inset_0px_-1px_1px_0px_rgba(255,255,255,0.25),inset_0px_1px_1px_0px_rgba(255,255,255,0.25)]" />
                  {selectableBackends.map((item) => {
                    const isSelected = backend === item;
                    return (
                      <button
                        key={item}
                        type="button"
                        className={`flex items-center justify-between w-full py-1.5 px-3 border-0 rounded-[var(--radius-pill)] bg-transparent text-left cursor-pointer transition-colors duration-140 font-semibold text-[11px] relative z-1 ${
                          isSelected ? 'bg-white text-[#0D6FFF] shadow-[0_1.5px_4px_rgba(0,0,0,0.08)]' : 'text-white/80 hover:bg-white/10 hover:text-white'
                        }`}
                        onClick={() => {
                          setBackend(item);
                          setBackendDropdownOpen(false);
                          window.setTimeout(() => focusPromptInput(inputRef.current), 0);
                        }}
                      >
                        <span className="flex items-center gap-1.5">
                          {getBackendIcon(item, 11)}
                          <span>{backendLabel(item)}</span>
                        </span>
                        {isSelected && <span className="text-[9px] font-bold">✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Blur glow layer — always matches pill shape/size */}
              <div
                className="absolute inset-0 bg-[rgba(13,111,255,0.56)] blur-[23.9px] z-0 pointer-events-none animate-pill-glow"
                style={{ borderRadius: `${pillHeight / 2}px` }}
              />

              <div
                className="command-bubble relative z-4 flex flex-col animate-pill-unfold origin-left"
                data-pill-theme={settings?.modalTheme ?? 'blue'}
                style={{
                  borderRadius: `${pillHeight / 2}px`
                }}
              >
                {/* Inner Shadow Layer covering the ENTIRE capsule, inheriting border-radius */}
                <div className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_2px_3px_3px_-3px_rgba(255,255,255,0.6),inset_0px_-1px_1px_0px_rgba(255,255,255,0.25),inset_0px_1px_1px_0px_rgba(255,255,255,0.25)]" />

                <div
                  className="flex items-center w-full relative z-1"
                  style={{
                    minHeight: `${pillHeight}px`,
                    gap: `${gap}px`,
                    paddingTop: `${padY}px`,
                    paddingBottom: `${padY}px`,
                    paddingRight: `${padXRight}px`,
                    paddingLeft: `${padXLeft}px`
                  }}
                  onMouseDown={onPillMouseDown}
                >
                  {/* Context Attachments Indicators */}
                  {showFullContext && (selection || selectedCuaEntities.length > 0) && (
                    <div className="flex items-center gap-1.5 shrink-0 select-none">
                      {selection && (
                        <div
                          className="group relative flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-[rgba(229,56,59,0.95)] transition-all duration-150 cursor-pointer animate-elastic-pop font-bold"
                          style={{
                            width: `${Math.max(20, Math.min(28, pillHeight - 8))}px`,
                            height: `${Math.max(20, Math.min(28, pillHeight - 8))}px`
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelection(null);
                            setHoveredAttachment(null);
                          }}
                          onMouseEnter={() => setHoveredAttachment('selection')}
                          onMouseLeave={() => setHoveredAttachment(null)}
                          title="Attached: Selected Region (Click to remove)"
                        >
                          <span
                            className="group-hover:hidden flex items-center justify-center text-white/90"
                            style={{ fontSize: `${Math.max(10, Math.min(13, pillHeight - 14))}px` }}
                          >
                            📸
                          </span>
                          <span
                            className="hidden group-hover:flex items-center justify-center text-white"
                            style={{ fontSize: `${Math.max(12, Math.min(14, pillHeight - 14))}px` }}
                          >
                            ×
                          </span>
                        </div>
                      )}

                      {selectedCuaEntities.length > 0 && selectedEntity && (
                        <div
                          className="group relative flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-[rgba(229,56,59,0.95)] transition-all duration-150 cursor-pointer animate-elastic-pop font-bold"
                          style={{
                            width: `${Math.max(20, Math.min(28, pillHeight - 8))}px`,
                            height: `${Math.max(20, Math.min(28, pillHeight - 8))}px`
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCuaEntities([]);
                            setHoveredAttachment(null);
                          }}
                          onMouseEnter={() => setHoveredAttachment('entity')}
                          onMouseLeave={() => setHoveredAttachment(null)}
                          title={`Attached: ${selectedCuaEntities.length} CUA element${selectedCuaEntities.length === 1 ? '' : 's'} (Click to remove)`}
                        >
                          <span
                            className="group-hover:hidden flex items-center justify-center text-white/90"
                            style={{ fontSize: `${Math.max(10, Math.min(13, pillHeight - 14))}px` }}
                          >
                            {selectedEntity.kind === 'text' ? '📝' : selectedEntity.kind === 'image' ? '🖼️' : selectedEntity.kind === 'container' ? '💻' : '🎯'}
                          </span>
                          <span
                            className="hidden group-hover:flex items-center justify-center text-white"
                            style={{ fontSize: `${Math.max(12, Math.min(14, pillHeight - 14))}px` }}
                          >
                            ×
                          </span>
                        </div>
                      )}

                    </div>
                  )}

                  <textarea
                    ref={inputRef}
                    autoFocus
                    className="bubble-input"
                    style={{
                      fontSize: `${inputFontSize}px`,
                      lineHeight: '1.4',
                      minHeight: `${Math.max(16, pillHeight - 12)}px`
                    }}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        setSettingsOpen(false);
                        window.openMagicPointer.cancelRun();
                        window.openMagicPointer.deactivate();
                        return;
                      }
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void submit();
                      }
                    }}
                    placeholder={placeholderForState(state, readiness)}
                    rows={1}
                  />

                  <button
                    className="bubble-menu shrink-0 grid place-items-center rounded-full text-white/70 bg-transparent leading-none tracking-[1px] hover:bg-white/10 hover:text-white active:scale-95 transition-all duration-160 relative z-1"
                    style={{
                      width: `${menuSize}px`,
                      height: `${menuSize}px`,
                      fontSize: `${Math.max(10, Math.min(18, menuSize - 4))}px`
                    }}
                    title="Menu"
                    onClick={() => setMenuOpen(!menuOpen)}
                    aria-label="Menu"
                  >
                    ···
                  </button>
                </div>

                {/* Faint Horizontal Line and Integrated Stream Panel */}
                {showFullContext && (
                  <>
                    <div className="mx-4 h-px bg-white/12" />
                    <div className="capsule-stream-panel scrollbar-capsule px-4 pb-5 pt-3" style={streamPanelStyle} ref={streamPanelRef}>
                      <div className="flex justify-between gap-2.5 text-white/50 text-[11px] font-semibold uppercase tracking-[0.02em]">
                        <span>{backendLabel(backend)}</span>
                        <span>{statusLabel(state)}</span>
                      </div>
                      <div className="flex flex-col gap-4 mt-2.5 w-full">
                        {historyTurns.map((turn) => {
                          if (turn.role === 'user') {
                            return (
                              <div key={turn.id} className="flex flex-col w-full items-end">
                                <div className="user-bubble max-w-[85%] rounded-[var(--radius-pill)_var(--radius-pill)_0_var(--radius-pill)] py-2.5 px-3.5 text-sm leading-[1.45] break-words whitespace-pre-wrap">
                                  {turn.text}
                                </div>
                                {turn.pointerContext && <PointerContextPreview context={turn.pointerContext} />}
                              </div>
                            );
                          } else {
                            return (
                              <div key={turn.id} className="flex flex-col w-full items-start">
                                <article className="agent-text text-sm markdown-body">
                                  <MarkdownRenderer value={turn.text} />
                                </article>
                              </div>
                            );
                          }
                        })}

                        {/* Active turn streaming/thinking */}
                        {((historyTurns.length === 0 && (state === 'submitting' || state === 'streaming' || state === 'approval')) ||
                          (historyTurns.length > 0 && historyTurns[historyTurns.length - 1]?.role === 'user')) && (
                          <div className="flex flex-col w-full items-start">
                            {/* Thinking Block */}
                            {thinkingTime > 0 && (
                              <div className="my-2.5 flex flex-col items-start w-full">
                                <div
                                  className={`inline-flex items-center gap-1.5 cursor-pointer select-none text-xs font-semibold text-white/60 py-1 px-2 rounded-[var(--radius-pill)] bg-white/5 hover:bg-white/10 hover:text-white transition-all duration-150${showTools ? ' [&>.arrow]:rotate-90' : ''}`}
                                  onClick={() => setShowTools(!showTools)}
                                >
                                  <span>已思考 {thinkingTime}s</span>
                                  <span className="arrow inline-block text-[8px] rotate-0 transition-transform duration-150 leading-none">▶</span>
                                </div>
                                {showTools && (
                                  <div className="mt-1.5 pl-3 border-l-2 border-white/10 w-full">
                                    {discovery && <p className="tool-discovery mt-2.5 text-white/60 text-[13px] leading-relaxed">{discovery.message}</p>}
                                    {toolEvents.length > 0 && <ToolRows events={toolEvents} />}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Streaming Markdown Response */}
                            {transcript && (
                              <article className="agent-text text-sm markdown-body">
                                <MarkdownRenderer value={transcript} />
                              </article>
                            )}

                            {/* Other active states */}
                            {approval && (
                              <div className="approval-box mt-3 border border-[rgba(255,255,255,0.15)] rounded-[var(--radius-pill)] bg-white/5 p-3">
                                <strong className="text-white text-[13px]">{approval.tool ?? 'Agent'} requests approval</strong>
                                <p className="mt-2.5 text-[13px] leading-relaxed text-white/80">{approval.reason}</p>
                                <div className="flex gap-2 mt-2.5">
                                  <button
                                    className="approval-button bg-white/15 text-white hover:bg-white/25 rounded-[var(--radius-pill)] px-3 py-1 text-xs font-semibold"
                                    onClick={() => void window.openMagicPointer.approveAgentRequest(approval.id, 'approve')}
                                  >
                                    Allow
                                  </button>
                                  <button
                                    className="approval-button bg-white/15 text-white hover:bg-white/25 rounded-[var(--radius-pill)] px-3 py-1 text-xs font-semibold"
                                    onClick={() => void window.openMagicPointer.approveAgentRequest(approval.id, 'deny')}
                                  >
                                    Deny
                                  </button>
                                </div>
                              </div>
                            )}
                            {latestFailure && <p className="text-danger text-[13px] leading-relaxed mt-2.5">{latestFailure.error}</p>}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="resize-grip" onMouseDown={onResizeMouseDown} />
                  </>
                )}
              </div>
            </section>
          )}

          {menuOpen && !shellHiddenForContextCapture && (
            <div className="bubble-dropdown" style={menuStyle} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
              <button className="bubble-dropdown-item" onClick={startVoice}>
                <span className="bubble-dropdown-icon">V</span>
                Voice input
              </button>
              <div className="bubble-dropdown-separator" />
              <label className="bubble-dropdown-item">
                <span className="bubble-dropdown-icon">B</span>
                <select
                  className="bubble-dropdown-select"
                  value={backend}
                  onChange={(event) => setBackend(event.target.value as AgentBackendId)}
                  title="Agent backend"
                >
                  {selectableBackends.map((item) => (
                    <option key={item} value={item}>
                      {backendLabel(item)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="bubble-dropdown-item"
                onClick={startNewConversation}
              >
                <span className="bubble-dropdown-icon">N</span>
                New Conversation
              </button>
              <button
                className="bubble-dropdown-item"
                onClick={() => {
                  setMenuOpen(false);
                  setHistoryOpen(true);
                  window.openMagicPointer.getConversations().then(setConversationsList);
                }}
              >
                <span className="bubble-dropdown-icon">H</span>
                History
              </button>
              <button
                className="bubble-dropdown-item"
                onClick={() => {
                  setMenuOpen(false);
                  setSettingsOpen(true);
                }}
              >
                <span className="bubble-dropdown-icon">S</span>
                Settings
              </button>
            </div>
          )}
        </>
      )}

      {settingsOpen && settings && (
        <SettingsPanel
          settings={settings}
          draftAwareSettings={draftAwareSettings}
          backend={backend}
          setBackend={setBackend}
          secretDrafts={secretDrafts}
          clearSecrets={clearSecrets}
          pillWidth={pillWidth}
          pillHeight={pillHeight}
          fetchedModels={fetchedModels}
          isFetchingModels={isFetchingModels}
          fetchModelsError={fetchModelsError}
          conversations={conversationsList}
          onClose={() => setSettingsOpen(false)}
          updateSettings={updateSettings}
          updateSecret={updateSecret}
          clearSecret={clearSecret}
          fetchModels={() => void fetchModels()}
          saveSettings={() => void saveSettings()}
          loadConversation={(id) => void loadConversation(id)}
          deleteConversation={(id, event) => void handleDeleteConversation(id, event)}
        />
      )}

      {historyOpen && (
        <HistoryPanel
          conversations={conversationsList}
          onClose={() => setHistoryOpen(false)}
          loadConversation={(id) => void loadConversation(id)}
          deleteConversation={(id, event) => void handleDeleteConversation(id, event)}
        />
      )}
    </div>
  );
}
