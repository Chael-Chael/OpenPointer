import type { ReactNode } from 'react';
import { clampNumber } from '@openmagicpointer/core';
import type { AgentEvent } from '@openmagicpointer/core';
import type { CursorPayload } from '../../../shared/types';
import type { BackendReadiness } from '../state';

export function HoldRing({ cursor, progress }: { cursor: CursorPayload; progress: number }) {
  const radius = 12;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className="hold-ring" style={{ transform: `translate3d(${cursor.localX - 16}px, ${cursor.localY - 16}px, 0)` }} viewBox="0 0 32 32">
      <circle className="hold-ring-track" cx="16" cy="16" r={radius} />
      <circle className="hold-ring-progress" cx="16" cy="16" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} />
    </svg>
  );
}

export function ToolRows({ events }: { events: Array<Extract<AgentEvent, { type: 'tool.started' | 'tool.completed' }>> }) {
  if (!events || events.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 mt-2 w-full select-none">
      {events.map((event, index) => {
        const isRunning = event.type === 'tool.started';
        return (
          <div
            key={`${event.type}-${index}`}
            className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] transition-all duration-150 animate-fade-in"
          >
            {/* 状态图示 */}
            <span className="relative inline-flex h-3 w-3 shrink-0 items-center justify-center">
              {isRunning ? (
                <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.2px] border-white/60 border-t-transparent" />
              ) : (
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-emerald-400" fill="none">
                  <path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            {/* 工具名称 */}
            <span className="font-semibold text-white/95 truncate">
              {event.name}
            </span>
            {/* 状态右文本 */}
            <span className="text-[9px] text-white/55 font-bold ml-auto uppercase tracking-wider">
              {isRunning ? 'Running' : 'Done'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function BackendCard({ title, status, children }: { title: string; status: BackendReadiness; children: ReactNode }) {
  return (
    <section className="backend-card">
      <header>
        <div>
          <h3 className="font-instrument text-xl font-normal text-white">{title}</h3>
          <p>{status.detail}</p>
        </div>
        <span className={`config-status tone-${status.tone}`}>{status.label}</span>
      </header>
      <div className="backend-fields">{children}</div>
    </section>
  );
}

export function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange(value: string): void; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

export function NumberSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange(value: number): void;
}) {
  function commit(rawValue: string) {
    onChange(clampNumber(Number(rawValue), min, max, value));
  }

  return (
    <label className="field slider-field">
      <span>
        {label}
        <em>
          {value}
          {unit}
        </em>
      </span>
      <div className="slider-row">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => commit(event.target.value)} />
        <input type="number" min={min} max={max} step={step} value={value} onChange={(event) => commit(event.target.value)} />
      </div>
    </label>
  );
}

export function SecretField({
  label,
  value,
  configured,
  clearQueued,
  onChange,
  onClear
}: {
  label: string;
  value: string;
  configured: boolean;
  clearQueued: boolean;
  onChange(value: string): void;
  onClear(): void;
}) {
  return (
    <label className="field secret-field">
      <span>
        {label}
        <em>{clearQueued ? 'Will clear' : configured ? 'Configured' : 'Not configured'}</em>
      </span>
      <div className="secret-row">
        <input
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={configured && !clearQueued ? 'Configured - paste to replace' : 'Paste key or token'}
        />
        <button type="button" onClick={onClear} disabled={!configured && !value}>
          Clear
        </button>
      </div>
    </label>
  );
}
