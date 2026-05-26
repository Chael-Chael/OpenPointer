import { describe, expect, it } from 'vitest';
import { inferRisk, validateActionPlan } from './risk.js';
import type { PointerActionPlan } from './types.js';

describe('risk policy', () => {
  it('infers higher risk from steps', () => {
    expect(inferRisk('summarize', [{ type: 'type', text: 'hello' }])).toBe('medium');
    expect(inferRisk('summarize', [{ type: 'shell', command: 'echo hi' }])).toBe('high');
  });

  it('rejects missing confirmation for state-changing actions', () => {
    const plan: PointerActionPlan = {
      id: 'p',
      intent: 'fill',
      risk: 'medium',
      contextId: 'c',
      steps: [{ type: 'type', text: 'hello' }],
      preview: 'Type hello',
      requiresConfirmation: false,
      createdAt: Date.now()
    };
    expect(validateActionPlan(plan).ok).toBe(false);
  });
});
