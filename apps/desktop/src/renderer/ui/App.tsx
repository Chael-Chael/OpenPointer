import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type UIEvent as ReactUIEvent } from 'react';
import { clampNumber, type AgentBackendId, type AgentEvent, type BackendSessionKey, type ContextChip, type Conversation, type PointerEntity } from '@openpointer/core';
import type { ApprovalDecision } from '@openpointer/agent-bridge';
import type { AppSettings } from '@openpointer/storage';
import { parseVoiceCommand } from '@openpointer/voice';
import type { CursorPayload, HoldProgressPayload, WindowPreviewResponse } from '../../shared/types';
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
import { backendLabel, backendReadiness, latestEvent, placeholderForState, secretConfigured, statusLabel } from './lib/backend-status';
import { parkBackgroundConversation, removeBackgroundConversation, resolveBackgroundConversations } from './lib/background-processes';
import { availablePanelHeight, computeShellPosition, focusPromptInput, normalizeSelection, resolvedPanelHeight, selectionFromDrag } from './lib/geometry';
import { selectedCuaAttachmentTitle, selectedListItemsForContext } from './lib/cua-selection';
import {
  CUA_GROUNDING_INITIAL_DELAY_MS,
  CUA_GROUNDING_MIN_CURSOR_DELTA,
  CUA_GROUNDING_REFRESH_MS,
  CUA_GROUNDING_STALE_MS,
  CUA_PICKER_HOVER_LOCK_MS,
  CUA_PICKER_HOVER_LOCK_TOLERANCE,
  CUA_PICKER_MIN_HEIGHT,
  CUA_PICKER_MIN_WIDTH,
  DEFAULT_CUA_PICKER_SIZE,
  MAX_CUA_HIGHLIGHTS,
} from './lib/cua-constants';
import {
  contextRegionAroundCursor,
  cursorDistanceSquared,
  defaultContextInstruction,
  distanceToLocalRectSquared,
  hasPreciseCuaRect,
  highlightRectForEntity,
  pointInLocalRect,
  rectsIntersect
} from './lib/cua-geometry';
import { entityDebugDetails, entityKindTitle, entityLabel, windowPreviewLabel } from './lib/entity-helpers';
import {
  contextChipFromEntity,
  contextChipFromWindowPreview,
  contextChipTitle,
  pinContextChip,
  removeContextChip
} from './lib/context-chips';
import { groupEventsToBlocks, type DialogueBlock, type HistoryToolEvent } from './lib/dialogue-parser';
import { HoldRing } from './components/fields';
import { SettingsPanel } from './components/SettingsPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { getBackendIcon } from './components/icons';
import { ChevronIcon, EntityKindGlyph, WindowGlyph } from './components/glyphs';
import { PointerContextPreview } from './components/PointerContextPreview';
import { HistoryThinkingBlock } from './components/HistoryThinkingBlock';
import { DialogueBlocksRenderer } from './components/DialogueBlocks';
import { CuaTaskPanel, useCuaTasks } from './components/CuaTaskPanel';
import { BackgroundProcessDock } from './components/BackgroundProcessDock';

export type { DialogueBlock, HistoryToolEvent };

const initialCursor: CursorPayload = { x: 300, y: 300, localX: 300, localY: 300, displayId: 0, dpr: 1 };
const CONTEXT_CHIP_HOVER_DELAY_MS = 380;
const CONTEXT_TRANSFER_PATTERN = /\b(copy|move|insert|paste|send|put|into|to)\b|放到|整理到|插入到|复制到|粘贴到|移到/u;

type ContinuableBackend = {
  backend: AgentBackendId;
  sessionId: string;
};

function resolveContinuableBackend(conversation: Conversation | null, preferred: AgentBackendId): ContinuableBackend | null {
  if (!conversation?.backendSessions) return null;
  const candidates: AgentBackendId[] =
    preferred !== 'auto' && preferred !== 'local-vlm' && preferred !== 'mock'
      ? [preferred, 'claude-agent', 'codex', 'hermes', 'opencode']
      : ['claude-agent', 'codex', 'hermes', 'opencode'];
  const seen = new Set<AgentBackendId>();
  for (const backend of candidates) {
    if (seen.has(backend)) continue;
    seen.add(backend);
    const key = backendSessionKey(backend);
    const sessionId = key ? conversation.backendSessions[key]?.sessionId : undefined;
    if (sessionId) return { backend, sessionId };
  }
  return null;
}

function backendSessionKey(backend: AgentBackendId): BackendSessionKey | undefined {
  switch (backend) {
    case 'claude-agent':
      return 'claudeAgent';
    case 'codex':
      return 'codex';
    case 'hermes':
      return 'hermes';
    case 'opencode':
      return 'opencode';
    default:
      return undefined;
  }
}

