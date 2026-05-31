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
    'Use the user instruction, screenshot, window metadata, pointer position, target area, and routing hints.',
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
    `User instruction: ${envelope.instruction.text}`,
    '',
    'Pointer context:',
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
