import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen } from 'electron';
import { activeWindow } from 'get-windows';
import { uIOhook } from 'uiohook-napi';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  createAgentBridge,
  resolveBackendForEnvelope,
  buildAgentContextEnvelope,
  type AgentBridge,
  type AgentBridgeRegistryConfig
} from '@openmagicpointer/agent-bridge';
import type { AgentContextEnvelope, AgentEvent, Point, PointerContext, PointerEntity, Rect } from '@openmagicpointer/core';
import { buildPointerContext } from '@openmagicpointer/grounding';
import { OMP_CHANNELS } from '../shared/ipc.js';
import type { CursorPayload, HoldProgressPayload, SubmitInstructionRequest } from '../shared/types.js';
import { CuaBroker } from './cua-broker.js';
import { CuaGroundingProvider } from './cua-grounding.js';
import { CuaSidecarManager } from './cua-sidecar.js';
import { loadLocalEnv } from './env.js';
import { getClaudeAgentApiKey, getCodexApiKey, getHermesApiKey, getLocalVlmApiKey, getOpenCodeApiKey, getSettings, saveSettings } from './settings.js';
import { ChatHistoryManager } from './history.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../..');
loadLocalEnv(repoRoot);

const windows = new Map<number, BrowserWindow>();
const overlayInteractive = new Map<number, boolean>();
let cursorTimer: NodeJS.Timeout | null = null;
let active = false;
let lastCursor: CursorPayload | null = null;
let lastActivationCursor: CursorPayload | null = null;
let activeAbort: AbortController | null = null;
let activeBridge: AgentBridge | null = null;
const cuaSidecar = new CuaSidecarManager(repoRoot);
const cuaGrounding = new CuaGroundingProvider(cuaSidecar);
const cuaBroker = new CuaBroker(cuaSidecar);
const chatHistory = new ChatHistoryManager();

// Single source of truth for the CUA tools exposed to the agent. This list is
// both advertised to the model (envelope.toolServers[].tools) and enforced by
// the broker as a whitelist, so the agent cannot invoke unlisted driver tools.
const CUA_AGENT_TOOLS = [
  'list_windows',
  'get_window_state',
  'click',
  'double_click',
  'right_click',
  'type_text',
  'press_key',
  'hotkey',
  'scroll',
  'drag',
  'set_value'
];

const hold = {
  active: false,
  completed: false,
  start: null as CursorPayload | null,
  startedWhileActive: false,
  startedAt: 0,
  timer: null as NodeJS.Timeout | null,
  progressTimer: null as NodeJS.Timeout | null
};

const HOLD_MS = 650;
const HOLD_RING_DELAY_MS = 180;
const HOLD_MOVE_TOLERANCE_PX = 8;
const OVERLAY_HIDE_SETTLE_MS = 80;
const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
let overlayHiddenDepth = 0;
let overlayVisibilitySnapshot = new Map<number, boolean>();
let overlayRestoreFocusDisplayId: number | null = null;
let overlayHideReady: Promise<void> | null = null;

async function createOverlay(display: Electron.Display): Promise<void> {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  windows.set(display.id, win);
  overlayInteractive.set(display.id, false);
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.on('did-finish-load', () => {
    if (!win.isVisible()) win.showInactive();
    const payload = cursorPayload();
    win.webContents.send(OMP_CHANNELS.Cursor, payload);
    if (active) win.webContents.send(OMP_CHANNELS.Activate, payload);
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[omp] overlay failed to load', { displayId: display.id, errorCode, errorDescription, validatedURL });
  });

  if (process.env.NODE_ENV === 'production' || app.isPackaged) {
    await win.loadFile(join(__dirname, '../../dist/index.html'), { query: { displayId: String(display.id) } });
  } else {
    await win.loadURL(`${devUrl}?displayId=${display.id}`);
  }
  if (!win.isVisible()) win.showInactive();
  win.on('closed', () => {
    windows.delete(display.id);
    overlayInteractive.delete(display.id);
  });
}

