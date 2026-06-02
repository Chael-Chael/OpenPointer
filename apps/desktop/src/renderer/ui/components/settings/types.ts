import type { MouseEvent as ReactMouseEvent } from 'react';
import type { AgentBackendId } from '@openpointer/core';
import type { AppSettings } from '@openpointer/storage';
import type { Conversation } from '@openpointer/core';
import type { SecretDrafts, ClearSecretFlags, SecretKey } from '../../state';

export type SettingsTab = 'general' | 'customization' | 'history';

export type SettingsPanelProps = {
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
