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
  return (
    <div className="tool-rows">
      {events.map((event, index) => (
        <div key={`${event.type}-${index}`}>
          <span>{event.type === 'tool.started' ? 'Using' : 'Finished'}</span>
          <strong>{event.name}</strong>
        </div>
      ))}
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
