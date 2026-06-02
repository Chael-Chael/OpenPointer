import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAgentInput } from './prompt.js';
import { buildAgentContextEnvelope } from './routing.js';
import { materializeAttachmentFiles } from './attachments.js';
import type { PointerContext } from '@openpointer/core';

const onePixelJpegBase64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2w==';

describe('materializeAttachmentFiles', () => {
  it('writes screenshot attachments to local image files for text-only agent bridges', () => {
    const context: PointerContext = {
      id: 'ctx',
      source: 'desktop',
      cursor: { x: 1, y: 2, localX: 1, localY: 2, displayId: 1, dpr: 1 },
      window: { title: 'Paper', app: 'Browser' },
      entities: [],
      visual: {
        screenshotId: 'screen',
        crop: { x: 0, y: 0, width: 10, height: 10 },
        imageBase64: onePixelJpegBase64,
        mimeType: 'image/jpeg'
      },
      windowSnapshot: {
        screenshotId: 'window',
        bounds: { x: 0, y: 0, width: 100, height: 80 },
        imageBase64: onePixelJpegBase64,
        mimeType: 'image/jpeg'
      },
      nearby: [],
      createdAt: 1
    };

    const envelope = materializeAttachmentFiles(buildAgentContextEnvelope({ instruction: 'explain this', mode: 'text', context }));
    expect(envelope.attachments).toHaveLength(2);
    expect(envelope.attachments.every((attachment) => attachment.tempPath && existsSync(attachment.tempPath))).toBe(true);
    expect(buildAgentInput(envelope)).toContain('file=');
    expect(buildAgentInput(envelope)).toContain('read that local image file');
  });
});
