import { describe, expect, it } from 'vitest';
import type { PointerContext } from '@openpointer/core';
import { buildAgentContextEnvelope } from './routing.js';

const context: PointerContext = {
  id: 'ctx-test',
  source: 'desktop',
  cursor: { x: 100, y: 200, localX: 100, localY: 200, displayId: 1, dpr: 1 },
  window: { title: 'Research Notes', app: 'PaperApp', process: 'paperapp.exe' },
  target: {
    id: 'entity-1',
    kind: 'text',
    text: 'Selected row',
    bbox: { x: 80, y: 180, width: 240, height: 40 },
    confidence: 0.8,
    origin: 'manual'
  },
  entities: [],
  visual: {
    screenshotId: 'screen-1',
    crop: { x: 0, y: 0, width: 600, height: 400 },
    imageBase64: 'abc',
    mimeType: 'image/jpeg'
  },
  nearby: [],
  createdAt: 1
};

describe('buildAgentContextEnvelope', () => {
  it('creates a generic envelope without app-specific tool hardcoding', () => {
    const envelope = buildAgentContextEnvelope({
      instruction: 'What is this?',
      mode: 'text',
      context
    });
    expect(envelope.schemaVersion).toBe('openpointer.agent-context.v1');
    expect(envelope.routing.preferredTools).toEqual(['app-specific-mcp', 'document-skill', 'screen-skill']);
    expect(envelope.routing.preferredTools.join(',')).not.toMatch(/zotero/i);
    expect(envelope.attachments[0]?.dataUrl).toContain('data:image/jpeg;base64,abc');
  });

  it('attaches the full window screenshot alongside the pointer screenshot', () => {
    const envelope = buildAgentContextEnvelope({
      instruction: 'Analyze this window',
      mode: 'text',
      context: {
        ...context,
        windowSnapshot: {
          screenshotId: 'window-1',
          bounds: { x: 20, y: 40, width: 900, height: 700 },
          imageBase64: 'window-abc',
          mimeType: 'image/jpeg'
        }
      }
    });
    expect(envelope.attachments).toHaveLength(2);
    expect(envelope.attachments.map((attachment) => attachment.scope)).toEqual(['pointer', 'window']);
    expect(envelope.attachments[1]?.dataUrl).toContain('data:image/jpeg;base64,window-abc');
    expect(envelope.attachments[1]?.crop).toEqual({ x: 20, y: 40, width: 900, height: 700 });
  });

  it('adds a CUA directive for explicit desktop operation intent', () => {
    const envelope = buildAgentContextEnvelope({
      instruction: 'merge these selected items',
      mode: 'text',
      context
    });
    expect(envelope.routing.toolPolicy).toBe('prefer');
    expect(envelope.cuaDirective?.mode).toBe('prefer');
    expect(envelope.cuaDirective?.target?.bbox).toEqual(context.target?.bbox);
  });

  it('adds a CUA directive for Chinese desktop operation intent', () => {
    const envelope = buildAgentContextEnvelope({
      instruction: '\u70b9\u51fb\u8fd9\u4e2a\u6309\u94ae',
      mode: 'text',
      context
    });
    expect(envelope.routing.toolPolicy).toBe('prefer');
    expect(envelope.cuaDirective?.mode).toBe('prefer');
  });

  it('requires CUA only for explicit force wording', () => {
    const envelope = buildAgentContextEnvelope({
      instruction: '\u76f4\u63a5\u64cd\u4f5c\u8fd9\u4e2a\u7a97\u53e3\uff0c\u5f3a\u5236 CUA \u70b9\u51fb\u8fd9\u4e2a',
      mode: 'voice',
      context
    });
    expect(envelope.routing.toolPolicy).toBe('require');
    expect(envelope.cuaDirective?.mode).toBe('require');
  });
});
