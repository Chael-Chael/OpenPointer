import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { AgentBackendId, AgentEvent, PointerEntity } from '@openmagicpointer/core';
import type { AppSettings } from '@openmagicpointer/storage';
import { parseVoiceCommand } from '@openmagicpointer/voice';
import type { CursorPayload, HoldProgressPayload } from '../../shared/types';
import { CursorTrail } from './CursorTrail';
import { MarkdownRenderer } from './MarkdownRenderer';

const initialCursor: CursorPayload = { x: 300, y: 300, localX: 300, localY: 300, displayId: 0, dpr: 1 };
const selectableBackends: AgentBackendId[] = ['auto', 'local-vlm', 'hermes', 'opencode', 'claude-agent', 'codex'];

type UiState = 'idle' | 'holding' | 'composing' | 'submitting' | 'streaming' | 'approval' | 'completed' | 'failed';
type StatusTone = 'ready' | 'missing' | 'working' | 'failed' | 'approval';
type SecretDrafts = Record<'localVlmApiKey' | 'hermesApiKey' | 'opencodeApiKey' | 'claudeAgentApiKey' | 'codexApiKey', string>;
type ClearSecretFlags = Record<keyof SecretDrafts, boolean>;
type SelectionRect = { x1: number; y1: number; x2: number; y2: number };
type SelectionHandle = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'se' | 'sw';
type SelectionDrag =
  | { kind: 'move'; startX: number; startY: number; initial: SelectionRect }
  | { kind: 'resize'; handle: SelectionHandle; startX: number; startY: number; initial: SelectionRect };

const emptySecretDrafts: SecretDrafts = {
  localVlmApiKey: '',
  hermesApiKey: '',
  opencodeApiKey: '',
  claudeAgentApiKey: '',
  codexApiKey: ''
};

