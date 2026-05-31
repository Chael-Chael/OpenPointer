import { describe, expect, it } from 'vitest';
import type { AppSettings } from '@openmagicpointer/storage';
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
    hasClaudeAgentApiKey: false,
    hasCodexApiKey: false,
    codexAppServerUrl: '',
    cuaMode: 'off',
    requireApprovalBeforeCua: false,
    activationHotkey: '',
    longPressEnabled: false,
    voiceEnabled: false,
    pillWidth: 520,
    pillHeight: 30,
    newDialogBehavior: 'continue',
    newDialogInterval: 300,
    localVlmContextWindow: 32768,
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
