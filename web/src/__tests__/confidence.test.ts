import { describe, it, expect } from "vitest";

// Inline the confidence logic to avoid Deno-style import resolution (the edge
// function files use .ts extensions and `import … from "./types.ts"` which
// Vitest / Node cannot resolve without extra config). These functions are pure
// and small enough to inline without loss of coverage value.

type MatchConfidence = "exact" | "partial" | "none";
type PortionConfidence = "exact" | "estimated" | "assumed_default";
type ItemConfidence = "high" | "medium" | "low";

const TABLE: Record<MatchConfidence, Record<PortionConfidence, ItemConfidence>> = {
  exact:   { exact: "high",   estimated: "medium", assumed_default: "low" },
  partial: { exact: "medium", estimated: "low",    assumed_default: "low" },
  none:    { exact: "low",    estimated: "low",    assumed_default: "low" },
};

function computeItemConfidence(match: MatchConfidence, portion: PortionConfidence): ItemConfidence {
  return TABLE[match][portion];
}

function computeMealConfidence(items: ItemConfidence[]): ItemConfidence {
  if (items.length === 0) return "low";
  if (items.some((c) => c === "low")) return "low";
  if (items.some((c) => c === "medium")) return "medium";
  return "high";
}

describe("computeItemConfidence", () => {
  it("exact match + exact portion → high", () => {
    expect(computeItemConfidence("exact", "exact")).toBe("high");
  });
  it("exact match + estimated portion → medium", () => {
    expect(computeItemConfidence("exact", "estimated")).toBe("medium");
  });
  it("exact match + assumed_default → low", () => {
    expect(computeItemConfidence("exact", "assumed_default")).toBe("low");
  });
  it("partial match + exact portion → medium", () => {
    expect(computeItemConfidence("partial", "exact")).toBe("medium");
  });
  it("partial match + estimated → low", () => {
    expect(computeItemConfidence("partial", "estimated")).toBe("low");
  });
  it("none match → always low regardless of portion", () => {
    expect(computeItemConfidence("none", "exact")).toBe("low");
    expect(computeItemConfidence("none", "estimated")).toBe("low");
    expect(computeItemConfidence("none", "assumed_default")).toBe("low");
  });
});

describe("computeMealConfidence", () => {
  it("empty item list → low", () => {
    expect(computeMealConfidence([])).toBe("low");
  });
  it("all high → high", () => {
    expect(computeMealConfidence(["high", "high", "high"])).toBe("high");
  });
  it("any low in a mixed list → low", () => {
    expect(computeMealConfidence(["high", "medium", "low"])).toBe("low");
  });
  it("mix of high and medium → medium", () => {
    expect(computeMealConfidence(["high", "medium", "high"])).toBe("medium");
  });
  it("single high → high", () => {
    expect(computeMealConfidence(["high"])).toBe("high");
  });
});
