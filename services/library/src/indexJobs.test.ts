import { describe, expect, it } from "vitest";
import { computeEtaSeconds, computePercent, inFileProgressWeight } from "./indexJobs.js";

describe("computePercent", () => {
  it("returns 0 while scanning", () => {
    expect(computePercent(0, 10, "scanning")).toBe(0);
  });

  it("calculates indexing percent for completed files", () => {
    expect(computePercent(5, 10, "indexing")).toBe(50);
    expect(computePercent(10, 10, "indexing")).toBe(100);
  });

  it("shows partial progress while current file is processing", () => {
    const started = 1_000_000;
    const now = started + 45_000;
    const pct = computePercent(0, 1, "indexing", "doc.pdf", started, now, 90_000);
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThan(100);
  });
});

describe("inFileProgressWeight", () => {
  it("grows over time", () => {
    const t0 = 1_000_000;
    const w1 = inFileProgressWeight("a.pdf", t0, 60_000, t0 + 10_000);
    const w2 = inFileProgressWeight("a.pdf", t0, 60_000, t0 + 30_000);
    expect(w2).toBeGreaterThan(w1);
  });

  it("creeps past plateau during long OCR", () => {
    const t0 = 1_000_000;
    const estimate = 60_000;
    const atEstimate = inFileProgressWeight("a.pdf", t0, estimate, t0 + estimate);
    const later = inFileProgressWeight("a.pdf", t0, estimate, t0 + estimate * 2);
    expect(atEstimate).toBeCloseTo(0.92, 2);
    expect(later).toBeGreaterThan(atEstimate);
    expect(later).toBeLessThanOrEqual(0.97);
  });
});

describe("computeEtaSeconds", () => {
  it("estimates remaining time with in-progress file", () => {
    const started = 1_000_000;
    const fileStarted = started + 5_000;
    const now = started + 65_000;
    const eta = computeEtaSeconds(started, 0, 3, "a.pdf", fileStarted, now, 90_000);
    expect(eta).not.toBeNull();
    expect(eta!).toBeGreaterThan(0);
  });

  it("returns null when done or empty", () => {
    expect(computeEtaSeconds(1000, 0, 0)).toBeNull();
    expect(computeEtaSeconds(1000, 5, 5)).toBe(0);
  });
});
