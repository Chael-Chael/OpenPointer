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
  gesture?: PointerGesture;
  nearby: Array<Pick<PointerEntity, 'id' | 'kind' | 'text' | 'bbox' | 'confidence'>>;
  createdAt: number;
};

export type PointerIntentId =
  | 'ask'
  | 'explain'
  | 'summarize'
  | 'translate'
  | 'rewrite'
  | 'extract'
  | 'fill'
  | 'copy'
  | 'click'
  | 'open'
  | 'compare'
  | 'send-to-agent';

export type PointerIntent = {
  id: PointerIntentId;
  label: string;
  reason: string;
  confidence: number;
  requiresInput: boolean;
  defaultPrompt: string;
};

export type ActionRisk = 'low' | 'medium' | 'high' | 'critical';

export type ActionStep =
  | { type: 'answer'; prompt: string }
  | { type: 'copy'; text: string }
  | { type: 'fill'; text: string; target?: PointerEntity }
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { type: 'doubleClick'; x: number; y: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'drag'; from: Point; to: Point }
  | { type: 'scroll'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'type'; text: string }
  | { type: 'hotkey'; keys: string[] }
  | { type: 'open'; target: string }
  | { type: 'launchApp'; appId: string }
  | { type: 'shell'; command: string };

export type PointerActionPlan = {
  id: string;
  intent: PointerIntentId;
  risk: ActionRisk;
  contextId: string;
  steps: ActionStep[];
  preview: string;
  requiresConfirmation: boolean;
  createdAt: number;
};

export type ExecutorResult = {
  ok: boolean;
  summary: string;
  beforeScreenshotId?: string;
  afterScreenshotId?: string;
  error?: string;
  raw?: unknown;
};

export type ExecutorAdapter = {
  id: string;
  label: string;
  capabilities(): Promise<string[]>;
  dryRun(plan: PointerActionPlan): Promise<PointerActionPlan>;
  execute(plan: PointerActionPlan, approvalToken: string): Promise<ExecutorResult>;
  captureBeforeAfter?<T>(run: () => Promise<T>): Promise<{ result: T; before?: string; after?: string }>;
  audit(plan: PointerActionPlan, result: ExecutorResult): Promise<void>;
};
