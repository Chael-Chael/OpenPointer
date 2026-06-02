import { useState } from 'react';
import { ToolRows } from './fields';
import type { HistoryToolEvent } from '../lib/dialogue-parser';

export function HistoryThinkingBlock({ thinkingTime, toolEvents }: { thinkingTime?: number; toolEvents?: HistoryToolEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!thinkingTime || thinkingTime <= 0) return null;

  return (
    <div className="my-2 flex flex-col items-start w-full select-none">
      <div
        className={`inline-flex items-center gap-1.5 cursor-pointer text-[11px] font-semibold text-white/55 py-1 px-2 rounded-[var(--radius-pill)] bg-white/5 hover:bg-white/10 hover:text-white transition-all duration-150${expanded ? ' [&>.arrow]:rotate-90 text-white/80' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shrink-0 opacity-60" />
        <span>思考过程 · {thinkingTime}s</span>
        {toolEvents && toolEvents.length > 0 && <span className="text-[10px] text-white/40 ml-1">({toolEvents.length} 个工具)</span>}
        <span className="arrow inline-block text-[7px] rotate-0 transition-transform duration-150 leading-none">▶</span>
      </div>
      {expanded && toolEvents && toolEvents.length > 0 && (
        <div className="mt-1.5 pl-3 border-l border-white/10 w-full animate-fade-in">
          <ToolRows events={toolEvents} />
        </div>
      )}
    </div>
  );
}

