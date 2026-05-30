import { describe, expect, it } from 'vitest';
import { clampNumber, estimateTextTokens } from './utils.js';

describe('clampNumber', () => {
  it('clamps to the inclusive range', () => {
    expect(clampNumber(5, 0, 10, 1)).toBe(5);
    expect(clampNumber(-3, 0, 10, 1)).toBe(0);
    expect(clampNumber(99, 0, 10, 1)).toBe(10);
  });

  it('rounds to the nearest integer', () => {
    expect(clampNumber(4.6, 0, 10, 1)).toBe(5);
  });

  it('returns the fallback for non-finite or non-numeric input', () => {
    expect(clampNumber(undefined, 0, 10, 7)).toBe(7);
    expect(clampNumber('abc', 0, 10, 7)).toBe(7);
    expect(clampNumber(NaN, 0, 10, 7)).toBe(7);
  });

  it('coerces numeric strings', () => {
    expect(clampNumber('8', 0, 10, 1)).toBe(8);
  });
});

describe('estimateTextTokens', () => {
  it('returns zero for empty text', () => {
    expect(estimateTextTokens('')).toBe(0);
  });

  it('weighs CJK characters more heavily than latin words', () => {
    const cjk = estimateTextTokens('你好世界');
    const latin = estimateTextTokens('hi');
    expect(cjk).toBeGreaterThan(latin);
  });

  it('grows monotonically with length', () => {
    const short = estimateTextTokens('hello');
    const long = estimateTextTokens('hello world this is a longer sentence');
    expect(long).toBeGreaterThan(short);
  });
});
