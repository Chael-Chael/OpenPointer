import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen } from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { OpenAICompatibleBackend, buildPointerMessages, isUnsupportedImageInputError } from '@openmagicpointer/backends';
import { actionPreviewFromSteps, createActionPlan, validateActionPlan, type ActionStep, type ExecutorResult, type PointerActionPlan, type PointerContext, type PointerEntity, type Rect } from '@openmagicpointer/core';
import { CuaHttpExecutor, MockExecutor } from '@openmagicpointer/executors';
import { WiggleDetector, wiggleOptionsForSensitivity } from '@openmagicpointer/gestures';
import { buildPointerContext } from '@openmagicpointer/grounding';
import { recommendIntents } from '@openmagicpointer/intent';
import type { AppSettings, AuditEntry } from '@openmagicpointer/storage';
import { OMP_CHANNELS } from '../shared/ipc.js';
import type { BuildContextRequest, CreatePlanRequest, CursorPayload, QueryRequest } from '../shared/types.js';
import { loadLocalEnv } from './env.js';
import { getApiKey, getSettings, saveSettings } from './settings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../..');
loadLocalEnv(repoRoot);

const windows = new Map<number, BrowserWindow>();
let wiggle = new WiggleDetector();
let wiggleSensitivity: AppSettings['wiggleSensitivity'] = 'medium';
let runtimeSettings: AppSettings | null = null;
let registeredHotkey = '';
let cursorTimer: NodeJS.Timeout | null = null;
let lastCursor: CursorPayload | null = null;
let active = false;

const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';

