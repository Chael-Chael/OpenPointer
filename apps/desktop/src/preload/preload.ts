import { contextBridge, ipcRenderer } from 'electron';
import type { AgentEvent } from '@openmagicpointer/core';
import type { AppSettings } from '@openmagicpointer/storage';
import { OMP_CHANNELS } from '../shared/ipc.js';
import type {
  CaptureActivityPayload,
  CursorPayload,
  DesktopApi,
  GroundingPreviewResponse,
  HoldProgressPayload,
  SaveSettingsPatch,
  SubmitInstructionRequest,
  SubmitInstructionResponse
} from '../shared/types.js';

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: DesktopApi = {
  onActivate: (cb) => on<CursorPayload>(OMP_CHANNELS.Activate, cb),
  onDeactivate: (cb) => on<void>(OMP_CHANNELS.Deactivate, () => cb()),
  onCursor: (cb) => on<CursorPayload>(OMP_CHANNELS.Cursor, cb),
  onGlobalContextMenu: (cb) => on<CursorPayload>(OMP_CHANNELS.GlobalContextMenu, cb),
  onHoldProgress: (cb) => on<HoldProgressPayload>(OMP_CHANNELS.HoldProgress, cb),
  onAgentEvent: (cb) => on<AgentEvent>(OMP_CHANNELS.AgentEvent, cb),
  onCaptureActivity: (cb) => on<CaptureActivityPayload>(OMP_CHANNELS.CaptureActivity, cb),
  deactivate: () => ipcRenderer.send(OMP_CHANNELS.RequestDeactivate),
  ready: () => ipcRenderer.send(OMP_CHANNELS.RendererReady),
  setInteractive: (value) => ipcRenderer.send(OMP_CHANNELS.SetInteractive, value),
  requestGrounding: (req) => ipcRenderer.invoke(OMP_CHANNELS.RequestGrounding, req) as Promise<GroundingPreviewResponse>,
  submitInstruction: (req: SubmitInstructionRequest) => ipcRenderer.invoke(OMP_CHANNELS.SubmitInstruction, req) as Promise<SubmitInstructionResponse>,
  approveAgentRequest: (id, decision) => ipcRenderer.invoke(OMP_CHANNELS.ApproveAgentRequest, id, decision) as Promise<void>,
  cancelRun: () => ipcRenderer.send(OMP_CHANNELS.CancelRun),
  getSettings: () => ipcRenderer.invoke(OMP_CHANNELS.GetSettings) as Promise<AppSettings>,
  saveSettings: (patch: SaveSettingsPatch) => ipcRenderer.invoke(OMP_CHANNELS.SaveSettings, patch) as Promise<AppSettings>,
  getConversations: () => ipcRenderer.invoke(OMP_CHANNELS.GetConversations),
  getConversation: (id) => ipcRenderer.invoke(OMP_CHANNELS.GetConversation, id),
  deleteConversation: (id) => ipcRenderer.invoke(OMP_CHANNELS.DeleteConversation, id),
  fetchVisionModels: (req) => ipcRenderer.invoke(OMP_CHANNELS.FetchVisionModels, req)
};

contextBridge.exposeInMainWorld('openMagicPointer', api);
