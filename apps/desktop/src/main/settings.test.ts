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

const ENV_KEYS = ['OP_AGENT_BACKEND', 'OP_LOCAL_VLM_BASE_URL', 'OP_LOCAL_VLM_MODEL', 'OP_CUA_MODE', 'OP_CODEX_MODEL', 'OP_CODEX_EFFORT'];

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
    process.env.OP_LOCAL_VLM_BASE_URL = 'http://env-host/v1';
    process.env.OP_CUA_MODE = 'off';
    process.env.OP_CODEX_MODEL = 'gpt-5.4';
    process.env.OP_CODEX_EFFORT = 'low';
    const result = settings.getSettings();
    expect(result.localVlmBaseUrl).toBe('http://env-host/v1');
    expect(result.cuaMode).toBe('off');
    expect(result.codexModel).toBe('gpt-5.4');
    expect(result.codexEffort).toBe('low');
  });

  it('defaults the background process dock to the bottom-left corner', () => {
    expect(settings.getSettings().backgroundProcessCorner).toBe('bottom-left');
  });

  it('prefers persisted values over env vars once settings are saved', () => {
    settings.saveSettings({ localVlmBaseUrl: 'http://saved-host/v1', cuaMode: 'require-on-explicit-command' });
    // Env now disagrees with what the user saved; saved values must win.
    process.env.OP_LOCAL_VLM_BASE_URL = 'http://env-host/v1';
    process.env.OP_CUA_MODE = 'off';
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

  it('round-trips the background process corner', () => {
    settings.saveSettings({ backgroundProcessCorner: 'top-right' });
    expect(settings.getSettings().backgroundProcessCorner).toBe('top-right');
  });

  it('falls back to bottom-left for an invalid background process corner', () => {
    fileContent = JSON.stringify({ backgroundProcessCorner: 'center' });
    expect(settings.getSettings().backgroundProcessCorner).toBe('bottom-left');
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
