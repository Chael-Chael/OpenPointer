import { WiggleDetector, wiggleOptionsForSensitivity } from '@openpointer/gestures';
import type { AppSettings } from '@openpointer/storage';
import type { CursorPayload, HoldProgressPayload } from '../shared/types.js';

type MouseButton = unknown;

export type MouseShakeRuntime = {
  settings: Pick<AppSettings, 'mouseShakeActivationEnabled' | 'mouseShakeSensitivity'>;
  active: boolean;
  holdActive: boolean;
  overlayHidden: boolean;
  cursor: CursorPayload;
  activate(cursor: CursorPayload): void;
  emitFeedback(payload: HoldProgressPayload): void;
};

type MouseShakeActivationControllerOptions = {
  guardMs?: number;
  minFeedbackProgress?: number;
  feedbackTtlMs?: number;
  now?: () => number;
  setTimeout?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
};

export class MouseShakeActivationController {
  private detector = new WiggleDetector(wiggleOptionsForSensitivity('low'));
  private sensitivity: AppSettings['mouseShakeSensitivity'] = 'low';
  private pressedButtons = new Set<string>();
  private lastPointerActionAt = Number.NEGATIVE_INFINITY;
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  private feedbackCursor: CursorPayload | null = null;
  private readonly guardMs: number;
  private readonly minFeedbackProgress: number;
  private readonly feedbackTtlMs: number;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;

  constructor(options: MouseShakeActivationControllerOptions = {}) {
    this.guardMs = options.guardMs ?? 220;
    this.minFeedbackProgress = options.minFeedbackProgress ?? 0.25;
    this.feedbackTtlMs = options.feedbackTtlMs ?? 180;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimeout ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimeout ?? ((timer) => clearTimeout(timer));
  }

  handleMouseDown(button: MouseButton, runtime?: Pick<MouseShakeRuntime, 'emitFeedback'>): void {
    this.pressedButtons.add(buttonKey(button));
    this.notePointerAction(runtime);
  }

  handleMouseUp(button: MouseButton, runtime?: Pick<MouseShakeRuntime, 'emitFeedback'>): void {
    this.pressedButtons.delete(buttonKey(button));
    this.notePointerAction(runtime);
  }

  handleMouseMove(event: { x: number; y: number }, runtime: MouseShakeRuntime): boolean {
    this.ensureSensitivity(runtime.settings.mouseShakeSensitivity);
    if (!this.canDetect(runtime)) {
      this.reset(runtime);
      return false;
    }

    const fired = this.detector.push({
      x: event.x,
      y: event.y,
      t: this.now(),
      displayId: runtime.cursor.displayId
    });

    if (fired) {
      this.clearFeedback();
      runtime.activate(runtime.cursor);
      runtime.emitFeedback({
        cursor: runtime.cursor,
        progress: 1,
        state: 'completed',
        startedWhileActive: false,
        source: 'mouse-shake'
      });
      return true;
    }

    const progress = this.detector.progress();
    if (progress >= this.minFeedbackProgress) {
      this.emitHoldingFeedback(runtime, progress);
    } else {
      this.clearFeedback(runtime);
    }
    return false;
  }

  reset(runtime?: Pick<MouseShakeRuntime, 'emitFeedback'>): void {
    this.detector.reset();
    this.clearFeedback(runtime);
  }

  destroy(): void {
    this.reset();
  }

  private canDetect(runtime: MouseShakeRuntime): boolean {
    if (!runtime.settings.mouseShakeActivationEnabled) return false;
    if (runtime.active || runtime.holdActive || runtime.overlayHidden) return false;
    if (this.pressedButtons.size > 0) return false;
    return this.now() - this.lastPointerActionAt >= this.guardMs;
  }

  private ensureSensitivity(sensitivity: AppSettings['mouseShakeSensitivity']): void {
    if (this.sensitivity === sensitivity) return;
    this.sensitivity = sensitivity;
    this.detector = new WiggleDetector(wiggleOptionsForSensitivity(sensitivity));
  }

  private notePointerAction(runtime?: Pick<MouseShakeRuntime, 'emitFeedback'>): void {
    this.lastPointerActionAt = this.now();
    this.detector.reset();
    this.clearFeedback(runtime);
  }

  private emitHoldingFeedback(runtime: MouseShakeRuntime, progress: number): void {
    this.feedbackCursor = runtime.cursor;
    runtime.emitFeedback({
      cursor: runtime.cursor,
      progress: Math.min(0.95, progress),
      state: 'holding',
      startedWhileActive: false,
      source: 'mouse-shake'
    });
    if (this.feedbackTimer) this.clearTimer(this.feedbackTimer);
    this.feedbackTimer = this.setTimer(() => {
      this.feedbackTimer = null;
      runtime.emitFeedback({
        cursor: runtime.cursor,
        progress: 0,
        state: 'canceled',
        startedWhileActive: false,
        source: 'mouse-shake'
      });
      this.feedbackCursor = null;
    }, this.feedbackTtlMs);
  }

  private clearFeedback(runtime?: Pick<MouseShakeRuntime, 'emitFeedback'>): void {
    if (this.feedbackTimer) {
      this.clearTimer(this.feedbackTimer);
      this.feedbackTimer = null;
    }
    if (runtime && this.feedbackCursor) {
      runtime.emitFeedback({
        cursor: this.feedbackCursor,
        progress: 0,
        state: 'canceled',
        startedWhileActive: false,
        source: 'mouse-shake'
      });
    }
    this.feedbackCursor = null;
  }
}

function buttonKey(button: MouseButton): string {
  return String(button ?? 'unknown');
}
