import type { AgentBackendId, AgentContextEnvelope } from '@openpointer/core';
import { ClaudeAgentBridge } from './claude-agent.js';
import { CodexBridge, HermesBridge, OpenClawBridge, OpenCodeBridge } from './http-bridges.js';
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
    case 'openclaw':
      return new OpenClawBridge(config.openclaw);
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
  if (looksLikeCodingWorkflow(envelope)) return resolveCodingBackend(config);
  if (requiresAgentRuntime(envelope)) return resolveAgentRuntimeBackend(config);
  return config.localVlm?.baseUrl ? 'local-vlm' : resolveAgentRuntimeBackend(config);
}

function resolveAutoBackend(config: AgentBridgeRegistryConfig): AgentBackendId {
  if (config.hermes?.baseUrl) return 'hermes';
  if (config.localVlm?.baseUrl) return 'local-vlm';
  if (config.opencode?.baseUrl) return 'opencode';
  if (config.openclaw?.baseUrl) return 'openclaw';
  if (config.claudeAgent?.enabled) return 'claude-agent';
  if (config.codex?.baseUrl) return 'codex';
  return 'local-vlm';
}

function resolveAgentRuntimeBackend(config: AgentBridgeRegistryConfig): AgentBackendId {
  if (config.hermes?.baseUrl) return 'hermes';
  if (config.claudeAgent?.enabled) return 'claude-agent';
  if (config.codex?.baseUrl) return 'codex';
  if (config.opencode?.baseUrl) return 'opencode';
  if (config.openclaw?.baseUrl) return 'openclaw';
  return config.localVlm?.baseUrl ? 'local-vlm' : resolveAutoBackend(config);
}

function resolveCodingBackend(config: AgentBridgeRegistryConfig): AgentBackendId {
  if (config.codex?.baseUrl) return 'codex';
  if (config.opencode?.baseUrl) return 'opencode';
  if (config.openclaw?.baseUrl) return 'openclaw';
  if (config.claudeAgent?.enabled) return 'claude-agent';
  return config.localVlm?.baseUrl ? 'local-vlm' : resolveAutoBackend(config);
}

function looksLikeCodingWorkflow(envelope: AgentContextEnvelope): boolean {
  const text = envelope.instruction.text.toLowerCase();
  const title = envelope.pointerContext.window?.title?.toLowerCase() ?? '';
  return envelope.resolvedIntent?.domain === 'code' || /\b(code|repo|diff|error|test|build|terminal|stack trace|pull request|issue)\b/.test(text + ' ' + title);
}

function requiresAgentRuntime(envelope: AgentContextEnvelope): boolean {
  const intent = envelope.resolvedIntent;
  return Boolean(
    envelope.cuaDirective?.enabled ||
      envelope.toolServers?.length ||
      intent?.needs.desktopControl ||
      intent?.needs.structuredUi ||
      intent?.needs.toolUse ||
      intent?.domain === 'browser' ||
      intent?.domain === 'document'
  );
}