function cursorPayload(): CursorPayload {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  return {
    x: point.x,
    y: point.y,
    localX: point.x - display.bounds.x,
    localY: point.y - display.bounds.y,
    displayId: display.id,
    dpr: display.scaleFactor
  };
}

function broadcast(channel: string, payload?: unknown): void {
  for (const win of windows.values()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function setOverlayInteractive(displayId: number, value: boolean): void {
  const win = windows.get(displayId);
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(!value, { forward: true });
  overlayInteractive.set(displayId, value);
}

function setWindowInteractive(win: BrowserWindow, value: boolean): void {
  if (win.isDestroyed()) return;
  win.setIgnoreMouseEvents(!value, { forward: true });
  for (const [displayId, candidate] of windows) {
    if (candidate === win) {
      overlayInteractive.set(displayId, value);
      break;
    }
  }
}

async function withOverlayHidden<T>(focusDisplayId: number | undefined, task: () => Promise<T>): Promise<T> {
  if (focusDisplayId !== undefined) overlayRestoreFocusDisplayId = focusDisplayId;
  const firstHiddenRequest = overlayHiddenDepth === 0;
  overlayHiddenDepth += 1;
  if (firstHiddenRequest) {
    overlayHideReady = hideOverlaysForDesktopRead();
  }

  try {
    await overlayHideReady;
    return await task();
  } finally {
    overlayHiddenDepth -= 1;
    if (overlayHiddenDepth === 0) {
      restoreHiddenOverlays();
      overlayHideReady = null;
    }
  }
}

async function hideOverlaysForDesktopRead(): Promise<void> {
  overlayVisibilitySnapshot = new Map();
  for (const [displayId, win] of windows) {
    if (win.isDestroyed()) continue;
    overlayVisibilitySnapshot.set(displayId, win.isVisible());
    if (win.isVisible()) win.hide();
  }
  await wait(OVERLAY_HIDE_SETTLE_MS);
}

function restoreHiddenOverlays(): void {
  const focusDisplayId = overlayRestoreFocusDisplayId;
  overlayRestoreFocusDisplayId = null;

  for (const [displayId, win] of windows) {
    if (win.isDestroyed() || !overlayVisibilitySnapshot.get(displayId)) continue;
    win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
  }

  if (active && focusDisplayId !== null) {
    const activeWin = windows.get(focusDisplayId);
    if (activeWin && !activeWin.isDestroyed() && overlayVisibilitySnapshot.get(focusDisplayId)) {
      activeWin.show();
      activeWin.focus();
      activeWin.webContents.focus();
    }
  }

  overlayVisibilitySnapshot.clear();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Escape closes the overlay. We register it as a global shortcut only while
// active so Electron exclusively captures the key (via RegisterHotKey on
// Windows) and it never leaks through to the focused app's own Esc shortcuts.
// Outside of the active session Esc is left untouched for every other app.
let escRegistered = false;

function registerEscapeShortcut(): void {
  if (escRegistered) return;
  try {
    escRegistered = globalShortcut.register('Escape', () => {
      if (active) deactivate();
    });
  } catch (error) {
    console.warn('[omp] failed to register Escape shortcut', error);
    escRegistered = false;
  }
}

function unregisterEscapeShortcut(): void {
  if (!escRegistered) return;
  try {
    globalShortcut.unregister('Escape');
  } catch (error) {
    console.warn('[omp] failed to unregister Escape shortcut', error);
  }
  escRegistered = false;
}

function activate(cursor = cursorPayload()): void {
  active = true;
  lastActivationCursor = cursor;
  registerEscapeShortcut();
  const activeWin = windows.get(cursor.displayId);
  for (const win of windows.values()) {
    if (win.isDestroyed()) continue;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
  }
  if (activeWin && !activeWin.isDestroyed()) {
    setOverlayInteractive(cursor.displayId, true);
    activeWin.show();
    activeWin.focus();
    activeWin.webContents.focus();
  }
  broadcast(OMP_CHANNELS.Activate, cursor);
}

function deactivate(): void {
  active = false;
  unregisterEscapeShortcut();
  activeAbort?.abort();
  activeAbort = null;
  activeBridge = null;
  broadcast(OMP_CHANNELS.Deactivate);
  for (const [displayId, win] of windows) {
    if (!win.isDestroyed()) setOverlayInteractive(displayId, false);
  }
}

let registeredHotkey: string | null = null;

function registerActivationHotkey(hotkey: string): boolean {
  if (registeredHotkey && globalShortcut.isRegistered(registeredHotkey)) {
    globalShortcut.unregister(registeredHotkey);
  }
  registeredHotkey = null;
  if (!hotkey) return false;
  let registered = false;
  try {
    registered = globalShortcut.register(hotkey, () => (active ? deactivate() : activate()));
  } catch (error) {
    console.error('[omp] global shortcut error', hotkey, error);
    return false;
  }
  if (registered) registeredHotkey = hotkey;
  console.log('[omp] global shortcut', hotkey, registered ? 'registered' : 'failed');
  return registered;
}

function startCursorLoop(): void {
  if (cursorTimer) return;
  cursorTimer = setInterval(() => {
    const payload = cursorPayload();
    lastCursor = payload;
    broadcast(OMP_CHANNELS.Cursor, payload);
  }, 33);
}

function startGlobalLongPress(): void {
  try {
    uIOhook.on('mousedown', (event) => {
      if (isSecondaryMouseButton(event.button)) {
        handleGlobalContextMouseDown();
        return;
      }
      if (!getSettings().longPressEnabled || !isPrimaryMouseButton(event.button)) return;
      const cursor = cursorPayload();
      hold.active = true;
      hold.completed = false;
      hold.start = cursor;
      hold.startedWhileActive = active;
      hold.startedAt = Date.now();
      hold.timer = setTimeout(() => completeHold(), HOLD_MS);
      hold.progressTimer = setInterval(() => {
        if (!hold.active || !hold.start) return;
        const elapsed = Date.now() - hold.startedAt;
        if (elapsed < HOLD_RING_DELAY_MS) return;
        const progress = Math.min(1, (elapsed - HOLD_RING_DELAY_MS) / (HOLD_MS - HOLD_RING_DELAY_MS));
        broadcastHold({ cursor: hold.start, progress, state: 'holding', startedWhileActive: hold.startedWhileActive });
      }, 32);
    });

    uIOhook.on('mousemove', (event) => {
      if (!hold.active || !hold.start || hold.completed) return;
      const distance = Math.hypot(event.x - hold.start.x, event.y - hold.start.y);
      if (distance > HOLD_MOVE_TOLERANCE_PX) cancelHold();
    });

    uIOhook.on('mouseup', (event) => {
      if (!isPrimaryMouseButton(event.button)) return;
      if (hold.active && !hold.completed) cancelHold();
    });

    uIOhook.start();
  } catch (error) {
    console.warn('[omp] global long-press hook unavailable', error);
  }
}

function completeHold(): void {
  if (!hold.active || !hold.start) return;
  hold.completed = true;
  clearHoldTimers();
  broadcastHold({ cursor: hold.start, progress: 1, state: 'completed', startedWhileActive: hold.startedWhileActive });
  activate(hold.start);
  hold.active = false;
  hold.startedWhileActive = false;
}

function cancelHold(): void {
  if (!hold.active || !hold.start) return;
  broadcastHold({ cursor: hold.start, progress: 0, state: 'canceled', startedWhileActive: hold.startedWhileActive });
  hold.active = false;
  hold.completed = false;
  hold.start = null;
  hold.startedWhileActive = false;
  clearHoldTimers();
}

function clearHoldTimers(): void {
  if (hold.timer) clearTimeout(hold.timer);
  if (hold.progressTimer) clearInterval(hold.progressTimer);
  hold.timer = null;
  hold.progressTimer = null;
}

function broadcastHold(payload: HoldProgressPayload): void {
  broadcast(OMP_CHANNELS.HoldProgress, payload);
}

function isPrimaryMouseButton(button: unknown): boolean {
  return button === 1 || button === 0 || button === 'left';
}

function isSecondaryMouseButton(button: unknown): boolean {
  return button === 2 || button === 'right';
}

function handleGlobalContextMouseDown(): void {
  if (!active) return;
  const cursor = cursorPayload();
  const win = windows.get(cursor.displayId);
  if (!win || win.isDestroyed()) return;
  if (overlayInteractive.get(cursor.displayId)) return;

  // When the transparent overlay is in pass-through mode, renderer
  // `contextmenu` events never fire. Wake this display just long enough for
  // the renderer to run the same edit-mode toggle path.
  setOverlayInteractive(cursor.displayId, true);
  win.webContents.send(OMP_CHANNELS.GlobalContextMenu, cursor);
}

function registerIpc(): void {
  ipcMain.on(OMP_CHANNELS.SetInteractive, (event, value: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) setWindowInteractive(win, value);
  });

  ipcMain.on(OMP_CHANNELS.RequestDeactivate, () => deactivate());
  ipcMain.on(OMP_CHANNELS.CancelRun, () => activeAbort?.abort());

  ipcMain.on(OMP_CHANNELS.RendererReady, (event) => {
    const payload = cursorPayload();
    event.sender.send(OMP_CHANNELS.Cursor, payload);
    if (active) event.sender.send(OMP_CHANNELS.Activate, lastActivationCursor ?? payload);
  });

  ipcMain.handle(OMP_CHANNELS.GetSettings, () => getSettings());
  ipcMain.handle(OMP_CHANNELS.SaveSettings, (_event, patch) => {
    const next = saveSettings(patch);
    // Re-apply runtime settings that are bound at registration time so saved
    // changes (e.g. the activation hotkey) take effect without a restart.
    registerActivationHotkey(next.activationHotkey);
    return next;
  });
  ipcMain.handle(OMP_CHANNELS.GetConversations, () => chatHistory.getConversations());
  ipcMain.handle(OMP_CHANNELS.GetConversation, (_event, id: string) => chatHistory.getConversation(id));
  ipcMain.handle(OMP_CHANNELS.DeleteConversation, (_event, id: string) => chatHistory.deleteConversation(id));
  ipcMain.handle(OMP_CHANNELS.FetchVisionModels, async (_event, req: { baseUrl: string; apiKey: string }) => {
    try {
      const apiKey = req.apiKey || getLocalVlmApiKey();
      const response = await fetch(`${req.baseUrl.replace(/\/$/, '')}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
      }
      const data = (await response.json()) as { data?: Array<{ id: string }> };
      const models = data.data?.map((m) => m.id) ?? [];
      const visionModels = models.filter((name) => /vision|vl|multimodal|gpt-4o|claude-3|gemini|minicpm|internvl|llama-3\.2.*vision|deepseek-vl/i.test(name));
      return { success: true, models: visionModels.length > 0 ? visionModels : models };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle(OMP_CHANNELS.RequestGrounding, async (_event, req: { cursor: CursorPayload }) => {
    const settings = getSettings();
    if (settings.cuaMode === 'off') return { status: 'fallback', entities: [], error: 'CUA mode is off.' };
    // Live CUA preview is accessibility-tree based; hiding the overlay here
    // makes the composer blink whenever background grounding refreshes.
    return cuaGrounding.preview(req.cursor, await activeWindowInfo());
  });
  ipcMain.handle(OMP_CHANNELS.ApproveAgentRequest, async (_event, id: string, decision: 'approve' | 'deny') => {
    if (cuaBroker.hasPendingApproval(id)) {
      cuaBroker.approve(id, decision);
      return;
    }
    await activeBridge?.approve?.(id, decision);
  });

  ipcMain.handle(OMP_CHANNELS.SubmitInstruction, async (event, req: SubmitInstructionRequest) => {
    activeAbort?.abort();
    const settings = getSettings();
    const cursor = req.cursor ?? lastActivationCursor ?? lastCursor ?? cursorPayload();
    const includeCua = Boolean(req.includeCua) && settings.cuaMode !== 'off';
    const providedCuaEntities = includeCua ? (req.cuaEntities ?? []) : [];
    const context = req.includeScreenshot
      ? await capturePointerContext(cursor, req.targetPath, req.selectedEntity, includeCua && providedCuaEntities.length === 0, providedCuaEntities)
      : await buildLightPointerContext(cursor, req.selectedEntity, providedCuaEntities, includeCua);

    const conversationId = req.conversationId || `conv-${Date.now()}`;
    await chatHistory.appendTurn(conversationId, {
      id: `turn-${Date.now()}-user`,
      role: 'user',
      text: req.text,
      pointerContext: context,
      timestamp: Date.now()
    });
    const conversation = await chatHistory.getConversation(conversationId);

    const initialEnvelope = buildAgentContextEnvelope({
      instruction: req.text,
      mode: req.mode,
      context,
      backend: req.backend ?? settings.agentBackend
    });
    if (conversation) {
      initialEnvelope.conversationId = conversationId;
      initialEnvelope.history = conversation.turns;
    }
    const config = bridgeConfig(settings);
    const backend = resolveBackendForEnvelope(initialEnvelope, config);
    const cuaBrokerSession =
      context.grounding?.status === 'matched'
        ? await cuaBroker.ensureStarted({
            requireApprovalBeforeCua: settings.requireApprovalBeforeCua,
            allowedTools: CUA_AGENT_TOOLS,
            emit: (agentEvent) => event.sender.send(OMP_CHANNELS.AgentEvent, agentEvent)
          })
        : undefined;
    const envelope: AgentContextEnvelope = {
      ...initialEnvelope,
      routing: { ...initialEnvelope.routing, backend },
      toolServers: cuaBrokerSession
        ? [
            {
              id: 'cua',
              transport: 'local-http',
              sessionId: cuaBrokerSession.sessionId,
              endpoint: cuaBrokerSession.endpoint,
              tools: CUA_AGENT_TOOLS
            }
          ]
        : initialEnvelope.toolServers
    };
    const controller = new AbortController();
    activeAbort = controller;
    activeBridge = createAgentBridge(backend, config);
    void streamBridgeEvents(event.sender, activeBridge, envelope, controller, settings.localVlmEnabled && backend !== 'local-vlm');
    return { requestId: envelope.requestId, backend, conversationId };
  });
}

async function streamBridgeEvents(
  sender: Electron.WebContents,
  bridge: AgentBridge,
  envelope: AgentContextEnvelope,
  controller: AbortController,
  allowLocalFallback: boolean
): Promise<void> {
  let emittedStarted = false;
  let sawTerminal = false;
  let fullAnswer = '';

  const forward = (agentEvent: AgentEvent) => {
    sender.send(OMP_CHANNELS.AgentEvent, agentEvent);
    if (agentEvent.type === 'run.completed' || agentEvent.type === 'run.failed') sawTerminal = true;
  };

  for await (const agentEvent of bridge.run(envelope, { signal: controller.signal, sessionKey: sessionKeyForContext(envelope.pointerContext) })) {
    if (agentEvent.type === 'run.failed' && agentEvent.recoverable && allowLocalFallback && !emittedStarted) {
      // Recover silently via the local VLM instead of surfacing the primary failure to the UI.
      const localEnvelope: AgentContextEnvelope = { ...envelope, routing: { ...envelope.routing, backend: 'local-vlm' } };
      forward({ type: 'assistant.delta', text: 'Agent backend is unavailable. Falling back to local VLM.' });
      const localBridge = createAgentBridge('local-vlm', bridgeConfig(getSettings()));
      for await (const localEvent of localBridge.run(localEnvelope, { signal: controller.signal })) {
        forward(localEvent);
        if (localEvent.type === 'assistant.delta') fullAnswer += localEvent.text;
      }
      break;
    }
    forward(agentEvent);
    if (agentEvent.type === 'run.started') emittedStarted = true;
    if (agentEvent.type === 'assistant.delta') fullAnswer += agentEvent.text;
  }

  // Guarantee the UI leaves the streaming state even if the runtime stream
  // closed without a terminal (run.completed / run.failed) event.
  if (!sawTerminal) forward({ type: 'run.completed', text: fullAnswer || undefined });

  if (envelope.conversationId && fullAnswer) {
    await chatHistory.appendTurn(envelope.conversationId, {
      id: `turn-${Date.now()}-assistant`,
      role: 'assistant',
      text: fullAnswer,
      timestamp: Date.now()
    });
  }
}

function bridgeConfig(settings = getSettings()): AgentBridgeRegistryConfig {
  const localApiKey = getLocalVlmApiKey();
  return {
    localVlm: settings.localVlmEnabled
      ? {
          baseUrl: settings.localVlmBaseUrl,
          model: settings.localVlmModel || undefined,
          apiKey: localApiKey,
          contextWindow: settings.localVlmContextWindow || 32768
        }
      : undefined,
    hermes: settings.hermesBaseUrl ? { baseUrl: settings.hermesBaseUrl, apiKey: getHermesApiKey() } : undefined,
    opencode: settings.opencodeBaseUrl ? { baseUrl: settings.opencodeBaseUrl, apiKey: getOpenCodeApiKey() } : undefined,
    claudeAgent: {
      enabled: settings.claudeAgentEnabled,
      apiKey: getClaudeAgentApiKey(),
      baseUrl: settings.claudeAgentBaseUrl || undefined,
      executable: settings.claudeAgentExecutable || undefined
    },
    codex: settings.codexAppServerUrl ? { baseUrl: settings.codexAppServerUrl, apiKey: getCodexApiKey() } : undefined
  };
}

async function capturePointerContext(
  cursor: CursorPayload,
  targetPath?: Point[],
  selectedEntity?: PointerEntity,
  useCua = true,
  seedCuaEntities: PointerEntity[] = []
): Promise<PointerContext> {
  // Signal the renderer that a submit-time screenshot is being taken so the
  // pointer can tint accordingly. `withCua` distinguishes a plain screenshot
  // (purple) from a screenshot that is paired with CUA grounding (teal).
  const withCua = useCua || Boolean(selectedEntity?.groundingRef) || seedCuaEntities.some((entity) => entity.groundingRef?.provider === 'cua');
  broadcast(OMP_CHANNELS.CaptureActivity, { phase: 'start', withCua });
  let capture: Awaited<ReturnType<typeof captureContextImage>>;
  let windowInfo: PointerContext['window'];
  let cuaPreview: Awaited<ReturnType<CuaGroundingProvider['preview']>> | undefined;
  try {
    const hiddenResult = await withOverlayHidden(cursor.displayId, async () => {
      const currentWindow = await activeWindowInfo();
      const [contextImage, groundingPreview] = await Promise.all([
        captureContextImage(cursor, targetPath),
        useCua ? cuaGrounding.preview(cursor, currentWindow) : Promise.resolve(undefined)
      ]);
      return {
        capture: contextImage,
        windowInfo: currentWindow,
        cuaPreview: groundingPreview
      };
    });
    capture = hiddenResult.capture;
    windowInfo = hiddenResult.windowInfo;
    cuaPreview = hiddenResult.cuaPreview;
  } finally {
    broadcast(OMP_CHANNELS.CaptureActivity, { phase: 'end', withCua });
  }

  const manualEntities = targetPath && targetPath.length > 1 ? visualEntities(cursor, capture.crop, targetPath) : [];
  const seededCuaEntities = seedCuaEntities.filter((entity) => entity.groundingRef?.provider === 'cua');
  const cuaEntities = seededCuaEntities.length > 0 ? seededCuaEntities : (cuaPreview?.entities ?? []);

  const entities = dedupeEntities(
    selectedEntity
      ? [selectedEntity, ...cuaEntities, ...manualEntities]
      : targetPath && targetPath.length > 1
        ? [...manualEntities, ...cuaEntities]
        : [...cuaEntities, ...manualEntities]
  );

  const context = buildPointerContext({
    cursor,
    source: 'desktop',
    window: windowInfo,
    entities,
    gestureKind: targetPath && targetPath.length > 1 ? 'rectangle' : 'hover',
    gesturePath: targetPath && targetPath.length > 0 ? targetPath : [{ x: cursor.localX, y: cursor.localY, t: Date.now() }],
    screenshotId: capture.id,
    imageBase64: capture.imageBase64,
    mimeType: capture.mimeType,
    crop: capture.crop
  });

  if (selectedEntity?.groundingRef || seededCuaEntities.length > 0) {
    context.grounding = groundingFromEntities(selectedEntity ? [selectedEntity, ...cuaEntities] : cuaEntities);
  } else if (useCua && cuaPreview) {
    context.grounding = {
      provider: 'cua',
      status: cuaPreview.status,
      pid: cuaPreview.pid,
      windowId: cuaPreview.windowId,
      elementCount: cuaPreview.entities.length,
      error: cuaPreview.error
    };
  }

  return context;
}

async function buildLightPointerContext(
  cursor: CursorPayload,
  selectedEntity: PointerEntity | undefined,
  cuaEntities: PointerEntity[],
  includeCua: boolean
): Promise<PointerContext> {
  const windowInfo = await activeWindowInfo();
  let groundingPreview: Awaited<ReturnType<CuaGroundingProvider['preview']>> | undefined;
  let groundedEntities = includeCua ? cuaEntities.filter((entity) => entity.groundingRef?.provider === 'cua') : [];
  if (includeCua && groundedEntities.length === 0) {
    groundingPreview = await cuaGrounding.preview(cursor, windowInfo);
    groundedEntities = groundingPreview.entities;
  }
  const entities = dedupeEntities(selectedEntity ? [selectedEntity, ...groundedEntities] : groundedEntities);
  const context = buildPointerContext({
    cursor,
    source: 'desktop',
    window: windowInfo,
    entities,
    gestureKind: 'hover',
    gesturePath: [{ x: cursor.localX, y: cursor.localY, t: Date.now() }]
  });

  if (selectedEntity?.groundingRef || groundedEntities.length > 0) {
    context.grounding = groundingFromEntities(selectedEntity ? [selectedEntity, ...groundedEntities] : groundedEntities);
  } else if (includeCua && groundingPreview) {
    context.grounding = {
      provider: 'cua',
      status: groundingPreview.status,
      pid: groundingPreview.pid,
      windowId: groundingPreview.windowId,
      elementCount: groundingPreview.entities.length,
      error: groundingPreview.error
    };
  }

  return context;
}

function groundingFromEntities(entities: PointerEntity[]): PointerContext['grounding'] {
  const ref = entities.find((entity) => entity.groundingRef?.provider === 'cua')?.groundingRef;
  const uniqueGroundedIds = new Set(entities.filter((entity) => entity.groundingRef?.provider === 'cua').map((entity) => entity.id));
  return {
    provider: 'cua',
    status: 'matched',
    pid: ref?.pid,
    windowId: ref?.windowId,
    elementCount: Math.max(1, uniqueGroundedIds.size)
  };
}

function dedupeEntities(entities: PointerEntity[]): PointerEntity[] {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    if (seen.has(entity.id)) return false;
    seen.add(entity.id);
    return true;
  });
}

async function activeWindowInfo(): Promise<PointerContext['window']> {
  try {
    const info = await activeWindow({ screenRecordingPermission: false, accessibilityPermission: false });
    if (!info) return undefined;
    return {
      title: info.title,
      app: info.owner?.name,
      process: info.owner?.name,
      windowId: String(info.id)
    };
  } catch {
    return undefined;
  }
}

function visualEntities(cursor: CursorPayload, crop: Rect, targetPath?: Point[]): PointerEntity[] {
  const bbox =
    targetPath && targetPath.length > 1
      ? bboxFromPoints(targetPath)
      : {
          x: Math.max(0, cursor.localX - 24),
          y: Math.max(0, cursor.localY - 24),
          width: 48,
          height: 48
        };
  return [
    {
      id: `entity-${Date.now()}`,
      kind: 'image',
      text: targetPath && targetPath.length > 1 ? 'Pointer-selected screen region' : 'Pointer target region',
      bbox: bbox.width > 0 && bbox.height > 0 ? bbox : crop,
      confidence: 0.72,
      origin: 'manual'
    }
  ];
}

async function captureContextImage(
  cursor: CursorPayload,
  targetPath?: Point[]
): Promise<{
  id: string;
  imageBase64: string;
  mimeType: 'image/jpeg';
  crop: Rect;
}> {
  const display = screen.getDisplayMatching({ x: cursor.x, y: cursor.y, width: 1, height: 1 });
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor)
    }
  });
  const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('Screen capture failed. Check screen recording permissions.');
  }

  const image = source.thumbnail;
  const size = image.getSize();
  const scale = imageScaleForDisplay(display, size.width, size.height, cursor.dpr);
  const crop = cropForRequest(cursor, size.width, size.height, targetPath, scale);
  const jpeg = image.crop(crop).toJPEG(82);
  return {
    id: `screen-${Date.now()}`,
    imageBase64: jpeg.toString('base64'),
    mimeType: 'image/jpeg',
    crop
  };
}

function cropForRequest(
  cursor: CursorPayload,
  screenWidth: number,
  screenHeight: number,
  targetPath?: Point[],
  scale: { x: number; y: number } = { x: 1, y: 1 }
): Rect {
  if (targetPath && targetPath.length > 1) {
    const bbox = scaleRect(bboxFromPoints(targetPath), scale);
    const x = Math.floor(Math.max(0, bbox.x));
    const y = Math.floor(Math.max(0, bbox.y));
    const right = Math.ceil(Math.min(screenWidth, bbox.x + bbox.width));
    const bottom = Math.ceil(Math.min(screenHeight, bbox.y + bbox.height));
    return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
  }

  const width = Math.min(720, screenWidth);
  const height = Math.min(480, screenHeight);
  const imageX = cursor.localX * scale.x;
  const imageY = cursor.localY * scale.y;
  const x = Math.round(Math.max(0, Math.min(screenWidth - width, imageX - width / 2)));
  const y = Math.round(Math.max(0, Math.min(screenHeight - height, imageY - height / 2)));
  return { x, y, width, height };
}

function imageScaleForDisplay(display: Electron.Display, imageWidth: number, imageHeight: number, fallbackDpr: number): { x: number; y: number } {
  const fallback = Math.max(1, fallbackDpr || display.scaleFactor || 1);
  return {
    x: display.bounds.width > 0 ? imageWidth / display.bounds.width : fallback,
    y: display.bounds.height > 0 ? imageHeight / display.bounds.height : fallback
  };
}

function scaleRect(rect: Rect, scale: { x: number; y: number }): Rect {
  return {
    x: rect.x * scale.x,
    y: rect.y * scale.y,
    width: rect.width * scale.x,
    height: rect.height * scale.y
  };
}

function bboxFromPoints(points: Point[]): Rect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function sessionKeyForContext(context: PointerContext): string {
  return [context.source, context.window?.app, context.window?.windowId].filter(Boolean).join(':') || 'desktop';
}

app.whenReady().then(async () => {
  registerIpc();
  for (const display of screen.getAllDisplays()) {
    await createOverlay(display);
  }
  const settings = getSettings();
  registerActivationHotkey(settings.activationHotkey);
  startCursorLoop();
  startGlobalLongPress();
  if (!app.isPackaged) {
    setTimeout(() => {
      if (!active) activate();
    }, 800);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (cursorTimer) clearInterval(cursorTimer);
  activeAbort?.abort();
  cuaBroker.stop();
  cuaSidecar.stop();
  clearHoldTimers();
  try {
    uIOhook.stop();
  } catch {
    // Global hook may not have started.
  }
});
