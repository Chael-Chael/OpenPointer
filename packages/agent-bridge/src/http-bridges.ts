import type { AgentContextEnvelope, AgentEvent } from '@openmagicpointer/core';
import { buildAgentInput, buildAgentInstructions, buildToolDiscoveryEvent } from './prompt.js';
import { postRunAndStream } from './http-stream.js';
import type { AgentBridge, AgentRunOptions, HttpAgentBridgeConfig } from './types.js';

export class HermesBridge implements AgentBridge {
  id = 'hermes' as const;

  constructor(private readonly config: HttpAgentBridgeConfig | undefined) {}

  async *run(envelope: AgentContextEnvelope, options: AgentRunOptions = {}): AsyncIterable<AgentEvent> {
    yield buildToolDiscoveryEvent(envelope);
    yield* postRunAndStream({
      backend: this.id,
      baseUrl: this.config?.baseUrl ?? '',
      apiKey: this.config?.apiKey,
      fetch: this.config?.fetch,
      signal: options.signal,
      path: '/runs',
      body: {
        input: buildAgentInput(envelope),
        instructions: buildAgentInstructions(envelope),
        session_id: options.sessionKey,
        metadata: {
          requestId: envelope.requestId,
          source: 'openmagicpointer'
        },
        attachments: envelope.attachments.map((attachment) => ({
          type: attachment.type,
          mime_type: attachment.mimeType,
          data_url: attachment.dataUrl,
          temp_path: attachment.tempPath,
          crop: attachment.crop
        }))
      }
    });
  }
}

export class OpenCodeBridge implements AgentBridge {
  id = 'opencode' as const;

  constructor(private readonly config: HttpAgentBridgeConfig | undefined) {}

  async *run(envelope: AgentContextEnvelope, options: AgentRunOptions = {}): AsyncIterable<AgentEvent> {
    yield buildToolDiscoveryEvent(envelope);
    yield* postRunAndStream({
      backend: this.id,
      baseUrl: this.config?.baseUrl ?? '',
      apiKey: this.config?.apiKey,
      fetch: this.config?.fetch,
      signal: options.signal,
      path: '/runs',
      body: {
        prompt: `${buildAgentInstructions(envelope)}\n\n${buildAgentInput(envelope)}`,
        sessionKey: options.sessionKey,
        metadata: { requestId: envelope.requestId }
      }
    });
  }
}

export class CodexBridge implements AgentBridge {
  id = 'codex' as const;

  constructor(private readonly config: HttpAgentBridgeConfig | undefined) {}

  async *run(envelope: AgentContextEnvelope, options: AgentRunOptions = {}): AsyncIterable<AgentEvent> {
    if (!this.config?.baseUrl) {
      yield { type: 'run.failed', error: 'Codex app-server is not configured. Set OMP_CODEX_APP_SERVER_URL for coding workflows.', recoverable: true };
      return;
    }
    yield buildToolDiscoveryEvent(envelope);
    yield* postRunAndStream({
      backend: this.id,
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      fetch: this.config.fetch,
      signal: options.signal,
      path: '/runs',
      body: {
        thread: options.sessionKey,
        input: buildAgentInput(envelope),
        instructions: buildAgentInstructions(envelope),
        metadata: { requestId: envelope.requestId, workflow: 'coding' }
      }
    });
  }
}
