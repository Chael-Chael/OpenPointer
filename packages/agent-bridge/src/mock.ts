import type { AgentContextEnvelope, AgentEvent } from '@openmagicpointer/core';
import type { AgentBridge, AgentRunOptions } from './types.js';

export class MockAgentBridge implements AgentBridge {
  id = 'mock' as const;

  async *run(envelope: AgentContextEnvelope, _options: AgentRunOptions = {}): AsyncIterable<AgentEvent> {
    const runId = `mock-${Date.now()}`;
    yield { type: 'run.started', runId, backend: this.id };
    yield {
      type: 'tool.discovery',
      tools: envelope.routing.preferredTools,
      skills: envelope.routing.preferredTools.filter((tool) => tool.includes('skill')),
      message: 'Agent may use available MCP tools, skills, or CUA depending on backend configuration.'
    };
    yield { type: 'assistant.delta', text: `Received: ${envelope.instruction.text}` };
    if (envelope.cuaDirective?.enabled) {
      yield { type: 'tool.started', name: 'cua', input: envelope.cuaDirective.target };
      yield { type: 'approval.requested', id: `approval-${Date.now()}`, reason: 'Mock agent requests approval before desktop control.', tool: 'cua' };
      yield { type: 'tool.completed', name: 'cua', output: { simulated: true } };
    }
    yield { type: 'run.completed', text: 'Mock run completed.' };
  }
}
