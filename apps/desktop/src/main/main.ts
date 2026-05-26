import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { OpenAICompatibleBackend, buildPointerMessages, isUnsupportedImageInputError } from '@openmagicpointer/backends';
import { actionPreviewFromSteps, createActionPlan, validateActionPlan, type PointerActionPlan, type PointerEntity, type Rect } from '@openmagicpointer/core';
import { CuaHttpExecutor, MockExecutor } from '@openmagicpointer/executors';
import { WiggleDetector } from '@openmagicpointer/gestures';
import { buildPointerContext } from '@openmagicpointer/grounding';
import { recommendIntents } from '@openmagicpointer/intent';
import { OMP_CHANNELS } from '../shared/ipc.js';
import type { BuildContextRequest, CreatePlanRequest, CursorPayload, QueryRequest } from '../shared/types.js';
import { loadLocalEnv } from './env.js';
import { getApiKey, getSettings, saveSettings } from './settings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../..');
loadLocalEnv(repoRoot);

const windows = new Map<number, BrowserWindow>();
const wiggle = new WiggleDetector();
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

function startCursorLoop(): void {
  if (cursorTimer) return;
  cursorTimer = setInterval(() => {
    const payload = cursorPayload();
    lastCursor = payload;
    broadcast(OMP_CHANNELS.Cursor, payload);
    const settings = getSettings();
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
  ipcMain.handle(OMP_CHANNELS.SaveSettings, (_event, patch) => saveSettings(patch));

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
    const text = req.prompt || req.intent.defaultPrompt;
    const steps = req.intent.id === 'click' && req.context.target?.bbox
      ? [{ type: 'click' as const, x: req.context.target.bbox.x + req.context.target.bbox.width / 2, y: req.context.target.bbox.y + req.context.target.bbox.height / 2 }]
      : req.intent.id === 'fill'
        ? [{ type: 'type' as const, text }]
        : [{ type: 'answer' as const, prompt: text }];
    const plan = createActionPlan({
      intent: req.intent.id,
      context: req.context,
      steps,
      preview: actionPreviewFromSteps(steps)
    });
    const valid = validateActionPlan(plan);
    if (!valid.ok) throw new Error(valid.error);
    return plan;
  });

  ipcMain.handle(OMP_CHANNELS.ExecutePlan, async (_event, plan: PointerActionPlan) => {
    const valid = validateActionPlan(plan);
    if (!valid.ok) return { ok: false, summary: valid.error, error: valid.error };
    const settings = getSettings();
    const executor = settings.cuaEndpoint ? new CuaHttpExecutor({ endpoint: settings.cuaEndpoint }) : new MockExecutor();
    try {
      const dryRun = await executor.dryRun(plan);
      const result = await executor.execute(dryRun, `approved-${Date.now()}`);
      await executor.audit(dryRun, result);
      return { ok: result.ok, summary: result.summary, error: result.error };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, summary: message, error: message };
    }
  });
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
  return [
    {
      id: `entity-${Date.now()}`,
      kind: 'image',
      text: req.gestureKind ? `Real ${req.gestureKind} screenshot region` : 'Real screenshot around pointer',
      bbox: base,
      confidence: 0.8,
      origin: 'manual'
    }
  ];
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
  const crop = cropForRequest(req, size.width, size.height);
  const jpeg = image.crop(crop).toJPEG(82);
  return {
    id: `screen-${Date.now()}`,
    imageBase64: jpeg.toString('base64'),
    mimeType: 'image/jpeg',
    crop
  };
}

function cropForRequest(req: BuildContextRequest, screenWidth: number, screenHeight: number): Rect {
  if (req.gesturePath && req.gesturePath.length > 1) {
    const xs = req.gesturePath.map((point) => point.x);
    const ys = req.gesturePath.map((point) => point.y);
    const pad = 48;
    const x = Math.floor(Math.max(0, Math.min(...xs) - pad));
    const y = Math.floor(Math.max(0, Math.min(...ys) - pad));
    const right = Math.ceil(Math.min(screenWidth, Math.max(...xs) + pad));
    const bottom = Math.ceil(Math.min(screenHeight, Math.max(...ys) + pad));
    return {
      x,
      y,
      width: Math.max(1, right - x),
      height: Math.max(1, bottom - y)
    };
  }

  const width = Math.min(720, screenWidth);
  const height = Math.min(480, screenHeight);
  const x = Math.round(Math.max(0, Math.min(screenWidth - width, req.cursor.localX - width / 2)));
  const y = Math.round(Math.max(0, Math.min(screenHeight - height, req.cursor.localY - height / 2)));
  return { x, y, width, height };
}

app.whenReady().then(async () => {
  console.log('[omp] app ready');
  registerIpc();
  for (const display of screen.getAllDisplays()) {
    await createOverlay(display);
  }
  const settings = getSettings();
  const registered = globalShortcut.register(settings.activationHotkey, () => (active ? deactivate() : activate()));
  console.log('[omp] global shortcut', settings.activationHotkey, registered ? 'registered' : 'failed');
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
