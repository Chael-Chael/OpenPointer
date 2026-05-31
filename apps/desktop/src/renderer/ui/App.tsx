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

export function App() {
  const [cursor, setCursor] = useState<CursorPayload>(initialCursor);
  const [hold, setHold] = useState<HoldProgressPayload | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const pillWidth = clampNumber(settings?.pillWidth, 280, 900, 520);
  const pillHeight = clampNumber(settings?.pillHeight, 36, 96, 44);
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
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkingStartRef = useRef<number>(0);
  const streamPanelRef = useRef<HTMLDivElement | null>(null);
  const lastGroundingPointRef = useRef<{ x: number; y: number } | null>(null);
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
    const offDeactivate = window.openMagicPointer.onDeactivate(() => {
      if (conversationIdRef.current) {
        lastConversationIdRef.current = conversationIdRef.current;
        lastDeactivatedAtRef.current = Date.now();
      }
      setActive(false);
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
      setDetached((d) => {
        if (d) {
          // Reattach shell position.
          setDetachedPos(null);
          setSelection(null);
          return false;
        }
        const c = cursorRef.current;
        setDetachedPos(computeShellPosition(c.localX, c.localY));
        return true;
      });
    }
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
    };
  }, [active, menuOpen, selecting, selectionDrag]);

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
    if (state === 'composing' && active && !selecting && !selectionDrag && !settingsOpen) {
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

  return (
    <div className={`screen${detached ? ' screen-detached' : ''}${selecting ? ' screen-selecting' : ''}`}>
      {hold?.state === 'holding' && <HoldRing cursor={hold.cursor} progress={hold.progress} />}

      {active && (
        <>
          <CursorTrail x={cursor.localX} y={cursor.localY} enabled={active} />
          <div className={`cursor-glow state-${state} activity-${pointerActivity}`} style={{ left: cursor.localX - 14, top: cursor.localY - 14 }} />

          {highlightedCuaEntity?.bbox && (
            <div
              className={`cua-element-highlight${selectedCuaEntityId ? ' is-selected' : ''}`}
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
              className={`selection-rect${selecting ? ' is-drafting' : ''}${selectionDrag ? ' is-adjusting' : ''}`}
              style={{ left: selection.x1, top: selection.y1, width: selection.x2 - selection.x1, height: selection.y2 - selection.y1 }}
              onMouseDown={beginSelectionMove}
            >
              {!selecting && (
                <>
                  <button className="selection-clear" type="button" onMouseDown={(event) => event.stopPropagation()} onClick={clearSelection} aria-label="Clear selection">x</button>
                  {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((handle) => (
                    <button
                      key={handle}
                      className={`selection-handle handle-${handle}`}
                      type="button"
                      aria-label={`Resize selection ${handle}`}
                      onMouseDown={(event) => beginSelectionResize(handle, event)}
                    />
                  ))}
                </>
              )}
            </div>
          )}

          <section
            className={`command-shell state-${state}${selecting ? ' is-selecting' : ''}`}
            style={{
              transform: `translate3d(${effectiveShellPos.x}px, ${effectiveShellPos.y}px, 0)`,
              '--pill-width': `${pillWidth}px`,
              '--pill-height': `${pillHeight}px`
            } as CSSProperties}
          >

            <div className="command-bubble" onMouseDown={onPillMouseDown}>
              <button className="bubble-menu" title="Menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
                ···
              </button>

              <textarea
                ref={inputRef}
                autoFocus
                className="bubble-input"
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

              {active && (
                <div
                  className="context-progress-wrapper"
                  style={{ '--ring-color': ringColor } as CSSProperties}
                  title={`Context window: ${estimatedUsedTokens} / ${contextLimit} tokens used (${Math.round(remainingFraction * 100)}% remaining)`}
                >
                  <svg className="context-progress-ring" viewBox="0 0 32 32">
                    <circle className="ring-track" cx="16" cy="16" r="10" />
                    <circle
                      className="ring-progress"
                      cx="16"
                      cy="16"
                      r="10"
                      strokeDasharray={62.8}
                      strokeDashoffset={62.8 * (1 - remainingFraction)}
                    />
                  </svg>
                  <span className="context-progress-text">{Math.round(remainingFraction * 100)}%</span>
                </div>
              )}

              {menuOpen && (
                <div className="bubble-dropdown">
                  <button onClick={startVoice}>
                    <span className="dropdown-icon">🎤</span>
                    Voice input
                  </button>
                  <div className="dropdown-divider" />
                  <label>
                    <span className="dropdown-icon">⚡</span>
                    <select value={backend} onChange={(event) => setBackend(event.target.value as AgentBackendId)} title="Agent backend">
                      {selectableBackends.map((item) => <option key={item} value={item}>{backendLabel(item)}</option>)}
                    </select>
                  </label>
                  <button className="menu-item" onClick={() => {
                    setMenuOpen(false);
                    setConversationId(null);
                    setHistoryTurns([]);
                    setEvents([]);
                    setPrompt('');
                  }}>
                    <span className="dropdown-icon">✨</span>
                    New Conversation
                  </button>
                  <button className="menu-item" onClick={() => {
                    setMenuOpen(false);
                    setHistoryOpen(true);
                    window.openMagicPointer.getConversations().then(setConversationsList);
                  }}>
                    <span className="dropdown-icon">🕒</span>
                    History
                  </button>
                  <button className="menu-item" onClick={() => {
                    setMenuOpen(false);
                    setSettingsOpen(true);
                  }}>
                    <span className="dropdown-icon">⚙</span>
                    Settings
                  </button>
                </div>
              )}
            </div>

            {/* Capability indicators — only visible when backend detects capabilities */}
            {(capabilities.hasSkills || capabilities.hasMcp || capabilities.hasCua) && (
              <div className="capability-indicators">
                {capabilities.hasSkills && <span className="indicator ind-skill">Skills</span>}
                {capabilities.hasMcp && <span className="indicator ind-mcp">MCP</span>}
                {capabilities.hasCua && <span className="indicator ind-cua">CUA</span>}
              </div>
            )}

            {(state !== 'composing' || historyTurns.length > 0 || conversationId) && (
              <div className="stream-panel" style={streamPanelStyle} ref={streamPanelRef}>
                <div className="stream-meta">
                  <span>{backendLabel(backend)}</span>
                  <span>{statusLabel(state)}</span>
                </div>
                <div className="history-log">
                  {historyTurns.map((turn) => {
                    if (turn.role === 'user') {
                      return (
                        <div key={turn.id} className="history-turn turn-user">
                          <div className="user-bubble">{turn.text}</div>
                        </div>
                      );
                    } else {
                      return (
                        <div key={turn.id} className="history-turn turn-assistant">
                          <article className="agent-text markdown-body">
                            <MarkdownRenderer value={turn.text} />
                          </article>
                        </div>
                      );
                    }
                  })}

                  {/* Active turn streaming/thinking */}
                  {((historyTurns.length === 0 && (state === 'submitting' || state === 'streaming' || state === 'approval')) ||
                    (historyTurns.length > 0 && historyTurns[historyTurns.length - 1]?.role === 'user')) && (
                    <div className="history-turn turn-assistant">
                      {/* Thinking Block */}
                      {thinkingTime > 0 && (
                        <div className="thinking-block">
                          <div
                            className={`thinking-header ${showTools ? 'expanded' : ''}`}
                            onClick={() => setShowTools(!showTools)}
                          >
                            <span>已思考 {thinkingTime}s</span>
                            <span className="arrow">▶</span>
                          </div>
                          {showTools && (
                            <div className="thinking-details">
                              {discovery && <p className="tool-discovery">{discovery.message}</p>}
                              {toolEvents.length > 0 && <ToolRows events={toolEvents} />}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Streaming Markdown Response */}
                      {transcript && (
                        <article className="agent-text markdown-body">
                          <MarkdownRenderer value={transcript} />
                        </article>
                      )}

                      {/* Other active states */}
                      {approval && (
                        <div className="approval-box">
                          <strong>{approval.tool ?? 'Agent'} requests approval</strong>
                          <p>{approval.reason}</p>
                          <div>
                            <button onClick={() => void window.openMagicPointer.approveAgentRequest(approval.id, 'approve')}>Allow</button>
                            <button onClick={() => void window.openMagicPointer.approveAgentRequest(approval.id, 'deny')}>Deny</button>
                          </div>
                        </div>
                      )}
                      {latestFailure && <p className="error-text">{latestFailure.error}</p>}
                    </div>
                  )}
                </div>
                {detached && (
                  <div className="stream-panel-resize-handle" onMouseDown={onResizeMouseDown} />
                )}
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
