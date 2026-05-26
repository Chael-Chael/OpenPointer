import { describe, expect, it } from 'vitest';
import { parseVoiceCommand } from './commands.js';

describe('parseVoiceCommand', () => {
  it('recognizes Chinese action commands', () => {
    expect(parseVoiceCommand('总结这个').kind).toBe('summarize');
    expect(parseVoiceCommand('执行').kind).toBe('execute');
  });
});
