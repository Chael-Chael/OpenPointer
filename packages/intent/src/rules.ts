import type { PointerContext, PointerEntityKind, PointerIntent } from '@openmagicpointer/core';

const generic: PointerIntent[] = [
  { id: 'explain', label: 'Explain', reason: 'General pointer context is available.', confidence: 0.62, requiresInput: false, defaultPrompt: 'Explain this.' },
  { id: 'summarize', label: 'Summarize', reason: 'Visible content can be summarized.', confidence: 0.58, requiresInput: false, defaultPrompt: 'Summarize this.' },
  { id: 'translate', label: 'Translate', reason: 'Text may be present in the target or nearby context.', confidence: 0.52, requiresInput: true, defaultPrompt: 'Translate this into my preferred language.' }
];

const byKind: Partial<Record<PointerEntityKind, PointerIntent[]>> = {
  input: [
    { id: 'fill', label: 'Fill here', reason: 'The target appears to be an input field.', confidence: 0.86, requiresInput: true, defaultPrompt: 'Fill this field with the appropriate text.' },
    { id: 'rewrite', label: 'Rewrite then fill', reason: 'Input fields often need polished text.', confidence: 0.73, requiresInput: true, defaultPrompt: 'Rewrite the selected text and fill it here.' }
  ],
  table: [
    { id: 'extract', label: 'Extract table', reason: 'The target appears to be tabular data.', confidence: 0.88, requiresInput: false, defaultPrompt: 'Extract this table as Markdown and CSV.' },
    { id: 'summarize', label: 'Summarize data', reason: 'Tables often benefit from a concise summary.', confidence: 0.75, requiresInput: false, defaultPrompt: 'Summarize the main patterns in this table.' }
  ],
  code: [
    { id: 'explain', label: 'Explain code', reason: 'The target appears to be code.', confidence: 0.86, requiresInput: false, defaultPrompt: 'Explain this code.' },
    { id: 'send-to-agent', label: 'Send to coding agent', reason: 'Code context may need repository-aware work.', confidence: 0.62, requiresInput: true, defaultPrompt: 'Send this code context to a coding agent.' }
  ],
  'error-log': [
    { id: 'explain', label: 'Explain error', reason: 'The target appears to be an error log.', confidence: 0.9, requiresInput: false, defaultPrompt: 'Explain this error and likely fixes.' },
    { id: 'send-to-agent', label: 'Fix with coding agent', reason: 'Error logs often need codebase changes.', confidence: 0.7, requiresInput: true, defaultPrompt: 'Ask a coding agent to investigate this error.' }
  ],
  button: [
    { id: 'explain', label: 'Explain control', reason: 'The target appears to be a clickable control.', confidence: 0.72, requiresInput: false, defaultPrompt: 'Explain what this button likely does.' },
    { id: 'click', label: 'Click after preview', reason: 'The target appears clickable.', confidence: 0.6, requiresInput: false, defaultPrompt: 'Click this control after confirmation.' }
  ],
  link: [
    { id: 'explain', label: 'Explain link', reason: 'The target appears to be a link.', confidence: 0.72, requiresInput: false, defaultPrompt: 'Explain where this link likely goes.' },
    { id: 'open', label: 'Open link', reason: 'The target appears openable.', confidence: 0.62, requiresInput: false, defaultPrompt: 'Open this link after confirmation.' }
  ]
};

export function recommendIntents(context: PointerContext): PointerIntent[] {
  const candidates = [...(context.target ? byKind[context.target.kind] ?? [] : []), ...generic];
  if (context.gesture?.kind === 'lasso' || context.gesture?.kind === 'circle' || context.entities.length > 1) {
    candidates.unshift({
      id: 'compare',
      label: 'Compare selected',
      reason: 'Multiple objects or a selected region are in context.',
      confidence: 0.78,
      requiresInput: false,
      defaultPrompt: 'Compare these selected items.'
    });
  }
  const deduped = new Map(candidates.map((intent) => [intent.id, intent]));
  return [...deduped.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 6);
}
