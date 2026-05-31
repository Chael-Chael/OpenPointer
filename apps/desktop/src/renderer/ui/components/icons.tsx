import type { AgentBackendId } from '@openmagicpointer/core';
import { backendLabel } from '../lib/backend-status';

import claudeSvg from '../../assets/claude-color.svg?raw';
import codexSvg from '../../assets/codex-color.svg?raw';
import hermesSvg from '../../assets/hermesagent.svg?raw';
import openaiSvg from '../../assets/openai.svg?raw';
import opencodeSvg from '../../assets/opencode.svg?raw';

function SvgIcon({ svg, size }: { svg: string; size: number }) {
  const rendered = svg
    .replace(/width="[^"]*"/, `width="${size}"`)
    .replace(/height="[^"]*"/, `height="${size}"`);
  return (
    <span
      style={{ width: size, height: size, display: 'inline-flex', flexShrink: 0, lineHeight: 1 }}
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
}

export function ArrowMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

export function SettingsMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
      <path d="M18.7 13.2c.1-.4.1-.8.1-1.2s0-.8-.1-1.2l2-1.5-2-3.4-2.4 1a8.2 8.2 0 0 0-2.1-1.2L14 3h-4l-.3 2.7c-.8.3-1.5.7-2.1 1.2l-2.4-1-2 3.4 2 1.5c-.1.4-.1.8-.1 1.2s0 .8.1 1.2l-2 1.5 2 3.4 2.4-1c.6.5 1.3.9 2.1 1.2L10 21h4l.3-2.7c.8-.3 1.5-.7 2.1-1.2l2.4 1 2-3.4-2.1-1.5Z" />
    </svg>
  );
}

function AutoIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function MockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

export function getBackendIcon(backend: AgentBackendId, size = 12) {
  switch (backend) {
    case 'codex':
      return <SvgIcon svg={codexSvg} size={size} />;
    case 'local-vlm':
      return <SvgIcon svg={openaiSvg} size={size} />;
    case 'claude-agent':
      return <SvgIcon svg={claudeSvg} size={size} />;
    case 'hermes':
      return <SvgIcon svg={hermesSvg} size={size} />;
    case 'opencode':
      return <SvgIcon svg={opencodeSvg} size={size} />;
    case 'auto':
      return <AutoIcon size={size} />;
    case 'mock':
      return <MockIcon size={size} />;
    default:
      return <AutoIcon size={size} />;
  }
}
