export interface DelayInput {
  attempt: number;
  retryAfter: string | null;
  random: () => number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * Honor Retry-After when HubSpot sends one. Otherwise exponential backoff
 * with jitter so a retry storm does not line up on the same millisecond.
 */
export function computeDelay(input: DelayInput): number {
  const jitterUnit = clamp01(input.random());
  const header = input.retryAfter?.trim();
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      const base = seconds * 1000;
      return Math.round(base + jitterUnit * base * 0.25);
    }
    const parsed = Date.parse(header);
    if (!Number.isNaN(parsed)) {
      const base = Math.max(0, parsed - Date.now());
      return Math.round(base + jitterUnit * 250);
    }
  }
  const exponential = Math.min(input.maxDelayMs, input.baseDelayMs * 2 ** input.attempt);
  return Math.round(exponential + jitterUnit * exponential * 0.3);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
