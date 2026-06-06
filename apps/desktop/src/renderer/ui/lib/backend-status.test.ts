import { describe, expect, it } from 'vitest';
import type { AppSettings } from '@openpointer/storage';
import { backendReadiness, secretConfigured, runtimeStatusFor } from './backend-status';

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    agentBackend: 'auto',
    localVlmEnabled: false,
    localVlmBaseUrl: '',
    localVlmModel: '',
    hasLocalVlmApiKey: false,
    hasHermesApiKey: false,
    hermesBaseUrl: '',
    hasOpenCodeApiKey: false,
    opencodeBaseUrl: '',
    claudeAgentEnabled: false,
    claudeAgentBaseUrl: '',
    claudeAgentExecutable: '',
    claudeAgentModel: '',
    claudeAgentEffort: 'high',
    hasClaudeAgentApiKey: false,
    hasCodexApiKey: false,
    codexAppServerUrl: '',
    codexExecutablePath: '',
    codexAppServerTransport: 'http-adapter',
    codexModel: 'gpt-5.4',
    codexEffort: 'low',
    cuaMode: 'off',
    requireApprovalBeforeCua: false,
    cuaDebugOverlayEnabled: false,
    cuaDriverHttpPort: 19771,
    cuaAgentCursorEnabled: true,
    cuaRecordingMode: 'manual',
    cuaBrowserPageToolsEnabled: true,
    cuaPageJavascriptPolicy: 'ask',
    activationHotkey: '',
    longPressEnabled: false,
    mouseShakeActivationEnabled: true,
    mouseShakeSensitivity: 'low',
    voiceEnabled: false,
    pillWidth: 520,
    pillHeight: 24,
    newDialogBehavior: 'continue',
    newDialogInterval: 300,
    localVlmContextWindow: 32768,
    modalTheme: 'blue',
    backgroundProcessCorner: 'bottom-left',
    ...overrides
  };
}

describe('backendReadiness', () => {
  it('reports missing config when settings are null', () => {
    expect(backendReadiness(null, 'local-vlm').configured).toBe(false);
  });

  it('requires base url and api key for local-vlm', () => {
    expect(backendReadiness(makeSettings({ localVlmEnabled: true }), 'local-vlm').configured).toBe(false);
    const ready = makeSettings({ localVlmEnabled: true, localVlmBaseUrl: 'http://x/v1', hasLocalVlmApiKey: true });
    expect(backendReadiness(ready, 'local-vlm').configured).toBe(true);
  });

  it('treats hermes token as optional', () => {
    const ready = makeSettings({ hermesBaseUrl: 'http://x/v1' });
    expect(backendReadiness(ready, 'hermes').configured).toBe(true);
  });

  it('auto is ready when any backend is configured', () => {
    const ready = makeSettings({ hermesBaseUrl: 'http://x/v1' });
    expect(backendReadiness(ready, 'auto').configured).toBe(true);
    expect(backendReadiness(makeSettings(), 'auto').configured).toBe(false);
  });

  it('claude-agent is ready when enabled, api key optional', () => {
    expect(backendReadiness(makeSettings(), 'claude-agent').configured).toBe(false);
    expect(backendReadiness(makeSettings({ claudeAgentEnabled: true }), 'claude-agent').configured).toBe(true);
    expect(backendReadiness(makeSettings({ claudeAgentEnabled: true, hasClaudeAgentApiKey: true }), 'claude-agent').configured).toBe(true);
  });

  it('codex supports URL and stdio executable readiness', () => {
    expect(backendReadiness(makeSettings(), 'codex').configured).toBe(false);
    expect(backendReadiness(makeSettings({ codexAppServerUrl: 'http://127.0.0.1:5050/v1' }), 'codex').configured).toBe(true);
    expect(backendReadiness(makeSettings({ codexAppServerTransport: 'stdio' }), 'codex').configured).toBe(false);
    expect(backendReadiness(makeSettings({ codexAppServerTransport: 'stdio', codexExecutablePath: 'C:\\codex\\codex.exe' }), 'codex').configured).toBe(true);
  });
});

describe('secretConfigured', () => {
  it('is false when clear is queued', () => {
    expect(secretConfigured(true, 'draft', true)).toBe(false);
  });

  it('is true when stored or when a draft exists', () => {
    expect(secretConfigured(true, '', false)).toBe(true);
    expect(secretConfigured(false, 'draft', false)).toBe(true);
    expect(secretConfigured(false, '   ', false)).toBe(false);
  });
});

describe('runtimeStatusFor', () => {
  const ready = { configured: true, label: 'Ready', detail: '', tone: 'ready' as const };

  it('reports missing config first', () => {
    const missing = { configured: false, label: 'Missing config', detail: '', tone: 'missing' as const };
    expect(runtimeStatusFor('idle', missing).tone).toBe('missing');
  });

  it('maps streaming and approval states', () => {
    expect(runtimeStatusFor('streaming', ready).tone).toBe('working');
    expect(runtimeStatusFor('approval', ready).tone).toBe('approval');
    expect(runtimeStatusFor('failed', ready).tone).toBe('failed');
  });
});
