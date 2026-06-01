import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { clampNumber } from '@openmagicpointer/core';
import type { AppSettings } from '@openmagicpointer/storage';

type StoredSettings = AppSettings & {
  encryptedLocalVlmApiKey?: string;
  encryptedHermesApiKey?: string;
  encryptedOpenCodeApiKey?: string;
  encryptedClaudeAgentApiKey?: string;
  encryptedCodexApiKey?: string;
};

type SaveSettingsPatch = Partial<AppSettings> & {
  localVlmApiKey?: string;
  hermesApiKey?: string;
  opencodeApiKey?: string;
  claudeAgentApiKey?: string;
  codexApiKey?: string;
  clearLocalVlmApiKey?: boolean;
  clearHermesApiKey?: boolean;
  clearOpenCodeApiKey?: boolean;
  clearClaudeAgentApiKey?: boolean;
  clearCodexApiKey?: boolean;
};

const DEFAULTS: AppSettings = {
  agentBackend: 'auto',
  localVlmEnabled: true,
  localVlmBaseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
  localVlmModel: '',
  hasLocalVlmApiKey: false,
  hasHermesApiKey: false,
  hermesBaseUrl: 'http://127.0.0.1:8642/v1',
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
  cuaMode: 'prefer',
  requireApprovalBeforeCua: true,
  cuaDebugOverlayEnabled: false,
  activationHotkey: 'CommandOrControl+Shift+Space',
  longPressEnabled: true,
  voiceEnabled: true,
  pillWidth: 240,
  pillHeight: 24,
  newDialogBehavior: 'continue',
  newDialogInterval: 300,
  localVlmContextWindow: 32768,
  modalTheme: 'blue'
};

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

function settingsFileExists(): boolean {
  return existsSync(settingsPath());
}

