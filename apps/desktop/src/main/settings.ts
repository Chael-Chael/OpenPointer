import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { clampNumber } from '@openpointer/core';
import type { AppSettings } from '@openpointer/storage';

export const DEFAULT_CODEX_ADAPTER_URL = 'http://127.0.0.1:5050/v1';

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
  agentBackend: 'codex',
  localVlmEnabled: true,
  localVlmBaseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
  localVlmModel: '',
  hasLocalVlmApiKey: false,
  hasHermesApiKey: false,
  hermesBaseUrl: 'http://127.0.0.1:8642/v1',
  hasOpenCodeApiKey: false,
  opencodeBaseUrl: '',
  openclawGatewayUrl: 'ws://127.0.0.1:18789',
  openclawExecutablePath: '',
  openclawAgent: 'main',
  openclawModel: '',
  claudeAgentEnabled: false,
  claudeAgentBaseUrl: '',
  claudeAgentExecutable: '',
  claudeAgentModel: '',
  claudeAgentEffort: 'high',
  hasClaudeAgentApiKey: false,
  hasCodexApiKey: false,
  codexAppServerUrl: DEFAULT_CODEX_ADAPTER_URL,
  codexExecutablePath: '',
  codexAppServerTransport: 'http-adapter',
  codexModel: 'gpt-5.4',
  codexEffort: 'low',
  cuaMode: 'prefer',
  requireApprovalBeforeCua: true,
  cuaDebugOverlayEnabled: false,
  cuaDriverHttpPort: 19771,
  cuaAgentCursorEnabled: true,
  cuaRecordingMode: 'manual',
  cuaBrowserPageToolsEnabled: true,
  cuaPageJavascriptPolicy: 'ask',
  activationHotkey: 'CommandOrControl+Shift+Space',
  longPressEnabled: true,
  mouseShakeActivationEnabled: true,
  mouseShakeSensitivity: 'low',
  voiceEnabled: true,
  pillWidth: 240,
  pillHeight: 24,
  newDialogBehavior: 'continue',
  newDialogInterval: 300,
  localVlmContextWindow: 32768,
  modalTheme: 'blue',
  backgroundProcessCorner: 'bottom-left'
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
  const envSeedIfEmpty = (keys: string[], loadedValue: string | undefined): string | undefined =>
    !persisted || !loadedValue?.trim() ? firstEnv(keys) : undefined;
  return {
    ...DEFAULTS,
    ...loaded,
    agentBackend: normalizeBackend(envOverride(['OP_AGENT_BACKEND']) || loaded.agentBackend || DEFAULTS.agentBackend),
    localVlmEnabled: readBoolean(envOverride(['OP_LOCAL_VLM_ENABLED']), loaded.localVlmEnabled ?? DEFAULTS.localVlmEnabled),
    localVlmBaseUrl: envOverride(['OP_LOCAL_VLM_BASE_URL', 'OP_OPENAI_COMPAT_BASE_URL']) || loaded.localVlmBaseUrl || DEFAULTS.localVlmBaseUrl,
    localVlmModel: envOverride(['OP_LOCAL_VLM_MODEL', 'OP_OPENAI_COMPAT_MODEL']) || loaded.localVlmModel || '',
    hermesBaseUrl: envSeedIfEmpty(['OP_HERMES_BASE_URL'], loaded.hermesBaseUrl) || loaded.hermesBaseUrl || DEFAULTS.hermesBaseUrl,
    opencodeBaseUrl: envSeedIfEmpty(['OP_OPENCODE_BASE_URL'], loaded.opencodeBaseUrl) || loaded.opencodeBaseUrl || '',
    openclawGatewayUrl: envSeedIfEmpty(['OP_OPENCLAW_GATEWAY_URL'], loaded.openclawGatewayUrl) || loaded.openclawGatewayUrl || DEFAULTS.openclawGatewayUrl,
    openclawExecutablePath:
      envSeedIfEmpty(['OP_OPENCLAW_EXECUTABLE', 'OP_OPENCLAW_CLI_PATH'], loaded.openclawExecutablePath) || loaded.openclawExecutablePath || DEFAULTS.openclawExecutablePath,
    openclawAgent: envSeedIfEmpty(['OP_OPENCLAW_AGENT'], loaded.openclawAgent) || loaded.openclawAgent || DEFAULTS.openclawAgent,
    openclawModel: envSeedIfEmpty(['OP_OPENCLAW_MODEL'], loaded.openclawModel) || loaded.openclawModel || DEFAULTS.openclawModel,
    claudeAgentEnabled: readBoolean(envOverride(['OP_CLAUDE_AGENT_ENABLED']), loaded.claudeAgentEnabled ?? DEFAULTS.claudeAgentEnabled),
    claudeAgentBaseUrl: envOverride(['OP_CLAUDE_AGENT_BASE_URL']) || loaded.claudeAgentBaseUrl || DEFAULTS.claudeAgentBaseUrl,
    claudeAgentExecutable: envOverride(['OP_CLAUDE_EXECUTABLE']) || loaded.claudeAgentExecutable || DEFAULTS.claudeAgentExecutable,
    codexAppServerUrl: envOverride(['OP_CODEX_APP_SERVER_URL']) || loaded.codexAppServerUrl || DEFAULTS.codexAppServerUrl,
    codexExecutablePath: envOverride(['OP_CODEX_EXECUTABLE', 'OP_CODEX_CLI_PATH']) || loaded.codexExecutablePath || detectDefaultCodexExecutable(),
    codexAppServerTransport: normalizeCodexTransport(
      envOverride(['OP_CODEX_APP_SERVER_TRANSPORT', 'OP_CODEX_TRANSPORT']) || loaded.codexAppServerTransport || DEFAULTS.codexAppServerTransport
    ),
    codexModel: envOverride(['OP_CODEX_MODEL']) || loaded.codexModel || DEFAULTS.codexModel,
    codexEffort: normalizeEffort(envOverride(['OP_CODEX_EFFORT']) || loaded.codexEffort || DEFAULTS.codexEffort),
    cuaMode: normalizeCuaMode(envOverride(['OP_CUA_MODE']) || loaded.cuaMode || DEFAULTS.cuaMode),
    cuaDriverHttpPort: clampNumber(Number(envOverride(['OP_CUA_HTTP_PORT']) || loaded.cuaDriverHttpPort), 1, 65535, DEFAULTS.cuaDriverHttpPort),
    cuaRecordingMode: normalizeCuaRecordingMode(loaded.cuaRecordingMode || DEFAULTS.cuaRecordingMode),
    cuaPageJavascriptPolicy: normalizeCuaPageJavascriptPolicy(loaded.cuaPageJavascriptPolicy || DEFAULTS.cuaPageJavascriptPolicy),
    mouseShakeActivationEnabled: readBoolean(envOverride(['OP_MOUSE_SHAKE_ACTIVATION_ENABLED']), loaded.mouseShakeActivationEnabled ?? DEFAULTS.mouseShakeActivationEnabled),
    mouseShakeSensitivity: normalizeMouseShakeSensitivity(envOverride(['OP_MOUSE_SHAKE_SENSITIVITY']) || loaded.mouseShakeSensitivity || DEFAULTS.mouseShakeSensitivity),
    pillWidth: clampNumber(loaded.pillWidth, 280, 900, DEFAULTS.pillWidth),
    pillHeight: clampNumber(loaded.pillHeight, 24, 96, DEFAULTS.pillHeight),
    newDialogBehavior: normalizeNewDialogBehavior(loaded.newDialogBehavior || DEFAULTS.newDialogBehavior),
    newDialogInterval: clampNumber(loaded.newDialogInterval, 10, 86400, DEFAULTS.newDialogInterval),
    localVlmContextWindow: clampNumber(loaded.localVlmContextWindow, 4096, 2000000, DEFAULTS.localVlmContextWindow),
    modalTheme: normalizeModalTheme(loaded.modalTheme || DEFAULTS.modalTheme),
    backgroundProcessCorner: normalizeBackgroundProcessCorner(loaded.backgroundProcessCorner || DEFAULTS.backgroundProcessCorner),
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

const localVlmSecretEnvKeys = ['OP_LOCAL_VLM_API_KEY', 'OP_OPENAI_COMPAT_API_KEY'];
const hermesSecretEnvKeys = ['OP_HERMES_API_KEY'];
const opencodeSecretEnvKeys = ['OP_OPENCODE_API_KEY'];
const claudeAgentSecretEnvKeys = ['OP_CLAUDE_AGENT_API_KEY', 'ANTHROPIC_API_KEY'];
const codexSecretEnvKeys = ['OP_CODEX_API_KEY'];

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
  return ['hermes', 'opencode', 'openclaw', 'claude-agent', 'codex'].includes(value) ? (value as AppSettings['agentBackend']) : 'codex';
}

