import { describe, expect, it } from "vitest";
import { computeDelay } from "../src/hubspot/retry.js";

describe("rate limit delay", () => {
  const base = { baseDelayMs: 100, maxDelayMs: 1_000 };

  it("honors Retry-After seconds and adds jitter", () => {
    expect(computeDelay({ ...base, attempt: 0, retryAfter: "2", random: () => 0 })).toBe(2_000);
    expect(computeDelay({ ...base, attempt: 4, retryAfter: "2", random: () => 1 })).toBe(2_500);
    expect(computeDelay({ ...base, attempt: 0, retryAfter: "0", random: () => 0 })).toBe(0);
  });

  it("uses exponential backoff with jitter when Retry-After is absent", () => {
    expect(computeDelay({ ...base, attempt: 0, retryAfter: null, random: () => 0 })).toBe(100);
    expect(computeDelay({ ...base, attempt: 3, retryAfter: null, random: () => 0 })).toBe(800);
    expect(computeDelay({ ...base, attempt: 8, retryAfter: null, random: () => 0 })).toBe(1_000);
    expect(computeDelay({ ...base, attempt: 1, retryAfter: null, random: () => 1 })).toBe(260);
  });
});
