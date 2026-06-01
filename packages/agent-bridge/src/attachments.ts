import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentAttachment, AgentContextEnvelope } from '@openmagicpointer/core';

export function materializeAttachmentFiles(envelope: AgentContextEnvelope): AgentContextEnvelope {
  const attachments = envelope.attachments.map((attachment, index) => materializeAttachment(attachment, envelope.requestId, index));
  return { ...envelope, attachments };
}

function materializeAttachment(attachment: AgentAttachment, requestId: string, index: number): AgentAttachment {
  if (attachment.tempPath || !attachment.dataUrl) return attachment;
  const parsed = parseDataUrl(attachment.dataUrl);
  if (!parsed) return attachment;
  const dir = join(tmpdir(), 'openmagicpointer', 'attachments', sanitizePathPart(requestId));
  mkdirSync(dir, { recursive: true });
  const extension = attachment.mimeType === 'image/png' ? 'png' : 'jpg';
  const scope = sanitizePathPart(attachment.scope ?? `attachment-${index}`);
  const tempPath = join(dir, `${index + 1}-${scope}.${extension}`);
  writeFileSync(tempPath, parsed);
  return { ...attachment, tempPath };
}

function parseDataUrl(dataUrl: string): Buffer | undefined {
  const match = /^data:[^;]+;base64,(.+)$/s.exec(dataUrl);
  if (!match) return undefined;
  const payload = match[1];
  return payload ? Buffer.from(payload, 'base64') : undefined;
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'attachment';
}
