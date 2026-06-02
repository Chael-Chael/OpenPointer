import type { AgentContextEnvelope, AgentEvent } from '@openpointer/core';
import { materializeAttachmentFiles } from './attachments.js';
import { buildAgentInput, buildAgentInstructions, buildToolDiscoveryEvent } from './prompt.js';
import { postRunAndStream } from './http-stream.js';
import type { AgentBridge, AgentRunOptions, HttpAgentBridgeConfig } from './types.js';

export class HermesBridge implements AgentBridge {
  id = 'hermes' as const;

  constructor(private readonly config: HttpAgentBridgeConfig | undefined) {}

  async *run(envelope: AgentContextEnvelope, options: AgentRunOptions = {}): AsyncIterable<AgentEvent> {
    const runEnvelope = materializeAttachmentFiles(envelope);
    yield buildToolDiscoveryEvent(envelope);
    yield* postRunAndStream({
      backend: this.id,
      baseUrl: this.config?.baseUrl ?? '',
      apiKey: this.config?.apiKey,
      fetch: this.config?.fetch,
      signal: options.signal,
      path: '/runs',
      body: {
        input: buildAgentInput(runEnvelope),
        instructions: buildAgentInstructions(runEnvelope),
        session_id: options.sessionKey,
        metadata: {
          requestId: runEnvelope.requestId,
          source: 'openpointer'
        },
        attachments: runEnvelope.attachments.map((attachment) => ({
          type: attachment.type,
          scope: attachment.scope,
          label: attachment.label,
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
    const runEnvelope = materializeAttachmentFiles(envelope);
    yield buildToolDiscoveryEvent(envelope);
    yield* postRunAndStream({
      backend: this.id,
      baseUrl: this.config?.baseUrl ?? '',
      apiKey: this.config?.apiKey,
      fetch: this.config?.fetch,
      signal: options.signal,
      path: '/runs',
      body: {
        prompt: `${buildAgentInstructions(runEnvelope)}\n\n${buildAgentInput(runEnvelope)}`,
        sessionKey: options.sessionKey,
        metadata: { requestId: runEnvelope.requestId },
        attachments: runEnvelope.attachments.map((attachment) => ({
          type: attachment.type,
          scope: attachment.scope,
          label: attachment.label,
          mime_type: attachment.mimeType,
          data_url: attachment.dataUrl,
          temp_path: attachment.tempPath,
          crop: attachment.crop
        }))
      }
    });
  }
}

export class CodexBridge implements AgentBridge {
  id = 'codex' as const;

  constructor(private readonly config: HttpAgentBridgeConfig | undefined) {}

  async *run(envelope: AgentContextEnvelope, options: AgentRunOptions = {}): AsyncIterable<AgentEvent> {
    if (!this.config?.baseUrl) {
      yield { type: 'run.failed', error: 'Codex app-server is not configured. Set OP_CODEX_APP_SERVER_URL for coding workflows.', recoverable: true };
      return;
    }
    const runEnvelope = materializeAttachmentFiles(envelope);
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
        input: buildAgentInput(runEnvelope),
        instructions: buildAgentInstructions(runEnvelope),
        metadata: { requestId: runEnvelope.requestId, workflow: 'coding' },
        attachments: runEnvelope.attachments.map((attachment) => ({
          type: attachment.type,
          scope: attachment.scope,
          label: attachment.label,
          mime_type: attachment.mimeType,
          data_url: attachment.dataUrl,
          temp_path: attachment.tempPath,
          crop: attachment.crop
        }))
      }
    });
  }
}
