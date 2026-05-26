import type { ActionRisk, ActionStep, PointerActionPlan, PointerIntentId } from './types.js';

const INTENT_RISK: Record<PointerIntentId, ActionRisk> = {
  ask: 'low',
  explain: 'low',
  summarize: 'low',
  translate: 'low',
  rewrite: 'low',
  extract: 'low',
  compare: 'low',
  fill: 'medium',
  copy: 'medium',
  click: 'medium',
  open: 'medium',
  'send-to-agent': 'high'
};

const STEP_RISK: Record<ActionStep['type'], ActionRisk> = {
  answer: 'low',
  copy: 'medium',
  fill: 'medium',
  click: 'medium',
  doubleClick: 'medium',
  move: 'low',
  drag: 'medium',
  scroll: 'low',
  type: 'medium',
  hotkey: 'medium',
  open: 'medium',
  launchApp: 'medium',
  shell: 'high'
};

const RANK: Record<ActionRisk, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
};

export function maxRisk(a: ActionRisk, b: ActionRisk): ActionRisk {
  return RANK[a] >= RANK[b] ? a : b;
}

export function inferRisk(intent: PointerIntentId, steps: ActionStep[]): ActionRisk {
  return steps.reduce((risk, step) => maxRisk(risk, STEP_RISK[step.type]), INTENT_RISK[intent]);
}

export function requiresConfirmation(risk: ActionRisk): boolean {
  return risk !== 'low';
}

export function validateActionPlan(plan: PointerActionPlan): { ok: true } | { ok: false; error: string } {
  if (!plan.id || !plan.contextId) return { ok: false, error: 'Action plan is missing identity fields.' };
  if (plan.steps.length === 0) return { ok: false, error: 'Action plan must include at least one step.' };
  if (!plan.preview.trim()) return { ok: false, error: 'Action plan must include a visible preview.' };
  const inferred = inferRisk(plan.intent, plan.steps);
  if (RANK[plan.risk] < RANK[inferred]) {
    return { ok: false, error: `Action plan risk ${plan.risk} is lower than inferred risk ${inferred}.` };
  }
  if (requiresConfirmation(plan.risk) && !plan.requiresConfirmation) {
    return { ok: false, error: 'State-changing action plans require confirmation.' };
  }
  return { ok: true };
}
