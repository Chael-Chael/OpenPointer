import { useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { AgentBackendId } from '@openmagicpointer/core';
import type { AppSettings } from '@openmagicpointer/storage';
import type { Conversation } from '@openmagicpointer/core';
import type { SecretDrafts, ClearSecretFlags, SecretKey } from '../state';
import { selectableBackends } from '../state';
import { backendReadiness, backendLabel, secretConfigured } from '../lib/backend-status';
import { BackendCard, TextField, SecretField, NumberSlider } from './fields';

type SettingsTab = 'general' | 'customization' | 'history';

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
  conversations: Conversation[];
  onClose(): void;
  updateSettings(patch: Partial<AppSettings>): void;
  updateSecret(key: SecretKey, value: string): void;
  clearSecret(key: SecretKey): void;
  fetchModels(): void;
  saveSettings(): void;
  loadConversation(id: string): void;
  deleteConversation(id: string, event: ReactMouseEvent): void;
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
    conversations,
    onClose,
    updateSettings,
    updateSecret,
    clearSecret,
    fetchModels,
    saveSettings,
    loadConversation,
    deleteConversation
  } = props;

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  const modalTheme = settings.modalTheme ?? 'blue';

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="OpenMagicPointer settings">
      <div className="modal-card" data-theme={modalTheme}>
        <header className="flex items-center justify-between gap-3 mb-4">
          <h2 className="m-0 text-2xl font-instrument font-normal leading-tight text-white">Settings</h2>
          <button className="ghost-button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="segmented-control">
          <div className="segmented-control-track">
            {(['general', 'customization', 'history'] as SettingsTab[]).map((tab) => (
              <button
                key={tab}
                className={`segmented-control-item${activeTab === tab ? ' active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'general' ? 'General' : tab === 'customization' ? 'Customization' : 'History'}
              </button>
            ))}
            <div className="segmented-control-indicator" data-active={activeTab} />
          </div>
        </div>

        {/* ─── General Tab ─── */}
        {activeTab === 'general' && (
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
                  <input type="checkbox" checked={settings.claudeAgentEnabled} onChange={(event) => updateSettings({ claudeAgentEnabled: event.target.checked })} />
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
                    <option value="http-adapter">HTTP adapter</option>
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
          </>
        )}

        {/* ─── Customization Tab ─── */}
        {activeTab === 'customization' && (
          <>
            <section className="settings-section">
              <label className="field">
                <span>Interface theme</span>
                <select
                  value={settings.modalTheme ?? 'blue'}
                  onChange={(event) => updateSettings({ modalTheme: event.target.value as AppSettings['modalTheme'] })}
                >
                  <option value="blue">Blue (default)</option>
                  <option value="white">White</option>
                  <option value="black">Black</option>
                </select>
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
                min={24}
                max={96}
                step={2}
                unit="px"
                onChange={(value) => updateSettings({ pillHeight: value })}
              />
            </section>
          </>
        )}

        {/* ─── History Tab ─── */}
        {activeTab === 'history' && (
          <>
            {conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-white/40 text-sm m-0">No past conversations yet.</p>
              </div>
            ) : (
              <div className="history-list">
                {conversations.map((conv) => (
                  <div key={conv.id} className="history-item" onClick={() => loadConversation(conv.id)}>
                    <div className="history-item-info">
                      <span className="history-item-title">{conv.title || 'Untitled Conversation'}</span>
                      <span className="history-item-date">{new Date(conv.updatedAt).toLocaleString()}</span>
                    </div>
                    <div className="history-item-actions">
                      <button
                        className="history-item-btn primary-button"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          loadConversation(conv.id);
                        }}
                      >
                        Open
                      </button>
                      <button className="history-item-btn ghost-button" type="button" onClick={(e) => deleteConversation(conv.id, e)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end mt-4">
          <button className="primary-button" onClick={saveSettings}>
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}
