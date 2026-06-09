import { app, BrowserWindow, clipboard, desktopCapturer, globalShortcut, ipcMain, screen, type NativeImage } from 'electron';
import { activeWindow } from 'get-windows';
import { uIOhook } from 'uiohook-napi';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  type AgentBridgeRegistryConfig,
  type ApprovalDecision
} from '@openpointer/agent-bridge';
import type { AgentBackendId, ContextChip, Conversation, Point, PointerContext, PointerEntity, Rect } from '@openpointer/core';
import { buildPointerContext } from '@openpointer/grounding';
import type { AppSettings } from '@openpointer/storage';
import { OP_CHANNELS } from '../shared/ipc.js';
import type {
  CursorPayload,
  HoldProgressPayload,
  InsertTextRequest,
  InsertTextResponse,
  ReadSelectionRequest,
  ReadSelectionResponse,
  ContinueConversationRequest,
  ContinueConversationResponse,
  DeactivatePayload,
  SubmitInstructionRequest
} from '../shared/types.js';
import { CuaBroker } from './cua-broker.js';
import { CapabilityDiscoveryService } from './capability-discovery.js';
import { CodexAdapterManager } from './codex-adapter.js';
import { CuaGroundingProvider } from './cua-grounding.js';
import { CuaSidecarManager, type CuaToolResult } from './cua-sidecar.js';
import { CuaTaskManager } from './cua-task-manager.js';
import { loadLocalEnv } from './env.js';
import { getClaudeAgentApiKey, getCodexApiKey, getHermesApiKey, getLocalVlmApiKey, getOpenCodeApiKey, getSettings, saveSettings } from './settings.js';
import { backendSessionKey, ChatHistoryManager } from './history.js';
import { MouseShakeActivationController } from './mouse-shake-activation.js';
import { OpenPointerHarness } from './openpointer-harness.js';
import { buildResumeTerminalSpawn } from './terminal-resume.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../..');
loadLocalEnv(repoRoot);

if (!app.isPackaged) {
  const devCachePath = join(tmpdir(), 'openpointer', 'chromium-cache', String(process.pid));
  mkdirSync(devCachePath, { recursive: true });
  app.setPath('sessionData', devCachePath);
  app.commandLine.appendSwitch('disk-cache-dir', devCachePath);
}

const windows = new Map<number, BrowserWindow>();
const overlayInteractive = new Map<number, boolean>();
let cursorTimer: NodeJS.Timeout | null = null;
let active = false;
let activeDisplayId: number | null = null;
let lastCursor: CursorPayload | null = null;
let lastActivationCursor: CursorPayload | null = null;
let cachedSettings: AppSettings | null = null;
const cuaSidecar = new CuaSidecarManager(repoRoot);
const cuaGrounding = new CuaGroundingProvider(cuaSidecar);
const cuaBroker = new CuaBroker(cuaSidecar);
const codexAdapter = new CodexAdapterManager(repoRoot);
const cuaTaskManager = new CuaTaskManager(4);
const chatHistory = new ChatHistoryManager();
const mouseShakeActivation = new MouseShakeActivationController();
const capabilityDiscovery = new CapabilityDiscoveryService();

// Single source of truth for the CUA tools exposed to the agent. This list is
// both advertised to the model (envelope.toolServers[].tools) and enforced by
// the broker as a whitelist, so the agent cannot invoke unlisted driver tools.
const CUA_DRIVER_AGENT_TOOLS = [
  'bring_to_front',
  'check_for_update',
  'check_permissions',
  'debug_window_info',
  'list_apps',
  'list_windows',
  'get_accessibility_tree',
  'get_agent_cursor_state',
  'get_config',
  'get_cursor_position',
  'get_recording_state',
  'get_screen_size',
  'get_window_state',
  'click',
  'double_click',
  'right_click',
  'type_text',
  'press_key',
  'hotkey',
  'scroll',
  'drag',
  'set_value',
  'launch_app',
  'kill_app',
  'move_cursor',
  'page',
  'replay_trajectory',
  'set_agent_cursor_enabled',
  'set_agent_cursor_motion',
  'set_agent_cursor_style',
  'set_config',
  'start_recording',
  'stop_recording',
  'zoom'
];
const OP_AGENT_TOOLS = ['read_selected_text', 'insert_text', 'replace_text'];
const CUA_AGENT_TOOLS = [...OP_AGENT_TOOLS, ...CUA_DRIVER_AGENT_TOOLS];
const openPointerHarness = new OpenPointerHarness({
  taskManager: cuaTaskManager,
  cuaBroker,
  chatHistory,
  getSettings,
  bridgeConfig,
  createOpenPointerTools,
  allowedCuaTools: CUA_AGENT_TOOLS,
  withDesktopInteractionHidden: keepOverlayVisibleForCua,
  showDesktopInteractionApproval: restoreOverlayForCuaApproval
});

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
const CUA_OVERLAY_RESTORE_DELAY_MS = 15000;
const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
let overlayHiddenDepth = 0;
let overlayVisibilitySnapshot = new Map<number, boolean>();
let overlayRestoreFocusDisplayId: number | null = null;
let overlayHideReady: Promise<void> | null = null;
let overlayRestoreTimer: NodeJS.Timeout | null = null;

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
    if (payload.displayId === display.id) win.webContents.send(OP_CHANNELS.Cursor, payload);
    if (active && activeDisplayId === display.id) {
      win.webContents.send(OP_CHANNELS.Activate, lastActivationCursor ?? payload);
    } else {
      win.webContents.send(OP_CHANNELS.Deactivate);
    }
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

