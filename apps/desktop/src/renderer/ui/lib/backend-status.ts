import type { AgentBackendId, AgentEvent } from '@openmagicpointer/core';
import type { AppSettings } from '@openmagicpointer/storage';
import type { BackendReadiness, StatusTone, UiState } from '../state';
import { selectableBackends } from '../state';

export function backendReadiness(settings: AppSettings | null, backend: AgentBackendId): BackendReadiness {
  if (!settings) return { configured: false, label: 'Missing config', detail: 'Settings are loading.', tone: 'missing' };
  if (backend === 'auto') {
    const configured = selectableBackends.filter((item) => item !== 'auto').some((item) => backendReadiness(settings, item).configured);
    return configured
      ? { configured: true, label: 'Ready', detail: 'Auto will choose from configured backends.', tone: 'ready' }
      : { configured: false, label: 'Missing config', detail: 'Configure at least one backend.', tone: 'missing' };
  }
  if (backend === 'local-vlm') {
    if (!settings.localVlmEnabled) return { configured: false, label: 'Missing config', detail: 'Local VLM is disabled.', tone: 'missing' };
    if (!settings.localVlmBaseUrl.trim()) return { configured: false, label: 'Missing config', detail: 'Add a Local VLM base URL.', tone: 'missing' };
    if (!settings.hasLocalVlmApiKey) return { configured: false, label: 'Missing config', detail: 'Add a Local VLM API key.', tone: 'missing' };
    return { configured: true, label: 'Ready', detail: 'Base URL and API key are configured.', tone: 'ready' };
  }
  if (backend === 'hermes') {
    if (!settings.hermesBaseUrl.trim()) return { configured: false, label: 'Missing config', detail: 'Add a Hermes base URL.', tone: 'missing' };
    return { configured: true, label: 'Ready', detail: settings.hasHermesApiKey ? 'Base URL and token are configured.' : 'Base URL configured; token optional.', tone: 'ready' };
  }
  if (backend === 'opencode') {
    if (!settings.opencodeBaseUrl.trim()) return { configured: false, label: 'Missing config', detail: 'Add an OpenCode base URL.', tone: 'missing' };
    return { configured: true, label: 'Ready', detail: settings.hasOpenCodeApiKey ? 'Base URL and token are configured.' : 'Base URL configured; token optional.', tone: 'ready' };
  }
  if (backend === 'claude-agent') {
    if (!settings.claudeAgentEnabled) return { configured: false, label: 'Missing config', detail: 'Claude Agent is disabled.', tone: 'missing' };
    if (!settings.hasClaudeAgentApiKey) return { configured: false, label: 'Missing config', detail: 'Add a Claude Agent API key.', tone: 'missing' };
    return { configured: true, label: 'Ready', detail: 'Claude Agent is enabled with a configured key.', tone: 'ready' };
  }
  if (backend === 'codex') {
    if (!settings.codexAppServerUrl.trim()) return { configured: false, label: 'Missing config', detail: 'Add a Codex app-server URL.', tone: 'missing' };
    return { configured: true, label: 'Ready', detail: settings.hasCodexApiKey ? 'Server URL and token are configured.' : 'Server URL configured; token optional.', tone: 'ready' };
  }
  return { configured: true, label: 'Ready', detail: 'Backend is available.', tone: 'ready' };
}

export function runtimeStatusFor(state: UiState, readiness: BackendReadiness): { label: string; tone: StatusTone } {
  if (!readiness.configured) return { label: 'Missing config', tone: 'missing' };
  if (state === 'submitting') return { label: 'Connecting', tone: 'working' };
  if (state === 'streaming') return { label: 'Streaming', tone: 'working' };
  if (state === 'approval') return { label: 'Approval needed', tone: 'approval' };
  if (state === 'failed') return { label: 'Failed', tone: 'failed' };
  return { label: 'Ready', tone: 'ready' };
}

export function secretConfigured(stored: boolean, draft: string, clearQueued: boolean): boolean {
  if (clearQueued) return false;
  return stored || Boolean(draft.trim());
}

export function placeholderForState(state: UiState, readiness: BackendReadiness): string {
  if (!readiness.configured) return readiness.detail;
  if (state === 'submitting') return 'Connecting...';
  if (state === 'streaming') return 'Ask a follow-up...';
  if (state === 'failed') return 'Try again...';
  return 'Ask something...';
}

export function backendLabel(backend: AgentBackendId): string {
  switch (backend) {
    case 'local-vlm':
      return 'Local VLM';
    case 'hermes':
      return 'Hermes';
    case 'opencode':
      return 'OpenCode';
    case 'claude-agent':
      return 'Claude Agent';
    case 'codex':
      return 'Codex';
    case 'mock':
      return 'Mock';
    case 'auto':
      return 'Auto';
    default:
      return backend;
  }
}

export function statusLabel(state: UiState): string {
  switch (state) {
    case 'submitting':
      return 'Connecting';
    case 'streaming':
      return 'Streaming';
    case 'approval':
      return 'Approval';
    case 'completed':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'holding':
      return 'Holding';
    case 'composing':
      return 'Ready';
    case 'idle':
      return 'Idle';
    default:
      return 'Idle';
  }
}

export function latestEvent<T extends AgentEvent['type']>(events: AgentEvent[], type: T): Extract<AgentEvent, { type: T }> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === type) return event as Extract<AgentEvent, { type: T }>;
  }
  return undefined;
}

export function isToolEvent(event: AgentEvent): event is Extract<AgentEvent, { type: 'tool.started' | 'tool.completed' }> {
  return event.type === 'tool.started' || event.type === 'tool.completed';
}
