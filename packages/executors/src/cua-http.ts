import type { ActionStep, ExecutorAdapter, ExecutorResult, PointerActionPlan } from '@openmagicpointer/core';

export type CuaHttpExecutorConfig = {
  endpoint: string;
  authToken?: string;
};

type CuaCommand = {
  command: string;
  params: Record<string, unknown>;
};

export class CuaHttpExecutor implements ExecutorAdapter {
  id = 'cua-http';
  label = 'Cua computer-server HTTP executor';

  constructor(private readonly config: CuaHttpExecutorConfig) {}

  async capabilities(): Promise<string[]> {
    return ['screenshot', 'click', 'doubleClick', 'move', 'drag', 'scroll', 'type', 'hotkey', 'clipboard', 'open', 'launchApp', 'activeWindow'];
  }

  async dryRun(plan: PointerActionPlan): Promise<PointerActionPlan> {
    return plan;
  }

  async execute(plan: PointerActionPlan, approvalToken: string): Promise<ExecutorResult> {
    if (!approvalToken) return { ok: false, summary: 'Missing approval token.' };
    const commands = plan.steps.map(stepToCuaCommand).filter((cmd): cmd is CuaCommand => cmd !== null);
    const results: unknown[] = [];
    for (const command of commands) {
      results.push(await this.send(command));
    }
    return { ok: true, summary: `Executed ${commands.length} Cua command(s).`, raw: results };
  }

  async audit(_plan: PointerActionPlan, _result: ExecutorResult): Promise<void> {
    return;
  }

  private async send(command: CuaCommand): Promise<unknown> {
    const response = await fetch(`${this.config.endpoint.replace(/\/$/, '')}/cmd`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.authToken ? { Authorization: `Bearer ${this.config.authToken}` } : {})
      },
      body: JSON.stringify(command)
    });
    if (!response.ok) {
      throw new Error(`Cua command ${command.command} failed with ${response.status}: ${await response.text()}`);
    }
    return response.json().catch(() => ({}));
  }
}

function stepToCuaCommand(step: ActionStep): CuaCommand | null {
  switch (step.type) {
    case 'click':
      return { command: 'left_click', params: { x: step.x, y: step.y } };
    case 'doubleClick':
      return { command: 'double_click', params: { x: step.x, y: step.y } };
    case 'move':
      return { command: 'move_cursor', params: { x: step.x, y: step.y } };
    case 'drag':
      return { command: 'drag', params: { x1: step.from.x, y1: step.from.y, x2: step.to.x, y2: step.to.y } };
    case 'scroll':
      return { command: 'scroll', params: { x: step.deltaX, y: step.deltaY } };
    case 'type':
      return { command: 'type_text', params: { text: step.text } };
    case 'hotkey':
      return { command: 'hotkey', params: { keys: step.keys } };
    case 'copy':
      return { command: 'clipboard_set', params: { text: step.text } };
    case 'open':
      return { command: 'open', params: { target: step.target } };
    case 'launchApp':
      return { command: 'launch_app', params: { app: step.appId } };
    default:
      return null;
  }
}
