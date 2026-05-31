import type { AgentContextEnvelope, CuaDirective, PointerContext } from '@openmagicpointer/core';

const TOOL_DISCOVERY_MESSAGE = 'Agent may use available MCP tools, skills, or CUA depending on backend configuration.';

export function buildToolDiscoveryEvent(envelope: AgentContextEnvelope) {
  const skills = envelope.routing.preferredTools.filter((tool) => tool.includes('skill')).map((tool) => tool.replace(/-/g, ' '));
  return {
    type: 'tool.discovery' as const,
    tools: envelope.routing.preferredTools,
    skills,
    message: TOOL_DISCOVERY_MESSAGE
  };
}

export function buildAgentInstructions(envelope: AgentContextEnvelope): string {
  const cues = [
    'You are receiving a desktop pointer context from OpenMagicPointer.',
    'Treat the user instruction text as the primary intent.',
    'Use screenshots as visual evidence and CUA grounding as structured UI evidence/action references.',
    'If text, screenshot, and CUA disagree, follow the user instruction and explain the uncertainty instead of inventing missing state.',
    'Do not assume OpenMagicPointer can execute actions locally.',
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
    envelope.attachments.length > 0
      ? `Attachments: ${envelope.attachments.map((attachment) => `${attachment.type}:${attachment.mimeType}`).join(', ')}`
      : 'Attachments: none'
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
    gesture: context.gesture
      ? {
          kind: context.gesture.kind,
          region: context.gesture.region,
          confidence: context.gesture.confidence
        }
      : undefined,
    nearby: context.nearby,
    grounding: context.grounding
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
          attachment: envelope.attachments[0] ? `${envelope.attachments[0].type}:${envelope.attachments[0].mimeType}` : undefined,
          crop: context.visual.crop,
          gesture: context.gesture
            ? {
                kind: context.gesture.kind,
                region: context.gesture.region
              }
            : undefined
        }
      : undefined,
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
                  groundingRef: context.target.groundingRef
                }
              : undefined,
            nearby: cuaEntities.slice(0, 12).map((entity) => ({
              kind: entity.kind,
              text: entity.text,
              name: entity.name,
              role: entity.role,
              bbox: entity.bbox,
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
            bbox: context.target.bbox
          }
        : undefined
    }
  };
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
  return ['Local tool servers:', JSON.stringify(toolServers, null, 2)].join('\n');
}
