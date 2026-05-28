import type { AgentBackendId, AgentContextEnvelope } from '@openmagicpointer/core';
import { ClaudeAgentBridge } from './claude-agent.js';
import { CodexBridge, HermesBridge, OpenCodeBridge } from './http-bridges.js';
import { LocalVlmBridge } from './local-vlm.js';
import { MockAgentBridge } from './mock.js';
import type { AgentBridge, AgentBridgeRegistryConfig } from './types.js';

export function createAgentBridge(backend: AgentBackendId, config: AgentBridgeRegistryConfig = {}): AgentBridge {
  switch (backend) {
    case 'local-vlm':
      return new LocalVlmBridge(config.localVlm);
    case 'hermes':
      return new HermesBridge(config.hermes);
    case 'opencode':
      return new OpenCodeBridge(config.opencode);
    case 'claude-agent':
      return new ClaudeAgentBridge(config.claudeAgent);
    case 'codex':
      return new CodexBridge(config.codex);
    case 'mock':
      return new MockAgentBridge();
    case 'auto':
      return createAgentBridge(resolveAutoBackend(config), config);
  }
}

export function resolveBackendForEnvelope(envelope: AgentContextEnvelope, config: AgentBridgeRegistryConfig = {}): AgentBackendId {
  if (envelope.routing.backend !== 'auto') return envelope.routing.backend;
  if (looksLikeCodingWorkflow(envelope)) return config.codex?.baseUrl ? 'codex' : config.opencode?.baseUrl ? 'opencode' : 'local-vlm';
  if (envelope.cuaDirective?.enabled) {
    if (config.hermes?.baseUrl) return 'hermes';
    if (config.opencode?.baseUrl) return 'opencode';
    if (config.claudeAgent?.enabled) return 'claude-agent';
  }
  return config.localVlm?.baseUrl ? 'local-vlm' : resolveAutoBackend(config);
}

function resolveAutoBackend(config: AgentBridgeRegistryConfig): AgentBackendId {
  if (config.hermes?.baseUrl) return 'hermes';
  if (config.localVlm?.baseUrl) return 'local-vlm';
  if (config.opencode?.baseUrl) return 'opencode';
  if (config.claudeAgent?.enabled) return 'claude-agent';
  if (config.codex?.baseUrl) return 'codex';
  return 'local-vlm';
}

function looksLikeCodingWorkflow(envelope: AgentContextEnvelope): boolean {
  const text = envelope.instruction.text.toLowerCase();
  const title = envelope.pointerContext.window?.title?.toLowerCase() ?? '';
  return /\b(code|repo|diff|error|test|build|terminal|stack trace|pull request|issue)\b/.test(text + ' ' + title);
}
