// Tests for the PRODUCTION toLocalDateString function.
// Imports directly from the shared Edge Function module — no inlined copy.
import { describe, it, expect } from "vitest";
import { toLocalDateString } from "@shared/timezone";

// ── Africa/Johannesburg (UTC+2, no DST) ───────────────────────────────────────
// UTC midnight is 02:00 SAST, so events near UTC midnight must map to the
// correct SAST date. This is a real-world case for all SA users.

describe("toLocalDateString — Africa/Johannesburg", () => {
  it("21:59 UTC = 23:59 SAST → still 2026-07-22 (the previous calendar day in UTC is still the same local day)", () => {
    const d = new Date("2026-07-22T21:59:00Z");
    expect(toLocalDateString(d, "Africa/Johannesburg")).toBe("2026-07-22");
  });

  it("22:00 UTC = 00:00 SAST next day → 2026-07-23", () => {
    const d = new Date("2026-07-22T22:00:00Z");
    expect(toLocalDateString(d, "Africa/Johannesburg")).toBe("2026-07-23");
  });

  it("23:59 UTC → 01:59 SAST next day → 2026-07-23", () => {
    const d = new Date("2026-07-22T23:59:00Z");
    expect(toLocalDateString(d, "Africa/Johannesburg")).toBe("2026-07-23");
  });

  it("00:01 UTC → 02:01 SAST same day → 2026-07-23", () => {
    const d = new Date("2026-07-23T00:01:00Z");
    expect(toLocalDateString(d, "Africa/Johannesburg")).toBe("2026-07-23");
  });

  it("mid-afternoon 2026-07-23T12:00Z → 2026-07-23", () => {
    const d = new Date("2026-07-23T12:00:00Z");
    expect(toLocalDateString(d, "Africa/Johannesburg")).toBe("2026-07-23");
  });
});

// ── UTC fallback ──────────────────────────────────────────────────────────────

describe("toLocalDateString — UTC fallback", () => {
  it("UTC timezone: 2026-07-22T23:30:00Z → 2026-07-22", () => {
    const d = new Date("2026-07-22T23:30:00Z");
    expect(toLocalDateString(d, "UTC")).toBe("2026-07-22");
  });

  it("UTC timezone: 2026-07-23T00:30:00Z → 2026-07-23", () => {
    const d = new Date("2026-07-23T00:30:00Z");
    expect(toLocalDateString(d, "UTC")).toBe("2026-07-23");
  });
});

// ── DST-aware timezone (Europe/London) ────────────────────────────────────────
// Verifies the code is not hard-coded to UTC+2. Europe/London is UTC+1 in summer,
// UTC+0 in winter. Testing with a summer date confirms DST offset is applied.

describe("toLocalDateString — DST-aware timezone (Europe/London)", () => {
  it("2026-07-23T22:30:00Z → 23:30 BST (UTC+1) → still 2026-07-23", () => {
    const d = new Date("2026-07-23T22:30:00Z");
    expect(toLocalDateString(d, "Europe/London")).toBe("2026-07-23");
  });

  it("2026-07-23T23:30:00Z → 00:30 BST next day → 2026-07-24", () => {
    const d = new Date("2026-07-23T23:30:00Z");
    expect(toLocalDateString(d, "Europe/London")).toBe("2026-07-24");
  });

  it("2026-12-22T23:30:00Z (winter, UTC+0) → still 2026-12-22", () => {
    const d = new Date("2026-12-22T23:30:00Z");
    expect(toLocalDateString(d, "Europe/London")).toBe("2026-12-22");
  });
});

// ── America/New_York (UTC-5 winter, UTC-4 summer) ─────────────────────────────

describe("toLocalDateString — America/New_York", () => {
  it("2026-07-23T03:00:00Z → 23:00 EDT (UTC-4) → 2026-07-22", () => {
    const d = new Date("2026-07-23T03:00:00Z");
    expect(toLocalDateString(d, "America/New_York")).toBe("2026-07-22");
  });

  it("2026-07-23T04:01:00Z → 00:01 EDT → 2026-07-23", () => {
    const d = new Date("2026-07-23T04:01:00Z");
    expect(toLocalDateString(d, "America/New_York")).toBe("2026-07-23");
  });
});

// ── Output format ─────────────────────────────────────────────────────────────

describe("toLocalDateString — output format", () => {
  it("returns YYYY-MM-DD with zero-padded month and day", () => {
    const d = new Date("2026-01-05T12:00:00Z");
    const result = toLocalDateString(d, "UTC");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result).toBe("2026-01-05");
  });
});
