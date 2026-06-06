import type { AgentContextEnvelope, CuaDirective, PointerContext } from '@openpointer/core';

const TOOL_DISCOVERY_MESSAGE = 'Agent may use available MCP tools, skills, or CUA depending on backend configuration.';

export function buildToolDiscoveryEvent(envelope: AgentContextEnvelope) {
  const skills = envelope.routing.preferredTools.filter((tool) => tool.includes('skill')).map((tool) => tool.replace(/-/g, ' '));
  const serverTools = envelope.toolServers?.flatMap((server) => server.tools.map((tool) => `${server.id}:${tool}`)) ?? [];
  return {
    type: 'tool.discovery' as const,
    tools: [...envelope.routing.preferredTools, ...serverTools],
    skills,
    message: TOOL_DISCOVERY_MESSAGE
  };
}

export function buildAgentInstructions(envelope: AgentContextEnvelope): string {
  const cues = [
    'You are receiving a desktop pointer context from OpenPointer.',
    'Treat the user instruction text as the primary intent.',
    'Use screenshots as visual evidence and CUA grounding as structured UI evidence/action references.',
    'If text, screenshot, and CUA disagree, follow the user instruction and explain the uncertainty instead of inventing missing state.',
    'Do not assume OpenPointer can execute actions locally.',
    'If useful, discover and use configured MCP tools, skills, or CUA tools in your own runtime.',
    'If a desktop-control action can change state, request approval before proceeding.',
    `Tool policy: ${envelope.routing.toolPolicy}.`,
    envelope.routing.preferredTools.length > 0 ? `Preferred tools: ${envelope.routing.preferredTools.join(', ')}.` : '',
    envelope.routing.requiredCapabilities.length > 0 ? `Required capabilities: ${envelope.routing.requiredCapabilities.join(', ')}.` : '',
    envelope.toolServers?.length ? formatToolServers(envelope.toolServers) : '',
    envelope.cuaDirective ? formatCuaDirective(envelope.cuaDirective) : ''
  ];
  return cues.filter(Boolean).join('\n');
}

export function buildAgentInput(envelope: AgentContextEnvelope): string {
  return [
    `User instruction (primary text): ${envelope.instruction.text}`,
    '',
    'Multimodal context bundle:',
    JSON.stringify(summarizeMultimodalContext(envelope), null, 2),
    '',
    'Conversation context history:',
    JSON.stringify(summarizeConversationContextHistory(envelope), null, 2),
    '',
    'Pointer context detail:',
    JSON.stringify(summarizePointerContext(envelope.pointerContext), null, 2),
    '',
    formatAttachments(envelope)
  ].join('\n');
}

export function buildLocalVlmPrompt(envelope: AgentContextEnvelope): string {
  return [
    'Answer from the visible screenshot and pointer context only.',
    'Do not claim that you used tools or performed actions.',
    'If the request requires desktop control, explain what an agent backend would need to do.',
    '',
    buildAgentInput(envelope)
  ].join('\n');
}

export function dataUrlFromEnvelope(envelope: AgentContextEnvelope): string | undefined {
  return envelope.attachments.find((attachment) => attachment.dataUrl)?.dataUrl;
}

export function dataUrlsFromEnvelope(envelope: AgentContextEnvelope): string[] {
  return envelope.attachments.map((attachment) => attachment.dataUrl).filter((dataUrl): dataUrl is string => Boolean(dataUrl));
}