function sendToDisplay(displayId: number, channel: string, payload?: unknown): void {
  const win = windows.get(displayId);
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

cuaTaskManager.on('taskEvent', (payload) => {
  broadcast(OP_CHANNELS.CuaTaskEvent, payload);
});

cuaTaskManager.on('agentEvent', (taskId, agentEvent) => {
  if (cuaTaskManager.isForeground(taskId)) broadcast(OP_CHANNELS.AgentEvent, agentEvent);
});

function displayIdForWebContents(sender: Electron.WebContents): number | undefined {
  for (const [displayId, win] of windows) {
    if (!win.isDestroyed() && win.webContents === sender) return displayId;
  }
  return undefined;
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

async function withOverlayHidden<T>(
  focusDisplayId: number | undefined,
  task: () => Promise<T>,
  options: { restoreDelayMs?: number } = {}
): Promise<T> {
  if (focusDisplayId !== undefined) overlayRestoreFocusDisplayId = focusDisplayId;
  if (overlayRestoreTimer) {
    clearTimeout(overlayRestoreTimer);
    overlayRestoreTimer = null;
  }
  const firstHiddenRequest = overlayHiddenDepth === 0 && overlayVisibilitySnapshot.size === 0;
  overlayHiddenDepth += 1;
  if (firstHiddenRequest) {
    overlayHideReady = hideOverlaysForDesktopRead();
  }

  try {
    await (overlayHideReady ?? Promise.resolve());
    return await task();
  } finally {
    overlayHiddenDepth -= 1;
    if (overlayHiddenDepth === 0) {
      scheduleOverlayRestore(options.restoreDelayMs ?? 0);
    }
  }
}

function scheduleOverlayRestore(delayMs: number): void {
  if (delayMs <= 0) {
    restoreHiddenOverlays();
    overlayHideReady = null;
    return;
  }
  overlayRestoreTimer = setTimeout(() => {
    overlayRestoreTimer = null;
    restoreHiddenOverlays();
    overlayHideReady = null;
  }, delayMs);
}

function restoreOverlayForCuaApproval(): void {
  if (overlayRestoreTimer) {
    clearTimeout(overlayRestoreTimer);
    overlayRestoreTimer = null;
  }
  if (overlayHiddenDepth === 0 && overlayVisibilitySnapshot.size > 0) {
    restoreHiddenOverlays();
    overlayHideReady = null;
  }
}

async function withOverlayHiddenForCua<T>(task: () => Promise<T>): Promise<T> {
  return withOverlayHidden(undefined, task, { restoreDelayMs: CUA_OVERLAY_RESTORE_DELAY_MS });
}

async function keepOverlayVisibleForCua<T>(task: () => Promise<T>): Promise<T> {
  return task();
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

function currentSettings(): AppSettings {
  cachedSettings ??= getSettings();
  return cachedSettings;
}

function capabilityDiscoveryOptions() {
  return {
    homeDir: app.getPath('home'),
    appDataDir: app.getPath('appData')
  };
}

async function refreshCapabilitiesAndBroadcast(): Promise<ReturnType<CapabilityDiscoveryService['getSnapshot']>> {
  const snapshot = await capabilityDiscovery.refresh(capabilityDiscoveryOptions());
  broadcast(OP_CHANNELS.CapabilitySnapshotChanged, snapshot);
  return snapshot;
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
      if (active) deactivate({ startNewConversationOnNextActivate: true });
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
  activeDisplayId = cursor.displayId;
  lastActivationCursor = cursor;
  registerEscapeShortcut();
  const activeWin = windows.get(activeDisplayId);
  for (const [displayId, win] of windows) {
    if (win.isDestroyed()) continue;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
    setOverlayInteractive(displayId, false);
    if (displayId !== activeDisplayId) win.webContents.send(OP_CHANNELS.Deactivate);
  }
  if (activeWin && !activeWin.isDestroyed()) {
    activeWin.showInactive();
    activeWin.webContents.send(OP_CHANNELS.Activate, cursor);
  }
}

function focusActiveOverlayWithoutActivate(cursor: CursorPayload): void {
  active = true;
  activeDisplayId = cursor.displayId;
  registerEscapeShortcut();
  const activeWin = windows.get(cursor.displayId);
  for (const [displayId, win] of windows) {
    if (win.isDestroyed()) continue;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
    setOverlayInteractive(displayId, false);
    if (displayId !== cursor.displayId) win.webContents.send(OP_CHANNELS.Deactivate);
  }
  if (activeWin && !activeWin.isDestroyed()) {
    activeWin.showInactive();
  }
}

function deactivate(options: DeactivatePayload = {}): void {
  active = false;
  activeDisplayId = null;
  unregisterEscapeShortcut();
  broadcast(OP_CHANNELS.Deactivate, options);
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
    registered = globalShortcut.register(hotkey, () => (active ? focusActiveOverlayWithoutActivate(cursorPayload()) : activate()));
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
    sendToDisplay(payload.displayId, OP_CHANNELS.Cursor, payload);
  }, 33);
}

function startGlobalLongPress(): void {
  try {
    uIOhook.on('mousedown', (event) => {
      mouseShakeActivation.handleMouseDown(event.button, { emitFeedback: broadcastHold });
      if (isSecondaryMouseButton(event.button)) {
        handleGlobalContextMouseDown();
        return;
      }
      if (isPrimaryMouseButton(event.button)) {
        handleGlobalPrimaryMouseDown();
      }
      if (!currentSettings().longPressEnabled || !isPrimaryMouseButton(event.button)) return;
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
      if (hold.active && hold.start && !hold.completed) {
        const distance = Math.hypot(event.x - hold.start.x, event.y - hold.start.y);
        if (distance > HOLD_MOVE_TOLERANCE_PX) cancelHold();
      }
      handleGlobalMouseShakeMove(event);
    });

    uIOhook.on('mouseup', (event) => {
      mouseShakeActivation.handleMouseUp(event.button, { emitFeedback: broadcastHold });
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
  if (hold.startedWhileActive) {
    focusActiveOverlayWithoutActivate(hold.start);
  } else {
    activate(hold.start);
  }
  broadcastHold({ cursor: hold.start, progress: 1, state: 'completed', startedWhileActive: hold.startedWhileActive });
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
  sendToDisplay(payload.cursor.displayId, OP_CHANNELS.HoldProgress, payload);
}

function handleGlobalMouseShakeMove(event: { x: number; y: number }): void {
  const cursor = cursorPayload();
  mouseShakeActivation.handleMouseMove(event, {
    settings: currentSettings(),
    active,
    holdActive: hold.active,
    overlayHidden: overlayHiddenDepth > 0 || overlayVisibilitySnapshot.size > 0 || Boolean(overlayHideReady),
    cursor,
    activate,
    emitFeedback: broadcastHold
  });
}

function isPrimaryMouseButton(button: unknown): boolean {
  return button === 1 || button === 0 || button === 'left';
}

function isSecondaryMouseButton(button: unknown): boolean {
  return button === 2 || button === 'right';
}

function handleGlobalPrimaryMouseDown(): void {
  if (!active) return;
  const cursor = cursorPayload();
  const win = windows.get(cursor.displayId);
  if (!win || win.isDestroyed()) return;
  if (overlayInteractive.get(cursor.displayId)) return;
  win.webContents.send(OP_CHANNELS.GlobalMouseDown, cursor);
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
  win.focus();
  win.webContents.focus();
  win.webContents.send(OP_CHANNELS.GlobalContextMenu, cursor);
}

function registerIpc(): void {
  ipcMain.on(OP_CHANNELS.SetInteractive, (event, value: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) setWindowInteractive(win, value);
  });

  ipcMain.on(OP_CHANNELS.RequestDeactivate, (_event, options?: DeactivatePayload) => deactivate(options));
  ipcMain.on(OP_CHANNELS.CancelRun, () => cuaTaskManager.cancelForeground());

  ipcMain.on(OP_CHANNELS.RendererReady, (event) => {
    const displayId = displayIdForWebContents(event.sender);
    const payload = cursorPayload();
    if (displayId === undefined || payload.displayId === displayId) event.sender.send(OP_CHANNELS.Cursor, payload);
    event.sender.send(OP_CHANNELS.CapabilitySnapshotChanged, capabilityDiscovery.getSnapshot());
    if (active && displayId !== undefined && activeDisplayId === displayId) {
      event.sender.send(OP_CHANNELS.Activate, lastActivationCursor ?? payload);
    } else {
      event.sender.send(OP_CHANNELS.Deactivate);
    }
  });

  ipcMain.handle(OP_CHANNELS.GetSettings, () => getSettings());
  ipcMain.handle(OP_CHANNELS.SaveSettings, (_event, patch) => {
    const next = saveSettings(patch);
    cachedSettings = next;
    // Re-apply runtime settings that are bound at registration time so saved
    // changes (e.g. the activation hotkey) take effect without a restart.
    registerActivationHotkey(next.activationHotkey);
    mouseShakeActivation.reset({ emitFeedback: broadcastHold });
    configureCuaRuntime(next);
    void codexAdapter.ensure(next);
    return next;
  });
  ipcMain.handle(OP_CHANNELS.GetCapabilitySnapshot, () => capabilityDiscovery.getSnapshot());
  ipcMain.handle(OP_CHANNELS.RefreshCapabilities, async () => refreshCapabilitiesAndBroadcast());
  ipcMain.handle(OP_CHANNELS.CuaHealth, () => {
    configureCuaRuntime(getSettings());
    return cuaSidecar.getHealth();
  });
  ipcMain.handle(OP_CHANNELS.GetConversations, () => chatHistory.getConversations());
  ipcMain.handle(OP_CHANNELS.GetConversation, (_event, id: string) => chatHistory.getConversation(id));
  ipcMain.handle(OP_CHANNELS.ContinueConversation, (_event, req: ContinueConversationRequest) => continueConversation(req));
  ipcMain.handle(OP_CHANNELS.DeleteConversation, (_event, id: string) => chatHistory.deleteConversation(id));
  ipcMain.handle(OP_CHANNELS.FetchVisionModels, async (_event, req: { baseUrl: string; apiKey: string }) => {
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
  ipcMain.handle(OP_CHANNELS.RequestGrounding, async (_event, req: { cursor: CursorPayload }) => {
    const settings = getSettings();
    configureCuaRuntime(settings);
    if (settings.cuaMode === 'off') return { status: 'fallback', entities: [], error: 'CUA mode is off.' };
    // Live CUA preview is accessibility-tree based; hiding the overlay here
    // makes the composer blink whenever background grounding refreshes.
    return cuaGrounding.preview(req.cursor, await activeWindowInfo());
  });
  ipcMain.handle(OP_CHANNELS.ReadSelection, async (_event, req?: ReadSelectionRequest) => {
    return readSelectedText(req);
  });
  ipcMain.handle(OP_CHANNELS.InsertText, async (_event, req: InsertTextRequest) => {
    return insertText(req);
  });
  ipcMain.handle(OP_CHANNELS.RequestWindowContext, async (_event, req: { cursor: CursorPayload }) => {
    const settings = getSettings();
    configureCuaRuntime(settings);
    const activeInfo = await activeWindowPreviewInfo();
    if (settings.cuaMode !== 'off') {
      const cuaWindow = await cuaGrounding.previewWindow(req.cursor, activeInfo?.window);
      if (cuaWindow.status === 'matched') return cuaWindow;
    }
    if (activeInfo) {
      return {
        status: 'matched',
        source: 'active-window',
        window: activeInfo.window,
        windowId: activeInfo.window.windowId,
        pid: activeInfo.pid,
        bounds: activeInfo.bounds
      };
    }
    return { status: 'fallback', source: 'active-window', error: 'No active window information available.' };
  });
  ipcMain.handle(OP_CHANNELS.ApproveAgentRequest, async (_event, id: string, decision: ApprovalDecision) => {
    await openPointerHarness.approve(id, decision);
  });

  ipcMain.handle(OP_CHANNELS.CuaTaskList, () => cuaTaskManager.list());

  ipcMain.handle(OP_CHANNELS.CuaTaskCancel, (_event, taskId: string) => {
    cuaTaskManager.cancel(taskId);
  });

  ipcMain.handle(OP_CHANNELS.CuaTaskStartRecording, async (_event, taskId: string) => {
    const task = cuaTaskManager.get(taskId);
    if (!task?.brokerSessionId) throw new Error('CUA task has no active broker session.');
    if (getSettings().cuaRecordingMode === 'off') throw new Error('CUA recording is disabled in Settings.');
    const outputDir = join(app.getPath('userData'), 'cua-recordings', taskId);
    await cuaBroker.startRecording(task.brokerSessionId, outputDir);
    cuaTaskManager.markRecording(taskId, { status: 'recording', outputDir });
  });

  ipcMain.handle(OP_CHANNELS.CuaTaskStopRecording, async (_event, taskId: string) => {
    const task = cuaTaskManager.get(taskId);
    if (!task?.brokerSessionId) throw new Error('CUA task has no active broker session.');
    await cuaBroker.stopRecording(task.brokerSessionId);
    cuaTaskManager.markRecording(taskId, { status: 'available', outputDir: task.recording?.outputDir });
  });

  ipcMain.handle(OP_CHANNELS.CuaTaskReplayRecording, async (_event, taskId: string) => {
    const task = cuaTaskManager.get(taskId);
    const outputDir = task?.recording?.outputDir;
    if (!task || !outputDir) throw new Error('CUA task has no replayable recording.');
    let brokerSessionId = task.brokerSessionId;
    let releaseTempSession = false;
    if (!brokerSessionId || !cuaBroker.hasSession(brokerSessionId)) {
      const settings = getSettings();
      const session = await cuaBroker.ensureStarted({
        requireApprovalBeforeCua: settings.requireApprovalBeforeCua,
        cuaAgentCursorEnabled: settings.cuaAgentCursorEnabled,
        cuaPageJavascriptPolicy: settings.cuaPageJavascriptPolicy,
        allowedTools: CUA_AGENT_TOOLS,
        localTools: {},
        withDesktopInteractionHidden: keepOverlayVisibleForCua,
        showDesktopInteractionApproval: restoreOverlayForCuaApproval,
        emit: (agentEvent) => cuaTaskManager.emitAgentEvent(taskId, agentEvent)
      });
      brokerSessionId = session.sessionId;
      releaseTempSession = true;
    }
    try {
      await cuaBroker.replayRecording(brokerSessionId, outputDir);
    } finally {
      if (releaseTempSession) cuaBroker.releaseSession(brokerSessionId);
    }
  });

  ipcMain.handle(OP_CHANNELS.SubmitInstruction, async (event, req: SubmitInstructionRequest) => {
    const settings = getSettings();
    configureCuaRuntime(settings);
    const cursor = req.cursor ?? lastActivationCursor ?? lastCursor ?? cursorPayload();
    const includeCua = Boolean(req.includeCua) && settings.cuaMode !== 'off';
    const providedCuaEntities = includeCua ? (req.cuaEntities ?? []) : [];
    const selectedTextResult = req.includeSelectedText ? await readSelectedText({ cursor, windowContext: req.windowContext }) : undefined;
    const selectedText = selectedTextResult?.status === 'matched' ? selectedTextResult.text : undefined;
    const context = req.includeScreenshot
      ? await capturePointerContext(
          cursor,
          req.targetPath,
          req.selectedEntity,
          includeCua && providedCuaEntities.length === 0,
          providedCuaEntities,
          req.windowContext,
          req.windowPid,
          req.windowBounds,
          selectedText
        )
      : await buildLightPointerContext(
          cursor,
          req.selectedEntity,
          providedCuaEntities,
          includeCua,
          req.windowContext,
          req.windowPid,
          req.windowBounds,
          selectedText
        );
    context.contextChips = await refreshSubmittedContextChips(req.contextChips ?? [], cursor);

    return openPointerHarness.submit({
      text: req.text,
      mode: req.mode,
      context,
      backend: req.backend,
      capabilityHints: req.capabilityHints,
      conversationId: req.conversationId
    });
  });
}

async function refreshSubmittedContextChips(chips: ContextChip[], cursor: CursorPayload): Promise<ContextChip[]> {
  const pinned = chips.filter((chip) => chip.status === 'pinned').slice(0, 4);
  if (pinned.length === 0) return [];
  return Promise.all(
    pinned.map(async (chip) => {
      if (chip.kind !== 'window' || !chip.windowRef) return chip;
      const windowInfo: PointerContext['window'] = {
        title: chip.windowRef.title,
        app: chip.windowRef.app,
        process: chip.windowRef.process,
        windowId: chip.windowRef.windowId
      };
      const windowSnapshot = await captureWindowSnapshot(cursor, windowInfo, chip.windowRef.pid, chip.windowRef.bounds);
      return {
        ...chip,
        windowSnapshot,
        error: windowSnapshot?.error,
        lastSeenAt: Date.now()
      };
    })
  );
}

async function continueConversation(req: ContinueConversationRequest): Promise<ContinueConversationResponse> {
  const conversation = await chatHistory.getConversation(req.conversationId);
  if (!conversation) {
    return { ok: false, target: req.target, error: 'Conversation not found.' };
  }

  const resolved = resolveContinuableBackend(conversation, req.backend);
  if (!resolved) {
    return { ok: false, target: req.target, error: 'This conversation has no resumable backend session yet.' };
  }

  if (req.target === 'app') {
    return {
      ok: false,
      backend: resolved.backend,
      target: req.target,
      error: `Continue in app is not available for ${backendDisplayName(resolved.backend)} yet.`
    };
  }

  const settings = getSettings();
  const command = resumeCommandForBackend(resolved.backend, resolved.sessionId, settings);
  if (!command) {
    return {
      ok: false,
      backend: resolved.backend,
      target: req.target,
      error: `${backendDisplayName(resolved.backend)} does not expose a terminal resume command.`
    };
  }

  try {
    openResumeTerminal(command.executable, command.args, command.title);
    return { ok: true, backend: resolved.backend, target: req.target };
  } catch (error) {
    return {
      ok: false,
      backend: resolved.backend,
      target: req.target,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function resolveContinuableBackend(conversation: Conversation, requested?: AgentBackendId): { backend: AgentBackendId; sessionId: string } | null {
  const candidates: AgentBackendId[] =
    requested && requested !== 'auto' && requested !== 'local-vlm' && requested !== 'mock'
      ? [requested, 'claude-agent', 'codex', 'hermes', 'opencode', 'openclaw']
      : ['claude-agent', 'codex', 'hermes', 'opencode', 'openclaw'];
  const seen = new Set<AgentBackendId>();
  for (const backend of candidates) {
    if (seen.has(backend)) continue;
    seen.add(backend);
    const key = backendSessionKey(backend);
    const sessionId = key ? conversation.backendSessions?.[key]?.sessionId : undefined;
    if (sessionId) return { backend, sessionId };
  }
  return null;
}

function resumeCommandForBackend(
  backend: AgentBackendId,
  sessionId: string,
  settings: ReturnType<typeof getSettings>
): { executable: string; args: string[]; title: string } | null {
  if (backend === 'claude-agent') {
    const args = ['--resume', sessionId];
    if (settings.claudeAgentModel) args.push('--model', settings.claudeAgentModel);
    if (settings.claudeAgentEffort) args.push('--effort', settings.claudeAgentEffort);
    return {
      executable: settings.claudeAgentExecutable?.trim() || 'claude',
      args,
      title: 'OpenPointer Claude'
    };
  }

  if (backend === 'codex') {
    const args = ['resume', sessionId, '-C', repoRoot];
    if (settings.codexModel) args.push('-m', settings.codexModel);
    return {
      executable: settings.codexExecutablePath?.trim() || 'codex',
      args,
      title: 'OpenPointer Codex'
    };
  }

  if (backend === 'openclaw') {
    const args = ['chat', '--session', sessionId];
    return {
      executable: settings.openclawExecutablePath?.trim() || 'openclaw',
      args,
      title: 'OpenPointer OpenClaw'
    };
  }

  return null;
}

function openResumeTerminal(executable: string, args: string[], title: string): void {
  const terminal = buildResumeTerminalSpawn({ executable, args, title }, repoRoot);
  const child = spawn(terminal.executable, terminal.args, {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
}

function backendDisplayName(backend: AgentBackendId): string {
  switch (backend) {
    case 'claude-agent':
      return 'Claude';
    case 'codex':
      return 'Codex';
    case 'hermes':
      return 'Hermes';
    case 'opencode':
      return 'OpenCode';
    case 'openclaw':
      return 'OpenClaw';
    default:
      return backend;
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
    openclaw: settings.openclawGatewayUrl
      ? {
          baseUrl: settings.openclawGatewayUrl,
          executablePath: settings.openclawExecutablePath || undefined,
          cwd: repoRoot,
          model: settings.openclawModel || undefined,
          agent: settings.openclawAgent || 'main',
          timeoutMs: 600000
        }
      : undefined,
    claudeAgent: {
      enabled: settings.claudeAgentEnabled,
      apiKey: getClaudeAgentApiKey(),
      baseUrl: settings.claudeAgentBaseUrl || undefined,
      executable: settings.claudeAgentExecutable || undefined,
      model: settings.claudeAgentModel || undefined,
      effort: settings.claudeAgentEffort || 'high',
      approvalMode: settings.approvalMode,
      permissionStorePath: join(app.getPath('userData'), 'claude-permissions.json')
    },
    codex:
      settings.codexAppServerUrl || settings.codexExecutablePath
        ? {
            baseUrl: settings.codexAppServerUrl,
            apiKey: getCodexApiKey(),
            transport: settings.codexAppServerTransport,
            executablePath: settings.codexExecutablePath || undefined,
            cwd: repoRoot,
            model: settings.codexModel || undefined,
            effort: settings.codexEffort || 'low',
            sandbox: 'workspace-write'
          }
        : undefined
  };
}

function configureCuaRuntime(settings = getSettings()): void {
  cuaSidecar.configure({ port: settings.cuaDriverHttpPort });
}

type ClipboardSnapshot = {
  text: string;
  html: string;
  rtf: string;
  image?: NativeImage;
};

function createOpenPointerTools(context: PointerContext): Record<string, (args: Record<string, unknown>) => Promise<CuaToolResult>> {
  return {
    read_selected_text: async () => toolResultFromReadSelection(await readSelectedText({ cursor: context.cursor, windowContext: context.window })),
    insert_text: async (args) => {
      const text = typeof args.text === 'string' ? args.text : '';
      if (!text) return toolError('insert_text: missing required string field `text`.');
      const clickTarget = typeof args.click_target === 'boolean' ? args.click_target : true;
      return toolResultFromInsertText(
        await insertText({
          text,
          cursor: context.cursor,
          windowContext: context.window,
          targetEntity: context.target,
          clickTarget
        })
      );
    },
    replace_text: async (args) => {
      if (typeof args.text !== 'string') return toolError('replace_text: missing required string field `text`.');
      const clickTarget = typeof args.click_target === 'boolean' ? args.click_target : true;
      return toolResultFromInsertText(
        await insertText({
          text: args.text,
          cursor: context.cursor,
          windowContext: context.window,
          targetEntity: context.target,
          clickTarget,
          replaceExisting: true
        })
      );
    }
  };
}

async function readSelectedText(req: ReadSelectionRequest = {}): Promise<ReadSelectionResponse> {
  const settings = getSettings();
  if (settings.cuaMode === 'off') {
    return { status: 'unavailable', error: 'CUA mode is off.' };
  }

  const cursor = req.cursor ?? lastActivationCursor ?? lastCursor ?? cursorPayload();
  const snapshot = snapshotClipboard();
  try {
    return await withOverlayHidden(cursor.displayId, async () => {
      const target = await resolveCuaSelectionTarget(cursor, req.windowContext);
      if (!target) {
        return { status: 'unavailable', error: 'No CUA window matched the selection cursor.' };
      }

      const uiaSelection = await readSelectedTextViaUia(target);
      if (uiaSelection) {
        return uiaSelection;
      }

      clipboard.clear();
      const result = await cuaSidecar.callTool('hotkey', {
        pid: target.pid,
        window_id: Number(target.windowId),
        keys: ['ctrl', 'c']
      });
      if (result.isError) {
        return {
          status: 'unavailable',
          pid: target.pid,
          windowId: target.windowId,
          error: cuaToolResultText(result) ?? 'CUA hotkey copy failed.'
        };
      }

      await wait(180);
      const text = clipboard.readText();
      return text.trim()
        ? { status: 'matched', text, source: 'cua-hotkey-clipboard', pid: target.pid, windowId: target.windowId }
        : { status: 'empty', source: 'cua-hotkey-clipboard', pid: target.pid, windowId: target.windowId };
    });
  } catch (error) {
    return { status: 'unavailable', error: error instanceof Error ? error.message : String(error) };
  } finally {
    restoreClipboard(snapshot);
  }
}

type UiaSelectionToolPayload = {
  status?: 'matched' | 'empty';
  text?: string;
  pid?: number;
  window_id?: number;
  source?: string;
};

async function readSelectedTextViaUia(target: { pid: number; windowId: string }): Promise<ReadSelectionResponse | undefined> {
  try {
    const result = await cuaSidecar.callTool('get_selected_text', {
      pid: target.pid,
      window_id: Number(target.windowId)
    });
    if (result.isError) {
      return undefined;
    }

    const structured = result.structuredContent as UiaSelectionToolPayload | undefined;
    if (structured?.status === 'matched' || structured?.status === 'empty') {
      return {
        status: structured.status,
        text: structured.text,
        source: 'uia-textpattern',
        pid: structured.pid ?? target.pid,
        windowId: typeof structured.window_id === 'number' ? String(structured.window_id) : target.windowId
      };
    }
  } catch {
    // Older sidecars may not expose `get_selected_text`; the hotkey/clipboard
    // fallback below remains the compatibility path.
  }
  return undefined;
}

async function insertText(req: InsertTextRequest): Promise<InsertTextResponse> {
  const text = typeof req.text === 'string' ? req.text : '';
  const replaceExisting = req.replaceExisting === true;
  if (!replaceExisting && !text) return { status: 'unavailable', error: 'Missing text to insert.' };
  const settings = getSettings();
  if (settings.cuaMode === 'off') {
    return { status: 'unavailable', error: 'CUA mode is off.' };
  }

  const cursor = req.cursor ?? lastActivationCursor ?? lastCursor ?? cursorPayload();
  const snapshot = snapshotClipboard();
  try {
    return await withOverlayHidden(cursor.displayId, async () => {
      const target = await resolveCuaSelectionTarget(cursor, req.windowContext);
      if (!target) {
        return { status: 'unavailable', error: 'No CUA window matched the insertion target.' };
      }

      const setValueAttempt = replaceExisting ? await setTargetValueIfPossible(target, req.targetEntity, text) : undefined;
      if (setValueAttempt?.status === 'matched') {
        return setValueAttempt;
      }

      const source = replaceExisting ? 'cua-replace-paste' : 'cua-click-paste';
      if (req.clickTarget !== false) {
        const focused = await focusInsertionTarget(target, cursor, req.targetEntity);
        if (!focused.ok) {
          return {
            status: 'unavailable',
            source,
            pid: target.pid,
            windowId: target.windowId,
            error: appendPriorAttemptError(focused.error, setValueAttempt?.error)
          };
        }
        await wait(120);
      }

      if (replaceExisting) {
        const selectAll = await cuaSidecar.callTool('hotkey', {
          pid: target.pid,
          window_id: Number(target.windowId),
          keys: ['ctrl', 'a']
        });
        if (selectAll.isError) {
          return {
            status: 'unavailable',
            source,
            pid: target.pid,
            windowId: target.windowId,
            error: appendPriorAttemptError(cuaToolResultText(selectAll) ?? 'CUA select-all hotkey failed before replacement.', setValueAttempt?.error)
          };
        }
        await wait(120);
      }

      clipboard.writeText(text);
      const result = await cuaSidecar.callTool('hotkey', {
        pid: target.pid,
        window_id: Number(target.windowId),
        keys: ['ctrl', 'v']
      });
      if (result.isError) {
        return {
          status: 'unavailable',
          source,
          pid: target.pid,
          windowId: target.windowId,
          error: appendPriorAttemptError(cuaToolResultText(result) ?? 'CUA paste hotkey failed.', setValueAttempt?.error)
        };
      }

      await wait(180);
      return { status: 'matched', source, pid: target.pid, windowId: target.windowId };
    });
  } catch (error) {
    return { status: 'unavailable', error: error instanceof Error ? error.message : String(error) };
  } finally {
    restoreClipboard(snapshot);
  }
}

async function setTargetValueIfPossible(
  target: { pid: number; windowId: string; bounds?: Rect },
  targetEntity: PointerEntity | undefined,
  text: string
): Promise<InsertTextResponse | undefined> {
  const ref = targetEntity?.groundingRef?.provider === 'cua' ? targetEntity.groundingRef : undefined;
  if (!ref || typeof ref.elementIndex !== 'number') return undefined;

  const result = await cuaSidecar.callTool('set_value', {
    pid: ref.pid ?? target.pid,
    window_id: Number(ref.windowId ?? target.windowId),
    element_index: ref.elementIndex,
    value: text
  });
  return result.isError
    ? {
        status: 'unavailable',
        source: 'cua-set-value',
        pid: ref.pid ?? target.pid,
        windowId: ref.windowId ?? target.windowId,
        error: cuaToolResultText(result) ?? 'CUA set_value failed.'
      }
    : {
        status: 'matched',
        source: 'cua-set-value',
        pid: ref.pid ?? target.pid,
        windowId: ref.windowId ?? target.windowId
      };
}

function appendPriorAttemptError(error: string, priorError?: string): string {
  return priorError ? `${error} Prior set_value attempt failed: ${priorError}` : error;
}

async function resolveCuaSelectionTarget(
  cursor: CursorPayload,
  preferredWindowInfo?: PointerContext['window']
): Promise<{ pid: number; windowId: string; bounds?: Rect } | undefined> {
  const preview = await cuaGrounding.previewWindow(cursor, preferredWindowInfo ?? (await activeWindowInfo()));
  if (preview.status === 'matched' && typeof preview.pid === 'number' && preview.windowId) {
    return { pid: preview.pid, windowId: preview.windowId, bounds: preview.bounds };
  }
  return undefined;
}

async function focusInsertionTarget(
  target: { pid: number; windowId: string; bounds?: Rect },
  cursor: CursorPayload,
  targetEntity?: PointerEntity
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ref = targetEntity?.groundingRef?.provider === 'cua' ? targetEntity.groundingRef : undefined;
  const clickArgs: Record<string, unknown> = {
    pid: ref?.pid ?? target.pid,
    window_id: Number(ref?.windowId ?? target.windowId)
  };
  if (typeof ref?.elementIndex === 'number') {
    clickArgs.element_index = ref.elementIndex;
  } else {
    const point = insertionPoint(cursor, target.bounds, ref?.screenRect);
    if (!point) return { ok: true };
    clickArgs.x = point.x;
    clickArgs.y = point.y;
  }

  const result = await cuaSidecar.callTool('click', clickArgs);
  if (result.isError) return { ok: false, error: cuaToolResultText(result) ?? 'CUA click failed before insertion.' };
  return { ok: true };
}

function insertionPoint(cursor: CursorPayload, bounds?: Rect, preferredRect?: Rect): { x: number; y: number } | undefined {
  if (!bounds) return undefined;
  const screenPoint = preferredRect
    ? {
        x: preferredRect.x + preferredRect.width / 2,
        y: preferredRect.y + preferredRect.height / 2
      }
    : { x: cursor.x, y: cursor.y };
  return {
    x: screenPoint.x - bounds.x,
    y: screenPoint.y - bounds.y
  };
}

function toolResultFromReadSelection(response: ReadSelectionResponse): CuaToolResult {
  if (response.status === 'matched') {
    return toolText(`Selected text: ${response.text ?? ''}`, response);
  }
  return response.status === 'empty'
    ? toolText('No selected text was available.', response)
    : toolError(response.error ?? 'read_selected_text failed.', response);
}

function toolResultFromInsertText(response: InsertTextResponse): CuaToolResult {
  return response.status === 'matched'
    ? toolText('Inserted text into the target application.', response)
    : toolError(response.error ?? 'insert_text failed.', response);
}

function toolText(text: string, structuredContent?: unknown): CuaToolResult {
  return { content: [{ type: 'text', text }], structuredContent };
}

function toolError(text: string, structuredContent?: unknown): CuaToolResult {
  return { content: [{ type: 'text', text }], structuredContent, isError: true };
}

function cuaToolResultText(result: CuaToolResult): string | undefined {
  return result.content
    ?.map((part) => part.text)
    .filter(Boolean)
    .join(' ')
    .trim();
}

function snapshotClipboard(): ClipboardSnapshot {
  const image = clipboard.readImage();
  return {
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf: clipboard.readRTF(),
    image: image.isEmpty() ? undefined : image
  };
}

function restoreClipboard(snapshot: ClipboardSnapshot): void {
  if (!snapshot.text && !snapshot.html && !snapshot.rtf && !snapshot.image) {
    clipboard.clear();
    return;
  }
  clipboard.write({
    text: snapshot.text || undefined,
    html: snapshot.html || undefined,
    rtf: snapshot.rtf || undefined,
    image: snapshot.image
  });
}

async function capturePointerContext(
  cursor: CursorPayload,
  targetPath?: Point[],
  selectedEntity?: PointerEntity,
  useCua = true,
  seedCuaEntities: PointerEntity[] = [],
  preferredWindowInfo?: PointerContext['window'],
  preferredWindowPid?: number,
  preferredWindowBounds?: Rect,
  selectionText?: string
): Promise<PointerContext> {
  // Signal the renderer that a submit-time screenshot is being taken so the
  // pointer can tint accordingly. `withCua` distinguishes a plain screenshot
  // (purple) from a screenshot that is paired with CUA grounding (teal).
  const withCua = useCua || Boolean(selectedEntity?.groundingRef) || seedCuaEntities.some((entity) => entity.groundingRef?.provider === 'cua');
  sendToDisplay(cursor.displayId, OP_CHANNELS.CaptureActivity, { phase: 'start', withCua });
  let capture: Awaited<ReturnType<typeof captureContextImage>>;
  let windowInfo: PointerContext['window'];
  let windowSnapshot: PointerContext['windowSnapshot'];
  let cuaPreview: Awaited<ReturnType<CuaGroundingProvider['preview']>> | undefined;
  try {
    const hiddenResult = await withOverlayHidden(cursor.displayId, async () => {
      const currentWindow = preferredWindowInfo ?? (await activeWindowInfo());
      const [contextImage, fullWindowImage, groundingPreview] = await Promise.all([
        captureContextImage(cursor, targetPath),
        captureWindowSnapshot(cursor, currentWindow, preferredWindowPid, preferredWindowBounds),
        useCua ? cuaGrounding.preview(cursor, currentWindow) : Promise.resolve(undefined)
      ]);
      return {
        capture: contextImage,
        windowSnapshot: fullWindowImage,
        windowInfo: currentWindow,
        cuaPreview: groundingPreview
      };
    });
    capture = hiddenResult.capture;
    windowSnapshot = hiddenResult.windowSnapshot;
    windowInfo = hiddenResult.windowInfo;
    cuaPreview = hiddenResult.cuaPreview;
  } finally {
    sendToDisplay(cursor.displayId, OP_CHANNELS.CaptureActivity, { phase: 'end', withCua });
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
    windowSnapshot,
    entities,
    gestureKind: targetPath && targetPath.length > 1 ? 'rectangle' : 'hover',
    gesturePath: targetPath && targetPath.length > 0 ? targetPath : [{ x: cursor.localX, y: cursor.localY, t: Date.now() }],
    screenshotId: capture.id,
    imageBase64: capture.imageBase64,
    mimeType: capture.mimeType,
    crop: capture.crop,
    selectionText
  });
  if (selectedEntity) context.target = selectedEntity;

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
  includeCua: boolean,
  preferredWindowInfo?: PointerContext['window'],
  preferredWindowPid?: number,
  preferredWindowBounds?: Rect,
  selectionText?: string
): Promise<PointerContext> {
  const windowInfo = preferredWindowInfo ?? (await activeWindowInfo());
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
    gesturePath: [{ x: cursor.localX, y: cursor.localY, t: Date.now() }],
    selectionText
  });
  if (selectedEntity) context.target = selectedEntity;

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
  return (await activeWindowPreviewInfo())?.window;
}

async function activeWindowPreviewInfo(): Promise<{ window: NonNullable<PointerContext['window']>; pid?: number; bounds?: Rect } | undefined> {
  try {
    const info = await activeWindow({ screenRecordingPermission: false, accessibilityPermission: false });
    if (!info) return undefined;
    return {
      window: {
        title: info.title,
        app: info.owner?.name,
        process: info.owner?.name,
        windowId: String(info.id)
      },
      pid: info.owner?.processId,
      bounds: info.bounds
    };
  } catch {
    return undefined;
  }
}

async function captureWindowSnapshot(
  cursor: CursorPayload,
  windowInfo?: PointerContext['window'],
  pid?: number,
  bounds?: Rect
): Promise<NonNullable<PointerContext['windowSnapshot']> | undefined> {
  const cuaCapture = await captureWindowViaCuaVision(windowInfo, pid);
  const capture = cuaCapture.capture ?? (bounds ? await captureWindowSourceImage(bounds, windowInfo) : undefined);
  if (!capture) {
    return cuaCapture.error
      ? {
          screenshotId: `window-missing-${Date.now()}`,
          source: 'cua-window',
          bounds,
          error: cuaCapture.error
        }
      : undefined;
  }
  return {
    screenshotId: capture.id,
    source: capture.source,
    imageBase64: capture.imageBase64,
    mimeType: capture.mimeType,
    bounds: capture.crop
  };
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

async function captureWindowViaCuaVision(
  windowInfo: PointerContext['window'] | undefined,
  pid: number | undefined
): Promise<{
  capture?: {
    id: string;
    source: 'cua-window';
    imageBase64: string;
    mimeType: 'image/png' | 'image/jpeg';
    crop: Rect;
  };
  error?: string;
}> {
  const hwnd = Number(windowInfo?.windowId);
  if (!Number.isFinite(hwnd) || hwnd <= 0) return { error: 'Missing or invalid HWND for CUA window capture.' };
  if (typeof pid !== 'number') return { error: 'Missing pid for CUA window capture.' };
  try {
    const result = await cuaSidecar.callTool('get_window_state', {
      pid,
      window_id: hwnd,
      capture_mode: 'vision'
    });
    if (result.isError) return { error: cuaToolResultText(result) ?? 'CUA vision capture returned an error.' };
    const image = result.content?.find((part) => part.type === 'image' && typeof part.data === 'string');
    if (!image?.data) return { error: 'CUA vision capture returned no image content.' };
    const structured = result.structuredContent as { screenshot_width?: number; screenshot_height?: number } | undefined;
    const width = Number(structured?.screenshot_width) || 0;
    const height = Number(structured?.screenshot_height) || 0;
    return {
      capture: {
        id: `window-cua-${Date.now()}`,
        source: 'cua-window',
        imageBase64: image.data,
        mimeType: image.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png',
        crop: { x: 0, y: 0, width, height }
      }
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function captureWindowSourceImage(
  bounds: Rect,
  windowInfo?: PointerContext['window']
): Promise<
  | {
      id: string;
      source: 'electron-window';
      imageBase64: string;
      mimeType: 'image/jpeg';
      crop: Rect;
    }
  | undefined
> {
  const scale = Math.max(1, screen.getDisplayMatching(bounds).scaleFactor || 1);
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: {
      width: Math.max(1, Math.round(bounds.width * scale)),
      height: Math.max(1, Math.round(bounds.height * scale))
    }
  });
  const source = findWindowSource(sources, windowInfo);
  if (!source || source.thumbnail.isEmpty()) return undefined;
  const image = source.thumbnail;
  const size = image.getSize();
  const jpeg = image.toJPEG(82);
  return {
    id: `window-${Date.now()}`,
    source: 'electron-window',
    imageBase64: jpeg.toString('base64'),
    mimeType: 'image/jpeg',
    crop: { x: 0, y: 0, width: size.width, height: size.height }
  };
}

function findWindowSource(sources: Electron.DesktopCapturerSource[], windowInfo?: PointerContext['window']): Electron.DesktopCapturerSource | undefined {
  const windowId = windowInfo?.windowId?.trim();
  if (windowId) {
    const byId = sources.find((source) => source.id.split(':').includes(windowId) || source.id.includes(windowId));
    if (byId) return byId;
  }

  const title = normalizeSourceText(windowInfo?.title);
  const app = normalizeSourceText(windowInfo?.app ?? windowInfo?.process);
  if (!title && !app) return undefined;
  return sources.find((source) => {
    const name = normalizeSourceText(source.name);
    if (title && (name === title || name.includes(title) || title.includes(name))) return true;
    return Boolean(app && name.includes(app));
  });
}

function normalizeSourceText(value: string | undefined): string {
  return value?.toLowerCase().replace(/\s+/g, ' ').trim() ?? '';
}

async function _captureScreenRegion(
  cursor: CursorPayload,
  region: Rect,
  idPrefix: string
): Promise<
  | {
      id: string;
      imageBase64: string;
      mimeType: 'image/jpeg';
      crop: Rect;
    }
  | undefined
> {
  const regionDisplay = displayForRegion(region, cursor);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(regionDisplay.size.width * regionDisplay.scaleFactor),
      height: Math.round(regionDisplay.size.height * regionDisplay.scaleFactor)
    }
  });
  const source = sources.find((item) => item.display_id === String(regionDisplay.id)) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) return undefined;

  const image = source.thumbnail;
  const size = image.getSize();
  const scale = imageScaleForDisplay(regionDisplay, size.width, size.height, cursor.dpr);
  const crop = cropForScreenRegion(region, regionDisplay, size.width, size.height, scale, cursor);
  if (!crop) return undefined;
  const jpeg = image.crop(crop).toJPEG(82);
  return {
    id: `${idPrefix}-${Date.now()}`,
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

function cropForScreenRegion(
  region: Rect,
  display: Electron.Display,
  imageWidth: number,
  imageHeight: number,
  scale: { x: number; y: number },
  cursor: CursorPayload
): Rect | undefined {
  const physical = regionUsesPhysicalCoordinates(region, cursor);
  const x = physical ? region.x - display.bounds.x * scale.x : (region.x - display.bounds.x) * scale.x;
  const y = physical ? region.y - display.bounds.y * scale.y : (region.y - display.bounds.y) * scale.y;
  const width = physical ? region.width : region.width * scale.x;
  const height = physical ? region.height : region.height * scale.y;
  const left = Math.floor(Math.max(0, x));
  const top = Math.floor(Math.max(0, y));
  const right = Math.ceil(Math.min(imageWidth, x + width));
  const bottom = Math.ceil(Math.min(imageHeight, y + height));
  if (right <= left || bottom <= top) return undefined;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function displayForRegion(region: Rect, cursor: CursorPayload): Electron.Display {
  const center = { x: region.x + region.width / 2, y: region.y + region.height / 2 };
  const display = screen.getAllDisplays().find((item) => pointInRect(center.x, center.y, item.bounds));
  if (display) return display;

  const dpr = Math.max(1, cursor.dpr || 1);
  const dipCenter = { x: center.x / dpr, y: center.y / dpr };
  return (
    screen.getAllDisplays().find((item) => pointInRect(dipCenter.x, dipCenter.y, item.bounds)) ??
    screen.getDisplayMatching({ x: cursor.x, y: cursor.y, width: 1, height: 1 })
  );
}

function regionUsesPhysicalCoordinates(region: Rect, cursor: CursorPayload): boolean {
  const dpr = Math.max(1, cursor.dpr || 1);
  return dpr > 1 && !pointInRect(cursor.x, cursor.y, region) && pointInRect(cursor.x * dpr, cursor.y * dpr, region);
}

function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
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

function ensureClaudePermissionHookRegistered(): void {
  const home = app.getPath('home');
  const settingsPath = join(home, '.claude', 'settings.json');
  const hookPath = join(repoRoot, 'apps', 'desktop', 'resources', 'op-claude-hook.cjs');
  if (!existsSync(hookPath)) return;
  let settings: Record<string, unknown> = {};
  try {
    settings = existsSync(settingsPath) ? (JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>) : {};
  } catch {
    return;
  }
  const hooks = isRecord(settings.hooks) ? settings.hooks : {};
  settings.hooks = hooks;
  let changed = false;
  for (const eventName of ['PermissionRequest', 'PreToolUse']) {
    const entries = Array.isArray(hooks[eventName]) ? (hooks[eventName] as unknown[]) : [];
    const command = hookCommand(hookPath, eventName);
    const alreadyFirst = hookEntryContainsCommand(entries[0], hookPath);
    const alreadyCurrent = hookEntryCommand(entries[0]) === command;
    const filtered = entries.filter((entry) => !hookEntryContainsCommand(entry, hookPath));
    const nextEntry = {
      matcher: '',
      hooks: [{ type: 'command', command }]
    };
    hooks[eventName] = [nextEntry, ...filtered];
    changed = changed || !alreadyFirst || !alreadyCurrent || filtered.length !== entries.length - (alreadyFirst ? 1 : 0);
  }
  if (!changed) return;
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

function hookCommand(hookPath: string, eventName: string): string {
  const escapedHookPath = hookPath.replace(/\\/g, '/');
  const escapedNodePath = hookNodeExecutable().replace(/\\/g, '/');
  return `"${escapedNodePath}" "${escapedHookPath}" ${eventName}`;
}

function hookNodeExecutable(): string {
  const candidate = process.env.ProgramFiles ? join(process.env.ProgramFiles, 'nodejs', 'node.exe') : '';
  return candidate && existsSync(candidate) ? candidate : 'node';
}

function hookEntryContainsCommand(entry: unknown, hookPath: string): boolean {
  const marker = hookPath.replace(/\\/g, '/');
  const command = hookEntryCommand(entry);
  return Boolean(command?.replace(/\\/g, '/').includes(marker));
}

function hookEntryCommand(entry: unknown): string | undefined {
  if (!isRecord(entry)) return undefined;
  if (typeof entry.command === 'string') return entry.command;
  if (Array.isArray(entry.hooks)) {
    const hook = entry.hooks.find((candidate) => isRecord(candidate) && typeof candidate.command === 'string');
    return isRecord(hook) && typeof hook.command === 'string' ? hook.command : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

app.whenReady().then(async () => {
  ensureClaudePermissionHookRegistered();
  registerIpc();
  for (const display of screen.getAllDisplays()) {
    await createOverlay(display);
  }
  const settings = getSettings();
  cachedSettings = settings;
  configureCuaRuntime(settings);
  void codexAdapter.ensure(settings);
  void refreshCapabilitiesAndBroadcast().catch((error) => {
    console.warn('[omp] capability discovery failed', error);
  });
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
  cuaTaskManager.cancelAll();
  cuaBroker.stop();
  codexAdapter.stop();
  cuaSidecar.stop();
  clearHoldTimers();
  mouseShakeActivation.destroy();
  try {
    uIOhook.stop();
  } catch {
    // Global hook may not have started.
  }
});
