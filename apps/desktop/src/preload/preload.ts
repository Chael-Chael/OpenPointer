import { contextBridge, ipcRenderer } from 'electron';
import { OMP_CHANNELS } from '../shared/ipc.js';
import type { BuildContextRequest, CreatePlanRequest, CursorPayload, DesktopApi, QueryRequest } from '../shared/types.js';
import type { AppSettings } from '@openmagicpointer/storage';
import type { PointerActionPlan } from '@openmagicpointer/core';

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: DesktopApi = {
  onActivate: (cb) => on<CursorPayload>(OMP_CHANNELS.Activate, cb),
  onDeactivate: (cb) => on<void>(OMP_CHANNELS.Deactivate, () => cb()),
  deactivate: () => ipcRenderer.send(OMP_CHANNELS.RequestDeactivate),
  ready: () => ipcRenderer.send(OMP_CHANNELS.RendererReady),
  onCursor: (cb) => on<CursorPayload>(OMP_CHANNELS.Cursor, cb),
  setInteractive: (value) => ipcRenderer.send(OMP_CHANNELS.SetInteractive, value),
  buildContext: (req: BuildContextRequest) => ipcRenderer.invoke(OMP_CHANNELS.BuildContext, req),
  query: (req: QueryRequest) => ipcRenderer.invoke(OMP_CHANNELS.Query, req),
  createPlan: (req: CreatePlanRequest) => ipcRenderer.invoke(OMP_CHANNELS.CreatePlan, req),
  executePlan: (plan: PointerActionPlan) => ipcRenderer.invoke(OMP_CHANNELS.ExecutePlan, plan),
  getSettings: () => ipcRenderer.invoke(OMP_CHANNELS.GetSettings) as Promise<AppSettings>,
  saveSettings: (patch: Partial<AppSettings> & { apiKey?: string }) => ipcRenderer.invoke(OMP_CHANNELS.SaveSettings, patch)
};

contextBridge.exposeInMainWorld('openMagicPointer', api);
