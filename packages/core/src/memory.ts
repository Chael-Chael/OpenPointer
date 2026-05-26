import type { PointerContext } from './types.js';

export type PointerMemory = {
  current?: PointerContext;
  previous?: PointerContext;
  selected: PointerContext[];
  insertion?: PointerContext;
};

export function createPointerMemory(): PointerMemory {
  return { selected: [] };
}

export function rememberCurrent(memory: PointerMemory, context: PointerContext): PointerMemory {
  return {
    ...memory,
    previous: memory.current,
    current: context
  };
}

export function rememberSelected(memory: PointerMemory, context: PointerContext): PointerMemory {
  const selected = [...memory.selected.filter((item) => item.id !== context.id), context];
  return { ...memory, selected };
}

export function rememberInsertion(memory: PointerMemory, context: PointerContext): PointerMemory {
  return { ...memory, insertion: context };
}

export function resolvePronoun(memory: PointerMemory, token: 'this' | 'that' | 'these' | 'here'): PointerContext | PointerContext[] | undefined {
  switch (token) {
    case 'this':
      return memory.current;
    case 'that':
      return memory.previous;
    case 'these':
      return memory.selected;
    case 'here':
      return memory.insertion;
  }
}