function normalizeCodexTransport(value: string): AppSettings['codexAppServerTransport'] {
  return ['http-adapter', 'websocket', 'stdio'].includes(value) ? (value as AppSettings['codexAppServerTransport']) : 'http-adapter';
}

function normalizeEffort(value: string): AppSettings['codexEffort'] {
  return ['low', 'medium', 'high', 'xhigh', 'max'].includes(value) ? (value as AppSettings['codexEffort']) : 'low';
}

function normalizeCuaMode(value: string): AppSettings['cuaMode'] {
  return ['off', 'prefer', 'require-on-explicit-command'].includes(value) ? (value as AppSettings['cuaMode']) : 'prefer';
}

function normalizeCuaRecordingMode(value: string): AppSettings['cuaRecordingMode'] {
  return ['off', 'manual'].includes(value) ? (value as AppSettings['cuaRecordingMode']) : 'manual';
}

function normalizeCuaPageJavascriptPolicy(value: string): AppSettings['cuaPageJavascriptPolicy'] {
  return ['ask', 'off'].includes(value) ? (value as AppSettings['cuaPageJavascriptPolicy']) : 'ask';
}

function normalizeMouseShakeSensitivity(value: string): AppSettings['mouseShakeSensitivity'] {
  return ['low', 'medium', 'high'].includes(value) ? (value as AppSettings['mouseShakeSensitivity']) : 'low';
}

function normalizeNewDialogBehavior(value: string): AppSettings['newDialogBehavior'] {
  return ['new', 'continue', 'interval'].includes(value) ? (value as AppSettings['newDialogBehavior']) : 'continue';
}

function normalizeModalTheme(value: string): AppSettings['modalTheme'] {
  return ['blue', 'white', 'black'].includes(value) ? (value as AppSettings['modalTheme']) : 'blue';
}

function normalizeBackgroundProcessCorner(value: string): AppSettings['backgroundProcessCorner'] {
  return ['bottom-left', 'bottom-right', 'top-left', 'top-right'].includes(value) ? (value as AppSettings['backgroundProcessCorner']) : 'bottom-left';
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