const emptyClearSecretFlags: ClearSecretFlags = {
  localVlmApiKey: false,
  hermesApiKey: false,
  opencodeApiKey: false,
  claudeAgentApiKey: false,
  codexApiKey: false
};

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
  const thinkingTimerRef = useRef<any>(null);
  const thinkingStartRef = useRef<number>(0);
  const streamPanelRef = useRef<HTMLDivElement | null>(null);
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
    } catch (e: any) {
      setFetchModelsError(e.message || 'Error occurred.');
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
      window.openMagicPointer.getConversation(conversationId).then(conv => {
        if (conv) setHistoryTurns(conv.turns);
      });
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
      }
      return;
    }
    const timer = window.setTimeout(() => {
      void window.openMagicPointer.requestGrounding({ cursor: cursorRef.current }).then((preview) => {
        setCuaEntities(preview.entities);
        setHoveredCuaEntityId(preview.hoveredEntityId ?? null);
      }).catch(() => {
        setCuaEntities([]);
        setHoveredCuaEntityId(null);
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [active, cursor.localX, cursor.localY, selecting, selectionDrag, settings?.cuaMode, settingsOpen, selection, selectedCuaEntityId]);

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
  const runtimeStatus = useMemo(() => runtimeStatusFor(state, readiness), [readiness, state]);
  const discovery = latestEvent(events, 'tool.discovery');
  const approval = latestEvent(events, 'approval.requested');
  const latestFailure = latestEvent(events, 'run.failed');
  const toolEvents = useMemo(() => events.filter(isToolEvent), [events]);
  const canSubmit = Boolean(prompt.trim()) && state !== 'submitting';

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
    if (panelHeight !== null) {
      return {
        height: `${panelHeight}px`,
        maxHeight: 'none',
      };
    }
    return {};
  }, [panelHeight]);

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
    const res = await window.openMagicPointer.submitInstruction({ text, mode, backend, cursor, targetPath: selectedEntity ? undefined : targetPath, selectedEntity, conversationId: conversationId ?? undefined });
    setConversationId(res.conversationId);
    const conv = await window.openMagicPointer.getConversation(res.conversationId);
    if (conv) setHistoryTurns(conv.turns);
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

  return (
    <div className={`screen${detached ? ' screen-detached' : ''}${selecting ? ' screen-selecting' : ''}`}>
      {hold?.state === 'holding' && <HoldRing cursor={hold.cursor} progress={hold.progress} />}

      {active && (
        <>
          <CursorTrail x={cursor.localX} y={cursor.localY} enabled={active} />
          <div className={`cursor-glow state-${state}`} style={{ left: cursor.localX - 14, top: cursor.localY - 14 }} />

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
        <div className="modal" role="dialog" aria-modal="true" aria-label="OpenMagicPointer settings">
          <div className="modal-card">
            <header className="settings-header">
              <div>
                <p>Agent backends</p>
                <h2>Connection settings</h2>
              </div>
              <button className="ghost-button" onClick={() => setSettingsOpen(false)}>Close</button>
            </header>

            <section className="settings-section">
              <label className="field">
                <span>Default backend</span>
                <select value={backend} onChange={(event) => setBackend(event.target.value as AgentBackendId)}>
                  {selectableBackends.map((item) => <option key={item} value={item}>{backendLabel(item)}</option>)}
                </select>
              </label>
            </section>

            <div className="backend-grid">
              <BackendCard title="Local VLM" status={backendReadiness(draftAwareSettings, 'local-vlm')}>
                <label className="toggle-row">
                  <input type="checkbox" checked={settings.localVlmEnabled} onChange={(event) => updateSettings({ localVlmEnabled: event.target.checked })} />
                  <span>Enabled</span>
                </label>
                <TextField label="Base URL" value={settings.localVlmBaseUrl} onChange={(value) => updateSettings({ localVlmBaseUrl: value })} placeholder="https://provider.example/v1" />
                <TextField label="Model" value={settings.localVlmModel} onChange={(value) => updateSettings({ localVlmModel: value })} placeholder="Optional model name" />

                <div className="model-fetch-row" style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginTop: '4px' }}>
                  <button
                    type="button"
                    className="ghost-button"
                    style={{ fontSize: '11px', padding: '4px 10px', height: '28px', borderRadius: '8px' }}
                    onClick={fetchModels}
                    disabled={isFetchingModels || !settings.localVlmBaseUrl}
                  >
                    {isFetchingModels ? 'Fetching...' : 'Fetch vision models'}
                  </button>
                  {fetchModelsError && <span style={{ color: '#e5383b', fontSize: '11px' }}>{fetchModelsError}</span>}
                </div>

                {fetchedModels && fetchedModels.length > 0 && (
                  <div className="fetched-models-list" style={{ marginTop: '8px', maxHeight: '100px', overflowY: 'auto', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '6px', background: 'rgba(0,0,0,0.02)' }}>
                    <p style={{ margin: '0 0 4px', fontSize: '11px', fontWeight: 'bold', color: 'var(--muted)' }}>Select a vision model:</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {fetchedModels.map(m => (
                        <span
                          key={m}
                          style={{ cursor: 'pointer', background: 'var(--accent-soft)', color: 'var(--accent-deep)', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(52,120,246,0.15)' }}
                          onClick={() => updateSettings({ localVlmModel: m })}
                        >
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <label className="field" style={{ marginTop: '10px' }}>
                  <span>
                    Context window size
                    <em>Default: 32k</em>
                  </span>
                  <input
                    type="number"
                    min={4096}
                    max={2000000}
                    step={4096}
                    value={settings.localVlmContextWindow ?? 32768}
                    onChange={(event) => updateSettings({ localVlmContextWindow: Number(event.target.value) })}
                  />
                </label>
                <SecretField
                  label="API key"
                  value={secretDrafts.localVlmApiKey}
                  configured={secretConfigured(settings.hasLocalVlmApiKey, secretDrafts.localVlmApiKey, clearSecrets.localVlmApiKey)}
                  clearQueued={clearSecrets.localVlmApiKey}
                  onChange={(value) => updateSecret('localVlmApiKey', value)}
                  onClear={() => clearSecret('localVlmApiKey')}
                />
              </BackendCard>

              <BackendCard title="Hermes" status={backendReadiness(draftAwareSettings, 'hermes')}>
                <TextField label="Base URL" value={settings.hermesBaseUrl} onChange={(value) => updateSettings({ hermesBaseUrl: value })} placeholder="http://127.0.0.1:8642/v1" />
                <SecretField
                  label="API token"
                  value={secretDrafts.hermesApiKey}
                  configured={secretConfigured(settings.hasHermesApiKey, secretDrafts.hermesApiKey, clearSecrets.hermesApiKey)}
                  clearQueued={clearSecrets.hermesApiKey}
                  onChange={(value) => updateSecret('hermesApiKey', value)}
                  onClear={() => clearSecret('hermesApiKey')}
                />
              </BackendCard>

              <BackendCard title="OpenCode" status={backendReadiness(draftAwareSettings, 'opencode')}>
                <TextField label="Base URL" value={settings.opencodeBaseUrl} onChange={(value) => updateSettings({ opencodeBaseUrl: value })} placeholder="http://127.0.0.1:4096" />
                <SecretField
                  label="API token"
                  value={secretDrafts.opencodeApiKey}
                  configured={secretConfigured(settings.hasOpenCodeApiKey, secretDrafts.opencodeApiKey, clearSecrets.opencodeApiKey)}
                  clearQueued={clearSecrets.opencodeApiKey}
                  onChange={(value) => updateSecret('opencodeApiKey', value)}
                  onClear={() => clearSecret('opencodeApiKey')}
                />
              </BackendCard>

              <BackendCard title="Claude Agent" status={backendReadiness(draftAwareSettings, 'claude-agent')}>
                <label className="toggle-row">
                  <input type="checkbox" checked={settings.claudeAgentEnabled} onChange={(event) => updateSettings({ claudeAgentEnabled: event.target.checked })} />
                  <span>Enabled</span>
                </label>
                <SecretField
                  label="API key"
                  value={secretDrafts.claudeAgentApiKey}
                  configured={secretConfigured(settings.hasClaudeAgentApiKey, secretDrafts.claudeAgentApiKey, clearSecrets.claudeAgentApiKey)}
                  clearQueued={clearSecrets.claudeAgentApiKey}
                  onChange={(value) => updateSecret('claudeAgentApiKey', value)}
                  onClear={() => clearSecret('claudeAgentApiKey')}
                />
              </BackendCard>

              <BackendCard title="Codex" status={backendReadiness(draftAwareSettings, 'codex')}>
                <TextField label="App server URL" value={settings.codexAppServerUrl} onChange={(value) => updateSettings({ codexAppServerUrl: value })} placeholder="http://127.0.0.1:5050/v1" />
                <SecretField
                  label="API token"
                  value={secretDrafts.codexApiKey}
                  configured={secretConfigured(settings.hasCodexApiKey, secretDrafts.codexApiKey, clearSecrets.codexApiKey)}
                  clearQueued={clearSecrets.codexApiKey}
                  onChange={(value) => updateSecret('codexApiKey', value)}
                  onClear={() => clearSecret('codexApiKey')}
                />
              </BackendCard>
            </div>

            <section className="settings-section runtime-section">
              <label className="field">
                <span>CUA mode</span>
                <select value={settings.cuaMode} onChange={(event) => updateSettings({ cuaMode: event.target.value as AppSettings['cuaMode'] })}>
                  <option value="off">Off</option>
                  <option value="prefer">Prefer</option>
                  <option value="require-on-explicit-command">Require on explicit command</option>
                </select>
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={settings.requireApprovalBeforeCua} onChange={(event) => updateSettings({ requireApprovalBeforeCua: event.target.checked })} />
                <span>Require approval before CUA</span>
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={settings.longPressEnabled} onChange={(event) => updateSettings({ longPressEnabled: event.target.checked })} />
                <span>Long press activation</span>
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={settings.voiceEnabled} onChange={(event) => updateSettings({ voiceEnabled: event.target.checked })} />
                <span>Voice input</span>
              </label>
            </section>

            <section className="settings-section">
              <label className="field">
                <span>New dialog behavior</span>
                <select
                  value={settings?.newDialogBehavior ?? 'continue'}
                  onChange={(event) => updateSettings({ newDialogBehavior: event.target.value as any })}
                >
                  <option value="new">Always start a new conversation</option>
                  <option value="continue">Always continue the previous conversation</option>
                  <option value="interval">Start new conversation after interval, otherwise continue</option>
                </select>
              </label>
              {(settings?.newDialogBehavior ?? 'continue') === 'interval' && (
                <div style={{ marginTop: '12px' }}>
                  <NumberSlider
                    label="New dialog interval"
                    value={settings?.newDialogInterval ?? 300}
                    min={10}
                    max={3600}
                    step={10}
                    unit="s"
                    onChange={(value) => updateSettings({ newDialogInterval: value })}
                  />
                </div>
              )}
            </section>

            <section className="settings-section appearance-section">
              <NumberSlider
                label="Pill width"
                value={pillWidth}
                min={280}
                max={900}
                step={10}
                unit="px"
                onChange={(value) => updateSettings({ pillWidth: value })}
              />
              <NumberSlider
                label="Pill height"
                value={pillHeight}
                min={36}
                max={96}
                step={2}
                unit="px"
                onChange={(value) => updateSettings({ pillHeight: value })}
              />
            </section>

            <div className="modal-actions">
              <button className="primary-button" onClick={() => void saveSettings()}>Save settings</button>
            </div>
          </div>
        </div>
      )}

      {historyOpen && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="OpenMagicPointer conversation history">
          <div className="modal-card">
            <header className="settings-header">
              <div>
                <p>Chat history</p>
                <h2>Past conversations</h2>
              </div>
              <button className="ghost-button" onClick={() => setHistoryOpen(false)}>Close</button>
            </header>

            {conversationsList.length === 0 ? (
              <div className="history-empty">
                <div className="history-empty-icon">🕒</div>
                <p>No past conversations found. Start a new chat to begin!</p>
              </div>
            ) : (
              <div className="history-list">
                {conversationsList.map((conv) => (
                  <div key={conv.id} className="history-item" onClick={() => void loadConversation(conv.id)}>
                    <div className="history-item-info">
                      <span className="history-item-title">{conv.title || 'Untitled Conversation'}</span>
                      <span className="history-item-date">{new Date(conv.updatedAt).toLocaleString()}</span>
                    </div>
                    <div className="history-item-actions">
                      <button className="history-item-btn primary-button" type="button" onClick={(e) => { e.stopPropagation(); void loadConversation(conv.id); }}>Open</button>
                      <button className="history-item-btn ghost-button" type="button" onClick={(e) => void handleDeleteConversation(conv.id, e)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


function HoldRing({ cursor, progress }: { cursor: CursorPayload; progress: number }) {
  const radius = 12;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className="hold-ring" style={{ transform: `translate3d(${cursor.localX - 16}px, ${cursor.localY - 16}px, 0)` }} viewBox="0 0 32 32">
      <circle className="hold-ring-track" cx="16" cy="16" r={radius} />
      <circle className="hold-ring-progress" cx="16" cy="16" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} />
    </svg>
  );
}

function ToolRows({ events }: { events: Array<Extract<AgentEvent, { type: 'tool.started' | 'tool.completed' }>> }) {
  return (
    <div className="tool-rows">
      {events.map((event, index) => (
        <div key={`${event.type}-${index}`}>
          <span>{event.type === 'tool.started' ? 'Using' : 'Finished'}</span>
          <strong>{event.name}</strong>
        </div>
      ))}
    </div>
  );
}

function BackendCard({ title, status, children }: { title: string; status: BackendReadiness; children: ReactNode }) {
  return (
    <section className="backend-card">
      <header>
        <div>
          <h3>{title}</h3>
          <p>{status.detail}</p>
        </div>
        <span className={`config-status tone-${status.tone}`}>{status.label}</span>
      </header>
      <div className="backend-fields">{children}</div>
    </section>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange(value: string): void; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function NumberSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange(value: number): void;
}) {
  function commit(rawValue: string) {
    onChange(clampNumber(Number(rawValue), min, max, value));
  }

  return (
    <label className="field slider-field">
      <span>
        {label}
        <em>{value}{unit}</em>
      </span>
      <div className="slider-row">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => commit(event.target.value)} />
        <input type="number" min={min} max={max} step={step} value={value} onChange={(event) => commit(event.target.value)} />
      </div>
    </label>
  );
}

function SecretField({
  label,
  value,
  configured,
  clearQueued,
  onChange,
  onClear
}: {
  label: string;
  value: string;
  configured: boolean;
  clearQueued: boolean;
  onChange(value: string): void;
  onClear(): void;
}) {
  return (
    <label className="field secret-field">
      <span>
        {label}
        <em>{clearQueued ? 'Will clear' : configured ? 'Configured' : 'Not configured'}</em>
      </span>
      <div className="secret-row">
        <input
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={configured && !clearQueued ? 'Configured - paste to replace' : 'Paste key or token'}
        />
        <button type="button" onClick={onClear} disabled={!configured && !value}>Clear</button>
      </div>
    </label>
  );
}

function ArrowMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

function SettingsMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
      <path d="M18.7 13.2c.1-.4.1-.8.1-1.2s0-.8-.1-1.2l2-1.5-2-3.4-2.4 1a8.2 8.2 0 0 0-2.1-1.2L14 3h-4l-.3 2.7c-.8.3-1.5.7-2.1 1.2l-2.4-1-2 3.4 2 1.5c-.1.4-.1.8-.1 1.2s0 .8.1 1.2l-2 1.5 2 3.4 2.4-1c.6.5 1.3.9 2.1 1.2L10 21h4l.3-2.7c.8-.3 1.5-.7 2.1-1.2l2.4 1 2-3.4-2.1-1.5Z" />
    </svg>
  );
}

type BackendReadiness = {
  configured: boolean;
  label: string;
  detail: string;
  tone: StatusTone;
};

function backendReadiness(settings: AppSettings | null, backend: AgentBackendId): BackendReadiness {
  if (!settings) return { configured: false, label: 'Missing config', detail: 'Settings are loading.', tone: 'missing' };
  if (backend === 'auto') {
    const configured = selectableBackends.filter((item) => item !== 'auto').some((item) => backendReadiness(settings, item).configured);
    return configured
      ? { configured: true, label: 'Ready', detail: 'Auto will choose from configured backends.', tone: 'ready' }
      : { configured: false, label: 'Missing config', detail: 'Configure at least one backend.', tone: 'missing' };
  }
  if (backend === 'local-vlm') {
    if (!settings.localVlmEnabled) return { configured: false, label: 'Missing config', detail: 'Local VLM is disabled.', tone: 'missing' };
    if (!settings.localVlmBaseUrl.trim()) return { configured: false, label: 'Missing config', detail: 'Add a Local VLM base URL.', tone: 'missing' };
    if (!settings.hasLocalVlmApiKey) return { configured: false, label: 'Missing config', detail: 'Add a Local VLM API key.', tone: 'missing' };
    return { configured: true, label: 'Ready', detail: 'Base URL and API key are configured.', tone: 'ready' };
  }
  if (backend === 'hermes') {
    if (!settings.hermesBaseUrl.trim()) return { configured: false, label: 'Missing config', detail: 'Add a Hermes base URL.', tone: 'missing' };
    return { configured: true, label: 'Ready', detail: settings.hasHermesApiKey ? 'Base URL and token are configured.' : 'Base URL configured; token optional.', tone: 'ready' };
  }
  if (backend === 'opencode') {
    if (!settings.opencodeBaseUrl.trim()) return { configured: false, label: 'Missing config', detail: 'Add an OpenCode base URL.', tone: 'missing' };
    return { configured: true, label: 'Ready', detail: settings.hasOpenCodeApiKey ? 'Base URL and token are configured.' : 'Base URL configured; token optional.', tone: 'ready' };
  }
  if (backend === 'claude-agent') {
    if (!settings.claudeAgentEnabled) return { configured: false, label: 'Missing config', detail: 'Claude Agent is disabled.', tone: 'missing' };
    if (!settings.hasClaudeAgentApiKey) return { configured: false, label: 'Missing config', detail: 'Add a Claude Agent API key.', tone: 'missing' };
    return { configured: true, label: 'Ready', detail: 'Claude Agent is enabled with a configured key.', tone: 'ready' };
  }
  if (backend === 'codex') {
    if (!settings.codexAppServerUrl.trim()) return { configured: false, label: 'Missing config', detail: 'Add a Codex app-server URL.', tone: 'missing' };
    return { configured: true, label: 'Ready', detail: settings.hasCodexApiKey ? 'Server URL and token are configured.' : 'Server URL configured; token optional.', tone: 'ready' };
  }
  return { configured: true, label: 'Ready', detail: 'Backend is available.', tone: 'ready' };
}

function runtimeStatusFor(state: UiState, readiness: BackendReadiness): { label: string; tone: StatusTone } {
  if (!readiness.configured) return { label: 'Missing config', tone: 'missing' };
  if (state === 'submitting') return { label: 'Connecting', tone: 'working' };
  if (state === 'streaming') return { label: 'Streaming', tone: 'working' };
  if (state === 'approval') return { label: 'Approval needed', tone: 'approval' };
  if (state === 'failed') return { label: 'Failed', tone: 'failed' };
  return { label: 'Ready', tone: 'ready' };
}

function secretConfigured(stored: boolean, draft: string, clearQueued: boolean): boolean {
  if (clearQueued) return false;
  return stored || Boolean(draft.trim());
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(Math.min(max, Math.max(min, numeric)));
}

function computeShellPosition(
  cursorX: number,
  cursorY: number,
  shellWidth = 520,
  pillHeight = 44,
  hasPanel = false
) {
  // Determine overall estimated height of the shell
  const shellHeight = !hasPanel ? pillHeight : 320;

  // Horizontal Position
  let preferredX = cursorX + 36;
  
  // If the right edge of the shell overflows the screen edge (with 12px margin),
  // we try to flip it to the left side of the cursor.
  if (cursorX + 36 + shellWidth + 12 > window.innerWidth) {
    if (cursorX - shellWidth - 36 >= 12) {
      preferredX = cursorX - shellWidth - 36;
    } else {
      preferredX = cursorX - shellWidth - 36;
    }
  }

  // Vertical Position
  const preferredY = cursorY - pillHeight / 2;
  let y = preferredY;

  // Check bottom boundary collision
  if (preferredY + shellHeight + 12 > window.innerHeight) {
    y = cursorY - shellHeight - 24;
  }
  
  // Check top boundary collision
  if (y < 12) {
    y = cursorY + 24;
  }

  // Final clamps to ensure the shell stays completely on-screen
  return {
    x: Math.min(Math.max(12, preferredX), Math.max(12, window.innerWidth - shellWidth - 12)),
    y: Math.min(Math.max(12, y), Math.max(12, window.innerHeight - shellHeight - 12))
  };
}

function focusPromptInput(input: HTMLTextAreaElement | null) {
  input?.focus({ preventScroll: true });
}

function normalizeSelection(rect: SelectionRect): SelectionRect {
  return {
    x1: Math.min(rect.x1, rect.x2),
    y1: Math.min(rect.y1, rect.y2),
    x2: Math.max(rect.x1, rect.x2),
    y2: Math.max(rect.y1, rect.y2)
  };
}

function clampSelection(rect: SelectionRect, width: number, height: number): SelectionRect {
  const normalized = normalizeSelection(rect);
  return {
    x1: Math.max(0, Math.min(width, normalized.x1)),
    y1: Math.max(0, Math.min(height, normalized.y1)),
    x2: Math.max(0, Math.min(width, normalized.x2)),
    y2: Math.max(0, Math.min(height, normalized.y2))
  };
}

function selectionFromDrag(drag: SelectionDrag, clientX: number, clientY: number, width: number, height: number): SelectionRect {
  const dx = clientX - drag.startX;
  const dy = clientY - drag.startY;
  if (drag.kind === 'move') {
    const rectWidth = drag.initial.x2 - drag.initial.x1;
    const rectHeight = drag.initial.y2 - drag.initial.y1;
    const x1 = Math.max(0, Math.min(width - rectWidth, drag.initial.x1 + dx));
    const y1 = Math.max(0, Math.min(height - rectHeight, drag.initial.y1 + dy));
    return { x1, y1, x2: x1 + rectWidth, y2: y1 + rectHeight };
  }

  const next = { ...drag.initial };
  if (drag.handle.includes('w')) next.x1 += dx;
  if (drag.handle.includes('e')) next.x2 += dx;
  if (drag.handle.includes('n')) next.y1 += dy;
  if (drag.handle.includes('s')) next.y2 += dy;
  return clampSelection(next, width, height);
}

function placeholderForState(state: UiState, readiness: BackendReadiness): string {
  if (!readiness.configured) return readiness.detail;
  if (state === 'submitting') return 'Connecting...';
  if (state === 'streaming') return 'Ask a follow-up...';
  if (state === 'failed') return 'Try again...';
  return 'Input text...';
}

function backendLabel(backend: AgentBackendId): string {
  switch (backend) {
    case 'local-vlm':
      return 'Local VLM';
    case 'hermes':
      return 'Hermes';
    case 'opencode':
      return 'OpenCode';
    case 'claude-agent':
      return 'Claude Agent';
    case 'codex':
      return 'Codex';
    case 'mock':
      return 'Mock';
    case 'auto':
      return 'Auto';
  }
}

function statusLabel(state: UiState): string {
  switch (state) {
    case 'submitting':
      return 'Connecting';
    case 'streaming':
      return 'Streaming';
    case 'approval':
      return 'Approval';
    case 'completed':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'holding':
      return 'Holding';
    case 'composing':
      return 'Ready';
    case 'idle':
      return 'Idle';
  }
}

function latestEvent<T extends AgentEvent['type']>(events: AgentEvent[], type: T): Extract<AgentEvent, { type: T }> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === type) return event as Extract<AgentEvent, { type: T }>;
  }
  return undefined;
}

function isToolEvent(event: AgentEvent): event is Extract<AgentEvent, { type: 'tool.started' | 'tool.completed' }> {
  return event.type === 'tool.started' || event.type === 'tool.completed';
}

function estimateTextTokens(text: string): number {
  let englishWordCount = 0;
  let chineseCharCount = 0;
  for (const char of text) {
    if (char.charCodeAt(0) > 127) {
      chineseCharCount++;
    } else if (/\w/.test(char)) {
      englishWordCount += 0.25;
    } else {
      englishWordCount += 0.15;
    }
  }
  return Math.ceil(chineseCharCount * 0.6 + englishWordCount);
}
