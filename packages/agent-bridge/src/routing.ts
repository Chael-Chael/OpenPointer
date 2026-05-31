import type { AgentBackendId, AgentContextEnvelope, AgentInputMode, AgentToolPolicy, CuaDirective, PointerContext } from '@openmagicpointer/core';

const OPERATION_PATTERN =
  /\b(click|merge|add|insert|fill|type|open|move|drag|scroll|operate|select)\b|(?:\u70b9|\u9ede)(?:\u51fb|\u64ca)|\u5408\u5e76|\u6dfb\u52a0|\u52a0\u5165|\u586b(?:\u5145)?|\u8f93\u5165|\u6253\u5f00|\u64cd\u4f5c|\u9009\u62e9/iu;
const FORCE_CUA_PATTERN = /\b(force|must|directly).*(cua|desktop|computer)|\u5f3a\u5236.*(cua|\u684c\u9762|\u7535\u8111)|\u76f4\u63a5\u64cd\u4f5c/iu;

export function buildAgentContextEnvelope(args: {
  instruction: string;
  mode: AgentInputMode;
  context: PointerContext;
  backend?: AgentBackendId;
}): AgentContextEnvelope {
  const requestedBackend = args.backend ?? 'auto';
  const operationIntent = OPERATION_PATTERN.test(args.instruction);
  const forceCua = FORCE_CUA_PATTERN.test(args.instruction);
  const toolPolicy: AgentToolPolicy = forceCua ? 'require' : operationIntent ? 'prefer' : 'agent_decides';
  const preferredTools = buildPreferredTools(operationIntent);
  const requiredCapabilities = ['screen_understanding', ...(operationIntent ? ['desktop_context'] : []), ...(forceCua ? ['desktop_control'] : [])];
  return {
    schemaVersion: 'openmagicpointer.agent-context.v1',
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    instruction: {
      text: args.instruction,
      mode: args.mode,
      submittedAt: Date.now()
    },
    pointerContext: args.context,
    attachments: contextAttachments(args.context),
    routing: {
      backend: requestedBackend,
      preferredTools,
      requiredCapabilities,
      toolPolicy
    },
    cuaDirective: operationIntent ? buildCuaDirective(args.instruction, args.context, forceCua ? 'require' : 'prefer') : undefined
  };
}

function buildPreferredTools(operationIntent: boolean): string[] {
  return operationIntent ? ['app-specific-mcp', 'document-skill', 'screen-skill', 'cua'] : ['app-specific-mcp', 'document-skill', 'screen-skill'];
}

function contextAttachments(context: PointerContext): AgentContextEnvelope['attachments'] {
  if (!context.visual?.imageBase64 || !context.visual.mimeType) return [];
  return [
    {
      type: 'screenshot',
      mimeType: context.visual.mimeType,
      dataUrl: `data:${context.visual.mimeType};base64,${context.visual.imageBase64}`,
      crop: context.visual.crop
    }
  ];
}

function buildCuaDirective(instruction: string, context: PointerContext, mode: 'prefer' | 'require'): CuaDirective {
  return {
    enabled: true,
    mode,
    objective: instruction,
    target: {
      kind: context.target?.bbox ? 'element' : context.visual?.crop ? 'region' : 'point',
      screenPoint: { x: context.cursor.x, y: context.cursor.y, displayId: context.cursor.displayId },
      bbox: context.target?.bbox ?? context.visual?.crop,
      coordinateSpace: context.target?.bbox ? 'screen' : context.visual?.crop ? 'crop' : 'screen',
      description: context.target?.text ?? context.target?.name ?? 'Pointer target'
    },
    allowedActions: ['screenshot', 'click', 'doubleClick', 'type', 'scroll', 'drag', 'hotkey'],
    constraints: {
      appAllowlist: context.window?.app ? [context.window.app] : context.window?.process ? [context.window.process] : undefined,
      requireApprovalBeforeStateChange: true,
      stopWhen: 'The requested task is complete or user approval is needed.'
    }
  };
}
