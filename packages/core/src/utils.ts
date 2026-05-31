/**
 * Shared utility helpers used across the desktop app and bridge packages.
 */

/**
 * Clamp a value to the inclusive range [min, max] and round to the nearest
 * integer. Non-finite or non-numeric input resolves to the provided fallback.
 */
export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(Math.min(max, Math.max(min, numeric)));
}

/**
 * Rough token estimate that accounts for both CJK characters and
 * latin-script words. Intended for budget heuristics, not exact counts.
 */
export function estimateTextTokens(text: string): number {
  let latinUnits = 0;
  let cjkCharCount = 0;
  for (const char of text) {
    if (char.charCodeAt(0) > 127) {
      cjkCharCount++;
    } else if (/\w/.test(char)) {
      latinUnits += 0.25;
    } else {
      latinUnits += 0.15;
    }
  }
  return Math.ceil(cjkCharCount * 0.6 + latinUnits);
}
