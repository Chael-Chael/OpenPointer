import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AppSettings } from '@openmagicpointer/storage';

type StoredSettings = AppSettings & {
  encryptedApiKey?: string;
};

const DEFAULTS: AppSettings = {
  openAICompatibleBaseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
  openAICompatibleModel: '',
  hasApiKey: false,
  cuaEndpoint: 'http://127.0.0.1:8000',
  activationHotkey: 'CommandOrControl+Shift+Space',
  wiggleEnabled: true,
  wiggleSensitivity: 'medium',
  trailEnabled: true,
  voiceEnabled: true
};

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

export function getSettings(): AppSettings {
  const loaded = readStored();
  const envKey = process.env.OMP_OPENAI_COMPAT_API_KEY;
  return {
    ...DEFAULTS,
    ...loaded,
    openAICompatibleBaseUrl: process.env.OMP_OPENAI_COMPAT_BASE_URL || loaded.openAICompatibleBaseUrl || DEFAULTS.openAICompatibleBaseUrl,
    openAICompatibleModel: process.env.OMP_OPENAI_COMPAT_MODEL || loaded.openAICompatibleModel || '',
    cuaEndpoint: process.env.OMP_CUA_ENDPOINT || loaded.cuaEndpoint || DEFAULTS.cuaEndpoint,
    hasApiKey: Boolean(envKey || loaded.encryptedApiKey)
  };
}

export function getApiKey(): string {
  if (process.env.OMP_OPENAI_COMPAT_API_KEY) return process.env.OMP_OPENAI_COMPAT_API_KEY;
  const loaded = readStored();
  if (!loaded.encryptedApiKey) return '';
  try {
    return safeStorage.decryptString(Buffer.from(loaded.encryptedApiKey, 'base64'));
  } catch {
    return '';
  }
}

export function saveSettings(patch: Partial<AppSettings> & { apiKey?: string }): AppSettings {
  const current = readStored();
  const next: StoredSettings = {
    ...DEFAULTS,
    ...current,
    ...patch,
    hasApiKey: current.hasApiKey
  };
  if (patch.apiKey && patch.apiKey.trim()) {
    const encrypted = safeStorage.encryptString(patch.apiKey.trim());
    next.encryptedApiKey = encrypted.toString('base64');
    next.hasApiKey = true;
  }
  delete (next as { apiKey?: string }).apiKey;
  writeStored(next);
  return getSettings();
}

function readStored(): StoredSettings {
  const path = settingsPath();
  if (!existsSync(path)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...(JSON.parse(readFileSync(path, 'utf8')) as StoredSettings) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeStored(settings: StoredSettings): void {
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf8');
}
