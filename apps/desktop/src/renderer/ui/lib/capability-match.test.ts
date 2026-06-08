import { describe, expect, it } from 'vitest';
import type { CapabilitySnapshot } from '@openpointer/core';
import { matchCapabilitySnapshot } from './capability-match';

const snapshot: CapabilitySnapshot = {
  status: 'ready',
  lastScannedAt: 1,
  sources: ['native'],
  mcp: [
    {
      id: 'zotero',
      kind: 'mcp',
      name: 'zotero',
      description: 'Reference manager MCP',
      backendIds: ['codex'],
      sources: ['native'],
      tags: ['paper']
    },
    {
      id: 'figma',
      kind: 'mcp',
      name: 'figma',
      description: 'Design handoff MCP',
      backendIds: ['opencode'],
      sources: ['native']
    }
  ],
  skills: [
    {
      id: 'paper-reader',
      kind: 'skill',
      name: 'paper-reader',
      description: 'Read and summarize academic papers.',
      backendIds: ['codex'],
      sources: ['native'],
      triggers: ['selected paragraph']
    }
  ]
};

describe('matchCapabilitySnapshot', () => {
  it('matches by backend and context keywords', () => {
    const matched = matchCapabilitySnapshot(snapshot, 'codex', 'summarize this paper');
    expect(matched.mcp.map((item) => item.name)).toEqual(['zotero']);
    expect(matched.skills.map((item) => item.name)).toEqual(['paper-reader']);
  });

  it('does not show capabilities for another selected backend', () => {
    const matched = matchCapabilitySnapshot(snapshot, 'opencode', 'summarize this paper');
    expect(matched.mcp).toEqual([]);
    expect(matched.skills).toEqual([]);
  });

  it('matches skill triggers in addition to descriptions and tags', () => {
    const matched = matchCapabilitySnapshot(snapshot, 'codex', 'polish the selected paragraph');
    expect(matched.skills.map((item) => item.name)).toEqual(['paper-reader']);
    expect(matched.skills[0]?.matchedKeywords).toContain('selected');
  });
});
