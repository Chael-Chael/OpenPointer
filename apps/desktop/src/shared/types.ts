import type { ApprovalDecision } from '@openpointer/agent-bridge';
import type { AgentBackendId, AgentEvent, AgentInputMode, ContextChip, Point, PointerContext, PointerEntity, Rect } from '@openpointer/core';
import type { AppSettings } from '@openpointer/storage';

export type CursorPayload = {
  x: number;
  y: number;
  localX: number;
  localY: number;
  displayId: number;
  dpr: number;
};

export type HoldProgressPayload = {
  cursor: CursorPayload;
  progress: number;
  state: 'holding' | 'completed' | 'canceled';
  startedWhileActive: boolean;
  source?: 'long-press' | 'mouse-shake';
};

export type SubmitInstructionRequest = {
  text: string;
  mode: AgentInputMode;
  backend?: AgentBackendId;
  cursor?: CursorPayload;
  targetPath?: Point[];
  selectedEntity?: PointerEntity;
  windowContext?: PointerContext['window'];
  windowPid?: number;
  windowBounds?: Rect;
  includeSelectedText?: boolean;
  includeScreenshot?: boolean;
  includeCua?: boolean;
  cuaEntities?: PointerEntity[];
  contextChips?: ContextChip[];
  conversationId?: string;
};

export type SubmitInstructionResponse = {
  requestId: string;
  backend: AgentBackendId;
  conversationId: string;
  taskId?: string;
};

export type ContinueConversationRequest = {
  conversationId: string;
  backend?: AgentBackendId;
  target: 'terminal' | 'app';
};

export type ContinueConversationResponse = {
  ok: boolean;
  backend?: AgentBackendId;
  target: 'terminal' | 'app';
  error?: string;
};

export type CuaTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type CuaTaskSummary = {
  id: string;
  conversationId: string;
  instruction: string;
  windowTitle?: string;
  status: CuaTaskStatus;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  requestId: string;
  backend: AgentBackendId;
  eventCount: number;
  recording?: {
    status: 'off' | 'recording' | 'available';
    outputDir?: string;
  };
};

export type CuaHealth = {
  transport: 'http';
  status: 'ready' | 'starting' | 'stopped' | 'unavailable';
  endpoint?: string;
  port: number;
  pid?: number;
  driverPath?: string;
  serverVersion?: string;
  toolCount?: number;
  lastError?: string;
};

export type CuaTaskEventPayload =
  | {
      type: 'task.updated';
      task: CuaTaskSummary;
    }
  | {
      type: 'agent-event';
      task: CuaTaskSummary;
      agentEvent: AgentEvent;
    };

export type SaveSettingsPatch = Partial<AppSettings> & {
  localVlmApiKey?: string;
  hermesApiKey?: string;
  opencodeApiKey?: string;
  claudeAgentApiKey?: string;
  codexApiKey?: string;
  clearLocalVlmApiKey?: boolean;
  clearHermesApiKey?: boolean;
  clearOpenCodeApiKey?: boolean;
  clearClaudeAgentApiKey?: boolean;
  clearCodexApiKey?: boolean;
};

export type GroundingPreviewRequest = {
  cursor: CursorPayload;
};

export type WindowPreviewRequest = {
  cursor: CursorPayload;
};

export type ReadSelectionRequest = {
  cursor?: CursorPayload;
  windowContext?: PointerContext['window'];
};

export type ReadSelectionResponse = {
  status: 'matched' | 'empty' | 'unavailable';
  text?: string;
  source?: 'uia-textpattern' | 'cua-hotkey-clipboard';
  pid?: number;
  windowId?: string;
  error?: string;
};

export type InsertTextRequest = {
  text: string;
  cursor?: CursorPayload;
  windowContext?: PointerContext['window'];
  targetEntity?: PointerEntity;
  clickTarget?: boolean;
};

export type InsertTextResponse = {
  status: 'matched' | 'unavailable';
  source?: 'cua-click-paste';
  pid?: number;
  windowId?: string;
  error?: string;
};

export type WindowPreviewResponse = {
  status: 'matched' | 'unavailable' | 'fallback';
  source: 'cua' | 'active-window';
  window?: PointerContext['window'];
  pid?: number;
  windowId?: string;
  bounds?: Rect;
  error?: string;
};

// Emitted by the main process around the submit-time screenshot capture so the
// renderer can tint the pointer. `withCua` is true when the capture coincides
// with a selected CUA element (screenshot + grounding happening together).
export type CaptureActivityPayload = {
  phase: 'start' | 'end';
  withCua: boolean;
};

export type GroundingPreviewResponse = {
  status: 'matched' | 'unavailable' | 'fallback';
  entities: PointerEntity[];
  hoveredEntityId?: string;
  pid?: number;
  windowId?: string;
  error?: string;
};

export type DesktopApi = {
  onActivate(cb: (cursor: CursorPayload) => void): () => void;
  onDeactivate(cb: (payload?: DeactivatePayload) => void): () => void;
  onCursor(cb: (cursor: CursorPayload) => void): () => void;
  onGlobalContextMenu(cb: (cursor: CursorPayload) => void): () => void;
  onGlobalMouseDown(cb: (cursor: CursorPayload) => void): () => void;
  onHoldProgress(cb: (payload: HoldProgressPayload) => void): () => void;
  onAgentEvent(cb: (event: AgentEvent) => void): () => void;
  onCuaTaskEvent(cb: (payload: CuaTaskEventPayload) => void): () => void;
  onCaptureActivity(cb: (payload: CaptureActivityPayload) => void): () => void;
  deactivate(options?: DeactivatePayload): void;
  ready(): void;
  setInteractive(value: boolean): void;
  requestWindowContext(req: WindowPreviewRequest): Promise<WindowPreviewResponse>;
  requestGrounding(req: GroundingPreviewRequest): Promise<GroundingPreviewResponse>;
  readSelection(req?: ReadSelectionRequest): Promise<ReadSelectionResponse>;
  insertText(req: InsertTextRequest): Promise<InsertTextResponse>;
  submitInstruction(req: SubmitInstructionRequest): Promise<SubmitInstructionResponse>;
  continueConversation(req: ContinueConversationRequest): Promise<ContinueConversationResponse>;
  listCuaTasks(): Promise<CuaTaskSummary[]>;
  cancelCuaTask(taskId: string): Promise<void>;
  getCuaHealth(): Promise<CuaHealth>;
  startCuaTaskRecording(taskId: string): Promise<void>;
  stopCuaTaskRecording(taskId: string): Promise<void>;
  replayCuaTaskRecording(taskId: string): Promise<void>;
  approveAgentRequest(id: string, decision: ApprovalDecision): Promise<void>;
  cancelRun(): void;
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: SaveSettingsPatch): Promise<AppSettings>;
  getConversations(): Promise<import('@openpointer/core').Conversation[]>;
  getConversation(id: string): Promise<import('@openpointer/core').Conversation | null>;
  deleteConversation(id: string): Promise<void>;
  fetchVisionModels(req: { baseUrl: string; apiKey: string }): Promise<{ success: boolean; models?: string[]; error?: string }>;
};

export type DeactivatePayload = {
  startNewConversationOnNextActivate?: boolean;
};
