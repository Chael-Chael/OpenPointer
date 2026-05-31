import type { AgentContextEnvelope, AgentEvent, PointerContext } from '@openmagicpointer/core';

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
  hasClaudeAgentApiKey: boolean;
  hasCodexApiKey: boolean;
  codexAppServerUrl: string;
  cuaMode: 'off' | 'prefer' | 'require-on-explicit-command';
  requireApprovalBeforeCua: boolean;
  activationHotkey: string;
  longPressEnabled: boolean;
  voiceEnabled: boolean;
  pillWidth: number;
  pillHeight: number;
  newDialogBehavior: 'new' | 'continue' | 'interval';
  newDialogInterval: number;
  localVlmContextWindow: number;
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