export function App() {
  const overlayDisplayId = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get('displayId');
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }, []);
  const isCursorOnThisOverlay = useCallback(
    (payload: CursorPayload): boolean => {
      return overlayDisplayId === null || payload.displayId === overlayDisplayId;
    },
    [overlayDisplayId]
  );

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
  const [claudeSubmenuOpen, setClaudeSubmenuOpen] = useState(false);
  const [codexSubmenuOpen, setCodexSubmenuOpen] = useState(false);
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
  const [cuaPickerResizeDrag, setCuaPickerResizeDrag] = useState<{ startX: number; startY: number; startWidth: number; startHeight: number } | null>(null);
  const [hoveredCuaEntityId, setHoveredCuaEntityId] = useState<string | null>(null);
  const [draftCuaEntities, setDraftCuaEntities] = useState<PointerEntity[]>([]);
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
  const [_thinkingTime, setThinkingTime] = useState<number>(0);
  const [showTools, setShowTools] = useState<boolean>(false);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkingStartRef = useRef<number>(0);
  const streamPanelRef = useRef<HTMLDivElement | null>(null);
  const streamPanelStickToBottomRef = useRef(true);
  // During assistant streaming, keep the top of the new answer stable instead
  // of continuously pushing it out of view as more tokens arrive.
  const streamPanelStreamingResponseRef = useRef(false);
  const groundingRequestSeqRef = useRef(0);
  const windowRequestSeqRef = useRef(0);
  const cuaHoverLockSuppressedUntilRef = useRef(0);
  const cuaPickerInteractiveRef = useRef(false);
  // Submit-time screenshot signal from the main process (see CaptureActivity IPC).
  const [captureActivity, setCaptureActivity] = useState<{ active: boolean; withCua: boolean }>({ active: false, withCua: false });
  const [historyTurns, setHistoryTurns] = useState<import('@openpointer/core').ChatTurn[]>([]);
  const [conversationMeta, setConversationMeta] = useState<Conversation | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversationsList, setConversationsList] = useState<import('@openpointer/core').Conversation[]>([]);
  const [backgroundConversationIds, setBackgroundConversationIds] = useState<string[]>([]);
  const [backgroundTerminalErrors, setBackgroundTerminalErrors] = useState<Record<string, string>>({});
  const [continueError, setContinueError] = useState<string | null>(null);
  const [pillDrag, setPillDrag] = useState<{ startX: number; startY: number; initialPos: { x: number; y: number } } | null>(null);
  const [pillWidthDrag, setPillWidthDrag] = useState<{
    side: 'left' | 'right';
    startX: number;
    startWidth: number;
    startXPos: number;
  } | null>(null);
  const [windowPreview, setWindowPreview] = useState<WindowPreviewResponse | null>(null);
  const [candidateContextChip, setCandidateContextChip] = useState<ContextChip | null>(null);
  const [pinnedContextChips, setPinnedContextChips] = useState<ContextChip[]>([]);
  const [draggingContextChip, setDraggingContextChip] = useState<{
    chip: ContextChip;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    overShelf: boolean;
  } | null>(null);
  const [settledApprovalIds, setSettledApprovalIds] = useState<Set<string>>(() => new Set());

  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const [hoveredAttachment, setHoveredAttachment] = useState<'window' | 'selection' | 'entity' | 'cua' | null>(null);
  const {
    tasks: cuaTasks,
    cancelTask: cancelCuaTask,
    startRecording: startCuaTaskRecording,
    stopRecording: stopCuaTaskRecording,
    replayRecording: replayCuaTaskRecording
  } = useCuaTasks();

  const showFullContext = detached && (historyTurns.length > 0 || state !== 'composing');

  async function fetchModels() {
    if (!settings?.localVlmBaseUrl) return;
    setIsFetchingModels(true);
    setFetchModelsError(null);
    setFetchedModels(null);
    try {
      const key = secretDrafts.localVlmApiKey || (settings.hasLocalVlmApiKey ? 'STORED' : '');
      const res = await window.openPointer.fetchVisionModels({
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
  const contextShelfRef = useRef<HTMLDivElement | null>(null);
  const draggingContextChipRef = useRef<typeof draggingContextChip>(null);
  draggingContextChipRef.current = draggingContextChip;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const activeRef = useRef(false);
  activeRef.current = active;
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const lastInteractiveRef = useRef(false);
  const lastGlobalContextMenuAtRef = useRef(0);
  const liveCuaPreview =
    active &&
    state === 'composing' &&
    settings?.cuaMode !== 'off' &&
    !selecting &&
    !selectionDrag &&
    !selection &&
    !settingsOpen &&
    !historyOpen &&
    !menuOpen &&
    !captureActivity.active &&
    !cuaPickerLocked &&
    selectedCuaEntities.length === 0;
  const backgroundConversations = useMemo(
    () => resolveBackgroundConversations(backgroundConversationIds, conversationsList),
    [backgroundConversationIds, conversationsList]
  );

  const releaseOverlayPointerCapture = useCallback(() => {
    cuaPickerInteractiveRef.current = false;
    if (lastInteractiveRef.current) {
      lastInteractiveRef.current = false;
      window.openPointer.setInteractive(false);
    }
  }, []);

  async function refreshConversationsList() {
    const list = await window.openPointer.getConversations();
    setConversationsList(list);
    return list;
  }

  function clearBackgroundTerminalError(id: string) {
    setBackgroundTerminalErrors((current) => {
      if (!current[id]) return current;
      const { [id]: _removed, ...next } = current;
      return next;
    });
  }

  function parkConversationInBackground(id: string | null | undefined) {
    if (!id) return;
    setBackgroundConversationIds((current) => parkBackgroundConversation(current, id));
    clearBackgroundTerminalError(id);
    void refreshConversationsList().catch(() => {
      /* transient IPC failure; dock will refresh on the next history read */
    });
  }

  function removeConversationFromBackground(id: string) {
    setBackgroundConversationIds((current) => removeBackgroundConversation(current, id));
    clearBackgroundTerminalError(id);
  }

  useEffect(() => {
    void window.openPointer.getSettings().then((value) => {
      setSettings(value);
      setBackend(value.agentBackend);
    });
    const offCursor = window.openPointer.onCursor((payload) => {
      if (isCursorOnThisOverlay(payload)) setCursor(payload);
    });
    const offHold = window.openPointer.onHoldProgress((payload) => {
      if (!isCursorOnThisOverlay(payload.cursor)) return;
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
          groundingRequestSeqRef.current += 1;
          setActive(true);
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
    const offActivate = window.openPointer.onActivate((payload) => {
      if (!isCursorOnThisOverlay(payload)) return;
      setCursor(payload);
      setCuaPickerAnchor(payload);
      setWindowPreview(null);
      setCandidateContextChip(null);
      setDraggingContextChip(null);
      setCuaPickerLocked(false);
      setCuaPickerPosition(null);
      setActive(true);

      // Wake-up stays parked at the activation point. The shell can still be
      // clicked, while the rest of the desktop remains pass-through.
      setDetached(false);
      setDetachedPos(computeShellPosition(payload.localX, payload.localY, pillWidth, pillHeight, false));

      window.openPointer.getSettings().then(async (currentSettings) => {
        setSettings(currentSettings);
      });

      setState('composing');
    });
    const offDeactivate = window.openPointer.onDeactivate((payload) => {
      lastInteractiveRef.current = false;
      groundingRequestSeqRef.current += 1;
      const currentConversationId = conversationIdRef.current;
      parkConversationInBackground(currentConversationId);
      if (payload?.startNewConversationOnNextActivate) {
        lastConversationIdRef.current = null;
        lastDeactivatedAtRef.current = 0;
        newConversationRequestedRef.current = true;
      } else if (currentConversationId) {
        lastConversationIdRef.current = currentConversationId;
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
      setConversationMeta(null);
      setContinueError(null);
      setHistoryOpen(false);
      setDetached(false);
      setSelection(null);
      setCuaEntities([]);
      setWindowPreview(null);
      setCandidateContextChip(null);
      setPinnedContextChips([]);
      setDraggingContextChip(null);
      setCuaPickerAnchor(initialCursor);
      setCuaPickerLocked(false);
      setCuaPickerPosition(null);
      setCuaPickerResizeDrag(null);
      setHoveredCuaEntityId(null);
      setDraftCuaEntities([]);
      setSelectedCuaEntities([]);
      setDetachedPos(null);
      setSelecting(false);
      setSelectionOrigin(null);
      setSelectionDrag(null);
      setPanelHeight(null);
      setThinkingTime(0);
      setSettledApprovalIds(new Set());
      setShowTools(false);
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
    });
    const offEvent = window.openPointer.onAgentEvent((event) => {
      if (event.type === 'run.started') {
        streamPanelStreamingResponseRef.current = false;
        streamPanelStickToBottomRef.current = true;
      }
      if (event.type === 'assistant.delta') {
        streamPanelStreamingResponseRef.current = true;
        streamPanelStickToBottomRef.current = false;
      }
      setEvents((prev) => [...prev, event].slice(-80));
      if (event.type === 'run.started' || event.type === 'assistant.delta' || event.type === 'tool.started' || event.type === 'tool.completed')
        setState('streaming');
      if (event.type === 'approval.requested') setState('approval');
      if (event.type === 'run.completed') setState('completed');
      if (event.type === 'run.failed') setState('failed');
    });
    window.openPointer.ready();
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
  }, [isCursorOnThisOverlay, settings?.pillHeight, settings?.pillWidth]);

  useEffect(() => {
    if (conversationId && (state === 'completed' || state === 'composing' || state === 'idle' || state === 'failed')) {
      // Guard against a stale response from a previous conversationId/state
      // overwriting the history after a rapid switch.
      let cancelled = false;
      window.openPointer
        .getConversation(conversationId)
        .then((conv) => {
          if (!cancelled && conversationIdRef.current === conversationId && conv) {
            setHistoryTurns(conv.turns);
            setConversationMeta(conv);
          }
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
    // Only explicit chat/modal/drag states force full-window capture. The
    // initial long-press preview remains transparent so background UI keeps
    // receiving normal left/right clicks until the user right-clicks into chat.
    const forceInteractive =
      active &&
      (detached ||
        menuOpen ||
        backendDropdownOpen ||
        settingsOpen ||
        historyOpen ||
        Boolean(pillDrag) ||
        Boolean(pillWidthDrag) ||
        Boolean(selection) ||
        selecting ||
        Boolean(selectionDrag) ||
        Boolean(panelResizeDrag) ||
        Boolean(cuaPickerResizeDrag) ||
        Boolean(draggingContextChip));

    function checkTarget(target: EventTarget | null) {
      if (forceInteractive) return true;
      if (!target) return false;
      const el = target as Element;
      if (el.closest('.background-process-dock')) return true;
      if (!detached) return Boolean(el.closest('.openpointer-shell, .cua-picker-panel, .context-candidate-chip, .context-chip-ghost'));
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
      if (shouldCapture && !active && backgroundConversations.length === 0) return;
      if (shouldCapture !== lastInteractiveRef.current) {
        lastInteractiveRef.current = shouldCapture;
        window.openPointer.setInteractive(shouldCapture);
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
    menuOpen,
    detached,
    backgroundConversations.length,
    backendDropdownOpen,
    settingsOpen,
    historyOpen,
    pillDrag,
    pillWidthDrag,
    selection,
    selecting,
    selectionDrag,
    panelResizeDrag,
    cuaPickerResizeDrag,
    candidateContextChip,
    draggingContextChip,
    state
  ]);

  // Esc = close this session; Right-click = restore follow mode or cancel local selection.
  useEffect(() => {
    function restoreFollowMode() {
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
        if (!detached) {
          setDetachedPos(null);
        }
        window.setTimeout(() => focusPromptInput(inputRef.current), 0);
        return;
      }
      if (!activeRef.current) return;
      setDetachedPos(null);
      setSelection(null);
      if (detached) {
        window.setTimeout(() => focusPromptInput(inputRef.current), 0);
      } else {
        window.setTimeout(() => releaseOverlayPointerCapture(), 0);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setSettingsOpen(false);
      window.openPointer.cancelRun();
      window.openPointer.deactivate({ startNewConversationOnNextActivate: true });
    }
    // Right click is a one-way return to follow mode; it does not close the
    // active conversation panel.
    function onContextMenu(event: MouseEvent) {
      // Always suppress the native right-click menu on the overlay.
      event.preventDefault();
      if (Date.now() - lastGlobalContextMenuAtRef.current < 300) return;
      restoreFollowMode();
    }
    const offGlobalContextMenu = window.openPointer.onGlobalContextMenu((payload) => {
      if (!isCursorOnThisOverlay(payload)) return;
      lastGlobalContextMenuAtRef.current = Date.now();
      setCursor(payload);
      setCuaPickerAnchor(payload);
      restoreFollowMode();
    });
    const offGlobalMouseDown = window.openPointer.onGlobalMouseDown((payload) => {
      if (!isCursorOnThisOverlay(payload)) return;
      setCursor(payload);
      setCuaPickerAnchor(payload);
      window.setTimeout(() => releaseOverlayPointerCapture(), 0);
    });
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    return () => {
      offGlobalContextMenu();
      offGlobalMouseDown();
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
    };
  }, [isCursorOnThisOverlay, menuOpen, selecting, selectionDrag, detached, releaseOverlayPointerCapture]);

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
      if (!detached) {
        setDetachedPos(null); // Unfreeze shell, resume following
      }
      // selection rect stays visible until submit or dismissed
      window.setTimeout(() => focusPromptInput(inputRef.current), 0);
    }
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [selecting, detached]);

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

      const maxPanelH = showFullContext ? Math.max(160, panelHeight ?? 0) : 0;
      const maxY = window.innerHeight - pillHeight - maxPanelH - 12;

      setDetachedPos({
        x: Math.min(Math.max(12, nextX), Math.max(12, window.innerWidth - pillWidth - 12)),
        y: Math.min(Math.max(12, nextY), Math.max(12, maxY))
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
  }, [pillDrag, pillWidth, pillHeight, showFullContext, panelHeight]);

  useEffect(() => {
    if (!pillWidthDrag) return;
    const activeDrag = pillWidthDrag;
    function onMouseMove(event: MouseEvent) {
      const dx = event.clientX - activeDrag.startX;
      if (activeDrag.side === 'right') {
        const nextWidth = clampNumber(activeDrag.startWidth + dx, 280, 900, 520);
        updateSettings({ pillWidth: nextWidth });
      } else {
        const rawWidth = activeDrag.startWidth - dx;
        const nextWidth = clampNumber(rawWidth, 280, 900, 520);
        const actualDx = activeDrag.startWidth - nextWidth;
        const nextX = activeDrag.startXPos + actualDx;

        setDetachedPos((prev) =>
          prev
            ? {
                ...prev,
                x: Math.min(Math.max(12, nextX), Math.max(12, window.innerWidth - nextWidth - 12))
              }
            : prev
        );
        updateSettings({ pillWidth: nextWidth });
      }
    }
    function onMouseUp() {
      setPillWidthDrag(null);
      if (settings) {
        void window.openPointer.saveSettings({
          ...settings,
          pillWidth
        });
      }
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [pillWidthDrag, settings, pillWidth]);

  // Keep the detached pill pulled up if the conversation panel is open,
  // preventing it from extending off the bottom of the screen.
  useEffect(() => {
    if (showFullContext && detachedPos) {
      const maxPanelH = Math.max(160, panelHeight ?? 0);
      const maxY = window.innerHeight - pillHeight - maxPanelH - 12;
      if (detachedPos.y > maxY) {
        setDetachedPos({
          ...detachedPos,
          y: Math.max(12, maxY)
        });
      }
    }
  }, [showFullContext, panelHeight, pillHeight, detachedPos]);

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
        setDraftCuaEntities([]);
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
      void window.openPointer
        .requestGrounding({ cursor: requestCursor })
        .then((preview) => {
          if (cancelled || groundingRequestSeqRef.current !== requestSeq) return;
          const cursorStillNearRequest = cursorDistanceSquared(cursorRef.current, requestCursor) < minCursorDeltaSquared;
          const hoveredEntityId = cursorStillNearRequest ? (preview.hoveredEntityId ?? null) : null;
          setCuaEntities(preview.entities);
          setHoveredCuaEntityId(hoveredEntityId);
          const selectedListItems = selectedListItemsForContext(preview.entities);
          if (selectedListItems.length > 0) {
            setSelectedCuaEntities((current) => (current.length === 0 ? selectedListItems : current));
            setDraftCuaEntities([]);
          }
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

  useEffect(() => {
    if (!active || state !== 'composing' || captureActivity.active) {
      setWindowPreview(null);
      windowRequestSeqRef.current += 1;
      return;
    }

    let cancelled = false;
    let inFlight = false;
    let lastRequestedCursor: CursorPayload | null = null;
    const requestSeq = ++windowRequestSeqRef.current;
    const minCursorDeltaSquared = CUA_GROUNDING_MIN_CURSOR_DELTA * CUA_GROUNDING_MIN_CURSOR_DELTA;

    const shouldRequestWindow = (force = false) => {
      if (force || !lastRequestedCursor) return true;
      return cursorDistanceSquared(cursorRef.current, lastRequestedCursor) >= minCursorDeltaSquared;
    };

    const refreshWindow = (force = false) => {
      if (cancelled || inFlight || !shouldRequestWindow(force)) return;
      const requestCursor = cursorRef.current;
      lastRequestedCursor = requestCursor;
      inFlight = true;
      void window.openPointer
        .requestWindowContext({ cursor: requestCursor })
        .then((preview) => {
          if (cancelled || windowRequestSeqRef.current !== requestSeq) return;
          setWindowPreview(preview.status === 'matched' && preview.window ? preview : null);
        })
        .catch(() => {
          if (cancelled || windowRequestSeqRef.current !== requestSeq) return;
          setWindowPreview(null);
        })
        .finally(() => {
          inFlight = false;
          if (!cancelled && cursorDistanceSquared(cursorRef.current, requestCursor) >= minCursorDeltaSquared) {
            refreshWindow();
          }
        });
    };

    refreshWindow(true);
    const interval = window.setInterval(() => refreshWindow(false), 900);
    return () => {
      cancelled = true;
      windowRequestSeqRef.current += 1;
      window.clearInterval(interval);
    };
  }, [active, captureActivity.active, state]);

  // Track submit-time screenshot capture so the pointer can tint while it runs.
  useEffect(() => {
    const off = window.openPointer.onCaptureActivity((payload) => {
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
  const activeBlocks = useMemo(() => groupEventsToBlocks(events), [events]);
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
  const approval = latestEvent(events, 'approval.requested');
  const activeApproval = approval && !settledApprovalIds.has(approval.id) ? approval : undefined;
  const latestFailure = latestEvent(events, 'run.failed');
  const continuableBackend = useMemo(() => resolveContinuableBackend(conversationMeta, backend), [backend, conversationMeta]);
  useEffect(() => {
    if (state === 'completed' || state === 'failed') {
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
    }
  }, [state]);

  useEffect(() => {
    const panel = streamPanelRef.current;
    if (!panel || streamPanelStreamingResponseRef.current || !streamPanelStickToBottomRef.current) return;
    panel.scrollTop = panel.scrollHeight;
  }, [transcript, events.length, historyTurns.length, state, showTools]);

  function onStreamPanelScroll(event: ReactUIEvent<HTMLDivElement>) {
    const panel = event.currentTarget;
    const distanceFromBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight;
    if (streamPanelStreamingResponseRef.current) {
      streamPanelStickToBottomRef.current = false;
      return;
    }
    streamPanelStickToBottomRef.current = distanceFromBottom < 24;
  }

  useEffect(() => {
    if (!panelResizeDrag) return;
    const activeDrag = panelResizeDrag;
    function onMouseMove(event: MouseEvent) {
      const dy = event.clientY - activeDrag.startY;
      const maxH = availablePanelHeight(effectiveShellPos.y, pillHeight);
      const nextHeight = Math.max(120, Math.min(maxH, activeDrag.startHeight + dy));
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
  }, [panelResizeDrag, effectiveShellPos.y, pillHeight]);

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
    const height = resolvedPanelHeight(effectiveShellPos.y, pillHeight, panelHeight);
    return {
      height: `${height}px`,
      maxHeight: `${maxHeight}px`
    };
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
    groundingRequestSeqRef.current += 1;
    setCuaPickerLocked(true);
    setCuaPickerPosition({ left: layout.left, top: layout.top });
    setCuaPickerResizeDrag({
      startX: event.clientX,
      startY: event.clientY,
      startWidth: layout.width,
      startHeight: layout.height
    });
  }

  async function decideApproval(id: string, decision: ApprovalDecision) {
    setSettledApprovalIds((prev) => new Set(prev).add(id));
    setState('streaming');
    await window.openPointer.approveAgentRequest(id, decision);
  }

  async function continueConversation(target: 'terminal' | 'app', targetConversationId = conversationId) {
    if (!targetConversationId) return;
    if (target === 'app') {
      await loadConversation(targetConversationId);
      return;
    }
    setContinueError(null);
    clearBackgroundTerminalError(targetConversationId);
    const targetConversation =
      targetConversationId === conversationMeta?.id
        ? conversationMeta
        : backgroundConversations.find((item) => item.id === targetConversationId) ?? conversationsList.find((item) => item.id === targetConversationId) ?? null;
    const targetContinuableBackend = resolveContinuableBackend(targetConversation, backend);
    try {
      const res = await window.openPointer.continueConversation({
        conversationId: targetConversationId,
        backend: targetContinuableBackend?.backend ?? continuableBackend?.backend ?? backend,
        target
      });
      if (!res.ok) {
        const error = res.error || 'Failed to continue this conversation.';
        if (targetConversationId === conversationIdRef.current) {
          setContinueError(error);
          setEvents([{ type: 'run.failed', error, recoverable: true }]);
          setState('failed');
        } else {
          setBackgroundTerminalErrors((current) => ({ ...current, [targetConversationId]: error }));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to continue this conversation.';
      if (targetConversationId === conversationIdRef.current) {
        setContinueError(message);
        setEvents([{ type: 'run.failed', error: message, recoverable: true }]);
        setState('failed');
      } else {
        setBackgroundTerminalErrors((current) => ({ ...current, [targetConversationId]: message }));
      }
    }
  }

  async function submit(mode: 'text' | 'voice' = 'text', overrideText = prompt) {
    const text = overrideText.trim();
    const submittedCuaEntities = selectedCuaEntities;
    const selectedEntity = submittedCuaEntities[0];
    const hasSelectionContext = Boolean(selection);
    const cuaEnabled = settings?.cuaMode !== 'off';
    const hasCuaContext = submittedCuaEntities.length > 0;
    const submittedContextChips = pinnedContextChips;
    const hasPinnedContext = submittedContextChips.length > 0;
    const submittedWindowContext = windowPreview?.window;
    const submittedWindowPid = windowPreview?.pid;
    const submittedWindowBounds = windowPreview?.bounds;
    const hasWindowContext = Boolean(submittedWindowContext);
    const instructionText = text || defaultContextInstruction(hasSelectionContext, hasCuaContext || hasPinnedContext, hasWindowContext || hasPinnedContext);
    if ((!text && !hasSelectionContext && !hasCuaContext && !hasWindowContext && !hasPinnedContext) || state === 'submitting') return;
    if (!readiness.configured) {
      setEvents([{ type: 'run.failed', error: readiness.detail, recoverable: true }]);
      setState('failed');
      return;
    }
    streamPanelStreamingResponseRef.current = false;
    streamPanelStickToBottomRef.current = true;
    setEvents([]);
    setContinueError(null);
    setState('submitting');
    setMenuOpen(false);

    setThinkingTime(0);
    setSettledApprovalIds(new Set());
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
    setDraftCuaEntities([]);
    setSelectedCuaEntities([]);
    setPinnedContextChips([]);
    setCandidateContextChip(null);
    setDraggingContextChip(null);
    setCuaPickerLocked(false);
    setCuaPickerPosition(null);
    setHoveredCuaEntityId(null);
    setCuaEntities([]);
    // Clear the composer now that the message has been sent, so its text does
    // not linger in the input box after submission.
    setPrompt('');
    try {
      const currentConversationId = conversationIdRef.current;
      const res = await window.openPointer.submitInstruction({
        text: instructionText,
        mode,
        backend,
        cursor,
        targetPath: selectedEntity ? undefined : targetPath,
        selectedEntity,
        windowContext: submittedWindowContext,
        windowPid: submittedWindowPid,
        windowBounds: submittedWindowBounds,
        includeScreenshot: hasSelectionContext,
        includeCua: cuaEnabled,
        cuaEntities: submittedCuaEntities,
        contextChips: submittedContextChips,
        conversationId: currentConversationId ?? undefined
      });
      newConversationRequestedRef.current = false;
      conversationIdRef.current = res.conversationId;
      lastConversationIdRef.current = res.conversationId;
      lastDeactivatedAtRef.current = Date.now();
      setConversationId(res.conversationId);
      const conv = await window.openPointer.getConversation(res.conversationId);
      if (conversationIdRef.current === res.conversationId && conv) {
        setHistoryTurns(conv.turns);
        setConversationMeta(conv);
      }
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
    const next = await window.openPointer.saveSettings({
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
    if (!detached) {
      if (event.button !== 0) return; // Only handle left clicks
      event.preventDefault();
      event.stopPropagation();
      setDetached(true);
      setDetachedPos((current) => current ?? computeShellPosition(cursor.localX, cursor.localY, pillWidth, pillHeight, true));
      window.setTimeout(() => focusPromptInput(inputRef.current), 0);
      return;
    }
    if (!detachedPos) return;
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

  function onPillWidthResizeMouseDown(event: ReactMouseEvent<HTMLDivElement>, side: 'left' | 'right') {
    event.preventDefault();
    event.stopPropagation();
    if (!detachedPos) return;
    setPillWidthDrag({
      side,
      startX: event.clientX,
      startWidth: pillWidth,
      startXPos: detachedPos.x
    });
  }

  function startNewConversation() {
    parkConversationInBackground(conversationIdRef.current);
    conversationRestoreEpochRef.current += 1;
    newConversationRequestedRef.current = true;
    conversationIdRef.current = null;
    lastConversationIdRef.current = null;
    lastDeactivatedAtRef.current = 0;
    window.openPointer.cancelRun();
    if (thinkingTimerRef.current) {
      clearInterval(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    setMenuOpen(false);
    setConversationId(null);
    setHistoryTurns([]);
    setConversationMeta(null);
    setContinueError(null);
    setEvents([]);
    streamPanelStreamingResponseRef.current = false;
    streamPanelStickToBottomRef.current = true;
    setPrompt('');
    setState('composing');
    setSelection(null);
    setSelectionDrag(null);
    setDraftCuaEntities([]);
    setSelectedCuaEntities([]);
    setCuaPickerLocked(false);
    setCuaPickerPosition(null);
    setHoveredCuaEntityId(null);
    setThinkingTime(0);
    setShowTools(false);
    window.setTimeout(() => focusPromptInput(inputRef.current), 0);
  }

  async function loadConversation(id: string) {
    const conv = await window.openPointer.getConversation(id);
    if (conv) {
      removeConversationFromBackground(conv.id);
      conversationRestoreEpochRef.current += 1;
      newConversationRequestedRef.current = false;
      conversationIdRef.current = conv.id;
      lastConversationIdRef.current = conv.id;
      lastDeactivatedAtRef.current = conv.updatedAt;
      setConversationId(conv.id);
      setHistoryTurns(conv.turns);
      setConversationMeta(conv);
      setContinueError(null);
      setEvents([]);
      setPrompt('');
      setPinnedContextChips([]);
      setCandidateContextChip(null);
      setDraggingContextChip(null);
      setActive(true);
      setDetached(true);
      setDetachedPos((current) => current ?? computeShellPosition(cursorRef.current.localX, cursorRef.current.localY, pillWidth, pillHeight, true));
      setState('composing');
      setDraftCuaEntities([]);
      setSelectedCuaEntities([]);
      setCuaPickerLocked(false);
      setCuaPickerPosition(null);
      setHoveredCuaEntityId(null);
      setMenuOpen(false);
      setSettingsOpen(false);
      setHistoryOpen(false);
      window.setTimeout(() => focusPromptInput(inputRef.current), 0);
    }
  }

  async function deleteConversation(id: string) {
    await window.openPointer.deleteConversation(id);
    removeConversationFromBackground(id);
    await refreshConversationsList();
    if (conversationId === id) {
      conversationIdRef.current = null;
      lastConversationIdRef.current = null;
      lastDeactivatedAtRef.current = 0;
      setConversationId(null);
      setHistoryTurns([]);
      setConversationMeta(null);
      setContinueError(null);
    }
  }

  async function handleDeleteConversation(id: string, event: ReactMouseEvent) {
    event.stopPropagation();
    await deleteConversation(id);
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
    setDraftCuaEntities([]);
    setSelectedCuaEntities([]);
    window.setTimeout(() => focusPromptInput(inputRef.current), 0);
  }

  function commitContextChip(chip: ContextChip) {
    setPinnedContextChips((current) => pinContextChip(current, chip));
    setCandidateContextChip(null);
    window.setTimeout(() => focusPromptInput(inputRef.current), 0);
  }

  function beginContextChipDrag(chip: ContextChip, event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setDraggingContextChip({
      chip,
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      overShelf: isPointOverContextShelf(event.clientX, event.clientY)
    });
    setCandidateContextChip(null);
    if (!lastInteractiveRef.current) {
      lastInteractiveRef.current = true;
      window.openPointer.setInteractive(true);
    }
  }

  function isPointOverContextShelf(x: number, y: number): boolean {
    const rect = contextShelfRef.current?.getBoundingClientRect();
    if (!rect) return false;
    return x >= rect.left - 28 && x <= rect.right + 28 && y >= rect.top - 24 && y <= rect.bottom + 24;
  }

  function clearPinnedContextChip(chipId: string) {
    setPinnedContextChips((current) => removeContextChip(current, chipId));
    setHoveredAttachment(null);
    window.setTimeout(() => focusPromptInput(inputRef.current), 0);
  }

  function swapContextTransferChips() {
    setPinnedContextChips((current) => {
      const source = current[0];
      const target = current[1];
      if (!source || !target) return current;
      return [target, source, ...current.slice(2)];
    });
    window.setTimeout(() => focusPromptInput(inputRef.current), 0);
  }

  const highlightedSelectedCuaEntities = draftCuaEntities;

  const selectedEntity = useMemo(() => {
    return selectedCuaEntities[0];
  }, [selectedCuaEntities]);
  const selectedCuaListItems = useMemo(() => selectedListItemsForContext(selectedCuaEntities), [selectedCuaEntities]);
  const pinnedContextChipIds = useMemo(() => new Set(pinnedContextChips.map((chip) => chip.id)), [pinnedContextChips]);
  const showContextRolePreview = pinnedContextChips.length >= 2 && CONTEXT_TRANSFER_PATTERN.test(prompt);
  const sourceContextChip = showContextRolePreview ? pinnedContextChips[0] : undefined;
  const targetContextChip = showContextRolePreview ? pinnedContextChips[1] : undefined;

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
    const byId = new Map<string, PointerEntity>();
    for (const entity of visibleCuaCandidates) byId.set(entity.id, entity);

    const remaining = cuaEntities
      .filter((entity) => entity.groundingRef?.provider === 'cua' && !byId.has(entity.id))
      .sort((a, b) => {
        const aRect = highlightRectForEntity(a);
        const bRect = highlightRectForEntity(b);
        if (aRect && bRect) {
          const distanceDelta =
            distanceToLocalRectSquared(cuaCandidateCursor.localX, cuaCandidateCursor.localY, aRect) -
            distanceToLocalRectSquared(cuaCandidateCursor.localX, cuaCandidateCursor.localY, bRect);
          if (distanceDelta !== 0) return distanceDelta;
          return aRect.width * aRect.height - bRect.width * bRect.height;
        }
        if (aRect) return -1;
        if (bRect) return 1;
        return entityLabel(a).localeCompare(entityLabel(b));
      });

    return [...visibleCuaCandidates, ...remaining];
  }, [cuaCandidateCursor.localX, cuaCandidateCursor.localY, cuaEntities, visibleCuaCandidates]);

  const highlightedCuaCandidates = useMemo(() => {
    if (!cuaPickerLocked) return [];
    const byId = new Map<string, PointerEntity>();
    if (hoveredCuaEntityId) {
      const hovered = [...draftCuaEntities, ...cuaPickerCandidates, ...cuaEntities].find((entity) => entity.id === hoveredCuaEntityId);
      if (hovered && hasPreciseCuaRect(hovered)) byId.set(hovered.id, hovered);
    }
    for (const entity of highlightedSelectedCuaEntities) {
      if (hasPreciseCuaRect(entity)) byId.set(entity.id, entity);
    }
    return [...byId.values()];
  }, [cuaEntities, cuaPickerCandidates, cuaPickerLocked, draftCuaEntities, highlightedSelectedCuaEntities, hoveredCuaEntityId]);

  const debugCuaBoxEntities = useMemo(() => {
    const byId = new Map<string, PointerEntity>();
    for (const entity of visibleCuaCandidates) {
      if (hasPreciseCuaRect(entity)) byId.set(entity.id, entity);
    }
    for (const entity of highlightedCuaCandidates) {
      if (hasPreciseCuaRect(entity)) byId.set(entity.id, entity);
    }
    return [...byId.values()];
  }, [highlightedCuaCandidates, visibleCuaCandidates]);

  const showCuaDebugOverlay =
    active &&
    state === 'composing' &&
    settings?.cuaDebugOverlayEnabled === true &&
    settings?.cuaMode !== 'off' &&
    !selecting &&
    !selectionDrag &&
    !settingsOpen &&
    !historyOpen &&
    !menuOpen &&
    !selection &&
    debugCuaBoxEntities.length > 0;

  const showCuaPicker =
    active &&
    state === 'composing' &&
    settings?.cuaDebugOverlayEnabled === true &&
    settings?.cuaMode !== 'off' &&
    !selecting &&
    !selectionDrag &&
    !settingsOpen &&
    !historyOpen &&
    !menuOpen &&
    !selection &&
    selectedCuaEntities.length === 0 &&
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
  const cursorInsideCuaPicker =
    showCuaPicker &&
    pointInLocalRect(
      cursor.localX,
      cursor.localY,
      { x: cuaPickerLayout.left, y: cuaPickerLayout.top, width: cuaPickerLayout.width, height: cuaPickerLayout.height },
      2
    );
  const cursorInsideCuaDebugBox =
    showCuaDebugOverlay &&
    debugCuaBoxEntities.some((entity) => {
      const rect = highlightRectForEntity(entity);
      return rect ? pointInLocalRect(cursor.localX, cursor.localY, rect, 2) : false;
    });

  const hoveredCuaEntity = useMemo(() => {
    if (!hoveredCuaEntityId) return undefined;
    return [...debugCuaBoxEntities, ...draftCuaEntities, ...cuaPickerCandidates, ...cuaEntities].find((entity) => entity.id === hoveredCuaEntityId);
  }, [cuaEntities, cuaPickerCandidates, debugCuaBoxEntities, draftCuaEntities, hoveredCuaEntityId]);
  const hoveredCuaRect = hoveredCuaEntity ? highlightRectForEntity(hoveredCuaEntity) : undefined;
  const cuaDebugTooltipStyle: CSSProperties | undefined =
    hoveredCuaEntity && hoveredCuaRect
      ? {
          left: clampNumber(hoveredCuaRect.x + hoveredCuaRect.width + 8, 12, Math.max(12, window.innerWidth - 320), 12),
          top: clampNumber(hoveredCuaRect.y, 12, Math.max(12, window.innerHeight - 220), 12)
        }
      : undefined;

  useEffect(() => {
    const shouldHideCandidate =
      !active ||
      state !== 'composing' ||
      captureActivity.active ||
      settingsOpen ||
      historyOpen ||
      menuOpen ||
      selecting ||
      Boolean(selectionDrag) ||
      Boolean(selection) ||
      Boolean(draggingContextChip);

    if (shouldHideCandidate) {
      setCandidateContextChip(null);
      return;
    }

    const candidate = hoveredCuaEntity
      ? contextChipFromEntity(hoveredCuaEntity)
      : windowPreview
        ? contextChipFromWindowPreview(windowPreview)
        : undefined;

    if (!candidate || pinnedContextChipIds.has(candidate.id)) {
      setCandidateContextChip(null);
      return;
    }

    const timer = window.setTimeout(() => {
      setCandidateContextChip(candidate);
    }, CONTEXT_CHIP_HOVER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    active,
    captureActivity.active,
    draggingContextChip,
    historyOpen,
    hoveredCuaEntity,
    menuOpen,
    pinnedContextChipIds,
    selecting,
    selection,
    selectionDrag,
    settingsOpen,
    state,
    windowPreview
  ]);

  useEffect(() => {
    if (!draggingContextChip) return;

    function onMouseMove(event: MouseEvent) {
      const overShelf = isPointOverContextShelf(event.clientX, event.clientY);
      setDraggingContextChip((current) =>
        current
          ? {
              ...current,
              x: event.clientX,
              y: event.clientY,
              overShelf
            }
          : current
      );
    }

    function onMouseUp(event: MouseEvent) {
      const current = draggingContextChipRef.current;
      if (current && isPointOverContextShelf(event.clientX, event.clientY)) {
        commitContextChip(current.chip);
      }
      setDraggingContextChip(null);
      if (!detached) {
        window.setTimeout(() => releaseOverlayPointerCapture(), 0);
      } else {
        window.setTimeout(() => focusPromptInput(inputRef.current), 0);
      }
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [detached, draggingContextChip?.chip.id, releaseOverlayPointerCapture]);

  const lockCuaPickerAtCurrentPosition = useCallback(() => {
    groundingRequestSeqRef.current += 1;
    setCuaPickerAnchor(cursorRef.current);
    setCuaPickerLocked(true);
    setCuaPickerPosition({
      left: cuaPickerLayout.left,
      top: cuaPickerLayout.top
    });
    setHoveredCuaEntityId(null);
  }, [cuaPickerLayout.left, cuaPickerLayout.top]);

  useEffect(() => {
    if (!showCuaPicker || !liveCuaPreview || cuaPickerLocked || cuaPickerCandidates.length === 0) return;
    if (Date.now() < cuaHoverLockSuppressedUntilRef.current) return;
    const hoverStart = cursorRef.current;
    const toleranceSquared = CUA_PICKER_HOVER_LOCK_TOLERANCE * CUA_PICKER_HOVER_LOCK_TOLERANCE;
    const timer = window.setTimeout(() => {
      if (cursorDistanceSquared(cursorRef.current, hoverStart) > toleranceSquared) return;
      lockCuaPickerAtCurrentPosition();
    }, CUA_PICKER_HOVER_LOCK_MS);
    return () => window.clearTimeout(timer);
  }, [cuaPickerCandidates.length, cuaPickerLocked, cursor.localX, cursor.localY, liveCuaPreview, lockCuaPickerAtCurrentPosition, showCuaPicker]);

  useEffect(() => {
    if (!active) {
      cuaPickerInteractiveRef.current = false;
      return;
    }

    const otherCaptureActive =
      menuOpen ||
      backendDropdownOpen ||
      settingsOpen ||
      historyOpen ||
      Boolean(pillDrag) ||
      Boolean(pillWidthDrag) ||
      Boolean(selection) ||
      selecting ||
      Boolean(selectionDrag) ||
      Boolean(panelResizeDrag) ||
      Boolean(cuaPickerResizeDrag) ||
      Boolean(draggingContextChip);

    if (cursorInsideCuaPicker || cursorInsideCuaDebugBox) {
      cuaPickerInteractiveRef.current = true;
      if (!lastInteractiveRef.current) {
        lastInteractiveRef.current = true;
        window.openPointer.setInteractive(true);
      }
      return;
    }

    if (cuaPickerInteractiveRef.current) {
      cuaPickerInteractiveRef.current = false;
      if (!otherCaptureActive && lastInteractiveRef.current) {
        lastInteractiveRef.current = false;
        window.openPointer.setInteractive(false);
      }
    }
  }, [
    active,
    backendDropdownOpen,
    cursorInsideCuaDebugBox,
    cuaPickerResizeDrag,
    cursorInsideCuaPicker,
    historyOpen,
    menuOpen,
    panelResizeDrag,
    pillDrag,
    pillWidthDrag,
    selecting,
    selection,
    selectionDrag,
    draggingContextChip,
    settingsOpen
  ]);



  const glowFillColor = '#0D6FFF';
  const modalOpen = settingsOpen || historyOpen;
  const shellHiddenForContextCapture = selecting || Boolean(selectionDrag) || captureActivity.active;
  const overlayNeedsPointerEvents =
    detached ||
    menuOpen ||
    backendDropdownOpen ||
    modalOpen ||
    Boolean(pillDrag) ||
    Boolean(pillWidthDrag) ||
    Boolean(draggingContextChip) ||
    selecting ||
    Boolean(selection) ||
    Boolean(panelResizeDrag) ||
    Boolean(selectionDrag) ||
    Boolean(cuaPickerResizeDrag);
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
      <CuaTaskPanel
        tasks={cuaTasks}
        theme={settings?.modalTheme ?? 'blue'}
        onCancel={cancelCuaTask}
        onStartRecording={startCuaTaskRecording}
        onStopRecording={stopCuaTaskRecording}
        onReplayRecording={replayCuaTaskRecording}
      />
      <BackgroundProcessDock
        conversations={backgroundConversations}
        corner={settings?.backgroundProcessCorner ?? 'bottom-left'}
        theme={settings?.modalTheme ?? 'blue'}
        terminalErrors={backgroundTerminalErrors}
        onOpen={(id) => void loadConversation(id)}
        onTerminal={(id) => void continueConversation('terminal', id)}
        onDelete={(id) => void deleteConversation(id)}
      />

      {hold?.state === 'holding' && <HoldRing cursor={hold.cursor} progress={hold.progress} />}

      {active && (
        <>
          <CursorTrail x={cursor.localX} y={cursor.localY} enabled={active} color={glowFillColor} />
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

          {candidateContextChip && !draggingContextChip && (
            <div
              className="context-candidate-chip"
              style={{
                left: clampNumber(cursor.localX + 18, 12, Math.max(12, window.innerWidth - 260), 12),
                top: clampNumber(cursor.localY - 18, 12, Math.max(12, window.innerHeight - 54), 12)
              }}
              onMouseDown={(event) => beginContextChipDrag(candidateContextChip, event)}
              title={contextChipTitle(candidateContextChip)}
            >
              <ContextChipGlyph chip={candidateContextChip} />
              <span className="context-candidate-chip-text">
                <span>{candidateContextChip.label}</span>
                {candidateContextChip.subtitle && <small>{candidateContextChip.subtitle}</small>}
              </span>
              <button
                type="button"
                className="context-candidate-chip-add"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  commitContextChip(candidateContextChip);
                }}
                aria-label="Pin context"
                title="Pin context"
              >
                +
              </button>
            </div>
          )}

          {draggingContextChip && (
            <div
              className={`context-chip-ghost${draggingContextChip.overShelf ? ' is-over-shelf' : ''}`}
              style={{
                left: draggingContextChip.x - draggingContextChip.offsetX,
                top: draggingContextChip.y - draggingContextChip.offsetY
              }}
              title={contextChipTitle(draggingContextChip.chip)}
            >
              <ContextChipGlyph chip={draggingContextChip.chip} />
              <span className="context-candidate-chip-text">
                <span>{draggingContextChip.chip.label}</span>
                {draggingContextChip.chip.subtitle && <small>{draggingContextChip.chip.subtitle}</small>}
              </span>
            </div>
          )}

          {showCuaDebugOverlay &&
            debugCuaBoxEntities.map((entity) => {
              const rect = highlightRectForEntity(entity);
              if (!rect) return null;
              const isHovered = hoveredCuaEntityId === entity.id;
              return (
                <div
                  key={entity.id}
                  className={`cua-element-highlight cua-element-candidate${isHovered ? ' is-hovered' : ''}`}
                  style={{
                    left: rect.x,
                    top: rect.y,
                    width: rect.width,
                    height: rect.height
                  }}
                  onMouseEnter={() => setHoveredCuaEntityId(entity.id)}
                  onMouseLeave={() => setHoveredCuaEntityId(null)}
                  title={entityDebugDetails(entity).join('\n')}
                />
              );
            })}

          {showCuaDebugOverlay && hoveredCuaEntity && cuaDebugTooltipStyle && (
            <div className="cua-debug-tooltip" style={cuaDebugTooltipStyle}>
              {entityDebugDetails(hoveredCuaEntity).map((line, index) => (
                <div key={`${hoveredCuaEntity.id}-${index}`} className={index === 0 ? 'cua-debug-tooltip-title' : undefined}>
                  {line}
                </div>
              ))}
            </div>
          )}

          {showCuaPicker && (
            <div className="cua-picker-panel" style={cuaPickerStyle}>
              <div className="cua-picker-header">
                <span>CUA</span>
                <span>{cuaPickerCandidates.length} debug elements</span>
              </div>
              <div className="cua-picker-list">
                {cuaPickerCandidates.map((entity) => {
                  const isHovered = hoveredCuaEntityId === entity.id;
                  const hasRect = hasPreciseCuaRect(entity);
                  return (
                    <div
                      key={entity.id}
                      className={`cua-picker-row${isHovered ? ' is-hovered' : ''}`}
                      onMouseEnter={() => setHoveredCuaEntityId(entity.id)}
                      onMouseLeave={() => setHoveredCuaEntityId(null)}
                      title={entity.text ?? entity.name ?? entity.role ?? entity.kind}
                    >
                      <span className="cua-picker-icon">
                        <EntityKindGlyph kind={entity.kind} size={13} />
                      </span>
                      <span className="cua-picker-main">
                        <span className="cua-picker-label">{entityLabel(entity)}</span>
                        <span className="cua-picker-meta">
                          {entity.role || entity.kind}
                          {hasRect ? ' - rect' : ' - ax'}
                        </span>
                      </span>
                      <span className="cua-picker-kind">{entity.kind}</span>
                    </div>
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
              className={`openpointer-shell absolute left-0 top-0 pointer-events-auto will-change-transform w-[min(var(--pill-width,520px),calc(100vw-32px))] state-${state}${selecting ? ' is-selecting' : ''}`}
              data-pill-theme={settings?.modalTheme ?? 'blue'}
              style={
                {
                  transform: `translate3d(${effectiveShellPos.x}px, ${effectiveShellPos.y}px, 0)`,
                  transition: shouldUseLagFollow ? 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
                  '--pill-width': `${pillWidth}px`,
                  '--pill-height': `${pillHeight}px`
                } as CSSProperties
              }
            >
              {detached && (
                <>
                  <div
                    className="absolute top-0 z-50 cursor-ew-resize select-none flex items-center justify-center group"
                    style={{
                      height: `${pillHeight}px`,
                      width: '14px',
                      left: '-7px'
                    }}
                    onMouseDown={(e) => onPillWidthResizeMouseDown(e, 'left')}
                    title="拖动调整宽度"
                  >
                    <div className="w-1 h-1/2 bg-white/0 group-hover:bg-white/40 rounded-full transition-colors duration-150" />
                  </div>
                  <div
                    className="absolute top-0 right-0 z-50 cursor-ew-resize select-none flex items-center justify-center group"
                    style={{
                      height: `${pillHeight}px`,
                      width: '14px',
                      right: '-7px'
                    }}
                    onMouseDown={(e) => onPillWidthResizeMouseDown(e, 'right')}
                    title="拖动调整宽度"
                  >
                    <div className="w-1 h-1/2 bg-white/0 group-hover:bg-white/40 rounded-full transition-colors duration-150" />
                  </div>
                </>
              )}

              {/* Context attachment preview card */}
              {hoveredAttachment === 'window' && windowPreview?.window && (
                <div
                  className="absolute left-0 z-10 w-[300px] p-3 text-white bg-[rgba(13,111,255,0.85)] backdrop-blur-[6.8px] shadow-[0px_8px_6px_0px_rgba(0,0,0,0.05)] border border-glass-border rounded-[var(--radius-pill)] flex flex-col gap-1.5 pointer-events-none animate-elastic-pop origin-bottom-left"
                  style={{ bottom: `calc(100% + ${previewCardBottom}px)` }}
                >
                  <div className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_2px_3px_3px_-3px_rgba(255,255,255,0.6),inset_0px_-1px_1px_0px_rgba(255,255,255,0.25),inset_0px_1px_1px_0px_rgba(255,255,255,0.25)]" />
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/12 text-white/90">
                        <WindowGlyph size={15} />
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-[12px] font-bold text-white/95 leading-tight">{windowPreviewLabel(windowPreview)}</span>
                        <span className="truncate text-[9px] text-white/60 leading-none">
                          {windowPreview.window.app || windowPreview.window.process || 'Current window'}
                        </span>
                      </div>
                    </div>
                    <span className="rounded-full bg-white/12 px-2 py-0.5 text-[10px] font-bold uppercase text-white/80">{windowPreview.source}</span>
                  </div>
                  <div className="h-px bg-white/12 my-0.5" />
                  <div className="grid gap-1 text-[11px] text-white/[0.84]">
                    {windowPreview.window.title && (
                      <div className="grid grid-cols-[54px_1fr] gap-2">
                        <span className="text-white/50">Title</span>
                        <span className="min-w-0 truncate">{windowPreview.window.title}</span>
                      </div>
                    )}
                    {(windowPreview.window.app || windowPreview.window.process) && (
                      <div className="grid grid-cols-[54px_1fr] gap-2">
                        <span className="text-white/50">App</span>
                        <span className="min-w-0 truncate">{windowPreview.window.app || windowPreview.window.process}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-[54px_1fr] gap-2">
                      <span className="text-white/50">Window</span>
                      <span className="min-w-0 truncate">
                        {windowPreview.windowId || windowPreview.window.windowId || 'unknown'}
                        {windowPreview.pid ? ` / pid ${windowPreview.pid}` : ''}
                      </span>
                    </div>
                    {windowPreview.bounds && (
                      <div className="font-mono text-[9px] text-white/55">
                        Bounds: {Math.round(windowPreview.bounds.width)}x{Math.round(windowPreview.bounds.height)} @ {Math.round(windowPreview.bounds.x)},{' '}
                        {Math.round(windowPreview.bounds.y)}
                      </div>
                    )}
                  </div>
                </div>
              )}

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
                    <span className="inline-flex text-white/90">
                      <EntityKindGlyph kind={selectedEntity.kind} size={16} />
                    </span>
                    <div className="flex flex-col">
                      <span className="text-[12px] font-bold text-white/95 leading-tight">
                        {selectedCuaListItems.length > 1 ? 'Attached selected list items' : entityKindTitle(selectedEntity)}
                      </span>
                      <span className="text-[9px] text-white/60 leading-none">Attached Context</span>
                    </div>
                  </div>
                  <div className="h-px bg-white/12 my-0.5" />
                  <div className="flex flex-col gap-1 text-[11px] text-white/85">
                    {selectedCuaListItems.length > 0 && (
                      <div className="rounded-[var(--radius-pill)] bg-white/5 p-1.5 text-white/85">
                        <div className="mb-1 text-[9px] uppercase text-white/50">{selectedCuaListItems.length} selected list item{selectedCuaListItems.length === 1 ? '' : 's'}</div>
                        <div className="grid gap-0.5">
                          {selectedCuaListItems.slice(0, 5).map((entity) => (
                            <div key={entity.id} className="truncate">
                              {entityLabel(entity)}
                            </div>
                          ))}
                          {selectedCuaListItems.length > 5 && <div className="text-[10px] text-white/50">+{selectedCuaListItems.length - 5} more</div>}
                        </div>
                      </div>
                    )}
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
                  className="backend-dropdown absolute left-0 z-10 animate-dropdown-appear flex flex-row items-end gap-1"
                  style={{ bottom: `calc(100% + ${previewCardBottom}px)` }}
                >
                  {/* Column 1: Main backend list */}
                  <div className="relative min-w-[180px] p-1 border border-glass-border rounded-[var(--radius-pill)] bg-[rgba(13,111,255,0.95)] backdrop-blur-[40px] shadow-[0px_8px_32px_rgba(0,0,0,0.15)] flex flex-col gap-0.5">
                    {/* Inner Shadow Layer */}
                    <div className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_2px_3px_3px_-3px_rgba(255,255,255,0.6),inset_0px_-1px_1px_0px_rgba(255,255,255,0.25),inset_0px_1px_1px_0px_rgba(255,255,255,0.25)]" />
                    {selectableBackends.map((item) => {
                      const isSelected = backend === item;
                      const isClaude = item === 'claude-agent';
                      const isCodex = item === 'codex';
                      const showSubmenu = (isClaude && claudeSubmenuOpen) || (isCodex && codexSubmenuOpen);
                      return (
                        <div key={item} className="relative">
                          <button
                            type="button"
                            className={`flex items-center justify-between w-full py-1.5 px-3 border-0 rounded-[var(--radius-pill)] bg-transparent text-left cursor-pointer transition-colors duration-140 font-semibold text-[11px] relative z-1 ${
                              isSelected ? 'bg-white text-[#0D6FFF] shadow-[0_1.5px_4px_rgba(0,0,0,0.08)]' : 'text-white/80 hover:bg-white/10 hover:text-white'
                            }`}
                            onClick={() => {
                              if (isClaude) {
                                setClaudeSubmenuOpen(!claudeSubmenuOpen);
                                setCodexSubmenuOpen(false);
                              } else if (isCodex) {
                                setCodexSubmenuOpen(!codexSubmenuOpen);
                                setClaudeSubmenuOpen(false);
                              } else {
                                setBackend(item);
                                setBackendDropdownOpen(false);
                                setClaudeSubmenuOpen(false);
                                setCodexSubmenuOpen(false);
                                window.setTimeout(() => focusPromptInput(inputRef.current), 0);
                              }
                            }}
                          >
                            <span className="flex items-center gap-1.5">
                              {getBackendIcon(item, 11)}
                              <span>{backendLabel(item)}</span>
                            </span>
                            <span className="flex items-center gap-1">
                              {isSelected && <span className="text-[9px] font-bold">✓</span>}
                              {(isClaude || isCodex) && <ChevronIcon size={6} isOpen={showSubmenu} />}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Column 2: Model sub-panel (shown when Claude submenu is open) */}
                  {claudeSubmenuOpen && (
                    <div className="relative min-w-[110px] p-1 border border-glass-border rounded-[var(--radius-pill)] bg-[rgba(13,111,255,0.95)] backdrop-blur-[40px] shadow-[0px_8px_32px_rgba(0,0,0,0.15)] flex flex-col gap-0.5 animate-dropdown-appear">
                      <div className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_2px_3px_3px_-3px_rgba(255,255,255,0.6),inset_0px_-1px_1px_0px_rgba(255,255,255,0.25),inset_0px_1px_1px_0px_rgba(255,255,255,0.25)]" />
                      <div className="text-[9px] text-white/50 uppercase tracking-wider px-3 pt-1.5 pb-0.5">Model</div>
                      {['', 'sonnet', 'opus', 'haiku'].map((model) => (
                        <button
                          key={model || 'default'}
                          type="button"
                          className={`w-full text-left py-1.5 px-3 border-0 rounded-[var(--radius-pill)] text-[11px] font-semibold cursor-pointer transition-colors ${
                            (settings?.claudeAgentModel || '') === model
                              ? 'bg-white text-[#0D6FFF] shadow-[0_1.5px_4px_rgba(0,0,0,0.08)]'
                              : 'bg-transparent text-white/80 hover:bg-white/10 hover:text-white'
                          }`}
                          onClick={async (e) => {
                            e.stopPropagation();
                            const next = await window.openPointer.saveSettings({ ...settings!, claudeAgentModel: model });
                            setSettings(next);
                            setBackend('claude-agent');
                            setClaudeSubmenuOpen(false);
                            setBackendDropdownOpen(false);
                            window.setTimeout(() => focusPromptInput(inputRef.current), 0);
                          }}
                        >
                          {model || 'Default'}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Column 3: Effort sub-panel (shown when Claude submenu is open) */}
                  {claudeSubmenuOpen && (
                    <div className="relative min-w-[100px] p-1 border border-glass-border rounded-[var(--radius-pill)] bg-[rgba(13,111,255,0.95)] backdrop-blur-[40px] shadow-[0px_8px_32px_rgba(0,0,0,0.15)] flex flex-col gap-0.5 animate-dropdown-appear">
                      <div className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_2px_3px_3px_-3px_rgba(255,255,255,0.6),inset_0px_-1px_1px_0px_rgba(255,255,255,0.25),inset_0px_1px_1px_0px_rgba(255,255,255,0.25)]" />
                      <div className="text-[9px] text-white/50 uppercase tracking-wider px-3 pt-1.5 pb-0.5">Effort</div>
                      {(['low', 'medium', 'high', 'max'] as const).map((effort) => (
                        <button
                          key={effort}
                          type="button"
                          className={`w-full text-left py-1.5 px-3 border-0 rounded-[var(--radius-pill)] text-[11px] font-semibold cursor-pointer transition-colors ${
                            (settings?.claudeAgentEffort || 'high') === effort
                              ? 'bg-white text-[#0D6FFF] shadow-[0_1.5px_4px_rgba(0,0,0,0.08)]'
                              : 'bg-transparent text-white/80 hover:bg-white/10 hover:text-white'
                          }`}
                          onClick={async (e) => {
                            e.stopPropagation();
                            const next = await window.openPointer.saveSettings({ ...settings!, claudeAgentEffort: effort });
                            setSettings(next);
                          }}
                        >
                          {effort.charAt(0).toUpperCase() + effort.slice(1)}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Codex model sub-panel */}
                  {codexSubmenuOpen && (
                    <div className="relative min-w-[118px] p-1 border border-glass-border rounded-[var(--radius-pill)] bg-[rgba(13,111,255,0.95)] backdrop-blur-[40px] shadow-[0px_8px_32px_rgba(0,0,0,0.15)] flex flex-col gap-0.5 animate-dropdown-appear">
                      <div className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_2px_3px_3px_-3px_rgba(255,255,255,0.6),inset_0px_-1px_1px_0px_rgba(255,255,255,0.25),inset_0px_1px_1px_0px_rgba(255,255,255,0.25)]" />
                      <div className="text-[9px] text-white/50 uppercase tracking-wider px-3 pt-1.5 pb-0.5">Model</div>
                      {['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'].map((model) => (
                        <button
                          key={model}
                          type="button"
                          className={`w-full text-left py-1.5 px-3 border-0 rounded-[var(--radius-pill)] text-[11px] font-semibold cursor-pointer transition-colors ${
                            (settings?.codexModel || 'gpt-5.5') === model
                              ? 'bg-white text-[#0D6FFF] shadow-[0_1.5px_4px_rgba(0,0,0,0.08)]'
                              : 'bg-transparent text-white/80 hover:bg-white/10 hover:text-white'
                          }`}
                          onClick={async (e) => {
                            e.stopPropagation();
                            const next = await window.openPointer.saveSettings({ ...settings!, codexModel: model });
                            setSettings(next);
                            setBackend('codex');
                            setCodexSubmenuOpen(false);
                            setBackendDropdownOpen(false);
                            window.setTimeout(() => focusPromptInput(inputRef.current), 0);
                          }}
                        >
                          {model}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Codex effort sub-panel */}
                  {codexSubmenuOpen && (
                    <div className="relative min-w-[100px] p-1 border border-glass-border rounded-[var(--radius-pill)] bg-[rgba(13,111,255,0.95)] backdrop-blur-[40px] shadow-[0px_8px_32px_rgba(0,0,0,0.15)] flex flex-col gap-0.5 animate-dropdown-appear">
                      <div className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_2px_3px_3px_-3px_rgba(255,255,255,0.6),inset_0px_-1px_1px_0px_rgba(255,255,255,0.25),inset_0px_1px_1px_0px_rgba(255,255,255,0.25)]" />
                      <div className="text-[9px] text-white/50 uppercase tracking-wider px-3 pt-1.5 pb-0.5">Effort</div>
                      {(['low', 'medium', 'high', 'max'] as const).map((effort) => (
                        <button
                          key={effort}
                          type="button"
                          className={`w-full text-left py-1.5 px-3 border-0 rounded-[var(--radius-pill)] text-[11px] font-semibold cursor-pointer transition-colors ${
                            (settings?.codexEffort || 'low') === effort
                              ? 'bg-white text-[#0D6FFF] shadow-[0_1.5px_4px_rgba(0,0,0,0.08)]'
                              : 'bg-transparent text-white/80 hover:bg-white/10 hover:text-white'
                          }`}
                          onClick={async (e) => {
                            e.stopPropagation();
                            const next = await window.openPointer.saveSettings({ ...settings!, codexEffort: effort });
                            setSettings(next);
                          }}
                        >
                          {effort.charAt(0).toUpperCase() + effort.slice(1)}
                        </button>
                      ))}
                    </div>
                  )}
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

                {showContextRolePreview && (
                  <div className="context-role-preview">
                    <span>From</span>
                    <strong>{sourceContextChip?.label}</strong>
                    {sourceContextChip && (
                      <button
                        type="button"
                        className="context-role-preview-button"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          clearPinnedContextChip(sourceContextChip.id);
                        }}
                        aria-label={`Remove ${sourceContextChip.label}`}
                        title="Remove source"
                      >
                        x
                      </button>
                    )}
                    <button
                      type="button"
                      className="context-role-preview-button"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        swapContextTransferChips();
                      }}
                      aria-label="Swap source and target"
                      title="Swap source and target"
                    >
                      {'<>'}
                    </button>
                    <span>To</span>
                    <strong>{targetContextChip?.label}</strong>
                    {targetContextChip && (
                      <button
                        type="button"
                        className="context-role-preview-button"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          clearPinnedContextChip(targetContextChip.id);
                        }}
                        aria-label={`Remove ${targetContextChip.label}`}
                        title="Remove target"
                      >
                        x
                      </button>
                    )}
                  </div>
                )}

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
                  {(pinnedContextChips.length > 0 || draggingContextChip) && (
                    <div
                      ref={contextShelfRef}
                      className={`context-chip-shelf${draggingContextChip?.overShelf ? ' is-drop-target' : ''}${pinnedContextChips.length === 0 ? ' is-empty' : ''}`}
                    >
                      {pinnedContextChips.length === 0 && <span className="context-chip-shelf-empty">Drop context</span>}
                      {pinnedContextChips.map((chip) => (
                        <div key={chip.id} className="context-chip-token" title={contextChipTitle(chip)}>
                          <ContextChipGlyph chip={chip} />
                          <span className="context-chip-token-label">{chip.label}</span>
                          <button
                            type="button"
                            className="context-chip-token-remove"
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              clearPinnedContextChip(chip.id);
                            }}
                            aria-label={`Remove ${chip.label}`}
                            title="Remove context"
                          >
                            x
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Context Attachments Indicators */}
                  {(windowPreview?.window || selection || selectedCuaEntities.length > 0) && (
                    <div className="flex items-center gap-1.5 shrink-0 select-none">
                      {windowPreview?.window && (
                        <div
                          className="group relative flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-all duration-150 cursor-default animate-elastic-pop"
                          style={{
                            width: `${Math.max(20, Math.min(28, pillHeight - 8))}px`,
                            height: `${Math.max(20, Math.min(28, pillHeight - 8))}px`
                          }}
                          onMouseEnter={() => setHoveredAttachment('window')}
                          onMouseLeave={() => setHoveredAttachment(null)}
                          title={`Window: ${windowPreviewLabel(windowPreview) ?? 'Current window'}`}
                        >
                          <WindowGlyph size={Math.max(12, Math.min(15, pillHeight - 12))} />
                        </div>
                      )}

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
                            setDraftCuaEntities([]);
                            setSelectedCuaEntities([]);
                            setCuaEntities([]);
                            setCuaPickerLocked(false);
                            setCuaPickerPosition(null);
                            setHoveredAttachment(null);
                          }}
                          onMouseEnter={() => setHoveredAttachment('entity')}
                          onMouseLeave={() => setHoveredAttachment(null)}
                          title={selectedCuaAttachmentTitle(selectedCuaEntities)}
                        >
                          <span
                            className="group-hover:hidden flex items-center justify-center text-white/90"
                          >
                            <EntityKindGlyph kind={selectedEntity.kind} size={Math.max(11, Math.min(14, pillHeight - 12))} />
                          </span>
                          {selectedCuaListItems.length > 1 && (
                            <span className="pointer-events-none absolute -right-1 -top-1 flex min-w-[14px] items-center justify-center rounded-full bg-white px-1 text-[8px] font-black leading-[14px] text-[#0D6FFF] shadow-[0_1px_4px_rgba(0,0,0,0.18)]">
                              {selectedCuaListItems.length}
                            </span>
                          )}
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
                        window.openPointer.cancelRun();
                        window.openPointer.deactivate({ startNewConversationOnNextActivate: true });
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
                    <div
                      className="capsule-stream-panel scrollbar-capsule px-4 pb-5 pt-3"
                      style={streamPanelStyle}
                      ref={streamPanelRef}
                      onScroll={onStreamPanelScroll}
                    >
                      <div className="flex justify-between gap-2.5 text-white/50 text-[11px] font-semibold uppercase tracking-[0.02em]">
                        <span>{backendLabel(backend)}</span>
                        <span>{statusLabel(state)}</span>
                      </div>
                      <div className="flex flex-col gap-4 mt-2.5 w-full">
                        {historyTurns.map((turn, index) => {
                          const showContinueActions = turn.role === 'assistant' && index === historyTurns.length - 1 && Boolean(continuableBackend);
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
                            if (turn.events && turn.events.length > 0) {
                              return (
                                <div key={turn.id} className="flex flex-col w-full items-start">
                                  <DialogueBlocksRenderer blocks={groupEventsToBlocks(turn.events)} />
                                  {showContinueActions && (
                                    <ConversationContinueActions
                                      backend={continuableBackend!.backend}
                                      error={continueError}
                                      continueConversation={(target) => void continueConversation(target)}
                                    />
                                  )}
                                </div>
                              );
                            }
                            return (
                              <div key={turn.id} className="flex flex-col w-full items-start">
                                <HistoryThinkingBlock thinkingTime={turn.thinkingTime} toolEvents={turn.toolEvents} />
                                <article className="agent-text text-sm markdown-body w-full">
                                  <MarkdownRenderer value={turn.text} />
                                </article>
                                {showContinueActions && (
                                  <ConversationContinueActions
                                    backend={continuableBackend!.backend}
                                    error={continueError}
                                    continueConversation={(target) => void continueConversation(target)}
                                  />
                                )}
                              </div>
                            );
                          }
                        })}

                        {/* Active turn streaming/thinking */}
                        {((historyTurns.length === 0 && (state === 'submitting' || state === 'streaming' || state === 'approval')) ||
                          (historyTurns.length > 0 && historyTurns[historyTurns.length - 1]?.role === 'user')) && (
                          <div className="flex flex-col w-full items-start gap-3">
                            {/* Typing Dots when submitting and no events are present yet */}
                            {state === 'submitting' && activeBlocks.length === 0 && (
                              <div className="flex items-center gap-1 py-2 pl-1 select-none animate-fade-in">
                                <span className="block h-1.5 w-1.5 rounded-full bg-white/40 animate-pulse-scale" style={{ animationDelay: '0ms' }} />
                                <span className="block h-1.5 w-1.5 rounded-full bg-white/40 animate-pulse-scale" style={{ animationDelay: '150ms' }} />
                                <span className="block h-1.5 w-1.5 rounded-full bg-white/40 animate-pulse-scale" style={{ animationDelay: '300ms' }} />
                              </div>
                            )}

                            {/* Render interspersed blocks directly in conversation flow! */}
                            <DialogueBlocksRenderer blocks={activeBlocks} />

                            {/* Other active states */}
                            {activeApproval && (
                              <div className="approval-box mt-3 w-full border border-yellow-500/30 bg-yellow-500/10 rounded-[14px] p-3 flex items-start gap-2.5 shadow-[0_8px_16px_rgba(0,0,0,0.12)] animate-fade-in">
                                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-yellow-500/20 text-yellow-400 mt-0.5">
                                  <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none">
                                    <path
                                      d="M7 1.5c-3 0-5.5 2.5-5.5 5.5S4 12.5 7 12.5s5.5-2.5 5.5-5.5c0-1.4-.5-2.7-1.4-3.7"
                                      stroke="currentColor"
                                      strokeWidth="1.4"
                                      strokeLinecap="round"
                                    />
                                    <path d="M7 5v3M7 10v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                                  </svg>
                                </span>
                                <div className="flex-1 min-w-0">
                                  <strong className="text-white text-[12.5px] font-semibold block leading-snug">
                                    {activeApproval.tool ?? 'Agent'} <span className="text-white/60 font-normal">请求权限</span>
                                  </strong>
                                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-white/70 font-medium line-clamp-3" title={activeApproval.reason}>
                                    {activeApproval.reason}
                                  </p>
                                  <div className="flex items-center gap-1.5 mt-2.5">
                                    <button
                                      className="px-2.5 py-1 text-[11px] font-bold rounded-full border border-emerald-400/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 active:scale-95 transition-all duration-100 cursor-pointer"
                                      onClick={() => void decideApproval(activeApproval.id, 'approve')}
                                    >
                                      允许
                                    </button>
                                    <button
                                      className="px-2.5 py-1 text-[11px] font-bold rounded-full border border-rose-400/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 active:scale-95 transition-all duration-100 cursor-pointer"
                                      onClick={() => void decideApproval(activeApproval.id, 'deny')}
                                    >
                                      拒绝
                                    </button>
                                    <button
                                      className="px-2.5 py-1 text-[11px] font-bold rounded-full border border-white/12 bg-white/8 text-white/80 hover:bg-white/15 active:scale-95 transition-all duration-100 cursor-pointer"
                                      onClick={() => void decideApproval(activeApproval.id, 'always_allow')}
                                    >
                                      总是允许
                                    </button>
                                  </div>
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
              <button className="bubble-dropdown-item" onClick={startNewConversation}>
                <span className="bubble-dropdown-icon">N</span>
                New Conversation
              </button>
              <button
                className="bubble-dropdown-item"
                onClick={() => {
                  setMenuOpen(false);
                  setHistoryOpen(true);
                  void refreshConversationsList();
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

function ContextChipGlyph({ chip }: { chip: ContextChip }) {
  if (chip.kind === 'window') return <WindowGlyph size={13} />;
  if (chip.kind === 'entity') return <EntityKindGlyph kind={chip.entityRefs?.[0]?.kind ?? 'unknown'} size={13} />;
  return <span className="context-chip-glyph-fallback">{chip.kind === 'selection' ? 'T' : 'R'}</span>;
}

function ConversationContinueActions({
  backend,
  error,
  continueConversation
}: {
  backend: AgentBackendId;
  error: string | null;
  continueConversation: (target: 'terminal' | 'app') => void;
}) {
  return (
    <div className="mt-3 flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-[11px] font-bold text-white/82 transition-all duration-150 hover:bg-white/14 active:scale-95"
          title={`Resume this ${backendLabel(backend)} session in a terminal`}
          onClick={() => continueConversation('terminal')}
        >
          Continue in Terminal
        </button>
        <button
          type="button"
          className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-bold text-white/60 transition-all duration-150 hover:bg-white/10 active:scale-95"
          title={`Try to resume this ${backendLabel(backend)} session in its app`}
          onClick={() => continueConversation('app')}
        >
          Continue in App
        </button>
      </div>
      {error && <p className="m-0 max-w-full text-[11.5px] font-semibold leading-snug text-danger">{error}</p>}
    </div>
  );
}
