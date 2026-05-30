import type { AgentBackendId } from '@openmagicpointer/core';

export type SecretKey = 'localVlmApiKey' | 'hermesApiKey' | 'opencodeApiKey' | 'claudeAgentApiKey' | 'codexApiKey';

export type StatusTone = 'ready' | 'missing' | 'working' | 'failed' | 'approval';

export type UiState =
  | 'idle'
  | 'holding'
  | 'composing'
  | 'submitting'
  | 'streaming'
  | 'approval'
  | 'completed'
  | 'failed';

export type SecretDrafts = Record<SecretKey, string>;
export type ClearSecretFlags = Record<SecretKey, boolean>;

export type SelectionRect = { x1: number; y1: number; x2: number; y2: number };
export type SelectionHandle = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'se' | 'sw';
export type SelectionDrag =
  | { kind: 'move'; startX: number; startY: number; initial: SelectionRect }
  | { kind: 'resize'; handle: SelectionHandle; startX: number; startY: number; initial: SelectionRect };

export type BackendReadiness = {
  configured: boolean;
  label: string;
  detail: string;
  tone: StatusTone;
};

export const selectableBackends: AgentBackendId[] = ['auto', 'local-vlm', 'hermes', 'opencode', 'claude-agent', 'codex'];

export const emptySecretDrafts: SecretDrafts = {
  localVlmApiKey: '',
  hermesApiKey: '',
  opencodeApiKey: '',
  claudeAgentApiKey: '',
  codexApiKey: ''
};

export const emptyClearSecretFlags: ClearSecretFlags = {
  localVlmApiKey: false,
  hermesApiKey: false,
  opencodeApiKey: false,
  claudeAgentApiKey: false,
  codexApiKey: false
};
