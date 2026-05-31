import { afterEach, describe, expect, it, vi } from 'vitest';
import { availablePanelHeight, computeShellPosition } from './geometry';

const MARGIN = 12;

function setViewport(width: number, height: number) {
  vi.stubGlobal('window', { innerWidth: width, innerHeight: height });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('computeShellPosition', () => {
  const W = 1920;
  const H = 1080;
  const shellW = 520;
  const pillH = 44;

  it('keeps the shell fully on screen near the bottom edge with a panel', () => {
    setViewport(W, H);
    const pos = computeShellPosition(400, H - 10, shellW, pillH, true);
    // The pill itself must never be pushed off the bottom.
    expect(pos.y).toBeLessThanOrEqual(H - pillH - MARGIN);
    expect(pos.y).toBeGreaterThanOrEqual(MARGIN);
  });

  it('flips to the left of the cursor near the right edge', () => {
    setViewport(W, H);
    const pos = computeShellPosition(W - 20, 400, shellW, pillH, false);
    expect(pos.x + shellW + MARGIN).toBeLessThanOrEqual(W);
  });

  it('clamps horizontally so the shell never overflows', () => {
    setViewport(W, H);
    const pos = computeShellPosition(W - 1, 400, shellW, pillH, true);
    expect(pos.x).toBeGreaterThanOrEqual(MARGIN);
    expect(pos.x + shellW + MARGIN).toBeLessThanOrEqual(W);
  });

  it('handles the bottom-right corner without clipping', () => {
    setViewport(W, H);
    const pos = computeShellPosition(W - 5, H - 5, shellW, pillH, true);
    expect(pos.x + shellW + MARGIN).toBeLessThanOrEqual(W);
    expect(pos.y).toBeLessThanOrEqual(H - pillH - MARGIN);
  });

  it('lifts the shell up so a panel fits below the pill', () => {
    setViewport(W, H);
    const withPanel = computeShellPosition(400, H - 100, shellW, pillH, true);
    const withoutPanel = computeShellPosition(400, H - 100, shellW, pillH, false);
    // With a panel the shell starts higher to leave room below.
    expect(withPanel.y).toBeLessThan(withoutPanel.y);
  });
});

describe('availablePanelHeight', () => {
  it('shrinks as the shell sits lower on screen', () => {
    setViewport(1920, 1080);
    const high = availablePanelHeight(100, 44);
    const low = availablePanelHeight(800, 44);
    expect(low).toBeLessThan(high);
  });

  it('never returns less than the minimum height', () => {
    setViewport(1920, 1080);
    expect(availablePanelHeight(1070, 44)).toBeGreaterThanOrEqual(160);
  });

  it('never exceeds the maximum height', () => {
    setViewport(1920, 4000);
    expect(availablePanelHeight(0, 44)).toBeLessThanOrEqual(520);
  });
});
