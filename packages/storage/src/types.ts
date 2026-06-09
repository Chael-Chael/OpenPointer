import type { AgentContextEnvelope, AgentEvent, PointerContext } from '@openpointer/core';

export type AppSettings = {
  agentBackend: 'hermes' | 'opencode' | 'openclaw' | 'claude-agent' | 'codex';
  localVlmEnabled: boolean;
  localVlmBaseUrl: string;
  localVlmModel: string;
  hasLocalVlmApiKey: boolean;
  hasHermesApiKey: boolean;
  hermesBaseUrl: string;
  hasOpenCodeApiKey: boolean;
  opencodeBaseUrl: string;
  openclawGatewayUrl: string;
  openclawExecutablePath: string;
  openclawAgent: string;
  openclawModel: string;
  claudeAgentEnabled: boolean;
  claudeAgentBaseUrl: string;
  claudeAgentExecutable: string;
  claudeAgentModel: string;
  claudeAgentEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  hasClaudeAgentApiKey: boolean;
  hasCodexApiKey: boolean;
  codexAppServerUrl: string;
  codexExecutablePath: string;
  codexAppServerTransport: 'http-adapter' | 'websocket' | 'stdio';
  codexModel: string;
  codexEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  approvalMode: 'request' | 'allow-all';
  cuaMode: 'off' | 'prefer' | 'require-on-explicit-command';
  requireApprovalBeforeCua: boolean;
  cuaDebugOverlayEnabled: boolean;
  cuaDriverHttpPort: number;
  cuaAgentCursorEnabled: boolean;
  cuaRecordingMode: 'off' | 'manual';
  cuaBrowserPageToolsEnabled: boolean;
  cuaPageJavascriptPolicy: 'ask' | 'off';
  activationHotkey: string;
  longPressEnabled: boolean;
  mouseShakeActivationEnabled: boolean;
  mouseShakeSensitivity: 'low' | 'medium' | 'high';
  voiceEnabled: boolean;
  pillWidth: number;
  pillHeight: number;
  newDialogBehavior: 'new' | 'continue' | 'interval';
  newDialogInterval: number;
  localVlmContextWindow: number;
  modalTheme: 'blue' | 'white' | 'black';
  backgroundProcessCorner: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
};

export type HistoryEntry = {
  id: string;
  context: PointerContext;
  prompt: string;
  answer?: string;
  envelope?: AgentContextEnvelope;
  events?: AgentEvent[];
  createdAt: number;
};

export type AuditEntry = {
  id: string;
  envelope: AgentContextEnvelope;
  events: AgentEvent[];
  createdAt: number;
};