function summarizePointerContext(context: PointerContext) {
  return {
    source: context.source,
    cursor: context.cursor,
    window: context.window,
    target: context.target
      ? {
          kind: context.target.kind,
          text: context.target.text,
          name: context.target.name,
          role: context.target.role,
          bbox: context.target.bbox,
          confidence: context.target.confidence,
          groundingRef: context.target.groundingRef
        }
      : undefined,
    selection: context.selection,
    visual: context.visual
      ? {
          screenshotId: context.visual.screenshotId,
          crop: context.visual.crop,
          mimeType: context.visual.mimeType,
          hasImageBase64: Boolean(context.visual.imageBase64)
        }
      : undefined,
    windowSnapshot: context.windowSnapshot
      ? {
          screenshotId: context.windowSnapshot.screenshotId,
          source: context.windowSnapshot.source,
          bounds: context.windowSnapshot.bounds,
          mimeType: context.windowSnapshot.mimeType,
          hasImageBase64: Boolean(context.windowSnapshot.imageBase64),
          error: context.windowSnapshot.error
        }
      : undefined,
    gesture: context.gesture
      ? {
          kind: context.gesture.kind,
          region: context.gesture.region,
          confidence: context.gesture.confidence
        }
      : undefined,
    nearby: context.nearby,
    grounding: context.grounding,
    contextChips: summarizeContextChips(context)
  };
}

function summarizeConversationContextHistory(envelope: AgentContextEnvelope) {
  return (envelope.history ?? [])
    .slice(0, -1)
    .filter((turn) => turn.pointerContext)
    .slice(-6)
    .map((turn) => {
      const context = turn.pointerContext!;
      const cuaEntities = context.nearby.filter((entity) => entity.groundingRef?.provider === 'cua');
      return {
        role: turn.role,
        text: turn.text,
        window: context.window,
        visual: context.visual
          ? {
              crop: context.visual.crop,
              mimeType: context.visual.mimeType,
              hasImage: Boolean(context.visual.imageBase64)
            }
          : undefined,
        windowSnapshot: context.windowSnapshot
          ? {
              source: context.windowSnapshot.source,
              bounds: context.windowSnapshot.bounds,
              mimeType: context.windowSnapshot.mimeType,
              hasImage: Boolean(context.windowSnapshot.imageBase64),
              error: context.windowSnapshot.error
            }
          : undefined,
        contextChips: summarizeContextChips(context),
        cua:
          context.grounding || cuaEntities.length > 0
            ? {
                grounding: context.grounding,
                target: context.target?.groundingRef
                  ? {
                      kind: context.target.kind,
                      text: context.target.text,
                      name: context.target.name,
                      role: context.target.role,
                      bbox: context.target.bbox,
                      state: context.target.state,
                      groundingRef: context.target.groundingRef
                    }
                  : undefined,
                nearby: cuaEntities.slice(0, 6)
              }
            : undefined
      };
    });
}

function summarizeMultimodalContext(envelope: AgentContextEnvelope) {
  const context = envelope.pointerContext;
  const cuaEntities = context.nearby.filter((entity) => entity.groundingRef?.provider === 'cua');
  return {
    text: {
      instruction: envelope.instruction.text,
      mode: envelope.instruction.mode
    },
    visual: context.visual
      ? {
          attachment: attachmentLabel(envelope, 'pointer'),
          crop: context.visual.crop,
          gesture: context.gesture
            ? {
                kind: context.gesture.kind,
                region: context.gesture.region
              }
            : undefined
        }
      : undefined,
    windowSnapshot: context.windowSnapshot
      ? {
          attachment: attachmentLabel(envelope, 'window'),
          source: context.windowSnapshot.source,
          bounds: context.windowSnapshot.bounds,
          error: context.windowSnapshot.error
        }
      : undefined,
    contextChips: summarizeContextChips(context).map((chip, index) => ({
      ...chip,
      attachment: contextAttachmentLabel(envelope, chip.id, index)
    })),
    cua:
      context.grounding || cuaEntities.length > 0
        ? {
            grounding: context.grounding,
            selectedTarget: context.target?.groundingRef
              ? {
                  kind: context.target.kind,
                  text: context.target.text,
                  name: context.target.name,
                  role: context.target.role,
                  bbox: context.target.bbox,
                  state: context.target.state,
                  groundingRef: context.target.groundingRef
                }
              : undefined,
            nearby: cuaEntities.slice(0, 12).map((entity) => ({
              kind: entity.kind,
              text: entity.text,
              name: entity.name,
              role: entity.role,
              bbox: entity.bbox,
              state: entity.state,
              groundingRef: entity.groundingRef
            }))
          }
        : undefined,
    pointer: {
      window: context.window,
      cursor: context.cursor,
      target: context.target
        ? {
            kind: context.target.kind,
            text: context.target.text,
            name: context.target.name,
            role: context.target.role,
            bbox: context.target.bbox,
            state: context.target.state
          }
        : undefined
    }
  };
}

