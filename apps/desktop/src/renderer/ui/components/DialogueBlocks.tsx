import { useState } from 'react';
import { MarkdownRenderer } from '../MarkdownRenderer';
import type { DialogueBlock } from '../lib/dialogue-parser';

function DialogueReasoningBlock({ text, isRunning }: { text: string; isRunning: boolean }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="flex flex-col w-full rounded-[var(--radius-pill)] border border-white/10 bg-white/5 overflow-hidden animate-fade-in select-none my-1">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/5 transition-all duration-150" onClick={() => setExpanded(!expanded)}>
        <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-md bg-cyan-500/20 text-cyan-400">
          {isRunning ? (
            <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.2px] border-cyan-400 border-t-transparent" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-3.12 3 3 0 0 1 0-4.88 2.5 2.5 0 0 1 0-3.12A2.5 2.5 0 0 1 9.5 2Z" />
              <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-3.12 3 3 0 0 0 0-4.88 2.5 2.5 0 0 0 0-3.12A2.5 2.5 0 0 0 14.5 2Z" />
            </svg>
          )}
        </span>
        <span className="text-[11.5px] font-semibold text-white/80">思考过程</span>
        {isRunning && <span className="text-[9px] font-bold text-cyan-400 animate-pulse ml-auto uppercase tracking-wider">Thinking</span>}
        <span className={`arrow text-[8px] text-white/40 transition-transform duration-150 leading-none ml-auto ${expanded ? 'rotate-90' : 'rotate-0'}`}>
          ▶
        </span>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-white/5 max-h-[220px] overflow-y-auto pr-1 scrollbar-thin text-xs text-white/55 leading-relaxed break-words font-sans select-text selection:bg-white/10">
          <MarkdownRenderer value={text} />
        </div>
      )}
    </div>
  );
}

export function DialogueBlocksRenderer({ blocks }: { blocks: DialogueBlock[] }) {
  if (!blocks || blocks.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 w-full">
      {blocks.map((block, idx) => {
        if (block.type === 'text') {
          return (
            <article key={idx} className="agent-text text-sm markdown-body w-full animate-fade-in">
              <MarkdownRenderer value={block.text} />
            </article>
          );
        } else if (block.type === 'reasoning') {
          return <DialogueReasoningBlock key={idx} text={block.text} isRunning={block.isRunning} />;
        } else if (block.type === 'tool') {
          const isRunning = !block.completedEvent;
          return (
            <div
              key={idx}
              className="flex items-center gap-2 rounded-[var(--radius-pill)] border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] transition-all duration-150 animate-fade-in select-none w-full"
            >
              <span className="relative inline-flex h-3 w-3 shrink-0 items-center justify-center">
                {isRunning ? (
                  <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.2px] border-white/60 border-t-transparent" />
                ) : (
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-emerald-400" fill="none">
                    <path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="font-semibold text-white/95 truncate">{block.name}</span>
              <span className="text-[9px] text-white/55 font-bold ml-auto uppercase tracking-wider">{isRunning ? 'Running' : 'Done'}</span>
            </div>
          );
        } else if (block.type === 'discovery') {
          return (
            <p key={idx} className="tool-discovery text-white/60 text-[13px] leading-relaxed animate-fade-in">
              {block.message}
            </p>
          );
        }
        return null;
      })}
    </div>
  );
}

