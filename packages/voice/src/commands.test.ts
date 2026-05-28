import { describe, expect, it } from 'vitest';
import { parseVoiceCommand } from './commands.js';

describe('parseVoiceCommand', () => {
  it('treats non-empty speech as an instruction', () => {
    expect(parseVoiceCommand('Summarize this area').kind).toBe('instruction');
    expect(parseVoiceCommand('合并这些条目').kind).toBe('instruction');
  });

  it('rejects empty speech', () => {
    expect(parseVoiceCommand('   ').kind).toBe('unknown');
  });
});
