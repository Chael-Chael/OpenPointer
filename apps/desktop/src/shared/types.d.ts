import type { AppSettings } from '@openmagicpointer/storage';
import type { Point, PointerActionPlan, PointerContext, PointerGestureKind, PointerIntent } from '@openmagicpointer/core';
export type CursorPayload = {
    x: number;
    y: number;
    localX: number;
    localY: number;
    displayId: number;
    dpr: number;
};
export type BuildContextRequest = {
    cursor: CursorPayload;
    gestureKind?: PointerGestureKind;
    gesturePath?: Point[];
};
export type QueryRequest = {
    context: PointerContext;
    prompt: string;
};
export type QueryResponse = {
    answer: string;
    intents: PointerIntent[];
};
export type CreatePlanRequest = {
    context: PointerContext;
    intent: PointerIntent;
    prompt?: string;
};
export type ExecutePlanResponse = {
    ok: boolean;
    summary: string;
    error?: string;
};
export type DesktopApi = {
    onActivate(cb: (cursor: CursorPayload) => void): () => void;
    onDeactivate(cb: () => void): () => void;
    onCursor(cb: (cursor: CursorPayload) => void): () => void;
    setInteractive(value: boolean): void;
    buildContext(req: BuildContextRequest): Promise<{
        context: PointerContext;
        intents: PointerIntent[];
    }>;
    query(req: QueryRequest): Promise<QueryResponse>;
    createPlan(req: CreatePlanRequest): Promise<PointerActionPlan>;
    executePlan(plan: PointerActionPlan): Promise<ExecutePlanResponse>;
    getSettings(): Promise<AppSettings>;
    saveSettings(patch: Partial<AppSettings> & {
        apiKey?: string;
    }): Promise<AppSettings>;
};
//# sourceMappingURL=types.d.ts.map