import { contextBridge, ipcRenderer } from 'electron';
import type { AgentEvent } from '@openpointer/core';
import type { AppSettings } from '@openpointer/storage';
import { OP_CHANNELS } from '../shared/ipc.js';
import type {
  CaptureActivityPayload,
  CuaTaskEventPayload,
  CuaTaskSummary,
  CursorPayload,
  DesktopApi,
  GroundingPreviewResponse,
  HoldProgressPayload,
  InsertTextRequest,
  InsertTextResponse,
  ReadSelectionRequest,
  ReadSelectionResponse,
  SaveSettingsPatch,
  ContinueConversationRequest,
  ContinueConversationResponse,
  SubmitInstructionRequest,
  SubmitInstructionResponse,
  WindowPreviewResponse
} from '../shared/types.js';

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: DesktopApi = {
  onActivate: (cb) => on<CursorPayload>(OP_CHANNELS.Activate, cb),
  onDeactivate: (cb) => on<void>(OP_CHANNELS.Deactivate, () => cb()),
  onCursor: (cb) => on<CursorPayload>(OP_CHANNELS.Cursor, cb),
  onGlobalContextMenu: (cb) => on<CursorPayload>(OP_CHANNELS.GlobalContextMenu, cb),
  onGlobalMouseDown: (cb) => on<CursorPayload>(OP_CHANNELS.GlobalMouseDown, cb),
  onHoldProgress: (cb) => on<HoldProgressPayload>(OP_CHANNELS.HoldProgress, cb),
  onAgentEvent: (cb) => on<AgentEvent>(OP_CHANNELS.AgentEvent, cb),
  onCuaTaskEvent: (cb) => on<CuaTaskEventPayload>(OP_CHANNELS.CuaTaskEvent, cb),
  onCaptureActivity: (cb) => on<CaptureActivityPayload>(OP_CHANNELS.CaptureActivity, cb),
  deactivate: () => ipcRenderer.send(OP_CHANNELS.RequestDeactivate),
  ready: () => ipcRenderer.send(OP_CHANNELS.RendererReady),
  setInteractive: (value) => ipcRenderer.send(OP_CHANNELS.SetInteractive, value),
  requestWindowContext: (req) => ipcRenderer.invoke(OP_CHANNELS.RequestWindowContext, req) as Promise<WindowPreviewResponse>,
  requestGrounding: (req) => ipcRenderer.invoke(OP_CHANNELS.RequestGrounding, req) as Promise<GroundingPreviewResponse>,
  readSelection: (req?: ReadSelectionRequest) => ipcRenderer.invoke(OP_CHANNELS.ReadSelection, req) as Promise<ReadSelectionResponse>,
  insertText: (req: InsertTextRequest) => ipcRenderer.invoke(OP_CHANNELS.InsertText, req) as Promise<InsertTextResponse>,
  submitInstruction: (req: SubmitInstructionRequest) => ipcRenderer.invoke(OP_CHANNELS.SubmitInstruction, req) as Promise<SubmitInstructionResponse>,
  continueConversation: (req: ContinueConversationRequest) => ipcRenderer.invoke(OP_CHANNELS.ContinueConversation, req) as Promise<ContinueConversationResponse>,
  listCuaTasks: () => ipcRenderer.invoke(OP_CHANNELS.CuaTaskList) as Promise<CuaTaskSummary[]>,
  cancelCuaTask: (taskId) => ipcRenderer.invoke(OP_CHANNELS.CuaTaskCancel, taskId) as Promise<void>,
  getCuaHealth: () => ipcRenderer.invoke(OP_CHANNELS.CuaHealth),
  startCuaTaskRecording: (taskId) => ipcRenderer.invoke(OP_CHANNELS.CuaTaskStartRecording, taskId) as Promise<void>,
  stopCuaTaskRecording: (taskId) => ipcRenderer.invoke(OP_CHANNELS.CuaTaskStopRecording, taskId) as Promise<void>,
  replayCuaTaskRecording: (taskId) => ipcRenderer.invoke(OP_CHANNELS.CuaTaskReplayRecording, taskId) as Promise<void>,
  approveAgentRequest: (id, decision) => ipcRenderer.invoke(OP_CHANNELS.ApproveAgentRequest, id, decision) as Promise<void>,
  cancelRun: () => ipcRenderer.send(OP_CHANNELS.CancelRun),
  getSettings: () => ipcRenderer.invoke(OP_CHANNELS.GetSettings) as Promise<AppSettings>,
  saveSettings: (patch: SaveSettingsPatch) => ipcRenderer.invoke(OP_CHANNELS.SaveSettings, patch) as Promise<AppSettings>,
  getConversations: () => ipcRenderer.invoke(OP_CHANNELS.GetConversations),
  getConversation: (id) => ipcRenderer.invoke(OP_CHANNELS.GetConversation, id),
  deleteConversation: (id) => ipcRenderer.invoke(OP_CHANNELS.DeleteConversation, id),
  fetchVisionModels: (req) => ipcRenderer.invoke(OP_CHANNELS.FetchVisionModels, req)
};

contextBridge.exposeInMainWorld('openPointer', api);