export function getSettings(): AppSettings {
  const loaded = readStored();
  // Environment variables only seed the *initial* configuration. Once the user
  // has saved settings (settings.json exists), their saved values win so that
  // edits made in the UI actually take effect and are not clobbered by .env.
  const persisted = settingsFileExists();
  const envOverride = (keys: string[]): string | undefined => (persisted ? undefined : firstEnv(keys));
  return {
    ...DEFAULTS,
    ...loaded,
    agentBackend: normalizeBackend(envOverride(['OMP_AGENT_BACKEND', 'OP_AGENT_BACKEND']) || loaded.agentBackend || DEFAULTS.agentBackend),
    localVlmEnabled: readBoolean(envOverride(['OMP_LOCAL_VLM_ENABLED', 'OP_LOCAL_VLM_ENABLED']), loaded.localVlmEnabled ?? DEFAULTS.localVlmEnabled),
    localVlmBaseUrl:
      envOverride(['OMP_LOCAL_VLM_BASE_URL', 'OMP_OPENAI_COMPAT_BASE_URL', 'OP_LOCAL_VLM_BASE_URL', 'OP_OPENAI_COMPAT_BASE_URL']) ||
      loaded.localVlmBaseUrl ||
      DEFAULTS.localVlmBaseUrl,
    localVlmModel:
      envOverride(['OMP_LOCAL_VLM_MODEL', 'OMP_OPENAI_COMPAT_MODEL', 'OP_LOCAL_VLM_MODEL', 'OP_OPENAI_COMPAT_MODEL']) || loaded.localVlmModel || '',
    hermesBaseUrl: envOverride(['OMP_HERMES_BASE_URL', 'OP_HERMES_BASE_URL']) || loaded.hermesBaseUrl || DEFAULTS.hermesBaseUrl,
    opencodeBaseUrl: envOverride(['OMP_OPENCODE_BASE_URL', 'OP_OPENCODE_BASE_URL']) || loaded.opencodeBaseUrl || '',
    claudeAgentEnabled: readBoolean(
      envOverride(['OMP_CLAUDE_AGENT_ENABLED', 'OP_CLAUDE_AGENT_ENABLED']),
      loaded.claudeAgentEnabled ?? DEFAULTS.claudeAgentEnabled
    ),
    claudeAgentBaseUrl: envOverride(['OMP_CLAUDE_AGENT_BASE_URL', 'OP_CLAUDE_AGENT_BASE_URL']) || loaded.claudeAgentBaseUrl || DEFAULTS.claudeAgentBaseUrl,
    claudeAgentExecutable: envOverride(['OMP_CLAUDE_EXECUTABLE', 'OP_CLAUDE_EXECUTABLE']) || loaded.claudeAgentExecutable || DEFAULTS.claudeAgentExecutable,
    codexAppServerUrl: envOverride(['OMP_CODEX_APP_SERVER_URL', 'OP_CODEX_APP_SERVER_URL']) || loaded.codexAppServerUrl || '',
    codexExecutablePath:
      envOverride(['OMP_CODEX_EXECUTABLE', 'OMP_CODEX_CLI_PATH', 'OP_CODEX_EXECUTABLE', 'OP_CODEX_CLI_PATH']) ||
      loaded.codexExecutablePath ||
      detectDefaultCodexExecutable(),
    codexAppServerTransport: normalizeCodexTransport(
      envOverride(['OMP_CODEX_APP_SERVER_TRANSPORT', 'OMP_CODEX_TRANSPORT', 'OP_CODEX_APP_SERVER_TRANSPORT', 'OP_CODEX_TRANSPORT']) ||
        loaded.codexAppServerTransport ||
        DEFAULTS.codexAppServerTransport
    ),
    cuaMode: normalizeCuaMode(envOverride(['OMP_CUA_MODE', 'OP_CUA_MODE']) || loaded.cuaMode || DEFAULTS.cuaMode),
    pillWidth: clampNumber(loaded.pillWidth, 280, 900, DEFAULTS.pillWidth),
    pillHeight: clampNumber(loaded.pillHeight, 24, 96, DEFAULTS.pillHeight),
    newDialogBehavior: normalizeNewDialogBehavior(loaded.newDialogBehavior || DEFAULTS.newDialogBehavior),
    newDialogInterval: clampNumber(loaded.newDialogInterval, 10, 86400, DEFAULTS.newDialogInterval),
    localVlmContextWindow: clampNumber(loaded.localVlmContextWindow, 4096, 2000000, DEFAULTS.localVlmContextWindow),
    modalTheme: normalizeModalTheme(loaded.modalTheme || DEFAULTS.modalTheme),
    hasLocalVlmApiKey: Boolean(firstEnv(localVlmSecretEnvKeys) || loaded.encryptedLocalVlmApiKey),
    hasHermesApiKey: Boolean(firstEnv(hermesSecretEnvKeys) || loaded.encryptedHermesApiKey),
    hasOpenCodeApiKey: Boolean(firstEnv(opencodeSecretEnvKeys) || loaded.encryptedOpenCodeApiKey),
    hasClaudeAgentApiKey: Boolean(firstEnv(claudeAgentSecretEnvKeys) || loaded.encryptedClaudeAgentApiKey),
    hasCodexApiKey: Boolean(firstEnv(codexSecretEnvKeys) || loaded.encryptedCodexApiKey)
  };
}

export function getLocalVlmApiKey(): string {
  return readSecret(localVlmSecretEnvKeys, 'encryptedLocalVlmApiKey');
}

export function getHermesApiKey(): string {
  return readSecret(hermesSecretEnvKeys, 'encryptedHermesApiKey');
}

export function getOpenCodeApiKey(): string {
  return readSecret(opencodeSecretEnvKeys, 'encryptedOpenCodeApiKey');
}

export function getClaudeAgentApiKey(): string {
  return readSecret(claudeAgentSecretEnvKeys, 'encryptedClaudeAgentApiKey');
}

export function getCodexApiKey(): string {
  return readSecret(codexSecretEnvKeys, 'encryptedCodexApiKey');
}

