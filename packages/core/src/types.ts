export type PointerSource = 'desktop' | 'browser' | 'sandbox';

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Point = {
  x: number;
  y: number;
  t?: number;
};

export type PointerGestureKind = 'hover' | 'sweep' | 'lasso' | 'circle' | 'rectangle' | 'click';

export type PointerGesture = {
  id: string;
  kind: PointerGestureKind;
  path: Point[];
  region?: {
    bbox: Rect;
    polygon?: Point[];
    maskId?: string;
  };
  entityIds: string[];
  confidence: number;
  startedAt: number;
  endedAt: number;
};

export type PointerEntityKind =
  | 'text'
  | 'button'
  | 'input'
  | 'link'
  | 'table'
  | 'code'
  | 'chart'
  | 'image'
  | 'product'
  | 'date'
  | 'place'
  | 'file'
  | 'issue'
  | 'diff'
  | 'error-log'
  | 'checkbox'
  | 'radio'
  | 'toggle'
  | 'menuitem'
  | 'tab'
  | 'listitem'
  | 'treeitem'
  | 'combobox'
  | 'slider'
  | 'menu'
  | 'toolbar'
  | 'container'
  | 'unknown';

export type PointerEntity = {
  id: string;
  kind: PointerEntityKind;
  text?: string;
  role?: string;
  name?: string;
  bbox?: Rect;
  selector?: string;
  accessibilityPath?: string;
  confidence: number;
  origin: 'accessibility' | 'ocr' | 'vision' | 'manual' | 'mock';
  state?: {
    selected?: boolean;
  };
  groundingRef?: {
    provider: 'cua';
    pid: number;
    windowId: string;
    elementIndex?: number;
    actions?: string[];
    screenRect?: Rect;
  };
};

export type PointerContext = {
  id: string;
  source: PointerSource;
  cursor: {
    x: number;
    y: number;
    displayId: number;
    localX: number;
    localY: number;
    dpr: number;
  };
  window?: {
    title?: string;
    process?: string;
    app?: string;
    windowId?: string;
  };
  target?: PointerEntity;
  entities: PointerEntity[];
  selection?: {
    text?: string;
    insertionTarget?: PointerEntity;
  };
  visual?: {
    screenshotId?: string;
    crop?: Rect;
    maskId?: string;
    imageBase64?: string;
    mimeType?: 'image/png' | 'image/jpeg';
  };
  windowSnapshot?: {
    screenshotId?: string;
    source?: 'cua-window' | 'electron-window';
    bounds?: Rect;
    imageBase64?: string;
    mimeType?: 'image/png' | 'image/jpeg';
    error?: string;
  };
  gesture?: PointerGesture;
  nearby: Array<Pick<PointerEntity, 'id' | 'kind' | 'text' | 'bbox' | 'confidence' | 'role' | 'name' | 'state' | 'groundingRef'>>;
  grounding?: {
    provider: 'cua';
    status: 'matched' | 'unavailable' | 'fallback';
    pid?: number;
    windowId?: string;
    elementCount?: number;
    error?: string;
  };
  createdAt: number;
};

export type AgentBackendId = 'auto' | 'local-vlm' | 'hermes' | 'opencode' | 'claude-agent' | 'codex' | 'mock';

export type AgentInputMode = 'text' | 'voice';

export type AgentToolPolicy = 'agent_decides' | 'prefer' | 'require';

export type AgentAttachment = {
  type: 'screenshot';
  scope?: 'pointer' | 'window';
  label?: string;
  mimeType: 'image/jpeg' | 'image/png';
  dataUrl?: string;
  tempPath?: string;
  crop?: Rect;
};

export type CuaDirective = {
  enabled: boolean;
  mode: 'prefer' | 'require';
  objective: string;
  target?: {
    kind: 'point' | 'region' | 'window' | 'element';
    screenPoint?: { x: number; y: number; displayId: number };
    bbox?: Rect;
    coordinateSpace: 'screen' | 'window' | 'crop';
    description?: string;
  };
  allowedActions: Array<'screenshot' | 'click' | 'doubleClick' | 'type' | 'scroll' | 'drag' | 'hotkey'>;
  constraints: {
    appAllowlist?: string[];
    stayWithinBbox?: boolean;
    requireApprovalBeforeStateChange: boolean;
    stopWhen?: string;
  };
};

export type ChatTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  pointerContext?: PointerContext;
  timestamp: number;
  thinkingTime?: number;
  toolEvents?: Array<Extract<AgentEvent, { type: 'tool.started' | 'tool.completed' }>>;
  events?: AgentEvent[];
};

export type Conversation = {
  id: string;
  title?: string;
  backendSessions?: {
    claudeAgent?: {
      sessionId: string;
    };
  };
  turns: ChatTurn[];
  createdAt: number;
  updatedAt: number;
};

export type AgentContextEnvelope = {
  schemaVersion: 'openpointer.agent-context.v1';
  requestId: string;
  instruction: {
    text: string;
    mode: AgentInputMode;
    submittedAt: number;
  };
  conversationId?: string;
  history?: ChatTurn[];
  pointerContext: PointerContext;
  attachments: AgentAttachment[];
  routing: {
    backend: AgentBackendId;
    preferredTools: string[];
    requiredCapabilities: string[];
    toolPolicy: AgentToolPolicy;
  };
  cuaDirective?: CuaDirective;
  toolServers?: Array<{
    id: 'cua';
    transport: 'local' | 'local-http';
    sessionId: string;
    endpoint?: string;
    tools: string[];
  }>;
};

export type AgentEvent =
  | { type: 'run.started'; runId: string; backend: AgentBackendId }
  | { type: 'backend.session'; backend: AgentBackendId; sessionId: string }
  | { type: 'assistant.delta'; text: string }
  | { type: 'tool.discovery'; tools: string[]; skills: string[]; message: string }
  | { type: 'tool.started'; name: string; input?: unknown }
  | { type: 'tool.completed'; name: string; output?: unknown }
  | { type: 'approval.requested'; id: string; reason: string; tool?: string }
  | { type: 'run.completed'; text?: string }
  | { type: 'run.failed'; error: string; recoverable?: boolean };
