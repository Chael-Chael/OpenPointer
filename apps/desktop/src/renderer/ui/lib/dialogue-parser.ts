import type { AgentEvent } from '@openpointer/core';

export type HistoryToolEvent = Extract<AgentEvent, { type: 'tool.started' | 'tool.completed' }>;

export type DialogueBlock =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; isRunning: boolean }
  | {
      type: 'tool';
      name: string;
      startedEvent: Extract<AgentEvent, { type: 'tool.started' }>;
      completedEvent?: Extract<AgentEvent, { type: 'tool.completed' }>;
    }
  | { type: 'discovery'; message: string };

export function parseTextToBlocks(fullText: string): DialogueBlock[] {
  const blocks: DialogueBlock[] = [];
  let tempText = fullText;

  while (tempText.length > 0) {
    const thinkStartIdx = tempText.indexOf('<think>');
    if (thinkStartIdx === -1) {
      blocks.push({ type: 'text', text: tempText });
      break;
    }

    if (thinkStartIdx > 0) {
      blocks.push({ type: 'text', text: tempText.slice(0, thinkStartIdx) });
    }

    const thinkEndIdx = tempText.indexOf('</think>', thinkStartIdx + 7);
    if (thinkEndIdx === -1) {
      blocks.push({ type: 'reasoning', text: tempText.slice(thinkStartIdx + 7), isRunning: true });
      break;
    }

    blocks.push({ type: 'reasoning', text: tempText.slice(thinkStartIdx + 7, thinkEndIdx), isRunning: false });
    tempText = tempText.slice(thinkEndIdx + 8);
  }

  return blocks;
}

export function groupEventsToBlocks(events: AgentEvent[]): DialogueBlock[] {
  const blocks: DialogueBlock[] = [];
  const activeToolBlocks = new Map<string, number>();
  let accumulatedText = '';

  const flushText = () => {
    if (accumulatedText.length > 0) {
      blocks.push(...parseTextToBlocks(accumulatedText));
      accumulatedText = '';
    }
  };

  for (const event of events) {
    if (event.type === 'assistant.delta') {
      accumulatedText += event.text;
    } else {
      flushText();

      if (event.type === 'tool.started') {
        const blockIndex = blocks.length;
        blocks.push({ type: 'tool', name: event.name, startedEvent: event });
        activeToolBlocks.set(event.name, blockIndex);
      } else if (event.type === 'tool.completed') {
        const blockIndex = activeToolBlocks.get(event.name);
        if (blockIndex !== undefined) {
          const block = blocks[blockIndex];
          if (block && block.type === 'tool') {
            block.completedEvent = event;
          }
          activeToolBlocks.delete(event.name);
        } else {
          for (let i = blocks.length - 1; i >= 0; i--) {
            const block = blocks[i];
            if (block && block.type === 'tool' && block.name === event.name && !block.completedEvent) {
              block.completedEvent = event;
              break;
            }
          }
        }
      } else if (event.type === 'tool.discovery') {
        blocks.push({ type: 'discovery', message: event.message });
      }
    }
  }

  flushText();

  return blocks;
}
