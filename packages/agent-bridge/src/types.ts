import type { AgentBackendId, AgentContextEnvelope, AgentEvent } from '@openpointer/core';

export type AgentRunOptions = {
  signal?: AbortSignal;
  sessionKey?: string;
  backendSessionId?: string;
};

export type ApprovalDecision = 'approve' | 'deny' | 'always_allow';

export interface AgentBridge {
  id: AgentBackendId;
  run(envelope: AgentContextEnvelope, options?: AgentRunOptions): AsyncIterable<AgentEvent>;
  stop?(runId: string): Promise<void>;
  approve?(approvalId: string, decision: ApprovalDecision): Promise<void>;
}

export type FetchLike = typeof fetch;

export type LocalVlmBridgeConfig = {
  baseUrl: string;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  contextWindow?: number;
};

export type HttpAgentBridgeConfig = {
  baseUrl: string;
  apiKey?: string;
  transport?: 'http-adapter' | 'websocket' | 'stdio';
  executablePath?: string;
  cwd?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  timeoutMs?: number;
  fetch?: FetchLike;
};

export type ClaudeAgentBridgeConfig = {
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  executable?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  approvalMode?: 'request' | 'allow-all';
  permissionStorePath?: string;
  sdk?: {
    query(args: unknown): AsyncIterable<unknown>;
  };
};

export type AgentBridgeRegistryConfig = {
  localVlm?: LocalVlmBridgeConfig;
  hermes?: HttpAgentBridgeConfig;
  opencode?: HttpAgentBridgeConfig;
  openclaw?: HttpAgentBridgeConfig & { agent?: string; executableArgs?: string[] };
  claudeAgent?: ClaudeAgentBridgeConfig;
  codex?: HttpAgentBridgeConfig;
};
