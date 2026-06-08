import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
    if (!this.config?.baseUrl?.trim()) {
      yield { type: 'run.failed', error: 'opencode backend is not configured.', recoverable: true };
      return;
    }

    const runEnvelope = materializeAttachmentFiles(envelope);
    yield buildToolDiscoveryEvent(envelope);

    const fetcher = this.config.fetch ?? fetch;
    const baseUrl = this.config.baseUrl.replace(/\/$/, '');
    const model = parseOpenCodeModel(this.config.model);

    try {
      const sessionId =
        options.backendSessionId && options.backendSessionId.startsWith('ses_')
          ? options.backendSessionId
          : await createOpenCodeSession({
              baseUrl,
              fetcher,
              apiKey: this.config.apiKey,
              signal: options.signal,
              cwd: this.config.cwd,
              model,
              requestId: runEnvelope.requestId
            });

      yield { type: 'run.started', runId: sessionId, backend: this.id };
      if (!options.backendSessionId) yield { type: 'backend.session', backend: this.id, sessionId };

      const response = await fetcher(`${baseUrl}/session/${encodeURIComponent(sessionId)}/message`, {
        method: 'POST',
        headers: openCodeHeaders(this.config.apiKey),
        body: JSON.stringify({
          ...(model ? { model: { providerID: model.providerID, modelID: model.modelID } } : {}),
          parts: [
            {
              type: 'text',
              text: `${buildAgentInstructions(runEnvelope)}\n\n${buildAgentInput(runEnvelope)}`
            }
          ]
        }),
        signal: options.signal
      });

      if (!response.ok) {
        yield { type: 'run.failed', error: `opencode message request failed with ${response.status}: ${await readResponseText(response)}`, recoverable: true };
        return;
      }

      const message = (await response.json().catch(() => ({}))) as OpenCodeMessageResponse;
      let text = '';
      for (const part of message.parts ?? []) {
        if (part?.type === 'text' && typeof part.text === 'string') {
          text += part.text;
          yield { type: 'assistant.delta', text: part.text };
        }
        if (part?.type === 'tool' && typeof part.tool === 'string') {
          yield { type: 'tool.completed', name: part.tool, output: part };
        }
      }

      const error = message.info?.error;
      if (error) {
        yield { type: 'run.failed', error: typeof error === 'string' ? error : JSON.stringify(error), recoverable: true };
        return;
      }

      yield { type: 'run.completed', text: text || undefined };
    } catch (error) {
      yield { type: 'run.failed', error: error instanceof Error ? error.message : String(error), recoverable: true };
    }
  }
}

export class OpenClawBridge implements AgentBridge {
  id = 'openclaw' as const;

  constructor(private readonly config: (HttpAgentBridgeConfig & { agent?: string; executableArgs?: string[] }) | undefined) {}

  async *run(envelope: AgentContextEnvelope, options: AgentRunOptions = {}): AsyncIterable<AgentEvent> {
    if (!this.config?.baseUrl?.trim()) {
      yield { type: 'run.failed', error: 'openclaw backend is not configured.', recoverable: true };
      return;
    }

    const runEnvelope = materializeAttachmentFiles(envelope);
    yield buildToolDiscoveryEvent(envelope);

    const agent = this.config.agent?.trim() || 'main';
    const sessionKey = options.backendSessionId || `agent:${agent}:${options.sessionKey || runEnvelope.requestId}`;
    yield { type: 'run.started', runId: sessionKey, backend: this.id };
    if (!options.backendSessionId) yield { type: 'backend.session', backend: this.id, sessionId: sessionKey };

    try {
      const command = resolveOpenClawCommand(this.config.executablePath, this.config.executableArgs);
      const result = await runOpenClawAgent({
        executable: command.executable,
        executableArgs: command.executableArgs,
        cwd: this.config.cwd,
        gatewayUrl: this.config.baseUrl,
        agent,
        sessionKey,
        model: this.config.model,
        timeoutMs: this.config.timeoutMs,
        signal: options.signal,
        message: `${buildAgentInstructions(runEnvelope)}\n\n${buildAgentInput(runEnvelope)}`
      });
      if (result.text) yield { type: 'assistant.delta', text: result.text };
      yield { type: 'run.completed', text: result.text || undefined };
    } catch (error) {
      yield { type: 'run.failed', error: error instanceof Error ? error.message : String(error), recoverable: true };
    }
  }
}

type OpenCodeModel = {
  providerID: string;
  modelID: string;
};

type OpenCodeMessageResponse = {
  info?: {
    error?: unknown;
  };
  parts?: Array<{
    type?: string;
    text?: string;
    tool?: string;
    [key: string]: unknown;
  }>;
};

