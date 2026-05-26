import type { ExecutorResult, PointerActionPlan, PointerContext } from '@openmagicpointer/core';

export type AppSettings = {
  openAICompatibleBaseUrl: string;
  openAICompatibleModel: string;
  hasApiKey: boolean;
  cuaEndpoint: string;
  activationHotkey: string;
  wiggleEnabled: boolean;
  wiggleSensitivity: 'low' | 'medium' | 'high';
  trailEnabled: boolean;
  voiceEnabled: boolean;
};

export type HistoryEntry = {
  id: string;
  context: PointerContext;
  prompt: string;
  answer?: string;
  plan?: PointerActionPlan;
  result?: ExecutorResult;
  createdAt: number;
};

export type AuditEntry = {
  id: string;
  plan: PointerActionPlan;
  result: ExecutorResult;
  createdAt: number;
};
