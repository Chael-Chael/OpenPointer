import type { AgentContextEnvelope, AgentEvent, PointerContext } from '@openpointer/core';

export type AppSettings = {
  agentBackend: 'auto' | 'local-vlm' | 'hermes' | 'opencode' | 'claude-agent' | 'codex';
  localVlmEnabled: boolean;
  localVlmBaseUrl: string;
  localVlmModel: string;
  hasLocalVlmApiKey: boolean;
  hasHermesApiKey: boolean;
  hermesBaseUrl: string;
  hasOpenCodeApiKey: boolean;
  opencodeBaseUrl: string;
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
  cuaMode: 'off' | 'prefer' | 'require-on-explicit-command';
  requireApprovalBeforeCua: boolean;
  cuaDebugOverlayEnabled: boolean;
  activationHotkey: string;
  longPressEnabled: boolean;
  voiceEnabled: boolean;
  pillWidth: number;
  pillHeight: number;
  newDialogBehavior: 'new' | 'continue' | 'interval';
  newDialogInterval: number;
  localVlmContextWindow: number;
  modalTheme: 'blue' | 'white' | 'black';
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
