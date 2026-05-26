import type { ActionStep, PointerActionPlan, PointerContext, PointerIntentId } from './types.js';
import { inferRisk, requiresConfirmation } from './risk.js';

export function createActionPlan(args: {
  intent: PointerIntentId;
  context: PointerContext;
  steps: ActionStep[];
  preview: string;
}): PointerActionPlan {
  const risk = inferRisk(args.intent, args.steps);
  return {
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    intent: args.intent,
    risk,
    contextId: args.context.id,
    steps: args.steps,
    preview: args.preview,
    requiresConfirmation: requiresConfirmation(risk),
    createdAt: Date.now()
  };
}

export function actionPreviewFromSteps(steps: ActionStep[]): string {
  return steps
    .map((step, index) => {
      const prefix = `${index + 1}.`;
      switch (step.type) {
        case 'answer':
          return `${prefix} Ask the model: ${step.prompt}`;
        case 'copy':
          return `${prefix} Copy text to clipboard.`;
        case 'fill':
          return `${prefix} Fill the current target with proposed text.`;
        case 'click':
          return `${prefix} Click at (${step.x}, ${step.y}).`;
        case 'doubleClick':
          return `${prefix} Double-click at (${step.x}, ${step.y}).`;
        case 'move':
          return `${prefix} Move cursor to (${step.x}, ${step.y}).`;
        case 'drag':
          return `${prefix} Drag from (${step.from.x}, ${step.from.y}) to (${step.to.x}, ${step.to.y}).`;
        case 'scroll':
          return `${prefix} Scroll by (${step.deltaX}, ${step.deltaY}).`;
        case 'type':
          return `${prefix} Type proposed text.`;
        case 'hotkey':
          return `${prefix} Press ${step.keys.join('+')}.`;
        case 'open':
          return `${prefix} Open ${step.target}.`;
        case 'launchApp':
          return `${prefix} Launch ${step.appId}.`;
        case 'shell':
          return `${prefix} Run a shell command.`;
      }
    })
    .join('\n');
}
