import { useEffect, useMemo, useRef, useState } from 'react';
import type { Point, PointerActionPlan, PointerContext, PointerGestureKind, PointerIntent } from '@openmagicpointer/core';
import type { AppSettings } from '@openmagicpointer/storage';
import { parseVoiceCommand } from '@openmagicpointer/voice';
import type { CursorPayload } from '../../shared/types';
import { CursorTrail } from './CursorTrail';

type CaptureMode = 'none' | 'sweep' | 'lasso' | 'rectangle';

const initialCursor: CursorPayload = { x: 300, y: 300, localX: 300, localY: 300, displayId: 0, dpr: 1 };

export function App() {
  const [cursor, setCursor] = useState<CursorPayload>(initialCursor);
  const [active, setActive] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [context, setContext] = useState<PointerContext | null>(null);
  const [contexts, setContexts] = useState<PointerContext[]>([]);
  const [intents, setIntents] = useState<PointerIntent[]>([]);
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [plan, setPlan] = useState<PointerActionPlan | null>(null);
  const [status, setStatus] = useState('');
  const [captureMode, setCaptureMode] = useState<CaptureMode>('none');
  const [path, setPath] = useState<Point[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [panelPosition, setPanelPosition] = useState({ x: 20, y: 20 });
  const drawingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; panelX: number; panelY: number } | null>(null);

  useEffect(() => {
    void window.openMagicPointer.getSettings().then(setSettings);
    return window.openMagicPointer.onCursor((payload) => setCursor(payload));
  }, []);

  useEffect(() => {
    const offActivate = window.openMagicPointer.onActivate((payload) => {
      setCursor(payload);
      setPanelPosition(computePanelPosition(payload.localX, payload.localY));
      setActive(true);
      setAnswer('');
      setPlan(null);
      window.openMagicPointer.setInteractive(true);
      void buildContext(payload, 'hover', [{ x: payload.localX, y: payload.localY, t: Date.now() }]);
    });
    const offDeactivate = window.openMagicPointer.onDeactivate(() => {
      setActive(false);
      setCaptureMode('none');
      setPath([]);
      window.openMagicPointer.setInteractive(false);
    });
    return () => {
      offActivate();
      offDeactivate();
    };
  }, []);

  useEffect(() => {
    window.openMagicPointer.ready();
  }, []);

  useEffect(() => {
    if (active && captureMode === 'none' && !settingsOpen) {
      focusPromptInput();
    }
  }, [active, captureMode, settingsOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (captureMode !== 'none') {
        setCaptureMode('none');
        setPath([]);
        drawingRef.current = false;
        setStatus('Selection canceled');
        return;
      }
      if (active || settingsOpen) {
        setSettingsOpen(false);
        setActive(false);
        setPlan(null);
        setPath([]);
        window.openMagicPointer.deactivate();
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [active, captureMode, settingsOpen]);

  function focusPromptInput() {
    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }

  function beginPanelDrag(event: React.PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('button,input,textarea,select')) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panelX: panelPosition.x,
      panelY: panelPosition.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePanelDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPanelPosition(clampPanelPosition({
      x: drag.panelX + event.clientX - drag.startX,
      y: drag.panelY + event.clientY - drag.startY
    }));
  }

  function endPanelDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released.
    }
    focusPromptInput();
  }

  async function buildContext(currentCursor = cursor, kind?: PointerGestureKind, gesturePath?: Point[]) {
    const result = await window.openMagicPointer.buildContext({
      cursor: currentCursor,
      gestureKind: kind,
      gesturePath
    });
    setContext(result.context);
    setIntents(result.intents);
    setContexts((prev) => [result.context, ...prev.filter((item) => item.id !== result.context.id)].slice(0, 6));
    setStatus(`${kind ?? 'pointer'} context captured`);
    focusPromptInput();
  }

  async function runPrompt(text = prompt) {
    if (!context) return;
    setStatus('Asking model...');
    setAnswer('');
    setPlan(null);
    const response = await window.openMagicPointer.query({ context, prompt: text || 'Explain this pointer context.' });
    setAnswer(response.answer);
    setIntents(response.intents);
    setStatus('Answer ready');
  }

  function clearContext() {
    setContext(null);
    setContexts([]);
    setIntents([]);
    setAnswer('');
    setPlan(null);
    setPath([]);
    setCaptureMode('none');
    setStatus('Context cleared');
    focusPromptInput();
  }

  async function chooseIntent(intent: PointerIntent) {
    if (!context) return;
    setStatus('Preparing action preview...');
    const nextPlan = await window.openMagicPointer.createPlan({ context, intent, prompt: prompt || intent.defaultPrompt });
    if (nextPlan.requiresConfirmation) {
      setPlan(nextPlan);
      setStatus('Preview ready');
      return;
    }
    await runPrompt(intent.defaultPrompt);
  }

  async function executePlan() {
    if (!plan) return;
    setStatus('Executing...');
    const result = await window.openMagicPointer.executePlan(plan);
    setStatus(result.ok ? result.summary : `Execution failed: ${result.error ?? result.summary}`);
    setPlan(null);
  }

  function startCapture(mode: CaptureMode) {
    if (captureMode === mode) {
      setCaptureMode('none');
      setPath([]);
      drawingRef.current = false;
      setStatus(`${mode} capture canceled`);
      focusPromptInput();
      return;
    }
    setCaptureMode(mode);
    setPath([]);
    setStatus(`${mode} capture armed`);
    window.openMagicPointer.setInteractive(true);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (captureMode === 'none') return;
    drawingRef.current = true;
    const point = { x: event.clientX, y: event.clientY, t: Date.now() };
    setPath([point]);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drawingRef.current || captureMode === 'none') return;
    setPath((prev) => [...prev, { x: event.clientX, y: event.clientY, t: Date.now() }].slice(-240));
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!drawingRef.current || captureMode === 'none') return;
    drawingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    const finalPath = [...path, { x: event.clientX, y: event.clientY, t: Date.now() }];
    const kind: PointerGestureKind = captureMode === 'rectangle' ? 'rectangle' : captureMode;
    setCaptureMode('none');
    setPath([]);
    void buildContext(cursor, kind, finalPath);
    focusPromptInput();
  }

  function startVoice() {
    const SpeechRecognitionCtor = (window.SpeechRecognition || window.webkitSpeechRecognition) as
      | (new () => {
          lang: string;
          interimResults: boolean;
          maxAlternatives: number;
          start(): void;
          stop(): void;
          onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
          onerror: (() => void) | null;
          onend: (() => void) | null;
        })
      | undefined;
    if (!SpeechRecognitionCtor) {
      setStatus('Speech recognition is not available in this runtime.');
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript ?? '';
      setPrompt(text);
      const command = parseVoiceCommand(text);
      if (command.kind === 'execute') void executePlan();
      else if (command.kind === 'cancel') setPlan(null);
      else void runPrompt(text);
    };
    recognition.onerror = () => setStatus('Voice recognition failed.');
    recognition.onend = () => setStatus('Voice input ended');
    setStatus('Listening...');
    recognition.start();
  }

  async function saveSettings() {
    const next = await window.openMagicPointer.saveSettings({
      ...(settings ?? {}),
      apiKey: apiKeyDraft || undefined
    });
    setSettings(next);
    setApiKeyDraft('');
    setSettingsOpen(false);
    setStatus('Settings saved');
  }

  return (
    <div
      className={`screen ${captureMode !== 'none' ? 'capture-active' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <CursorTrail x={cursor.localX} y={cursor.localY} enabled={Boolean(settings?.trailEnabled)} />

      {captureMode !== 'none' && (
        <div className="capture-hint">
          {captureMode === 'lasso' ? 'Draw around a region' : captureMode === 'sweep' ? 'Sweep across content' : 'Drag a rectangle'}
        </div>
      )}
      {path.length > 1 && <GestureOverlay points={path} mode={captureMode} />}

      {active && (
        <section className="panel" style={{ transform: `translate3d(${panelPosition.x}px, ${panelPosition.y}px, 0)` }}>
          <header
            className="panel-header"
            onPointerDown={beginPanelDrag}
            onPointerMove={movePanelDrag}
            onPointerUp={endPanelDrag}
            onPointerCancel={endPanelDrag}
          >
            <div>
              <strong>OpenMagicPointer</strong>
              <span>{status || 'Ready'}</span>
            </div>
            <div className="header-actions">
              <button onClick={() => setSettingsOpen(true)}>Settings</button>
              <button onClick={() => window.openMagicPointer.deactivate()}>Close</button>
            </div>
          </header>

          <div className="context-row">
            {contexts.map((item) => (
              <button key={item.id} className="context-chip" onClick={() => setContext(item)}>
                {item.gesture?.kind ?? item.target?.kind ?? 'context'}
              </button>
            ))}
            <button className="danger-button" onClick={clearContext} disabled={contexts.length === 0 && !context}>
              Clear context
            </button>
          </div>

          <div className="intent-row">
            {intents.map((intent) => (
              <button key={intent.id} onClick={() => void chooseIntent(intent)} title={intent.reason}>
                {intent.label}
              </button>
            ))}
          </div>

          <div className="input-row">
            <input ref={inputRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter') void runPrompt();
            }} placeholder="Ask, or pick an intent..." />
            <button onClick={startVoice}>Voice</button>
            <button onClick={() => void runPrompt()}>Ask</button>
          </div>

          <div className="tool-row">
            <button className={captureMode === 'sweep' ? 'active-tool' : ''} onClick={() => startCapture('sweep')}>Sweep</button>
            <button className={captureMode === 'lasso' ? 'active-tool' : ''} onClick={() => startCapture('lasso')}>Lasso</button>
            <button className={captureMode === 'rectangle' ? 'active-tool' : ''} onClick={() => startCapture('rectangle')}>Rectangle</button>
            {captureMode !== 'none' && <button onClick={() => startCapture(captureMode)}>Cancel selection</button>}
          </div>

          {plan && (
            <div className="preview">
              <strong>Action preview</strong>
              <pre>{plan.preview}</pre>
              <div>
                <button onClick={() => void executePlan()}>Confirm</button>
                <button onClick={() => setPlan(null)}>Cancel</button>
              </div>
            </div>
          )}

          {answer && <article className="answer">{answer}</article>}
        </section>
      )}

      {settingsOpen && settings && (
        <div className="modal">
          <div className="modal-card">
            <h2>Settings</h2>
            <label>
              Base URL
              <input value={settings.openAICompatibleBaseUrl} onChange={(event) => setSettings({ ...settings, openAICompatibleBaseUrl: event.target.value })} />
            </label>
            <label>
              Model
              <input value={settings.openAICompatibleModel} onChange={(event) => setSettings({ ...settings, openAICompatibleModel: event.target.value })} placeholder="Provider default" />
            </label>
            <label>
              API key
              <input value={apiKeyDraft} onChange={(event) => setApiKeyDraft(event.target.value)} type="password" placeholder={settings.hasApiKey ? 'Configured' : 'Paste key'} />
            </label>
            <label>
              Cua endpoint
              <input value={settings.cuaEndpoint} onChange={(event) => setSettings({ ...settings, cuaEndpoint: event.target.value })} />
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.wiggleEnabled} onChange={(event) => setSettings({ ...settings, wiggleEnabled: event.target.checked })} />
              Mouse wiggle activation
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.trailEnabled} onChange={(event) => setSettings({ ...settings, trailEnabled: event.target.checked })} />
              Cursor trail
            </label>
            <div className="modal-actions">
              <button onClick={() => void saveSettings()}>Save</button>
              <button onClick={() => setSettingsOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GestureOverlay({ points, mode }: { points: Point[]; mode: CaptureMode }) {
  if (points.length < 2) return null;
  if (mode === 'rectangle') {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const left = Math.min(first.x, last.x);
    const top = Math.min(first.y, last.y);
    return <div className="selection-rect" style={{ left, top, width: Math.abs(first.x - last.x), height: Math.abs(first.y - last.y) }} />;
  }
  const d = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  return (
    <svg className="gesture-path">
      <path d={d} fill="none" stroke="rgba(74, 222, 128, 0.95)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function computePanelPosition(cursorX: number, cursorY: number) {
  return clampPanelPosition({
    x: cursorX + 28,
    y: cursorY - 44
  });
}

function clampPanelPosition(pos: { x: number; y: number }) {
  const maxX = Math.max(20, window.innerWidth - 480);
  const maxY = Math.max(20, window.innerHeight - 360);
  return {
    x: Math.min(Math.max(20, pos.x), maxX),
    y: Math.min(Math.max(20, pos.y), maxY)
  };
}
