import type { AgentBackendId } from '@openpointer/core';
import type { AppSettings } from '@openpointer/storage';
import type { SecretDrafts, ClearSecretFlags, SecretKey } from '../../state';
import { selectableBackends } from '../../state';
import { backendReadiness, backendLabel, secretConfigured } from '../../lib/backend-status';
import { BackendCard, TextField, SecretField } from '../fields';

type GeneralTabProps = {
  settings: AppSettings;
  draftAwareSettings: AppSettings | null;
  backend: AgentBackendId;
  setBackend(backend: AgentBackendId): void;
  secretDrafts: SecretDrafts;
  clearSecrets: ClearSecretFlags;
  fetchedModels: string[] | null;
  isFetchingModels: boolean;
  fetchModelsError: string | null;
  updateSettings(patch: Partial<AppSettings>): void;
  updateSecret(key: SecretKey, value: string): void;
  clearSecret(key: SecretKey): void;
  fetchModels(): void;
};

export function GeneralTab({
  settings,
  draftAwareSettings,
  backend,
  setBackend,
  secretDrafts,
  clearSecrets,
  fetchedModels,
  isFetchingModels,
  fetchModelsError,
  updateSettings,
  updateSecret,
  clearSecret,
  fetchModels,
}: GeneralTabProps) {
  return (
    <>
      <section className="settings-section">
        <label className="field">
          <span>Default backend</span>
          <select value={backend} onChange={(event) => setBackend(event.target.value as AgentBackendId)}>
            {selectableBackends.map((item) => (
              <option key={item} value={item}>
                {backendLabel(item)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <BackendCard title="Local VLM" status={backendReadiness(draftAwareSettings, 'local-vlm')}>
          <label className="toggle-row">
            <input type="checkbox" checked={settings.localVlmEnabled} onChange={(event) => updateSettings({ localVlmEnabled: event.target.checked })} />
            <span>Enabled</span>
          </label>
          <TextField
            label="Base URL"
            value={settings.localVlmBaseUrl}
            onChange={(value) => updateSettings({ localVlmBaseUrl: value })}
            placeholder="https://provider.example/v1"
          />
          <TextField
            label="Model"
            value={settings.localVlmModel}
            onChange={(value) => updateSettings({ localVlmModel: value })}
            placeholder="Optional model name"
          />
          <div className="flex gap-2 items-end mt-1">
            <button
              type="button"
              className="ghost-button !text-[11px] !py-1 !px-2.5 !h-7"
              onClick={fetchModels}
              disabled={isFetchingModels || !settings.localVlmBaseUrl}
            >
              {isFetchingModels ? 'Fetching...' : 'Fetch vision models'}
            </button>
            {fetchModelsError && <span className="text-danger text-[11px]">{fetchModelsError}</span>}
          </div>
          {fetchedModels && fetchedModels.length > 0 && (
            <div className="mt-2 max-h-[100px] overflow-y-auto border border-white/12 rounded-[var(--radius-pill)] p-1.5 bg-black/20">
              <p className="m-0 mb-1 text-[11px] font-bold text-white/60">Select a vision model:</p>
              <div className="flex flex-wrap gap-1">
                {fetchedModels.map((m) => (
                  <span
                    key={m}
                    className="cursor-pointer bg-white/12 text-white text-[10px] py-0.5 px-1.5 rounded-[var(--radius-pill)] border border-white/15 hover:bg-white/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150"
                    onClick={() => updateSettings({ localVlmModel: m })}
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
          )}
          <label className="field mt-2.5">
            <span>
              Context window size
              <em>Default: 32k</em>
            </span>
            <input
              type="number"
              min={4096}
              max={2000000}
              step={4096}
              value={settings.localVlmContextWindow ?? 32768}
              onChange={(event) => updateSettings({ localVlmContextWindow: Number(event.target.value) })}
            />
          </label>
          <SecretField
            label="API key"
            value={secretDrafts.localVlmApiKey}
            configured={secretConfigured(settings.hasLocalVlmApiKey, secretDrafts.localVlmApiKey, clearSecrets.localVlmApiKey)}
            clearQueued={clearSecrets.localVlmApiKey}
            onChange={(value) => updateSecret('localVlmApiKey', value)}
            onClear={() => clearSecret('localVlmApiKey')}
          />
        </BackendCard>

        <BackendCard title="Hermes" status={backendReadiness(draftAwareSettings, 'hermes')}>
          <TextField
            label="Base URL"
            value={settings.hermesBaseUrl}
            onChange={(value) => updateSettings({ hermesBaseUrl: value })}
            placeholder="http://127.0.0.1:8642/v1"
          />
          <SecretField
            label="API token"
            value={secretDrafts.hermesApiKey}
            configured={secretConfigured(settings.hasHermesApiKey, secretDrafts.hermesApiKey, clearSecrets.hermesApiKey)}
            clearQueued={clearSecrets.hermesApiKey}
            onChange={(value) => updateSecret('hermesApiKey', value)}
            onClear={() => clearSecret('hermesApiKey')}
          />
        </BackendCard>

        <BackendCard title="OpenCode" status={backendReadiness(draftAwareSettings, 'opencode')}>
          <TextField
            label="Base URL"
            value={settings.opencodeBaseUrl}
            onChange={(value) => updateSettings({ opencodeBaseUrl: value })}
            placeholder="http://127.0.0.1:4096"
          />
          <SecretField
            label="API token"
            value={secretDrafts.opencodeApiKey}
            configured={secretConfigured(settings.hasOpenCodeApiKey, secretDrafts.opencodeApiKey, clearSecrets.opencodeApiKey)}
            clearQueued={clearSecrets.opencodeApiKey}
            onChange={(value) => updateSecret('opencodeApiKey', value)}
            onClear={() => clearSecret('opencodeApiKey')}
          />
        </BackendCard>

        <BackendCard title="Claude Code" status={backendReadiness(draftAwareSettings, 'claude-agent')}>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.claudeAgentEnabled}
              onChange={(event) => updateSettings({ claudeAgentEnabled: event.target.checked })}
            />
            <span>Enabled</span>
          </label>
          <TextField
            label="Claude executable (optional)"
            value={settings.claudeAgentExecutable}
            onChange={(value) => updateSettings({ claudeAgentExecutable: value })}
            placeholder="Auto-detect if empty"
          />
          <TextField
            label="Base URL (optional)"
            value={settings.claudeAgentBaseUrl}
            onChange={(value) => updateSettings({ claudeAgentBaseUrl: value })}
            placeholder="Leave empty to use local Claude Code auth"
          />
          <SecretField
            label="API key (optional)"
            value={secretDrafts.claudeAgentApiKey}
            configured={secretConfigured(settings.hasClaudeAgentApiKey, secretDrafts.claudeAgentApiKey, clearSecrets.claudeAgentApiKey)}
            clearQueued={clearSecrets.claudeAgentApiKey}
            onChange={(value) => updateSecret('claudeAgentApiKey', value)}
            onClear={() => clearSecret('claudeAgentApiKey')}
          />
          <TextField
            label="Model (optional)"
            value={settings.claudeAgentModel}
            onChange={(value) => updateSettings({ claudeAgentModel: value })}
            placeholder="e.g., sonnet, opus, haiku or full ID"
          />
          <label className="field">
            <span>Reasoning Effort</span>
            <select
              value={settings.claudeAgentEffort}
              onChange={(event) => updateSettings({ claudeAgentEffort: event.target.value as AppSettings['claudeAgentEffort'] })}
            >
              <option value="low">Low - Minimal thinking, fastest</option>
              <option value="medium">Medium - Moderate thinking</option>
              <option value="high">High - Deep reasoning (default)</option>
              <option value="xhigh">XHigh - Deeper than high</option>
              <option value="max">Max - Maximum effort</option>
            </select>
          </label>
        </BackendCard>

        <BackendCard title="Codex" status={backendReadiness(draftAwareSettings, 'codex')}>
          <label className="field">
            <span>Connection</span>
            <select
              value={settings.codexAppServerTransport}
              onChange={(event) => updateSettings({ codexAppServerTransport: event.target.value as AppSettings['codexAppServerTransport'] })}
            >
              <option value="http-adapter">Python SDK adapter</option>
              <option value="websocket">Official app-server WebSocket</option>
              <option value="stdio">Official app-server stdio</option>
            </select>
          </label>
          <TextField
            label="App server URL"
            value={settings.codexAppServerUrl}
            onChange={(value) => updateSettings({ codexAppServerUrl: value })}
            placeholder={settings.codexAppServerTransport === 'websocket' ? 'ws://127.0.0.1:17321' : 'http://127.0.0.1:5050/v1'}
          />
          <TextField
            label="Codex executable"
            value={settings.codexExecutablePath}
            onChange={(value) => updateSettings({ codexExecutablePath: value })}
            placeholder="Auto-detect if empty"
          />
          <TextField
            label="Model"
            value={settings.codexModel}
            onChange={(value) => updateSettings({ codexModel: value })}
            placeholder="gpt-5.5"
          />
          <label className="field">
            <span>Reasoning Effort</span>
            <select value={settings.codexEffort} onChange={(event) => updateSettings({ codexEffort: event.target.value as AppSettings['codexEffort'] })}>
              <option value="low">Low - Fastest</option>
              <option value="medium">Medium - Balanced</option>
              <option value="high">High - Deeper reasoning</option>
              <option value="xhigh">XHigh - Deeper than high</option>
              <option value="max">Max - Maximum effort</option>
            </select>
          </label>
          <SecretField
            label="API token"
            value={secretDrafts.codexApiKey}
            configured={secretConfigured(settings.hasCodexApiKey, secretDrafts.codexApiKey, clearSecrets.codexApiKey)}
            clearQueued={clearSecrets.codexApiKey}
            onChange={(value) => updateSecret('codexApiKey', value)}
            onClear={() => clearSecret('codexApiKey')}
          />
        </BackendCard>
      </div>

      <section className="settings-section grid grid-cols-[minmax(200px,1fr)_repeat(4,minmax(0,auto))] items-center gap-3 mt-3 max-md:grid-cols-1">
        <label className="field">
          <span>CUA mode</span>
          <select value={settings.cuaMode} onChange={(event) => updateSettings({ cuaMode: event.target.value as AppSettings['cuaMode'] })}>
            <option value="off">Off</option>
            <option value="prefer">Prefer</option>
            <option value="require-on-explicit-command">Require on explicit command</option>
          </select>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={settings.requireApprovalBeforeCua}
            onChange={(event) => updateSettings({ requireApprovalBeforeCua: event.target.checked })}
          />
          <span>Require approval before CUA</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={settings.cuaDebugOverlayEnabled}
            onChange={(event) => updateSettings({ cuaDebugOverlayEnabled: event.target.checked })}
          />
          <span>Show CUA debug boxes</span>
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={settings.longPressEnabled} onChange={(event) => updateSettings({ longPressEnabled: event.target.checked })} />
          <span>Long press activation</span>
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={settings.voiceEnabled} onChange={(event) => updateSettings({ voiceEnabled: event.target.checked })} />
          <span>Voice input</span>
        </label>
      </section>
    </>
  );
}
