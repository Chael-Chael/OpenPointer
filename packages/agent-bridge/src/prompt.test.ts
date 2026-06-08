import { describe, expect, it } from 'vitest';
import type { AgentContextEnvelope, PointerContext } from '@openpointer/core';
import { buildAgentContextEnvelope } from './routing.js';
import { buildAgentInstructions, buildToolDiscoveryEvent } from './prompt.js';

const context: PointerContext = {
  id: 'ctx',
  source: 'desktop',
  cursor: { x: 1, y: 2, localX: 1, localY: 2, displayId: 1, dpr: 1 },
  entities: [],
  nearby: [],
  createdAt: 1
};

function envelope(): AgentContextEnvelope {
  const built = buildAgentContextEnvelope({
    instruction: 'summarize this paper',
    mode: 'text',
    context,
    backend: 'codex'
  });
  built.capabilityHints = {
    mcp: [
      {
        id: 'mcp-zotero',
        kind: 'mcp',
        name: 'zotero',
        description: 'Reference manager MCP',
        backendIds: ['codex'],
        sources: ['native'],
        matchedKeywords: ['paper']
      }
    ],
    skills: [
      {
        id: 'skill-paper-reader',
        kind: 'skill',
        name: 'paper-reader',
        description: 'Read and summarize academic papers.',
        backendIds: ['codex'],
        sources: ['native', 'cc-switch'],
        matchedKeywords: ['paper']
      }
    ]
  };
  return built;
}

describe('capability hints in prompts', () => {
  it('adds context-matched capabilities to the discovery event', () => {
    const event = buildToolDiscoveryEvent(envelope());
    expect(event.tools).toContain('mcp:zotero');
    expect(event.skills).toContain('paper-reader');
  });

  it('formats capability hints without raw MCP config fields', () => {
    const instructions = buildAgentInstructions(envelope());
    expect(instructions).toContain('Context-matched capability hints');
    expect(instructions).toContain('paper-reader');
    expect(instructions).not.toContain('server_config');
    expect(instructions).not.toContain('env');
  });
});
