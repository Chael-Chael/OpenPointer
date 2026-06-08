import type {
  AgentBackendId,
  AgentContextEnvelope,
  AgentInputMode,
  AgentToolPolicy,
  CuaDirective,
  EntityBinding,
  PointerContext,
  ResolvedIntent,
  ResolvedIntentAction,
  ResolvedIntentDomain
} from '@openpointer/core';

const OPERATION_PATTERN =
  /\b(click|merge|add|insert|paste|fill|type|open|move|drag|scroll|operate|select|selection|selected|highlight|read|copy)\b|(?:\u70b9|\u9ede)(?:\u51fb|\u64ca)|\u5408\u5e76|\u6dfb\u52a0|\u52a0\u5165|\u63d2\u5165|\u7c98\u8d34|\u66ff\u6362|\u6539\u5199|\u586b(?:\u5145)?|\u8f93\u5165|\u8bfb\u53d6|\u8bc6\u522b|\u590d\u5236|\u9ad8\u4eae|\u6253\u5f00|\u64cd\u4f5c|\u9009\u62e9|\u9009\u4e2d/iu;
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
  const entityBindings = buildEntityBindings(args.context);
  const resolvedIntent = buildResolvedIntent(args.instruction, args.context, entityBindings, operationIntent, forceCua);
  return {
    schemaVersion: 'openpointer.agent-context.v1',
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
    resolvedIntent,
    entityBindings,
    cuaDirective: operationIntent ? buildCuaDirective(args.instruction, args.context, forceCua ? 'require' : 'prefer') : undefined
  };
}

function buildPreferredTools(operationIntent: boolean): string[] {
  return operationIntent ? ['app-specific-mcp', 'document-skill', 'screen-skill', 'cua'] : ['app-specific-mcp', 'document-skill', 'screen-skill'];
}

function contextAttachments(context: PointerContext): AgentContextEnvelope['attachments'] {
  const attachments: AgentContextEnvelope['attachments'] = [];
  if (context.visual?.imageBase64 && context.visual.mimeType) {
    attachments.push({
      type: 'screenshot',
      scope: 'pointer',
      label: 'Pointer context screenshot',
      mimeType: context.visual.mimeType,
      dataUrl: `data:${context.visual.mimeType};base64,${context.visual.imageBase64}`,
      crop: context.visual.crop
    });
  }
  if (context.windowSnapshot?.imageBase64 && context.windowSnapshot.mimeType) {
    attachments.push({
      type: 'screenshot',
      scope: 'window',
      label: 'Full window screenshot',
      mimeType: context.windowSnapshot.mimeType,
      dataUrl: `data:${context.windowSnapshot.mimeType};base64,${context.windowSnapshot.imageBase64}`,
      crop: context.windowSnapshot.bounds
    });
  }
  for (const [index, chip] of (context.contextChips ?? []).entries()) {
    const snapshot = chip.windowSnapshot;
    if (!snapshot?.imageBase64 || !snapshot.mimeType) continue;
    attachments.push({
      type: 'screenshot',
      scope: 'context',
      label: `Context ${index + 1}: ${chip.label}`,
      contextChipId: chip.id,
      mimeType: snapshot.mimeType,
      dataUrl: `data:${snapshot.mimeType};base64,${snapshot.imageBase64}`,
      crop: snapshot.bounds
    });
  }
  return attachments;
}

function buildCuaDirective(instruction: string, context: PointerContext, mode: 'prefer' | 'require'): CuaDirective {
  const targetBbox = context.target ? (context.target.groundingRef?.screenRect ?? context.target.bbox) : context.visual?.crop;
  const coordinateSpace = context.target?.groundingRef?.screenRect
    ? 'screen'
    : context.target?.bbox
      ? 'window'
      : context.visual?.crop && !context.target
        ? 'crop'
        : 'screen';
  return {
    enabled: true,
    mode,
    objective: instruction,
    target: {
      kind: context.target ? 'element' : context.visual?.crop ? 'region' : 'point',
      screenPoint: { x: context.cursor.x, y: context.cursor.y, displayId: context.cursor.displayId },
      bbox: targetBbox,
      coordinateSpace,
      description: context.target?.text ?? context.target?.name ?? 'Pointer target'
    },
    allowedActions: ['screenshot', 'click', 'doubleClick', 'type', 'scroll', 'drag', 'hotkey'],
    constraints: {
      appAllowlist: appAllowlistForContext(context),
      requireApprovalBeforeStateChange: true,
      stopWhen: 'The requested task is complete or user approval is needed.'
    }
  };
}