function summarizeContextChips(context: PointerContext) {
  return (context.contextChips ?? []).map((chip) => ({
    id: chip.id,
    kind: chip.kind,
    role: chip.role,
    label: chip.label,
    subtitle: chip.subtitle,
    windowRef: chip.windowRef,
    entityRefs: chip.entityRefs?.slice(0, 8).map((entity) => ({
      kind: entity.kind,
      text: entity.text,
      name: entity.name,
      role: entity.role,
      bbox: entity.bbox,
      state: entity.state,
      groundingRef: entity.groundingRef
    })),
    region: chip.region,
    selectionText: chip.selectionText,
    windowSnapshot: chip.windowSnapshot
      ? {
          screenshotId: chip.windowSnapshot.screenshotId,
          source: chip.windowSnapshot.source,
          bounds: chip.windowSnapshot.bounds,
          mimeType: chip.windowSnapshot.mimeType,
          hasImageBase64: Boolean(chip.windowSnapshot.imageBase64),
          error: chip.windowSnapshot.error
        }
      : undefined,
    error: chip.error,
    createdAt: chip.createdAt,
    lastSeenAt: chip.lastSeenAt
  }));
}

function attachmentLabel(envelope: AgentContextEnvelope, scope: 'pointer' | 'window'): string | undefined {
  const attachment = envelope.attachments.find((item) => item.scope === scope);
  return attachment
    ? `${attachment.scope ?? 'context'}:${attachment.type}:${attachment.mimeType}${attachment.tempPath ? `:${attachment.tempPath}` : ''}`
    : undefined;
}

function contextAttachmentLabel(envelope: AgentContextEnvelope, chipId: string, index: number): string | undefined {
  const attachment = envelope.attachments.find((item) => item.contextChipId === chipId);
  return attachment
    ? `${attachment.label ?? `Context ${index + 1}`}:${attachment.type}:${attachment.mimeType}${attachment.tempPath ? `:${attachment.tempPath}` : ''}`
    : undefined;
}

function formatAttachments(envelope: AgentContextEnvelope): string {
  if (envelope.attachments.length === 0) return 'Attachments: none';
  return [
    'Attachments:',
    ...envelope.attachments.map((attachment, index) =>
      [
        `- ${index + 1}. ${attachment.label ?? attachment.scope ?? 'context screenshot'}`,
        `scope=${attachment.scope ?? 'context'}`,
        `type=${attachment.type}`,
        `mime=${attachment.mimeType}`,
        attachment.crop ? `rect=${JSON.stringify(attachment.crop)}` : '',
        attachment.tempPath ? `file=${attachment.tempPath}` : '',
        attachment.dataUrl ? 'dataUrl=present' : ''
      ]
        .filter(Boolean)
        .join(' ')
    ),
    'Use the attached screenshot image content as visual evidence. If a file path is provided, read that local image file instead of claiming the screenshot is unavailable.'
  ].join('\n');
}

function formatCuaDirective(directive: CuaDirective): string {
  return [
    'CUA directive:',
    JSON.stringify(
      {
        mode: directive.mode,
        objective: directive.objective,
        target: directive.target,
        allowedActions: directive.allowedActions,
        constraints: directive.constraints
      },
      null,
      2
    )
  ].join('\n');
}

function formatToolServers(toolServers: NonNullable<AgentContextEnvelope['toolServers']>): string {
  return [
    'Local tool servers:',
    JSON.stringify(toolServers, null, 2),
    'OpenPointer local CUA tools include:',
    '- read_selected_text({}): read the currently selected text from the target app.',
    '- insert_text({ "text": string, "click_target"?: boolean }): insert text at the current pointer/target location.'
  ].join('\n');
}
