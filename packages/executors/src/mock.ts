import type { ExecutorAdapter, ExecutorResult, PointerActionPlan } from '@openmagicpointer/core';

export class MockExecutor implements ExecutorAdapter {
  id = 'mock';
  label = 'Mock executor';
  public executed: PointerActionPlan[] = [];

  async capabilities(): Promise<string[]> {
    return ['dryRun', 'audit', 'answer', 'copy', 'fill', 'click', 'type'];
  }

  async dryRun(plan: PointerActionPlan): Promise<PointerActionPlan> {
    return plan;
  }

  async execute(plan: PointerActionPlan, approvalToken: string): Promise<ExecutorResult> {
    if (!approvalToken) return { ok: false, summary: 'Missing approval token.' };
    this.executed.push(plan);
    return { ok: true, summary: `Mock executed ${plan.steps.length} step(s).` };
  }

  async audit(_plan: PointerActionPlan, _result: ExecutorResult): Promise<void> {
    return;
  }
}