function appAllowlistForContext(context: PointerContext): string[] | undefined {
  const apps = new Set<string>();
  const primary = context.window?.app ?? context.window?.process;
  if (primary) apps.add(primary);
  for (const chip of context.contextChips ?? []) {
    const app = chip.windowRef?.app ?? chip.windowRef?.process;
    if (app) apps.add(app);
  }
  return apps.size > 0 ? [...apps] : undefined;
}

function buildResolvedIntent(
  instruction: string,
  context: PointerContext,
  bindings: EntityBinding[],
  operationIntent: boolean,
  forceCua: boolean
): ResolvedIntent {
  const action = resolveAction(instruction, operationIntent);
  const domain = resolveDomain(instruction, context, action, operationIntent);
  const hasVisual = Boolean(context.visual?.imageBase64 || context.windowSnapshot?.imageBase64);
  const hasStructuredUi = hasCuaContext(context);
  const needsDesktopControl = forceCua || operationIntent || ['click', 'fill', 'insert', 'copy', 'navigate', 'operate'].includes(action);
  const needsToolUse = needsDesktopControl || ['code', 'document', 'browser'].includes(domain);
  const targetBindingIds = bindings.filter((binding) => ['target', 'destination', 'region'].includes(binding.role)).map((binding) => binding.id);
  const sourceBindingIds = bindings.filter((binding) => ['source', 'selection', 'context', 'window'].includes(binding.role)).map((binding) => binding.id);
  return {
    action,
    domain,
    summary: `${action} in ${domain}`,
    confidence: intentConfidence(context, operationIntent, hasStructuredUi),
    needs: {
      visualUnderstanding: hasVisual && !hasStructuredUi,
      structuredUi: hasStructuredUi || needsDesktopControl,
      desktopControl: needsDesktopControl,
      toolUse: needsToolUse
    },
    suggestedSkillIds: suggestedSkillIdsForIntent(action, domain, context, needsDesktopControl),
    sourceBindingIds,
    targetBindingIds
  };
}

function resolveAction(instruction: string, operationIntent: boolean): ResolvedIntentAction {
  const text = instruction.toLowerCase();
  if (/\b(click|press|tap|select)\b|点击|點擊|选择|選擇/u.test(text)) return 'click';
  if (/\b(fill|type|input|enter)\b|填写|填充|输入|輸入/u.test(text)) return 'fill';
  if (/\b(insert|paste|put)\b|插入|粘贴|貼上|放到/u.test(text)) return 'insert';
  if (/\b(copy|move)\b|复制|複製|移动|移到/u.test(text)) return 'copy';
  if (/\b(open|navigate|go to)\b|打开|打開|跳转|導航/u.test(text)) return 'navigate';
  if (/\b(compare|diff)\b|比较|對比|对比/u.test(text)) return 'compare';
  if (/\b(rewrite|polish|edit)\b|改写|润色|修改/u.test(text)) return 'rewrite';
  if (/\b(summarize|summary|explain|read)\b|总结|摘要|解释|读取/u.test(text)) return 'summarize';
  if (/\b(code|fix|test|build|debug|repo|diff|terminal)\b|代码|修复|测试|报错/u.test(text)) return 'code';
  return operationIntent ? 'operate' : instruction.trim() ? 'answer' : 'unknown';
}

