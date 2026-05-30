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
        <header className="settings-header">
          <div>
            <p>Agent backends</p>
            <h2>Connection settings</h2>
          </div>
          <button className="ghost-button" onClick={onClose}>Close</button>
        </header>

        <section className="settings-section">
          <label className="field">
            <span>Default backend</span>
            <select value={backend} onChange={(event) => setBackend(event.target.value as AgentBackendId)}>
              {selectableBackends.map((item) => <option key={item} value={item}>{backendLabel(item)}</option>)}
            </select>
          </label>
        </section>
        {/* BACKEND_GRID_PLACEHOLDER */}
        <div className="backend-grid">
          <BackendCard title="Local VLM" status={backendReadiness(draftAwareSettings, 'local-vlm')}>
            <label className="toggle-row">
              <input type="checkbox" checked={settings.localVlmEnabled} onChange={(event) => updateSettings({ localVlmEnabled: event.target.checked })} />
              <span>Enabled</span>
            </label>
            <TextField label="Base URL" value={settings.localVlmBaseUrl} onChange={(value) => updateSettings({ localVlmBaseUrl: value })} placeholder="https://provider.example/v1" />
            <TextField label="Model" value={settings.localVlmModel} onChange={(value) => updateSettings({ localVlmModel: value })} placeholder="Optional model name" />

            <div className="model-fetch-row" style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginTop: '4px' }}>
              <button
                type="button"
                className="ghost-button"
                style={{ fontSize: '11px', padding: '4px 10px', height: '28px', borderRadius: '8px' }}
                onClick={fetchModels}
                disabled={isFetchingModels || !settings.localVlmBaseUrl}
              >
                {isFetchingModels ? 'Fetching...' : 'Fetch vision models'}
              </button>
              {fetchModelsError && <span style={{ color: '#e5383b', fontSize: '11px' }}>{fetchModelsError}</span>}
            </div>

            {fetchedModels && fetchedModels.length > 0 && (
              <div className="fetched-models-list" style={{ marginTop: '8px', maxHeight: '100px', overflowY: 'auto', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '6px', background: 'rgba(0,0,0,0.02)' }}>
                <p style={{ margin: '0 0 4px', fontSize: '11px', fontWeight: 'bold', color: 'var(--muted)' }}>Select a vision model:</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {fetchedModels.map((m) => (
                    <span
                      key={m}
                      style={{ cursor: 'pointer', background: 'var(--accent-soft)', color: 'var(--accent-deep)', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(52,120,246,0.15)' }}
                      onClick={() => updateSettings({ localVlmModel: m })}
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <label className="field" style={{ marginTop: '10px' }}>
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
            <TextField label="Base URL" value={settings.hermesBaseUrl} onChange={(value) => updateSettings({ hermesBaseUrl: value })} placeholder="http://127.0.0.1:8642/v1" />
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
            <TextField label="Base URL" value={settings.opencodeBaseUrl} onChange={(value) => updateSettings({ opencodeBaseUrl: value })} placeholder="http://127.0.0.1:4096" />
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
            <TextField label="App server URL" value={settings.codexAppServerUrl} onChange={(value) => updateSettings({ codexAppServerUrl: value })} placeholder="http://127.0.0.1:5050/v1" />
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
        <section className="settings-section runtime-section">
          <label className="field">
            <span>CUA mode</span>
            <select value={settings.cuaMode} onChange={(event) => updateSettings({ cuaMode: event.target.value as AppSettings['cuaMode'] })}>
              <option value="off">Off</option>
              <option value="prefer">Prefer</option>
              <option value="require-on-explicit-command">Require on explicit command</option>
            </select>
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={settings.requireApprovalBeforeCua} onChange={(event) => updateSettings({ requireApprovalBeforeCua: event.target.checked })} />
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
            <div style={{ marginTop: '12px' }}>
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

        <section className="settings-section appearance-section">
          <NumberSlider
            label="Pill width"
            value={pillWidth}
            min={280}
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

        <div className="modal-actions">
          <button className="primary-button" onClick={saveSettings}>Save settings</button>
        </div>
      </div>
    </div>
  );
}