async function createOverlay(display: Electron.Display): Promise<void> {
  console.log('[omp] creating overlay', {
    displayId: display.id,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor
  });
  const win = new BrowserWindow({
    x: display.workArea.x,
    y: display.workArea.y,
    width: display.workArea.width,
    height: display.workArea.height,
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
  win.once('ready-to-show', () => {
    console.log('[omp] overlay ready-to-show', { displayId: display.id });
    win.showInactive();
  });
  win.webContents.on('did-finish-load', () => {
    console.log('[omp] overlay did-finish-load', { displayId: display.id });
    if (!win.isVisible()) win.showInactive();
    if (active) {
      win.webContents.send(OMP_CHANNELS.Activate, cursorPayload());
    }
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[omp] overlay failed to load', { displayId: display.id, errorCode, errorDescription, validatedURL });
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[omp] renderer process gone', { displayId: display.id, details });
  });

  if (process.env.NODE_ENV === 'production' || app.isPackaged) {
    const filePath = join(__dirname, '../../dist/index.html');
    console.log('[omp] loading packaged renderer', filePath);
    await win.loadFile(filePath, { query: { displayId: String(display.id) } });
  } else {
    console.log('[omp] loading dev renderer', devUrl);
    await win.loadURL(`${devUrl}?displayId=${display.id}`);
  }
  if (!win.isVisible()) win.showInactive();
  win.on('closed', () => windows.delete(display.id));
}

function cursorPayload(): CursorPayload {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  return {
    x: point.x,
    y: point.y,
    localX: point.x - display.workArea.x,
    localY: point.y - display.workArea.y,
    displayId: display.id,
    dpr: display.scaleFactor
  };
}

function broadcast(channel: string, payload?: unknown): void {
  for (const win of windows.values()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function activate(): void {
  console.log('[omp] activate');
  active = true;
  const payload = cursorPayload();
  lastCursor = payload;
  const activeWin = windows.get(payload.displayId);
  for (const win of windows.values()) {
    if (win.isDestroyed()) continue;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
  }
  if (activeWin && !activeWin.isDestroyed()) {
    activeWin.setIgnoreMouseEvents(false);
    activeWin.show();
    activeWin.focus();
    activeWin.webContents.focus();
  }
  broadcast(OMP_CHANNELS.Activate, payload);
}

function deactivate(): void {
  console.log('[omp] deactivate');
  active = false;
  broadcast(OMP_CHANNELS.Deactivate);
  for (const win of windows.values()) {
    if (!win.isDestroyed()) win.setIgnoreMouseEvents(true, { forward: true });
  }
}

function applyRuntimeSettings(settings: AppSettings): void {
  runtimeSettings = settings;
  updateWiggleDetector(settings.wiggleSensitivity);
  registerActivationHotkey(settings.activationHotkey);
}

function updateWiggleDetector(sensitivity: AppSettings['wiggleSensitivity']): void {
  if (wiggleSensitivity === sensitivity) return;
  wiggleSensitivity = sensitivity;
  wiggle = new WiggleDetector(wiggleOptionsForSensitivity(sensitivity));
}

function registerActivationHotkey(hotkey: string): void {
  const nextHotkey = hotkey.trim();
  if (registeredHotkey === nextHotkey) return;
  const previousHotkey = registeredHotkey;
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey);
    registeredHotkey = '';
  }
  if (!nextHotkey) {
    console.log('[omp] global shortcut disabled');
    return;
  }
  const registered = globalShortcut.register(nextHotkey, () => (active ? deactivate() : activate()));
  if (registered) registeredHotkey = nextHotkey;
  if (!registered && previousHotkey) {
    const restored = globalShortcut.register(previousHotkey, () => (active ? deactivate() : activate()));
    if (restored) registeredHotkey = previousHotkey;
  }
  console.log('[omp] global shortcut', nextHotkey, registered ? 'registered' : 'failed');
}

function startCursorLoop(): void {
  if (cursorTimer) return;
  cursorTimer = setInterval(() => {
    const payload = cursorPayload();
    lastCursor = payload;
    broadcast(OMP_CHANNELS.Cursor, payload);
    const settings = runtimeSettings ?? getSettings();
    if (!active && settings.wiggleEnabled && wiggle.push({ x: payload.x, y: payload.y, t: Date.now() })) {
      activate();
    }
  }, 33);
}

function registerIpc(): void {
  ipcMain.on(OMP_CHANNELS.SetInteractive, (event, value: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setIgnoreMouseEvents(!value, { forward: true });
  });

  ipcMain.on(OMP_CHANNELS.RequestDeactivate, () => {
    deactivate();
  });

  ipcMain.on(OMP_CHANNELS.RendererReady, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    console.log('[omp] renderer ready', { active, hasWindow: Boolean(win) });
    if (!active && !app.isPackaged) {
      activate();
      return;
    }
    if (active) {
      event.sender.send(OMP_CHANNELS.Activate, cursorPayload());
    } else {
      event.sender.send(OMP_CHANNELS.Cursor, cursorPayload());
    }
  });

  ipcMain.handle(OMP_CHANNELS.GetSettings, () => getSettings());
  ipcMain.handle(OMP_CHANNELS.SaveSettings, (_event, patch) => {
    const next = saveSettings(patch);
    applyRuntimeSettings(next);
    return next;
  });

  ipcMain.handle(OMP_CHANNELS.BuildContext, async (_event, req: BuildContextRequest) => {
    const capture = await captureContextImage(req);
    const entities = visualEntities(req, capture.crop);
    const context = buildPointerContext({
      cursor: req.cursor,
      source: 'desktop',
      entities,
      gestureKind: req.gestureKind,
      gesturePath: req.gesturePath,
      screenshotId: capture.id,
      imageBase64: capture.imageBase64,
      mimeType: capture.mimeType,
      crop: capture.crop
    });
    return { context, intents: recommendIntents(context) };
  });

  ipcMain.handle(OMP_CHANNELS.Query, async (_event, req: QueryRequest) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return {
        answer: 'No OpenAI-compatible API key is configured. Add it in Settings or a local .env file.',
        intents: recommendIntents(req.context)
      };
    }
    const settings = getSettings();
    const backend = new OpenAICompatibleBackend({
      baseUrl: settings.openAICompatibleBaseUrl,
      apiKey,
      model: settings.openAICompatibleModel || undefined
    });
    try {
      const result = await backend.complete(buildPointerMessages(req.context, req.prompt, { includeImage: true }));
      return { answer: result.text || 'The model returned an empty response.', intents: recommendIntents(req.context) };
    } catch (error) {
      if (!isUnsupportedImageInputError(error)) throw error;
      console.warn('[omp] provider does not support image input; retrying text-only context');
      const result = await backend.complete(buildPointerMessages(req.context, req.prompt, { includeImage: false }));
      const prefix = 'Note: the configured model does not support image input, so I used only pointer metadata rather than the screenshot.\n\n';
      return { answer: prefix + (result.text || 'The model returned an empty response.'), intents: recommendIntents(req.context) };
    }
  });

  ipcMain.handle(OMP_CHANNELS.CreatePlan, (_event, req: CreatePlanRequest) => {
    const steps = createStepsForIntent(req);
    const plan = createActionPlan({
      intent: req.intent.id,
      context: req.context,
      steps,
      preview: previewForIntent(req, steps)
    });
    const valid = validateActionPlan(plan);
    if (!valid.ok) throw new Error(valid.error);
    return plan;
  });

  ipcMain.handle(OMP_CHANNELS.ExecutePlan, async (_event, plan: PointerActionPlan) => {
    const valid = validateActionPlan(plan);
    if (!valid.ok) {
      const result: ExecutorResult = { ok: false, summary: valid.error, error: valid.error };
      persistAudit(plan, result);
      return { ok: false, summary: valid.error, error: valid.error };
    }
    const settings = getSettings();
    const executor = settings.cuaEndpoint ? new CuaHttpExecutor({ endpoint: settings.cuaEndpoint }) : new MockExecutor();
    try {
      const dryRun = await executor.dryRun(plan);
      const result = await executor.execute(dryRun, `approved-${Date.now()}`);
      await executor.audit(dryRun, result);
      persistAudit(dryRun, result);
      return { ok: result.ok, summary: result.summary, error: result.error };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result: ExecutorResult = { ok: false, summary: message, error: message };
      persistAudit(plan, result);
      return result;
    }
  });
}

