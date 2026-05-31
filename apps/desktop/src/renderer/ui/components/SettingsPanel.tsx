import type { AgentBackendId } from '@openmagicpointer/core';
import type { AppSettings } from '@openmagicpointer/storage';
import type { SecretDrafts, ClearSecretFlags, SecretKey } from '../state';
import { selectableBackends } from '../state';
import { backendReadiness, backendLabel, secretConfigured } from '../lib/backend-status';
import { BackendCard, TextField, SecretField, NumberSlider } from './fields';

type SettingsPanelProps = {
  settings: AppSettings;
  draftAwareSettings: AppSettings | null;
  backend: AgentBackendId;
  setBackend(backend: AgentBackendId): void;
  secretDrafts: SecretDrafts;
  clearSecrets: ClearSecretFlags;
  pillWidth: number;
  pillHeight: number;
  fetchedModels: string[] | null;
  isFetchingModels: boolean;
  fetchModelsError: string | null;
  onClose(): void;
  updateSettings(patch: Partial<AppSettings>): void;
  updateSecret(key: SecretKey, value: string): void;
  clearSecret(key: SecretKey): void;
  fetchModels(): void;
  saveSettings(): void;
};

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    settings,
    draftAwareSettings,
    backend,
    setBackend,
    secretDrafts,
    clearSecrets,
    pillWidth,
    pillHeight,
    fetchedModels,
    isFetchingModels,
    fetchModelsError,
    onClose,
    updateSettings,
    updateSecret,
    clearSecret,
    fetchModels,
    saveSettings
  } = props;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="OpenMagicPointer settings">
      <div className="modal-card">
        <header className="flex items-center justify-between gap-3 mb-4">
          <div>
            <p className="m-0 mb-1 text-accent text-[11px] font-bold uppercase tracking-[0.04em]">Agent backends</p>
            <h2 className="m-0 text-xl font-bold leading-tight text-ink">Connection settings</h2>
          </div>
          <button className="ghost-button" onClick={onClose}>
            Close
          </button>
        </header>

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
        {/* BACKEND_GRID_PLACEHOLDER */}
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
                className="ghost-button !text-[11px] !py-1 !px-2.5 !h-7 !rounded-lg"
                onClick={fetchModels}
                disabled={isFetchingModels || !settings.localVlmBaseUrl}
              >
                {isFetchingModels ? 'Fetching...' : 'Fetch vision models'}
              </button>
              {fetchModelsError && <span className="text-danger text-[11px]">{fetchModelsError}</span>}
            </div>

            {fetchedModels && fetchedModels.length > 0 && (
              <div className="mt-2 max-h-[100px] overflow-y-auto border border-glass-border rounded-lg p-1.5 bg-black/[0.02]">
                <p className="m-0 mb-1 text-[11px] font-bold text-muted">Select a vision model:</p>
                <div className="flex flex-wrap gap-1">
                  {fetchedModels.map((m) => (
                    <span
                      key={m}
                      className="cursor-pointer bg-accent-soft text-accent-deep text-[10px] py-0.5 px-1.5 rounded border border-accent/15 hover:brightness-95 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150"
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
          {/* MORE_BACKENDS_PLACEHOLDER */}
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

          <BackendCard title="Claude Agent" status={backendReadiness(draftAwareSettings, 'claude-agent')}>
            <label className="toggle-row">
              <input type="checkbox" checked={settings.claudeAgentEnabled} onChange={(event) => updateSettings({ claudeAgentEnabled: event.target.checked })} />
              <span>Enabled</span>
            </label>
            <SecretField
              label="API key"
              value={secretDrafts.claudeAgentApiKey}
              configured={secretConfigured(settings.hasClaudeAgentApiKey, secretDrafts.claudeAgentApiKey, clearSecrets.claudeAgentApiKey)}
              clearQueued={clearSecrets.claudeAgentApiKey}
              onChange={(value) => updateSecret('claudeAgentApiKey', value)}
              onClear={() => clearSecret('claudeAgentApiKey')}
            />
          </BackendCard>

          <BackendCard title="Codex" status={backendReadiness(draftAwareSettings, 'codex')}>
            <TextField
              label="App server URL"
              value={settings.codexAppServerUrl}
              onChange={(value) => updateSettings({ codexAppServerUrl: value })}
              placeholder="http://127.0.0.1:5050/v1"
            />
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
        {/* RUNTIME_SECTION_PLACEHOLDER */}
        <section className="settings-section grid grid-cols-[minmax(200px,1fr)_repeat(3,minmax(0,auto))] items-center gap-3 mt-3 max-md:grid-cols-1">
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
            <input type="checkbox" checked={settings.longPressEnabled} onChange={(event) => updateSettings({ longPressEnabled: event.target.checked })} />
            <span>Long press activation</span>
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={settings.voiceEnabled} onChange={(event) => updateSettings({ voiceEnabled: event.target.checked })} />
            <span>Voice input</span>
          </label>
        </section>

        <section className="settings-section">
          <label className="field">
            <span>New dialog behavior</span>
            <select
              value={settings?.newDialogBehavior ?? 'continue'}
              onChange={(event) => updateSettings({ newDialogBehavior: event.target.value as AppSettings['newDialogBehavior'] })}
            >
              <option value="new">Always start a new conversation</option>
              <option value="continue">Always continue the previous conversation</option>
              <option value="interval">Start new conversation after interval, otherwise continue</option>
            </select>
          </label>
          {(settings?.newDialogBehavior ?? 'continue') === 'interval' && (
            <div className="mt-3">
              <NumberSlider
                label="New dialog interval"
                value={settings?.newDialogInterval ?? 300}
                min={10}
                max={3600}
                step={10}
                unit="s"
                onChange={(value) => updateSettings({ newDialogInterval: value })}
              />
            </div>
          )}
        </section>

        <section className="settings-section grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <NumberSlider
            label="Pill width"
            value={pillWidth}
            min={240}
            max={900}
            step={10}
            unit="px"
            onChange={(value) => updateSettings({ pillWidth: value })}
          />
          <NumberSlider
            label="Pill height"
            value={pillHeight}
            min={36}
            max={96}
            step={2}
            unit="px"
            onChange={(value) => updateSettings({ pillHeight: value })}
          />
        </section>

        <div className="flex justify-end mt-4">
          <button className="primary-button" onClick={saveSettings}>
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}