export function saveSettings(patch: SaveSettingsPatch): AppSettings {
  const {
    localVlmApiKey,
    hermesApiKey,
    opencodeApiKey,
    claudeAgentApiKey,
    codexApiKey,
    clearLocalVlmApiKey,
    clearHermesApiKey,
    clearOpenCodeApiKey,
    clearClaudeAgentApiKey,
    clearCodexApiKey,
    ...settingsPatch
  } = patch;
  const current = readStored();
  const next: StoredSettings = {
    ...DEFAULTS,
    ...current,
    ...settingsPatch
  };

  writeSecret(next, 'encryptedLocalVlmApiKey', localVlmApiKey, Boolean(clearLocalVlmApiKey));
  writeSecret(next, 'encryptedHermesApiKey', hermesApiKey, Boolean(clearHermesApiKey));
  writeSecret(next, 'encryptedOpenCodeApiKey', opencodeApiKey, Boolean(clearOpenCodeApiKey));
  writeSecret(next, 'encryptedClaudeAgentApiKey', claudeAgentApiKey, Boolean(clearClaudeAgentApiKey));
  writeSecret(next, 'encryptedCodexApiKey', codexApiKey, Boolean(clearCodexApiKey));

  next.hasLocalVlmApiKey = Boolean(next.encryptedLocalVlmApiKey);
  next.hasHermesApiKey = Boolean(next.encryptedHermesApiKey);
  next.hasOpenCodeApiKey = Boolean(next.encryptedOpenCodeApiKey);
  next.hasClaudeAgentApiKey = Boolean(next.encryptedClaudeAgentApiKey);
  next.hasCodexApiKey = Boolean(next.encryptedCodexApiKey);

  writeStored(next);
  return getSettings();
}

function readStored(): StoredSettings {
  const path = settingsPath();
  if (!existsSync(path)) return { ...DEFAULTS };
  try {
    return migrateStored(
      JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredSettings> & {
        encryptedApiKey?: string;
        openAICompatibleBaseUrl?: string;
        openAICompatibleModel?: string;
      }
    );
  } catch {
    return { ...DEFAULTS };
  }
}

function migrateStored(
  loaded: Partial<StoredSettings> & {
    encryptedApiKey?: string;
    openAICompatibleBaseUrl?: string;
    openAICompatibleModel?: string;
  }
): StoredSettings {
  const migrated = {
    ...DEFAULTS,
    ...loaded,
    localVlmBaseUrl: loaded.localVlmBaseUrl || loaded.openAICompatibleBaseUrl || DEFAULTS.localVlmBaseUrl,
    localVlmModel: loaded.localVlmModel || loaded.openAICompatibleModel || '',
    encryptedLocalVlmApiKey: loaded.encryptedLocalVlmApiKey || loaded.encryptedApiKey
  };
  migrated.hasLocalVlmApiKey = Boolean(migrated.encryptedLocalVlmApiKey);
  migrated.hasHermesApiKey = Boolean(migrated.encryptedHermesApiKey);
  migrated.hasOpenCodeApiKey = Boolean(migrated.encryptedOpenCodeApiKey);
  migrated.hasClaudeAgentApiKey = Boolean(migrated.encryptedClaudeAgentApiKey);
  migrated.hasCodexApiKey = Boolean(migrated.encryptedCodexApiKey);
  return migrated;
}