function createStepsForIntent(req: CreatePlanRequest): ActionStep[] {
  const text = req.prompt || req.intent.defaultPrompt;
  const targetText = req.context.target?.text || req.context.target?.name || '';
  if (req.intent.id === 'click' && req.context.target?.bbox) {
    return [{ type: 'click', ...screenPointFromLocalRectCenter(req.context.target.bbox, req.context.cursor) }];
  }
  if (req.intent.id === 'fill') {
    return [{ type: 'type', text }];
  }
  if (req.intent.id === 'copy' && targetText) {
    return [{ type: 'copy', text: targetText }];
  }
  if (req.intent.id === 'open' && /^https?:\/\//i.test(targetText.trim())) {
    return [{ type: 'open', target: targetText.trim() }];
  }
  return [{ type: 'answer', prompt: text }];
}

function previewForIntent(req: CreatePlanRequest, steps: ActionStep[]): string {
  return [
    `Intent: ${req.intent.label} (${req.intent.id})`,
    `Context: ${describeContext(req.context)}`,
    'Steps:',
    actionPreviewFromSteps(steps)
  ].join('\n');
}

function describeContext(context: PointerContext): string {
  const parts = [
    context.gesture?.kind ? `${context.gesture.kind} gesture` : '',
    context.target?.kind ? `${context.target.kind} target` : '',
    context.entities.length === 1 ? '1 entity' : `${context.entities.length} entities`,
    context.visual?.crop ? `${Math.round(context.visual.crop.width)}x${Math.round(context.visual.crop.height)} crop` : ''
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'current pointer context';
}

function persistAudit(plan: PointerActionPlan, result: ExecutorResult): void {
  const entry: AuditEntry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    plan,
    result,
    createdAt: Date.now()
  };
  try {
    const path = join(app.getPath('userData'), 'audit.jsonl');
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    console.warn('[omp] failed to persist audit entry', error);
  }
}

