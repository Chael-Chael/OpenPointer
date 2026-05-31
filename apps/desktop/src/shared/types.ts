import type { AgentBackendId, AgentEvent, AgentInputMode, Point, PointerEntity } from '@openmagicpointer/core';
import type { AppSettings } from '@openmagicpointer/storage';

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
};

export type SubmitInstructionRequest = {
  text: string;
  mode: AgentInputMode;
  backend?: AgentBackendId;
  cursor?: CursorPayload;
  targetPath?: Point[];
  selectedEntity?: PointerEntity;
  includeScreenshot?: boolean;
  includeCua?: boolean;
  cuaEntities?: PointerEntity[];
  conversationId?: string;
};

export type SubmitInstructionResponse = {
  requestId: string;
  backend: AgentBackendId;
  conversationId: string;
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
  onDeactivate(cb: () => void): () => void;
  onCursor(cb: (cursor: CursorPayload) => void): () => void;
  onGlobalContextMenu(cb: (cursor: CursorPayload) => void): () => void;
  onHoldProgress(cb: (payload: HoldProgressPayload) => void): () => void;
  onAgentEvent(cb: (event: AgentEvent) => void): () => void;
  onCaptureActivity(cb: (payload: CaptureActivityPayload) => void): () => void;
  deactivate(): void;
  ready(): void;
  setInteractive(value: boolean): void;
  requestGrounding(req: GroundingPreviewRequest): Promise<GroundingPreviewResponse>;
  submitInstruction(req: SubmitInstructionRequest): Promise<SubmitInstructionResponse>;
  approveAgentRequest(id: string, decision: 'approve' | 'deny'): Promise<void>;
  cancelRun(): void;
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: SaveSettingsPatch): Promise<AppSettings>;
  getConversations(): Promise<import('@openmagicpointer/core').Conversation[]>;
  getConversation(id: string): Promise<import('@openmagicpointer/core').Conversation | null>;
  deleteConversation(id: string): Promise<void>;
  fetchVisionModels(req: { baseUrl: string; apiKey: string }): Promise<{ success: boolean; models?: string[]; error?: string }>;
};