async function createOpenCodeSession(args: {
  baseUrl: string;
  fetcher: typeof fetch;
  apiKey?: string;
  signal?: AbortSignal;
  cwd?: string;
  model?: OpenCodeModel;
  requestId: string;
}): Promise<string> {
  const url = new URL(`${args.baseUrl}/session`);
  if (args.cwd) url.searchParams.set('directory', args.cwd);
  const response = await args.fetcher(url.toString(), {
    method: 'POST',
    headers: openCodeHeaders(args.apiKey),
    body: JSON.stringify({
      title: 'OpenPointer',
      metadata: { requestId: args.requestId, source: 'openpointer' },
      ...(args.model ? { model: { providerID: args.model.providerID, id: args.model.modelID } } : {})
    }),
    signal: args.signal
  });

  if (!response.ok) throw new Error(`opencode session request failed with ${response.status}: ${await readResponseText(response)}`);
  const session = (await response.json().catch(() => ({}))) as { id?: unknown };
  if (typeof session.id !== 'string' || !session.id) throw new Error('opencode session response did not include an id.');
  return session.id;
}

function parseOpenCodeModel(model: string | undefined): OpenCodeModel | undefined {
  if (!model) return undefined;
  const slash = model.indexOf('/');
  if (slash <= 0 || slash === model.length - 1) return undefined;
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
}

function openCodeHeaders(apiKey: string | undefined): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
  };
}

async function readResponseText(response: Response): Promise<string> {
  return (await response.text().catch(() => '')).slice(0, 400);
}

type OpenClawAgentResult = {
  text: string;
};

async function runOpenClawAgent(args: {
  executable: string;
  executableArgs?: string[];
  cwd?: string;
  gatewayUrl: string;
  agent: string;
  sessionKey: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  message: string;
}): Promise<OpenClawAgentResult> {
  const timeoutSeconds = Math.max(1, Math.ceil((args.timeoutMs ?? 600000) / 1000));
  const cliArgs = [
    ...(args.executableArgs ?? []),
    'agent',
    '--agent',
    args.agent,
    '--session-key',
    args.sessionKey,
    '--message',
    args.message,
    '--json',
    '--timeout',
    String(timeoutSeconds)
  ];
  if (args.model?.trim()) cliArgs.push('--model', args.model.trim());

  return new Promise((resolve, reject) => {
    const child = spawn(args.executable, cliArgs, {
      cwd: args.cwd,
      windowsHide: true,
      shell: shouldUseShellForExecutable(args.executable),
      env: process.env
    });
    let stdout = '';
    let stderr = '';

    const abort = () => {
      child.kill();
      reject(new Error('openclaw run was aborted.'));
    };
    if (args.signal?.aborted) {
      abort();
      return;
    }
    args.signal?.addEventListener('abort', abort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      args.signal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.on('close', (code) => {
      args.signal?.removeEventListener('abort', abort);
      if (code !== 0) {
        reject(new Error(`openclaw agent exited with ${code}: ${stderr || stdout}`.trim().slice(0, 1200)));
        return;
      }
      try {
        const json = parseLastJsonObject(stdout);
        resolve({ text: extractOpenClawText(json) || stdout.trim() });
      } catch {
        resolve({ text: stdout.trim() });
      }
    });
  });
}

function parseLastJsonObject(text: string): unknown {
  for (let index = text.lastIndexOf('{'); index >= 0; index = text.lastIndexOf('{', index - 1)) {
    try {
      return JSON.parse(text.slice(index));
    } catch {
      // Keep scanning; OpenClaw may print status lines before its JSON payload.
    }
  }
  throw new Error('No JSON object found in OpenClaw output.');
}

function extractOpenClawText(value: unknown): string {
  const direct = extractTextField(value);
  if (direct) return direct;
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of ['payload', 'payloads', 'result', 'reply', 'message', 'output', 'data']) {
    const nested = extractOpenClawText(record[key]);
    if (nested) return nested;
  }
  return '';
}

function extractTextField(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractOpenClawText).filter(Boolean).join('');
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of ['text', 'content', 'answer', 'response']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return '';
}

function resolveOpenClawCommand(executablePath: string | undefined, executableArgs: string[] | undefined): { executable: string; executableArgs: string[] } {
  const explicit = executablePath?.trim();
  if (explicit) return { executable: explicit, executableArgs: executableArgs ?? [] };
  if (process.platform === 'win32') {
    const npmOpenClaw = join(process.env.APPDATA || '', 'npm', 'node_modules', 'openclaw', 'openclaw.mjs');
    if (existsSync(npmOpenClaw)) return { executable: 'node', executableArgs: [npmOpenClaw, ...(executableArgs ?? [])] };
  }
  return { executable: 'openclaw', executableArgs: executableArgs ?? [] };
}

function shouldUseShellForExecutable(executable: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
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
        thread: options.backendSessionId ?? options.sessionKey,
        input: buildAgentInput(runEnvelope),
        instructions: buildAgentInstructions(runEnvelope),
        cwd: this.config.cwd ?? process.cwd(),
        model: this.config.model,
        effort: this.config.effort,
        sandbox: this.config.sandbox ?? 'workspace-write',
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