function visualEntities(req: BuildContextRequest, crop: Rect): PointerEntity[] {
  const base = req.gesturePath && req.gesturePath.length > 0
    ? {
        x: Math.min(...req.gesturePath.map((p) => p.x)),
        y: Math.min(...req.gesturePath.map((p) => p.y)),
        width: Math.max(40, Math.max(...req.gesturePath.map((p) => p.x)) - Math.min(...req.gesturePath.map((p) => p.x))),
        height: Math.max(30, Math.max(...req.gesturePath.map((p) => p.y)) - Math.min(...req.gesturePath.map((p) => p.y)))
      }
    : crop;
  const kind = req.gestureKind ?? 'hover';
  const label = kind === 'sweep'
    ? 'Sweep path screenshot region'
    : kind === 'lasso' || kind === 'circle'
      ? 'Closed selection screenshot region'
      : kind === 'rectangle'
        ? 'Rectangle screenshot region'
        : 'Pointer hover screenshot region';
  return [
    {
      id: `entity-${Date.now()}`,
      kind: 'image',
      text: label,
      role: kind,
      name: label,
      bbox: base,
      confidence: req.gesturePath && req.gesturePath.length > 1 ? 0.72 : 0.62,
      origin: 'manual'
    }
  ];
}

function screenPointFromLocalRectCenter(rect: Rect, cursor: CursorPayload): { x: number; y: number } {
  return {
    x: cursor.x - cursor.localX + rect.x + rect.width / 2,
    y: cursor.y - cursor.localY + rect.y + rect.height / 2
  };
}

async function captureContextImage(req: BuildContextRequest): Promise<{
  id: string;
  imageBase64: string;
  mimeType: 'image/jpeg';
  crop: Rect;
}> {
  const display = screen.getDisplayMatching({
    x: req.cursor.x,
    y: req.cursor.y,
    width: 1,
    height: 1
  });
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
  const crop = cropForRequest(req, display);
  const imageCrop = imageRectFromLocalRect(crop, display, size.width, size.height);
  const jpeg = image.crop(imageCrop).toJPEG(82);
  return {
    id: `screen-${Date.now()}`,
    imageBase64: jpeg.toString('base64'),
    mimeType: 'image/jpeg',
    crop
  };
}

function cropForRequest(req: BuildContextRequest, display: Electron.Display): Rect {
  if (req.gesturePath && req.gesturePath.length > 1) {
    const xs = req.gesturePath.map((point) => point.x);
    const ys = req.gesturePath.map((point) => point.y);
    const pad = 48;
    const x = Math.floor(Math.max(0, Math.min(...xs) - pad));
    const y = Math.floor(Math.max(0, Math.min(...ys) - pad));
    const right = Math.ceil(Math.min(display.workArea.width, Math.max(...xs) + pad));
    const bottom = Math.ceil(Math.min(display.workArea.height, Math.max(...ys) + pad));
    return {
      x,
      y,
      width: Math.max(1, right - x),
      height: Math.max(1, bottom - y)
    };
  }

  const width = Math.min(720, display.workArea.width);
  const height = Math.min(480, display.workArea.height);
  const x = Math.round(Math.max(0, Math.min(display.workArea.width - width, req.cursor.localX - width / 2)));
  const y = Math.round(Math.max(0, Math.min(display.workArea.height - height, req.cursor.localY - height / 2)));
  return { x, y, width, height };
}

function imageRectFromLocalRect(rect: Rect, display: Electron.Display, imageWidth: number, imageHeight: number): Rect {
  const offsetX = display.workArea.x - display.bounds.x;
  const offsetY = display.workArea.y - display.bounds.y;
  const scale = display.scaleFactor;
  const left = clampStart(Math.floor((offsetX + rect.x) * scale), imageWidth);
  const top = clampStart(Math.floor((offsetY + rect.y) * scale), imageHeight);
  const right = Math.min(imageWidth, Math.max(left + 1, Math.ceil((offsetX + rect.x + rect.width) * scale)));
  const bottom = Math.min(imageHeight, Math.max(top + 1, Math.ceil((offsetY + rect.y + rect.height) * scale)));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function clampStart(value: number, extent: number): number {
  return Math.min(Math.max(0, value), Math.max(0, extent - 1));
}

app.whenReady().then(async () => {
  console.log('[omp] app ready');
  registerIpc();
  for (const display of screen.getAllDisplays()) {
    await createOverlay(display);
  }
  const settings = getSettings();
  applyRuntimeSettings(settings);
  startCursorLoop();
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
});
