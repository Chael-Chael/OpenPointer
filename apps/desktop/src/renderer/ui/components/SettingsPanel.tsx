import { useState } from 'react';
import type { SettingsTab, SettingsPanelProps } from './settings/types';
import { GeneralTab } from './settings/GeneralTab';
import { CustomizationTab } from './settings/CustomizationTab';
import { HistoryTab } from './settings/HistoryTab';

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
    capabilitySnapshot,
    refreshingCapabilities,
    conversations,
    onClose,
    updateSettings,
    updateSecret,
    clearSecret,
    fetchModels,
    refreshCapabilities,
    saveSettings,
    loadConversation,
    deleteConversation,
  } = props;

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const modalTheme = settings.modalTheme ?? 'blue';

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="OpenPointer settings">
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
              <button key={tab} className={`segmented-control-item${activeTab === tab ? ' active' : ''}`} onClick={() => setActiveTab(tab)}>
                {tab === 'general' ? 'General' : tab === 'customization' ? 'Customization' : 'History'}
              </button>
            ))}
            <div className="segmented-control-indicator" data-active={activeTab} />
          </div>
        </div>

        {activeTab === 'general' && (
          <GeneralTab
            settings={settings}
            draftAwareSettings={draftAwareSettings}
            backend={backend}
            setBackend={setBackend}
            secretDrafts={secretDrafts}
            clearSecrets={clearSecrets}
            fetchedModels={fetchedModels}
            isFetchingModels={isFetchingModels}
            fetchModelsError={fetchModelsError}
            capabilitySnapshot={capabilitySnapshot}
            refreshingCapabilities={refreshingCapabilities}
            updateSettings={updateSettings}
            updateSecret={updateSecret}
            clearSecret={clearSecret}
            fetchModels={fetchModels}
            refreshCapabilities={refreshCapabilities}
          />
        )}

        {activeTab === 'customization' && (
          <CustomizationTab
            settings={settings}
            pillWidth={pillWidth}
            pillHeight={pillHeight}
            updateSettings={updateSettings}
          />
        )}

        {activeTab === 'history' && (
          <HistoryTab
            conversations={conversations}
            loadConversation={loadConversation}
            deleteConversation={deleteConversation}
          />
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
