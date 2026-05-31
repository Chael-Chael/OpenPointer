import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { clampNumber, estimateTextTokens, type AgentBackendId, type AgentEvent, type PointerEntity } from '@openmagicpointer/core';
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
import {
  backendLabel,
  backendReadiness,
  isToolEvent,
  latestEvent,
  placeholderForState,
  secretConfigured,
  statusLabel
} from './lib/backend-status';
import {
  availablePanelHeight,
  computeShellPosition,
  focusPromptInput,
  normalizeSelection,
  selectionFromDrag
} from './lib/geometry';
import { HoldRing, ToolRows } from './components/fields';
import { SettingsPanel } from './components/SettingsPanel';
import { HistoryPanel } from './components/HistoryPanel';

const initialCursor: CursorPayload = { x: 300, y: 300, localX: 300, localY: 300, displayId: 0, dpr: 1 };

const ImageIcon = () => (
  <svg className="w-3.5 h-3.5 text-white/90 animate-elastic-pop" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
  </svg>
);

const TargetIcon = () => (
  <svg className="w-3.5 h-3.5 text-white/90 animate-elastic-pop" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m0 0a7.5 7.5 0 100 15 7.5 7.5 0 000-15zm0 0V2.25m0 4.5V3" />
  </svg>
);

export function App() {
  const [cursor, setCursor] = useState<CursorPayload>(initialCursor);
  const [hold, setHold] = useState<HoldProgressPayload | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const pillWidth = clampNumber(settings?.pillWidth, 280, 900, 520);
  const pillHeight = clampNumber(settings?.pillHeight, 24, 96, 30);

  // Dynamic sizing responsive to pillHeight
  const menuSize = Math.max(20, Math.min(32, pillHeight - 6));
  const progressSize = Math.max(16, Math.min(28, pillHeight - 8));
  const inputFontSize = Math.max(12, Math.min(14, pillHeight - 12));
  const gap = Math.max(8, Math.min(24, pillHeight - 12));
  const padY = Math.max(2, Math.min(8, (pillHeight - menuSize) / 2));
  const padXRight = Math.max(8, Math.min(12, pillHeight / 3));
  const padXLeft = Math.max(12, Math.min(24, pillHeight / 1.5));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [secretDrafts, setSecretDrafts] = useState<SecretDrafts>(emptySecretDrafts);
  const [clearSecrets, setClearSecrets] = useState<ClearSecretFlags>(emptyClearSecretFlags);
  const [active, setActive] = useState(false);
  const [state, setState] = useState<UiState>('idle');
  const [prompt, setPrompt] = useState('');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [backend, setBackend] = useState<AgentBackendId>('auto');
  const [menuOpen, setMenuOpen] = useState(false);
  const [detached, setDetached] = useState(false);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [detachedPos, setDetachedPos] = useState<{ x: number; y: number } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectionOrigin, setSelectionOrigin] = useState<{ x: number; y: number } | null>(null);
  const [selectionDrag, setSelectionDrag] = useState<SelectionDrag | null>(null);
  const [cuaEntities, setCuaEntities] = useState<PointerEntity[]>([]);
  const [hoveredCuaEntityId, setHoveredCuaEntityId] = useState<string | null>(null);
  const [selectedCuaEntityId, setSelectedCuaEntityId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  conversationIdRef.current = conversationId;
  const lastConversationIdRef = useRef<string | null>(null);
  const lastDeactivatedAtRef = useRef<number>(0);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const [panelResizeDrag, setPanelResizeDrag] = useState<{ startY: number; startHeight: number } | null>(null);
  const [thinkingTime, setThinkingTime] = useState<number>(0);
  const [showTools, setShowTools] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState(false);
  const [selectionImg, setSelectionImg] = useState<string | null>(null);
  const selectionRef = useRef<SelectionRect | null>(null);
  selectionRef.current = selection;

  const updateSelectionImage = useRef((rect: SelectionRect | null) => {
    if (!rect) {
      setSelectionImg(null);
      return;
    }
    const width = Math.abs(rect.x2 - rect.x1);
    const height = Math.abs(rect.y2 - rect.y1);
    if (width <= 0 || height <= 0) {
      setSelectionImg(null);
      return;
    }
    window.openMagicPointer.captureRegion({
      x1: rect.x1,
      y1: rect.y1,
      x2: rect.x2,
      y2: rect.y2
    }).then((imgBase64) => {
      setSelectionImg(imgBase64 || null);
    }).catch(() => {
      setSelectionImg(null);
    });
  });

  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkingStartRef = useRef<number>(0);
  const streamPanelRef = useRef<HTMLDivElement | null>(null);
  const lastGroundingPointRef = useRef<{ x: number; y: number } | null>(null);
  const refocusReceivedRef = useRef(false);
  // Submit-time screenshot signal from the main process (see CaptureActivity IPC).
  const [captureActivity, setCaptureActivity] = useState<{ active: boolean; withCua: boolean }>({ active: false, withCua: false });
  const [historyTurns, setHistoryTurns] = useState<import('@openmagicpointer/core').ChatTurn[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversationsList, setConversationsList] = useState<import('@openmagicpointer/core').Conversation[]>([]);
  const [pillDrag, setPillDrag] = useState<{ startX: number; startY: number; initialPos: { x: number; y: number } } | null>(null);

  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);

  const estimatedUsedTokens = useMemo(() => {
    let tokens = 0;
    for (const turn of historyTurns) {
      tokens += estimateTextTokens(turn.text);
      if (turn.pointerContext?.visual?.imageBase64) {
        tokens += 1000;
      }
    }
    tokens += estimateTextTokens(prompt);
    if (selection || selectedCuaEntityId) {
      tokens += 1000;
    }
    return tokens;
  }, [historyTurns, prompt, selection, selectedCuaEntityId]);

  const contextLimit = settings?.localVlmContextWindow ?? 32768;
  const remainingFraction = Math.max(0, (contextLimit - estimatedUsedTokens) / contextLimit);
  
  let ringColor = '#30a14e'; // Green
  if (remainingFraction < 0.2) {
    ringColor = '#e5383b'; // Red
  } else if (remainingFraction < 0.5) {
    ringColor = '#b8860b'; // Amber
  }

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
        if (activeRef.current) {
          // Second long-press while popup is open → start rectangle selection
          const origin = { x: payload.cursor.localX, y: payload.cursor.localY };
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
      setActive(true);
      window.openMagicPointer.getSettings().then(async (currentSettings) => {
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
        
        if (shouldRestore && restoreId) {
          setConversationId(restoreId);
          const conv = await window.openMagicPointer.getConversation(restoreId);
          if (conv) {
            setHistoryTurns(conv.turns);
          }
        } else {
          setConversationId(null);
          setHistoryTurns([]);
        }
      });

      setState('composing');
      window.setTimeout(() => focusPromptInput(inputRef.current), 0);
    });
    const offRefocus = window.openMagicPointer.onRefocusInput(() => {
      refocusReceivedRef.current = true;
      focusPromptInput(inputRef.current);
    });
    const offDeactivate = window.openMagicPointer.onDeactivate(() => {
      if (conversationIdRef.current) {
        lastConversationIdRef.current = conversationIdRef.current;
        lastDeactivatedAtRef.current = Date.now();
      }
      setActive(false);
      refocusReceivedRef.current = false;
      setState('idle');
      setPrompt('');
      setEvents([]);
      setHold(null);
      setMenuOpen(false);
      setConversationId(null);
      setHistoryTurns([]);
      setHistoryOpen(false);
      setDetached(false);
      setSelection(null);
      setSelectionImg(null);
      setCuaEntities([]);
      setHoveredCuaEntityId(null);
      setSelectedCuaEntityId(null);
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
      if (event.type === 'run.started' || event.type === 'assistant.delta' || event.type === 'tool.started' || event.type === 'tool.completed') setState('streaming');
      if (event.type === 'approval.requested') setState('approval');
      if (event.type === 'run.completed') setState('completed');
      if (event.type === 'run.failed') setState('failed');
    });
    window.openMagicPointer.ready();
    return () => {
      offCursor();
      offHold();
      offActivate();
      offRefocus();
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
      window.openMagicPointer.getConversation(conversationId)
        .then(conv => {
          if (!cancelled && conv) setHistoryTurns(conv.turns);
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
    // On initial activation, don't reset the interactive state. The main
    // process explicitly calls setIgnoreMouseEvents(false) during activate(),
    // and sending setInteractive(false) here would immediately undo that,
    // breaking keyboard focus.  Only start managing the state after the
    // delayed RefocusInput signal has arrived.
    let lastInteractive = false;

    // We want to force interactive mode if dragging/selecting/detached etc.
    const forceInteractive = active && (detached || menuOpen || settingsOpen || historyOpen || Boolean(selection) || selecting || Boolean(selectionDrag) || Boolean(panelResizeDrag));

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
      if (shouldCapture !== lastInteractive) {
        lastInteractive = shouldCapture;
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
    
    // Set initial state
    updateInteractive(forceInteractive);

    return () => {
      window.removeEventListener('mouseover', onMouseOver);
      window.removeEventListener('mouseout', onMouseOut);
    };
  }, [active, detached, menuOpen, settingsOpen, historyOpen, selection, selecting, selectionDrag, panelResizeDrag]);

  // Esc = deactivate; Right-click = toggle detach/reattach or cancel local selection.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setSettingsOpen(false);
      window.openMagicPointer.cancelRun();
      window.openMagicPointer.deactivate();
      /*
          if (d) {
            // Reattach — resume following
            setDetachedPos(null);
            setSelection(null);
            return false;
          }
          // Detach — freeze shell position
          const c = cursorRef.current;
          setDetachedPos(computeShellPosition(c.localX, c.localY));
          return true;
        */
    }
    function onContextMenu(event: MouseEvent) {
      event.preventDefault();
      if (menuOpen) { setMenuOpen(false); return; }
      if (selecting || selectionDrag) {
        setSelecting(false);
        setSelectionOrigin(null);
        setSelectionDrag(null);
        setDetachedPos(null);
        window.setTimeout(() => focusPromptInput(inputRef.current), 0);
        return;
      }
      if (!active) return;
      // Right-click only enters non-follow (detached) mode from follow mode.
      // Once detached, right-click is disabled. Re-entering follow mode (via Esc)
      // disables right-click again.
      if (detached) return;
      const c = cursorRef.current;
      setDetachedPos(computeShellPosition(c.localX, c.localY));
      setDetached(true);
    }
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
    };
  }, [active, detached, menuOpen, selecting, selectionDrag]);

  // Live-update selection rectangle while selecting (cursor comes via IPC)
  useEffect(() => {
    if (!selecting || !selectionOrigin) return;
    setSelection(normalizeSelection({
      x1: Math.min(selectionOrigin.x, cursor.localX),
      y1: Math.min(selectionOrigin.y, cursor.localY),
      x2: Math.max(selectionOrigin.x, cursor.localX),
      y2: Math.max(selectionOrigin.y, cursor.localY),
    }));
  }, [selecting, selectionOrigin, cursor.localX, cursor.localY]);

  // End selection on mouseup → return to composing (following mode)
  useEffect(() => {
    if (!selecting) return;
    function onMouseUp() {
      setSelecting(false);
      setSelectionOrigin(null);
      setDetachedPos(null); // Unfreeze shell, resume following
      // selection rect stays visible until submit or dismissed
      if (selectionRef.current) {
        updateSelectionImage.current(selectionRef.current);
      }
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
      if (selectionRef.current) {
        updateSelectionImage.current(selectionRef.current);
      }
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
    // Only re-focus after the initial RefocusInput signal has arrived,
    // to avoid racing with the main process's activation sequence.
    if (refocusReceivedRef.current && state === 'composing' && active && !selecting && !selectionDrag && !settingsOpen) {
      const requestId = window.requestAnimationFrame(() => focusPromptInput(inputRef.current));
      return () => window.cancelAnimationFrame(requestId);
    }
  }, [active, selecting, selectionDrag, settingsOpen, state]);

  useEffect(() => {
    if (!active || settings?.cuaMode === 'off' || selecting || selectionDrag || settingsOpen || selection || selectedCuaEntityId) {
      if (!selectedCuaEntityId) {
        setCuaEntities([]);
        setHoveredCuaEntityId(null);
        lastGroundingPointRef.current = null;
      }
      return;
    }
    // Settle-based throttle: only ground after the cursor has been still for
    // GROUNDING_SETTLE_MS, and skip re-grounding when it barely moved since the
    // last successful preview (dead zone). This avoids hammering CUA on every
    // pixel of cursor movement.
    const GROUNDING_SETTLE_MS = 350;
    const GROUNDING_MOVE_DEADZONE_PX = 24;
    const last = lastGroundingPointRef.current;
    if (last && Math.hypot(cursor.localX - last.x, cursor.localY - last.y) < GROUNDING_MOVE_DEADZONE_PX) {
      return;
    }
    const timer = window.setTimeout(() => {
      const point = { x: cursorRef.current.localX, y: cursorRef.current.localY };
      void window.openMagicPointer.requestGrounding({ cursor: cursorRef.current }).then((preview) => {
        lastGroundingPointRef.current = point;
        setCuaEntities(preview.entities);
        setHoveredCuaEntityId(preview.hoveredEntityId ?? null);
      }).catch(() => {
        lastGroundingPointRef.current = null;
        setCuaEntities([]);
        setHoveredCuaEntityId(null);
      });
    }, GROUNDING_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [active, cursor.localX, cursor.localY, selecting, selectionDrag, settings?.cuaMode, settingsOpen, selection, selectedCuaEntityId]);

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

  const hasPanel = state !== 'composing' || historyTurns.length > 0 || Boolean(conversationId);
  const shellPosition = useMemo(
    () => computeShellPosition(cursor.localX, cursor.localY, pillWidth, pillHeight, hasPanel),
    [cursor.localX, cursor.localY, pillWidth, pillHeight, hasPanel]
  );
  const effectiveShellPos = detachedPos ?? shellPosition;
  const shouldUseLagFollow = active && !detachedPos && !pillDrag && !panelResizeDrag && !selecting && !selectionDrag;
  const transcript = useMemo(() => events.filter((event) => event.type === 'assistant.delta').map((event) => event.text).join(''), [events]);
  const readiness = useMemo(() => backendReadiness(settings, backend), [backend, settings]);
  const draftAwareSettings = useMemo(() => settings
    ? {
        ...settings,
        hasLocalVlmApiKey: secretConfigured(settings.hasLocalVlmApiKey, secretDrafts.localVlmApiKey, clearSecrets.localVlmApiKey),
        hasHermesApiKey: secretConfigured(settings.hasHermesApiKey, secretDrafts.hermesApiKey, clearSecrets.hermesApiKey),
        hasOpenCodeApiKey: secretConfigured(settings.hasOpenCodeApiKey, secretDrafts.opencodeApiKey, clearSecrets.opencodeApiKey),
        hasClaudeAgentApiKey: secretConfigured(settings.hasClaudeAgentApiKey, secretDrafts.claudeAgentApiKey, clearSecrets.claudeAgentApiKey),
        hasCodexApiKey: secretConfigured(settings.hasCodexApiKey, secretDrafts.codexApiKey, clearSecrets.codexApiKey)
      }
    : null, [clearSecrets, secretDrafts, settings]);
  const discovery = latestEvent(events, 'tool.discovery');
  const approval = latestEvent(events, 'approval.requested');
  const latestFailure = latestEvent(events, 'run.failed');
  const toolEvents = useMemo(() => events.filter(isToolEvent), [events]);

  // Capability indicators — only show when detected via tool.discovery
  const capabilities = useMemo(() => {
    if (!discovery) return { hasSkills: false, hasMcp: false, hasCua: false };
    return {
      hasSkills: discovery.skills.length > 0,
      hasMcp: discovery.tools.some((t) => t.includes('mcp')),
      hasCua: Boolean(settings?.cuaMode && settings.cuaMode !== 'off'),
    };
  }, [discovery, settings]);

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
    const panelEl = event.currentTarget.parentElement;
    const currentHeight = panelEl ? panelEl.getBoundingClientRect().height : 320;
    setPanelResizeDrag({
      startY: event.clientY,
      startHeight: currentHeight
    });
  }

  async function submit(mode: 'text' | 'voice' = 'text', overrideText = prompt) {
    const text = overrideText.trim();
    if (!text || state === 'submitting') return;
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
      ? [{ x: selection.x1, y: selection.y1 }, { x: selection.x2, y: selection.y1 }, { x: selection.x2, y: selection.y2 }, { x: selection.x1, y: selection.y2 }]
      : undefined;
    const selectedEntity = selectedCuaEntityId ? cuaEntities.find((entity) => entity.id === selectedCuaEntityId) : undefined;
    setSelection(null);
    setSelectionImg(null);
    setSelectedCuaEntityId(null);
    setHoveredCuaEntityId(null);
    // Clear the composer now that the message has been sent, so its text does
    // not linger in the input box after submission.
    setPrompt('');
    try {
      const res = await window.openMagicPointer.submitInstruction({ text, mode, backend, cursor, targetPath: selectedEntity ? undefined : targetPath, selectedEntity, conversationId: conversationId ?? undefined });
      setConversationId(res.conversationId);
      const conv = await window.openMagicPointer.getConversation(res.conversationId);
      if (conv) setHistoryTurns(conv.turns);
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
    setSettings((current) => current ? { ...current, ...patch } : current);
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

  async function loadConversation(id: string) {
    const conv = await window.openMagicPointer.getConversation(id);
    if (conv) {
      setConversationId(conv.id);
      setHistoryTurns(conv.turns);
      setEvents([]);
      setPrompt('');
      setState('composing');
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
    setSelectionImg(null);
    setSelectionDrag(null);
    setSelectedCuaEntityId(null);
    window.setTimeout(() => focusPromptInput(inputRef.current), 0);
  }

  function selectCuaEntity(entity: PointerEntity, event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedCuaEntityId(entity.id);
    setHoveredCuaEntityId(entity.id);
    setSelection(null);
    window.setTimeout(() => focusPromptInput(inputRef.current), 0);
  }

  const highlightedCuaEntity = useMemo(() => {
    const id = selectedCuaEntityId ?? hoveredCuaEntityId;
    return id ? cuaEntities.find((entity) => entity.id === id && entity.bbox) : undefined;
  }, [cuaEntities, hoveredCuaEntityId, selectedCuaEntityId]);

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

  return (
    <div className={`fixed inset-0 text-ink pointer-events-none${detached ? ' pointer-events-auto cursor-crosshair' : ''}${selecting ? ' cursor-crosshair' : ''}`}>
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
              height: 80,
            }}
            viewBox="0 0 80 80"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <g filter="url(#filter0_f_42_128)">
              <circle
                cx="40"
                cy="40"
                r="14"
                fill={glowFillColor}
                style={{ transition: 'fill 160ms ease' }}
              />
            </g>
            <defs>
              <filter id="filter0_f_42_128" x="0" y="0" width="80" height="80" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                <feFlood floodOpacity="0" result="BackgroundImageFix" />
                <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
                <feGaussianBlur stdDeviation="6.75" result="effect1_foregroundBlur_42_128" />
              </filter>
            </defs>
          </svg>

          {highlightedCuaEntity?.bbox && (
            <div
              className={`cua-element-highlight${selectedCuaEntityId ? ' border-accent-deep bg-[rgba(52,120,246,0.09)] shadow-[0_0_0_1px_rgba(255,255,255,0.58)_inset,0_0_0_2px_rgba(52,120,246,0.18),0_10px_30px_rgba(37,99,235,0.16)] z-6' : ''}`}
              style={{
                left: highlightedCuaEntity.bbox.x,
                top: highlightedCuaEntity.bbox.y,
                width: highlightedCuaEntity.bbox.width,
                height: highlightedCuaEntity.bbox.height
              }}
              title={highlightedCuaEntity.text ?? highlightedCuaEntity.role ?? 'CUA element'}
              onMouseDown={(event) => selectCuaEntity(highlightedCuaEntity, event)}
            />
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
                  <button className="selection-clear" type="button" onMouseDown={(event) => event.stopPropagation()} onClick={clearSelection} aria-label="Clear selection">x</button>
                  {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((handle) => {
                    const handlePos: Record<string, string> = {
                      n: 'handle-ns left-1/2 -translate-x-1/2 -top-1.5',
                      s: 'handle-ns left-1/2 -translate-x-1/2 -bottom-1.5',
                      e: 'handle-ew -right-1.5',
                      w: 'handle-ew -left-1.5',
                      nw: 'handle-corner -left-1.5 -top-1.5',
                      ne: 'handle-corner-alt -right-1.5 -top-1.5',
                      se: 'handle-corner -right-1.5 -bottom-1.5',
                      sw: 'handle-corner-alt -left-1.5 -bottom-1.5',
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

          <section
            className={`absolute left-0 top-0 ${selecting ? 'pointer-events-none' : 'pointer-events-auto'} will-change-transform w-[min(var(--pill-width,520px),calc(100vw-32px))] state-${state}${selecting ? ' is-selecting' : ''}`}
            style={{
              transform: `translate3d(${effectiveShellPos.x}px, ${effectiveShellPos.y}px, 0)`,
              transition: shouldUseLagFollow ? 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
              '--pill-width': `${pillWidth}px`,
              '--pill-height': `${pillHeight}px`
            } as CSSProperties}
          >
            {/* Hover Preview Box */}
            {showPreview && (selection || selectedCuaEntityId) && (
              <div className="absolute bottom-[calc(100%+10px)] left-3 z-10 animate-fade-up pointer-events-none w-max">
                <div
                  className="relative overflow-hidden flex flex-col bg-[rgba(13,111,255,0.92)] backdrop-blur-[15px] border border-white/20 shadow-[0_12px_40px_rgba(0,0,0,0.25)] p-3.5 rounded-[16px] text-white min-w-[200px] max-w-[320px]"
                  style={{
                    boxShadow: 'inset 2px 3px 3px -3px rgba(255,255,255,0.6), 0 12px 40px rgba(0,0,0,0.25)',
                  }}
                >
                  <div className="absolute inset-0 bg-white/5 pointer-events-none rounded-[inherit]" />
                  
                  {selection ? (
                    <div className="flex flex-col gap-1.5 z-1">
                      <div className="flex items-center gap-2 border-b border-white/10 pb-1.5 mb-1">
                        <span className="text-base leading-none">🖼️</span>
                        <span className="text-xs font-bold uppercase tracking-wider text-white/90">区域截图附件</span>
                      </div>
                      
                      {selectionImg && (
                        <div className="relative w-full h-24 rounded-[8px] overflow-hidden border border-white/10 mb-1.5 bg-black/25 flex items-center justify-center">
                          <img
                            src={selectionImg}
                            alt="Screenshot region preview"
                            className="max-w-full max-h-full object-contain"
                          />
                        </div>
                      )}

                      <div className="flex flex-col gap-1.5 text-[11px] text-white/80 font-mono">
                        <div className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-white/50">尺寸:</span>
                          <span className="font-bold text-white">{selection.x2 - selection.x1}px × {selection.y2 - selection.y1}px</span>
                        </div>
                        <div className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-white/50">起点:</span>
                          <span>X: {selection.x1}, Y: {selection.y1}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-white/50">终点:</span>
                          <span>X: {selection.x2}, Y: {selection.y2}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    highlightedCuaEntity && (
                      <div className="flex flex-col gap-1.5 z-1">
                        <div className="flex items-center gap-2 border-b border-white/10 pb-1.5 mb-1">
                          <span className="text-base leading-none">🎯</span>
                          <span className="text-xs font-bold uppercase tracking-wider text-white/90">UI 元素附件</span>
                        </div>
                        <div className="flex flex-col gap-1.5 text-[11px] text-white/80 font-mono">
                          <div className="flex justify-between gap-4 border-b border-white/5 pb-1">
                            <span className="text-white/50 shrink-0">角色:</span>
                            <span className="font-bold text-white capitalize bg-white/10 px-1.5 py-0.5 rounded text-[10px]">{highlightedCuaEntity.role || '未知 UI'}</span>
                          </div>
                          {highlightedCuaEntity.text && (
                            <div className="flex flex-col gap-1 border-b border-white/5 pb-1">
                              <span className="text-white/50 text-[10px]">文本内容:</span>
                              <span className="font-medium bg-white/5 p-1.5 rounded text-[10px] break-all leading-normal text-left text-white/95 max-h-[80px] overflow-y-auto scrollbar-thin">
                                "{highlightedCuaEntity.text}"
                              </span>
                            </div>
                          )}
                          {highlightedCuaEntity.bbox && (
                            <div className="flex flex-col gap-1">
                              <div className="flex justify-between border-b border-white/5 pb-1">
                                <span className="text-white/50">大小:</span>
                                <span className="text-white">{Math.round(highlightedCuaEntity.bbox.width)} × {Math.round(highlightedCuaEntity.bbox.height)} px</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-white/50">位置:</span>
                                <span>X: {Math.round(highlightedCuaEntity.bbox.x)}, Y: {Math.round(highlightedCuaEntity.bbox.y)}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Unified Glow Layer — wraps both input and panel if open */}
            <div
              className="absolute inset-0 z-0 pointer-events-none animate-pill-unfold-geometry origin-left"
              style={{
                borderRadius: hasPanel ? '24px' : `${pillHeight / 2}px`,
                transition: 'border-radius 260ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <div className="absolute inset-0 rounded-[inherit] bg-[rgba(13,111,255,0.56)] blur-[23.9px] animate-pill-glow" />
            </div>

            {/* Unified Card Container */}
            <div
              className="relative z-4 overflow-hidden flex flex-col bg-[rgba(13,111,255,0.85)] backdrop-blur-[15px] shadow-[0px_8px_6px_0px_rgba(0,0,0,0.05)] animate-pill-unfold origin-left"
              style={{
                borderRadius: hasPanel ? '20px' : `${pillHeight / 2}px`,
                border: hasPanel ? '1px solid rgba(255, 255, 255, 0.15)' : 'none',
                transition: 'border-radius 260ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              {/* Input Area (Command Bubble) */}
              <div
                className="command-bubble flex items-center bg-transparent relative"
                style={{
                  minHeight: `${pillHeight}px`,
                  gap: `${gap}px`,
                  paddingTop: `${padY}px`,
                  paddingBottom: `${padY}px`,
                  paddingRight: `${padXRight}px`,
                  paddingLeft: `${padXLeft}px`,
                }}
                onMouseDown={onPillMouseDown}
              >
                <div className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_2px_3px_3px_-3px_rgba(255,255,255,0.6),inset_0px_-1px_1px_0px_rgba(255,255,255,0.25),inset_0px_1px_1px_0px_rgba(255,255,255,0.25)]" />
                
                {/* Context Attachment Icon — rendered before input area */}
                {(selection || selectedCuaEntityId) && (
                  <div
                    className="relative flex items-center justify-center rounded-full shrink-0 bg-white/10 hover:bg-white/20 border border-white/10 transition-all duration-150 cursor-pointer group animate-elastic-pop z-1"
                    style={{
                      width: `${menuSize}px`,
                      height: `${menuSize}px`,
                    }}
                    onMouseEnter={() => setShowPreview(true)}
                    onMouseLeave={() => setShowPreview(false)}
                    onClick={(event) => {
                      event.stopPropagation();
                      setShowPreview(false);
                      if (selection) {
                        setSelection(null);
                        setSelectionDrag(null);
                      }
                      if (selectedCuaEntityId) {
                        setSelectedCuaEntityId(null);
                      }
                      window.setTimeout(() => focusPromptInput(inputRef.current), 0);
                    }}
                    title="点击清除附件 / Click to clear attachment"
                  >
                    {selection ? <ImageIcon /> : <TargetIcon />}
                    
                    {/* Hover subtle red "x" overlay */}
                    <div className="absolute inset-0 flex items-center justify-center bg-red-500/90 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <span className="text-[10px] font-bold text-white leading-none">×</span>
                    </div>
                  </div>
                )}

                <textarea
                  ref={inputRef}
                  autoFocus
                  className="bubble-input"
                  style={{
                    fontSize: `${inputFontSize}px`,
                    lineHeight: '1.4',
                    minHeight: `${Math.max(16, pillHeight - 12)}px`,
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
                  className="bubble-menu shrink-0 grid place-items-center rounded-full text-white/70 bg-transparent leading-none tracking-[1px] hover:bg-white/10 hover:text-white active:scale-95 transition-all duration-160 relative z-1 cursor-pointer"
                  style={{
                    width: `${menuSize}px`,
                    height: `${menuSize}px`,
                    fontSize: `${Math.max(10, Math.min(18, menuSize - 4))}px`,
                  }}
                  title="Menu"
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    setMenuOpen(!menuOpen);
                  }}
                  aria-label="Menu"
                >
                  ···
                </button>

                {menuOpen && (
                  <div className="bubble-dropdown absolute top-[calc(100%+6px)] right-[12px] min-w-[200px] p-1.5 border border-white/20 rounded-[14px] bg-[rgba(13,111,255,0.92)] backdrop-blur-[15px] shadow-[0_8px_32px_rgba(0,0,0,0.15)] animate-dropdown-appear z-10">
                    <button className="flex items-center gap-2 w-full py-2 px-2.5 border-0 rounded-[10px] bg-transparent text-white/90 text-[13px] font-medium text-left cursor-pointer hover:bg-white/10 hover:text-white transition-colors duration-140" onClick={startVoice}>
                      <span className="inline-flex w-[18px] h-[18px] items-center justify-center text-sm shrink-0">🎤</span>
                      Voice input
                    </button>
                    <div className="h-px mx-2 my-1 bg-white/15" />
                    <label className="flex items-center gap-2 w-full py-2 px-2.5 border-0 rounded-[10px] bg-transparent text-white/90 text-[13px] font-medium text-left cursor-pointer hover:bg-white/10 hover:text-white transition-colors duration-140">
                      <span className="inline-flex w-[18px] h-[18px] items-center justify-center text-sm shrink-0">⚡</span>
                      <select className="flex-1 min-w-0 h-7 border border-white/15 rounded-lg px-2 bg-white/10 text-white text-xs font-medium outline-none cursor-pointer focus:border-white/30 [&>option]:bg-[#0d6fff] [&>option]:text-white" value={backend} onChange={(event) => setBackend(event.target.value as AgentBackendId)} title="Agent backend">
                        {selectableBackends.map((item) => <option key={item} value={item}>{backendLabel(item)}</option>)}
                      </select>
                    </label>
                    <button className="flex items-center gap-2 w-full py-2 px-2.5 border-0 rounded-[10px] bg-transparent text-white/90 text-[13px] font-medium text-left cursor-pointer hover:bg-white/10 hover:text-white transition-colors duration-140" onClick={() => {
                      setMenuOpen(false);
                      setConversationId(null);
                      setHistoryTurns([]);
                      setEvents([]);
                      setPrompt('');
                    }}>
                      <span className="inline-flex w-[18px] h-[18px] items-center justify-center text-sm shrink-0">✨</span>
                      New Conversation
                    </button>
                    <button className="flex items-center gap-2 w-full py-2 px-2.5 border-0 rounded-[10px] bg-transparent text-white/90 text-[13px] font-medium text-left cursor-pointer hover:bg-white/10 hover:text-white transition-colors duration-140" onClick={() => {
                      setMenuOpen(false);
                      setHistoryOpen(true);
                      window.openMagicPointer.getConversations().then(setConversationsList);
                    }}>
                      <span className="inline-flex w-[18px] h-[18px] items-center justify-center text-sm shrink-0">🕒</span>
                      History
                    </button>
                    <button className="flex items-center gap-2 w-full py-2 px-2.5 border-0 rounded-[10px] bg-transparent text-white/90 text-[13px] font-medium text-left cursor-pointer hover:bg-white/10 hover:text-white transition-colors duration-140" onClick={() => {
                      setMenuOpen(false);
                      setSettingsOpen(true);
                    }}>
                      <span className="inline-flex w-[18px] h-[18px] items-center justify-center text-sm shrink-0">⚙</span>
                      Settings
                    </button>
                  </div>
                )}
              </div>

              {/* Faint Horizontal Divider Line */}
              {hasPanel && (
                <div className="h-px w-full bg-white/15 shrink-0" />
              )}

              {/* Conversation Stream Panel */}
              {hasPanel && (
                <div
                  className={`stream-panel-unified scrollbar-thin flex-grow overflow-y-auto w-full`}
                  style={{
                    ...streamPanelStyle,
                    background: 'transparent',
                    border: 'none',
                    boxShadow: 'none',
                    padding: '16px',
                    borderRadius: '0',
                    margin: '0',
                  }}
                  ref={streamPanelRef}
                >
                  <div className="flex justify-between gap-2.5 text-white/50 text-[10px] font-bold uppercase tracking-[0.04em] mb-3">
                    <span>{backendLabel(backend)}</span>
                    <span>{statusLabel(state)}</span>
                  </div>
                  <div className="flex flex-col gap-4 mt-2.5 w-full">
                    {historyTurns.map((turn) => {
                      if (turn.role === 'user') {
                        return (
                          <div key={turn.id} className="flex flex-col w-full items-end">
                            <div className="user-bubble max-w-[85%] bg-white/10 border border-white/5 rounded-[16px_16px_0_16px] py-2 px-3 text-sm leading-[1.4] text-white break-words whitespace-pre-wrap shadow-[0_2px_8px_rgba(0,0,0,0.05)]">
                              {turn.text}
                            </div>
                          </div>
                        );
                      } else {
                        return (
                          <div key={turn.id} className="flex flex-col w-full items-start text-white/90">
                            <article className="agent-text text-sm markdown-body w-full">
                              <MarkdownRenderer value={turn.text} />
                            </article>
                          </div>
                        );
                      }
                    })}

                    {/* Active turn streaming/thinking */}
                    {((historyTurns.length === 0 && (state === 'submitting' || state === 'streaming' || state === 'approval')) ||
                      (historyTurns.length > 0 && historyTurns[historyTurns.length - 1]?.role === 'user')) && (
                      <div className="flex flex-col w-full items-start text-white/90">
                        {/* Thinking Block */}
                        {thinkingTime > 0 && (
                          <div className="my-2.5 flex flex-col items-start w-full">
                            <div
                              className={`inline-flex items-center gap-1.5 cursor-pointer select-none text-xs font-semibold text-white/60 py-1 px-2 rounded-[10px] bg-white/5 border border-white/5 hover:bg-white/10 hover:text-white transition-all duration-150${showTools ? ' [&>.arrow]:rotate-90' : ''}`}
                              onClick={() => setShowTools(!showTools)}
                            >
                              <span>已思考 {thinkingTime}s</span>
                              <span className="arrow inline-block text-[8px] rotate-0 transition-transform duration-150 leading-none">▶</span>
                            </div>
                            {showTools && (
                              <div className="mt-1.5 pl-3 border-l-2 border-white/15 w-full">
                                {discovery && <p className="tool-discovery mt-2.5 text-white/60 text-[13px] leading-relaxed">{discovery.message}</p>}
                                {toolEvents.length > 0 && <ToolRows events={toolEvents} />}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Streaming Markdown Response */}
                        {transcript && (
                          <article className="agent-text text-sm markdown-body w-full">
                            <MarkdownRenderer value={transcript} />
                          </article>
                        )}

                        {/* Other active states */}
                        {approval && (
                          <div className="approval-box mt-3 border border-[rgba(255,255,255,0.15)] rounded-[10px] bg-white/5 p-3 w-full">
                            <strong className="text-white text-[13px]">{approval.tool ?? 'Agent'} requests approval</strong>
                            <p className="mt-2.5 text-[13px] leading-relaxed text-white/80">{approval.reason}</p>
                            <div className="flex gap-2 mt-2.5">
                              <button className="approval-button px-3 py-1.5 rounded-full bg-white/10 text-white text-xs font-semibold hover:bg-white/20 active:scale-95 transition-all" onClick={() => void window.openMagicPointer.approveAgentRequest(approval.id, 'approve')}>Allow</button>
                              <button className="approval-button px-3 py-1.5 rounded-full bg-white/10 text-white text-xs font-semibold hover:bg-white/20 active:scale-95 transition-all" onClick={() => void window.openMagicPointer.approveAgentRequest(approval.id, 'deny')}>Deny</button>
                            </div>
                          </div>
                        )}
                        {latestFailure && <p className="text-red-400 text-[13px] leading-relaxed mt-2.5">{latestFailure.error}</p>}
                      </div>
                    )}
                  </div>
                  {detached && (
                    <div className="resize-grip" onMouseDown={onResizeMouseDown} />
                  )}
                </div>
              )}
            </div>
            {/* Capability indicators — only visible when backend detects capabilities */}
            {(capabilities.hasSkills || capabilities.hasMcp || capabilities.hasCua) && (
              <div className="flex items-center gap-1.5 mt-2 ml-2">
                {capabilities.hasSkills && <span className="inline-flex items-center px-2.5 py-[3px] rounded-pill text-[11px] font-semibold uppercase tracking-[0.03em] leading-none bg-[rgba(52,199,89,0.12)] text-success animate-elastic-pop">Skills</span>}
                {capabilities.hasMcp && <span className="inline-flex items-center px-2.5 py-[3px] rounded-pill text-[11px] font-semibold uppercase tracking-[0.03em] leading-none bg-[rgba(255,59,48,0.10)] text-danger animate-elastic-pop">MCP</span>}
                {capabilities.hasCua && <span className="inline-flex items-center px-2.5 py-[3px] rounded-pill text-[11px] font-semibold uppercase tracking-[0.03em] leading-none bg-[rgba(255,204,0,0.15)] text-warning animate-elastic-pop">CUA</span>}
              </div>
            )}
          </section>
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
          onClose={() => setSettingsOpen(false)}
          updateSettings={updateSettings}
          updateSecret={updateSecret}
          clearSecret={clearSecret}
          fetchModels={() => void fetchModels()}
          saveSettings={() => void saveSettings()}
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
