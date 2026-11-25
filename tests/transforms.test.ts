import { describe, expect, it } from "vitest";
import { applyTransform, lookupValueMap } from "../src/transforms.js";

describe("transforms", () => {
  it("normalizes emails, phones, domains, dates, and amounts", () => {
    expect(applyTransform("email", "  Jordan.Hale@Cedar.EXAMPLE ")).toEqual({
      ok: true,
      value: "jordan.hale@cedar.example",
    });
    expect(applyTransform("phone", "(415) 555-0100")).toEqual({ ok: true, value: "+14155550100" });
    expect(applyTransform("phone", "415.555.0199 x12")).toEqual({ ok: true, value: "+14155550199" });
    expect(applyTransform("phone", "+44 20 7946 0958")).toEqual({ ok: true, value: "+442079460958" });
    expect(applyTransform("phone", "+1 415 555 0172")).toEqual({ ok: true, value: "+14155550172" });
    expect(applyTransform("domain", "https://www.Brightpath.example/home")).toEqual({
      ok: true,
      value: "brightpath.example",
    });
    expect(applyTransform("number", "$48,000.00")).toEqual({ ok: true, value: "48000" });
    const expected = String(Date.UTC(2026, 2, 15));
    expect(applyTransform("date", "2026-03-15")).toEqual({ ok: true, value: expected });
    expect(applyTransform("date", "3/15/2026")).toEqual({ ok: true, value: expected });
    expect(applyTransform("date", "15-Mar-2026")).toEqual({ ok: true, value: expected });
  });

  it("splits person names and rejects values that cannot be stored", () => {
    expect(applyTransform("split_first", "Mary Ann Moss")).toEqual({ ok: true, value: "Mary Ann" });
    expect(applyTransform("split_last", "Mary Ann Moss")).toEqual({ ok: true, value: "Moss" });
    expect(applyTransform("split_last", "Prince")).toEqual({ ok: true, value: "" });
    expect(applyTransform("email", "not-an-email").ok).toBe(false);
    expect(applyTransform("phone", "call me").ok).toBe(false);
    expect(applyTransform("domain", "not a domain").ok).toBe(false);
    expect(applyTransform("date", "yesterday").ok).toBe(false);
    expect(applyTransform("date", "2026-02-31").ok).toBe(false);
    expect(applyTransform("number", "TBD").ok).toBe(false);
  });

  it("matches picklist values without caring about case", () => {
    const map = { "Closed Won": "closedwon", Software: "COMPUTER_SOFTWARE" };
    expect(lookupValueMap(map, "closed won")).toBe("closedwon");
    expect(lookupValueMap(map, "software")).toBe("COMPUTER_SOFTWARE");
    expect(lookupValueMap(map, "Astrology")).toBeUndefined();
  });
});