function writeStored(settings: StoredSettings): void {
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf8');
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

const localVlmSecretEnvKeys = ['OMP_LOCAL_VLM_API_KEY', 'OMP_OPENAI_COMPAT_API_KEY', 'OP_LOCAL_VLM_API_KEY', 'OP_OPENAI_COMPAT_API_KEY'];
const hermesSecretEnvKeys = ['OMP_HERMES_API_KEY', 'OP_HERMES_API_KEY'];
const opencodeSecretEnvKeys = ['OMP_OPENCODE_API_KEY', 'OP_OPENCODE_API_KEY'];
const claudeAgentSecretEnvKeys = ['OMP_CLAUDE_AGENT_API_KEY', 'OP_CLAUDE_AGENT_API_KEY', 'ANTHROPIC_API_KEY'];
const codexSecretEnvKeys = ['OMP_CODEX_API_KEY', 'OP_CODEX_API_KEY'];

function firstEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

function readSecret(
  envKeys: string[],
  storedField: keyof Pick<
    StoredSettings,
    'encryptedLocalVlmApiKey' | 'encryptedHermesApiKey' | 'encryptedOpenCodeApiKey' | 'encryptedClaudeAgentApiKey' | 'encryptedCodexApiKey'
  >
): string {
  const envValue = firstEnv(envKeys);
  if (envValue) return envValue;
  const encrypted = readStored()[storedField];
  if (!encrypted) return '';
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch {
    return '';
  }
}

function writeSecret(
  settings: StoredSettings,
  storedField: keyof Pick<
    StoredSettings,
    'encryptedLocalVlmApiKey' | 'encryptedHermesApiKey' | 'encryptedOpenCodeApiKey' | 'encryptedClaudeAgentApiKey' | 'encryptedCodexApiKey'
  >,
  value: string | undefined,
  clear: boolean
): void {
  if (clear) {
    delete settings[storedField];
    return;
  }
  const trimmed = value?.trim();
  if (!trimmed) return;
  settings[storedField] = safeStorage.encryptString(trimmed).toString('base64');
}

function normalizeBackend(value: string): AppSettings['agentBackend'] {
  return ['auto', 'local-vlm', 'hermes', 'opencode', 'claude-agent', 'codex'].includes(value) ? (value as AppSettings['agentBackend']) : 'auto';
}

function normalizeCodexTransport(value: string): AppSettings['codexAppServerTransport'] {
  return ['http-adapter', 'websocket', 'stdio'].includes(value) ? (value as AppSettings['codexAppServerTransport']) : 'http-adapter';
}

function normalizeCuaMode(value: string): AppSettings['cuaMode'] {
  return ['off', 'prefer', 'require-on-explicit-command'].includes(value) ? (value as AppSettings['cuaMode']) : 'prefer';
}

function normalizeNewDialogBehavior(value: string): AppSettings['newDialogBehavior'] {
  return ['new', 'continue', 'interval'].includes(value) ? (value as AppSettings['newDialogBehavior']) : 'continue';
}

function normalizeModalTheme(value: string): AppSettings['modalTheme'] {
  return ['blue', 'white', 'black'].includes(value) ? (value as AppSettings['modalTheme']) : 'blue';
}

function detectDefaultCodexExecutable(): string {
  const candidates = codexExecutableCandidates();
  return candidates.find((candidate) => existsSync(candidate)) || '';
}

function codexExecutableCandidates(): string[] {
  const home = app.getPath('home');
  const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const pathCandidates = (process.env.PATH || '')
    .split(process.platform === 'win32' ? ';' : ':')
    .filter(Boolean)
    .flatMap((entry) => (process.platform === 'win32' ? [join(entry, 'codex.cmd'), join(entry, 'codex.exe')] : [join(entry, 'codex')]));

  if (process.platform === 'win32') {
    return uniqueStrings([
      join(appData, 'npm', 'codex.cmd'),
      join(appData, 'npm', 'codex.exe'),
      join(programFiles, 'nodejs', 'node_global', 'codex.cmd'),
      join(programFiles, 'nodejs', 'node_global', 'codex.exe'),
      join(programFilesX86, 'nodejs', 'node_global', 'codex.cmd'),
      join(programFilesX86, 'nodejs', 'node_global', 'codex.exe'),
      join(localAppData, 'Programs', 'Codex', 'codex.exe'),
      join(localAppData, 'OpenAI', 'Codex', 'codex.exe'),
      ...windowsAppPackageCodexCandidates(programFiles),
      ...pathCandidates
    ]);
  }

  if (process.platform === 'darwin') {
    return uniqueStrings([
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex',
      join(home, '.local', 'bin', 'codex'),
      '/Applications/Codex.app/Contents/MacOS/codex',
      ...pathCandidates
    ]);
  }

  return uniqueStrings(['/usr/local/bin/codex', '/usr/bin/codex', join(home, '.local', 'bin', 'codex'), ...pathCandidates]);
}

function windowsAppPackageCodexCandidates(programFiles: string): string[] {
  const windowsApps = join(programFiles, 'WindowsApps');
  try {
    return readdirSync(windowsApps)
      .filter((name: string) => /^OpenAI\.Codex_/i.test(name))
      .map((name: string) => join(windowsApps, name, 'app', 'resources', 'codex.exe'));
  } catch {
    return [];
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
