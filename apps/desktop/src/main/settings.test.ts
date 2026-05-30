import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the settings.json file on disk.
let fileContent: string | null = null;

vi.mock('electron', () => ({
  app: { getPath: () => '/virtual/userData' },
  safeStorage: {
    encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (buf: Buffer) => buf.toString().replace(/^enc:/, ''),
    isEncryptionAvailable: () => true
  }
}));

vi.mock('node:fs', () => ({
  existsSync: () => fileContent !== null,
  readFileSync: () => {
    if (fileContent === null) throw new Error('ENOENT');
    return fileContent;
  },
  writeFileSync: (_path: string, data: string) => {
    fileContent = data;
  },
  mkdirSync: () => undefined
}));

const ENV_KEYS = [
  'OMP_AGENT_BACKEND',
  'OMP_LOCAL_VLM_BASE_URL',
  'OMP_LOCAL_VLM_MODEL',
  'OMP_CUA_MODE'
];

let settings: typeof import('./settings.js');

beforeEach(async () => {
  fileContent = null;
  for (const key of ENV_KEYS) delete process.env[key];
  vi.resetModules();
  settings = await import('./settings.js');
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('getSettings env vs persisted precedence', () => {
  it('uses env vars to seed config when no settings file exists', () => {
    process.env.OMP_LOCAL_VLM_BASE_URL = 'http://env-host/v1';
    process.env.OMP_CUA_MODE = 'off';
    const result = settings.getSettings();
    expect(result.localVlmBaseUrl).toBe('http://env-host/v1');
    expect(result.cuaMode).toBe('off');
  });

  it('prefers persisted values over env vars once settings are saved', () => {
    settings.saveSettings({ localVlmBaseUrl: 'http://saved-host/v1', cuaMode: 'require-on-explicit-command' });
    // Env now disagrees with what the user saved; saved values must win.
    process.env.OMP_LOCAL_VLM_BASE_URL = 'http://env-host/v1';
    process.env.OMP_CUA_MODE = 'off';
    const result = settings.getSettings();
    expect(result.localVlmBaseUrl).toBe('http://saved-host/v1');
    expect(result.cuaMode).toBe('require-on-explicit-command');
  });
});

describe('saveSettings', () => {
  it('round-trips a saved value through getSettings', () => {
    settings.saveSettings({ localVlmModel: 'mimo-2.5' });
    expect(settings.getSettings().localVlmModel).toBe('mimo-2.5');
  });

  it('encrypts and decrypts secrets, and clears them on request', () => {
    settings.saveSettings({ localVlmApiKey: 'secret-token' });
    expect(settings.getLocalVlmApiKey()).toBe('secret-token');
    expect(settings.getSettings().hasLocalVlmApiKey).toBe(true);

    settings.saveSettings({ clearLocalVlmApiKey: true });
    expect(settings.getLocalVlmApiKey()).toBe('');
    expect(settings.getSettings().hasLocalVlmApiKey).toBe(false);
  });
});
