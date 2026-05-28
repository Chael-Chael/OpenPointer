export type VoiceCommandKind = 'instruction' | 'unknown';

export type VoiceCommand = {
  kind: VoiceCommandKind;
  text: string;
  confidence: number;
};

export function parseVoiceCommand(text: string): VoiceCommand {
  const normalized = text.trim();
  if (!normalized) return { kind: 'unknown', text: normalized, confidence: 0 };
  return { kind: 'instruction', text: normalized, confidence: 0.82 };
}
