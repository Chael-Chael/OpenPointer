import type { AgentBackendId, AgentContextEnvelope, AgentInputMode, AgentToolPolicy, CuaDirective, PointerContext } from '@openmagicpointer/core';

const OPERATION_PATTERN = /\b(click|merge|add|insert|fill|type|open|move|drag|scroll|operate|select)\b|点击|合并|添加|加入|填|输入|打开|操作|选择/iu;
const FORCE_CUA_PATTERN = /\b(force|must|directly).*(cua|desktop|computer)|强制.*(cua|桌面|电脑)|直接操作/iu;

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
  return operationIntent
    ? ['app-specific-mcp', 'document-skill', 'screen-skill', 'cua']
    : ['app-specific-mcp', 'document-skill', 'screen-skill'];
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