function resolveDomain(instruction: string, context: PointerContext, action: ResolvedIntentAction, operationIntent: boolean): ResolvedIntentDomain {
  const text = [instruction, context.window?.title, context.window?.app, context.window?.process].filter(Boolean).join(' ').toLowerCase();
  if (/\b(code|repo|diff|stack trace|terminal|vscode|visual studio|github)\b|代码|仓库|终端|报错/u.test(text) || action === 'code') return 'code';
  if (/\b(pdf|paper|document|docx|word|excel|powerpoint|paragraph)\b|论文|文档|段落|表格/u.test(text)) return 'document';
  if (/\b(browser|chrome|edge|firefox|safari|url|webpage|tab|link)\b|浏览器|网页|链接/u.test(text)) return 'browser';
  if (context.selection?.text || context.contextChips?.some((chip) => chip.kind === 'selection')) return 'text-selection';
  if (operationIntent || hasCuaContext(context)) return 'desktop-control';
  if (context.target?.kind === 'image' || context.entities.some((entity) => entity.kind === 'image')) return 'image';
  return context.visual ? 'screen' : 'general';
}

function buildEntityBindings(context: PointerContext): EntityBinding[] {
  const bindings: EntityBinding[] = [];
  if (context.target) {
    bindings.push({
      id: `binding-target-${context.target.id}`,
      role: 'target',
      label: entityLabel(context.target),
      kind: context.target.kind,
      confidence: context.target.confidence,
      entityId: context.target.id,
      text: context.target.text ?? context.target.name,
      region: context.target.groundingRef?.screenRect ?? context.target.bbox,
      groundingRef: context.target.groundingRef
    });
  }
  if (context.selection?.text) {
    bindings.push({
      id: 'binding-selection',
      role: 'selection',
      label: 'Current selected text',
      kind: 'selection',
      confidence: 0.9,
      text: context.selection.text
    });
  }
  for (const chip of context.contextChips ?? []) {
    const role = chip.role === 'target' ? 'destination' : chip.role === 'source' ? 'source' : 'context';
    bindings.push({
      id: `binding-chip-${chip.id}`,
      role,
      label: chip.label,
      kind: chip.kind,
      confidence: chip.status === 'pinned' ? 0.86 : 0.68,
      chipId: chip.id,
      text: chip.selectionText,
      region: chip.region,
      window: chip.windowRef,
      groundingRef: chip.entityRefs?.find((entity) => entity.groundingRef)?.groundingRef
    });
  }
  if (context.window) {
    bindings.push({
      id: 'binding-active-window',
      role: 'window',
      label: context.window.title ?? context.window.app ?? context.window.process ?? 'Active window',
      kind: 'window',
      confidence: 0.75,
      window: context.window
    });
  }
  if (!context.target && context.visual?.crop) {
    bindings.push({
      id: 'binding-pointer-region',
      role: 'region',
      label: 'Pointer screenshot crop',
      kind: 'region',
      confidence: 0.62,
      region: context.visual.crop
    });
  }
  return bindings;
}

function entityLabel(entity: PointerContext['target']): string {
  return entity?.text ?? entity?.name ?? entity?.role ?? entity?.kind ?? 'Pointer target';
}

function hasCuaContext(context: PointerContext): boolean {
  return Boolean(
    context.grounding?.provider === 'cua' ||
      context.target?.groundingRef?.provider === 'cua' ||
      context.entities.some((entity) => entity.groundingRef?.provider === 'cua') ||
      context.nearby.some((entity) => entity.groundingRef?.provider === 'cua')
  );
}

function intentConfidence(context: PointerContext, operationIntent: boolean, hasStructuredUi: boolean): number {
  if (context.target?.groundingRef) return 0.9;
  if (context.target) return 0.78;
  if (hasStructuredUi) return 0.74;
  if (context.selection?.text) return 0.72;
  if (operationIntent) return 0.6;
  return 0.52;
}

function suggestedSkillIdsForIntent(
  action: ResolvedIntentAction,
  domain: ResolvedIntentDomain,
  context: PointerContext,
  needsDesktopControl: boolean
): string[] {
  const ids = new Set<string>();
  if (needsDesktopControl || hasCuaContext(context)) ids.add('openpointer.generic-cua');
  if (domain === 'browser') ids.add('openpointer.browser');
  if (domain === 'document') ids.add('openpointer.document-pdf');
  if (domain === 'code' || action === 'code') ids.add('openpointer.code');
  if (domain === 'text-selection' || context.selection?.text || ['rewrite', 'summarize', 'copy', 'insert'].includes(action)) ids.add('openpointer.text-selection');
  if (context.target?.kind === 'image' || domain === 'image') ids.add('openpointer.image-region');
  return [...ids];
}
