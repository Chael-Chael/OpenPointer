import { describe, expect, it } from 'vitest';
import type { AppSettings } from '@openpointer/storage';
import type { CursorPayload, HoldProgressPayload } from '../shared/types.js';
import { MouseShakeActivationController, type MouseShakeRuntime } from './mouse-shake-activation.js';

const cursor: CursorPayload = {
  x: 100,
  y: 100,
  localX: 100,
  localY: 100,
  displayId: 1,
  dpr: 1
};

const settings: Pick<AppSettings, 'mouseShakeActivationEnabled' | 'mouseShakeSensitivity'> = {
  mouseShakeActivationEnabled: true,
  mouseShakeSensitivity: 'low'
};

function createHarness(patch: Partial<MouseShakeRuntime> = {}) {
  let now = 0;
  let activated = 0;
  const feedback: HoldProgressPayload[] = [];
  const controller = new MouseShakeActivationController({
    now: () => now,
    setTimeout: (() => 0) as unknown as typeof setTimeout,
    clearTimeout: (() => undefined) as unknown as typeof clearTimeout
  });
  const runtime = (): MouseShakeRuntime => ({
    settings,
    active: false,
    holdActive: false,
    overlayHidden: false,
    cursor,
    activate: () => {
      activated += 1;
    },
    emitFeedback: (payload) => {
      feedback.push(payload);
    },
    ...patch
  });
  const move = (x: number, y: number, t: number) => {
    now = t;
    return controller.handleMouseMove({ x, y }, runtime());
  };
  const shake = (startAt = 300) => [0, 90, -10, 92, -12, 94, -10].some((x, index) => move(x, 0, startAt + index * 100));
  return {
    controller,
    feedback,
    move,
    runtime,
    shake,
    get activated() {
      return activated;
    },
    set now(value: number) {
      now = value;
    }
  };
}

describe('MouseShakeActivationController', () => {
  it('activates after a valid shake', () => {
    const harness = createHarness();
    expect(harness.shake()).toBe(true);
    expect(harness.activated).toBe(1);
    expect(harness.feedback.at(-1)?.source).toBe('mouse-shake');
    expect(harness.feedback.at(-1)?.state).toBe('completed');
  });

  it('ignores shakes when disabled', () => {
    const harness = createHarness({
      settings: { mouseShakeActivationEnabled: false, mouseShakeSensitivity: 'low' }
    });
    expect(harness.shake()).toBe(false);
    expect(harness.activated).toBe(0);
  });

  it('ignores shakes while the overlay is active', () => {
    const harness = createHarness({ active: true });
    expect(harness.shake()).toBe(false);
    expect(harness.activated).toBe(0);
  });

  it('ignores shakes while any mouse button is pressed', () => {
    const harness = createHarness();
    harness.controller.handleMouseDown(1, harness.runtime());
    expect(harness.shake()).toBe(false);
    expect(harness.activated).toBe(0);
  });

  it('ignores shakes inside the pointer action guard window after mouseup', () => {
    const harness = createHarness();
    harness.now = 1000;
    harness.controller.handleMouseUp(1, harness.runtime());
    expect(harness.shake(1050)).toBe(false);
    expect(harness.activated).toBe(0);
  });

  it('ignores shakes while overlays are hidden for desktop reads', () => {
    const harness = createHarness({ overlayHidden: true });
    expect(harness.shake()).toBe(false);
    expect(harness.activated).toBe(0);
  });
});
