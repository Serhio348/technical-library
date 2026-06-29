import { describe, expect, it } from "vitest";
import {
  computeEtaSeconds,
  computePercent,
  inFileProgressWeight,
  indexJobMatchesScope,
  indexJobMatchesView,
} from "./indexJobs.js";
import type { IndexJobSnapshot } from "./indexJobs.js";

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

describe("indexJobMatchesScope", () => {
  it("matches folder and batch upload scopes", () => {
    expect(indexJobMatchesScope("tkp", "tkp")).toBe(true);
    expect(indexJobMatchesScope("tkp@batch-abc", "tkp")).toBe(true);
    expect(indexJobMatchesScope("tkp/docs", "tkp")).toBe(true);
    expect(indexJobMatchesScope("other", "tkp")).toBe(false);
  });

  it("matches nested paths", () => {
    expect(indexJobMatchesScope("tkp/docs", "tkp/docs")).toBe(true);
    expect(indexJobMatchesScope("tkp/docs@batch-x", "tkp/docs")).toBe(true);
    expect(indexJobMatchesScope("tkp/docs/file.pdf", "tkp/docs")).toBe(true);
  });

  it("matches parent folder reindex from child path", () => {
    expect(indexJobMatchesScope("tkp", "tkp/docs")).toBe(true);
    expect(indexJobMatchesScope("tkp@batch-x", "tkp/docs")).toBe(false);
  });
});

describe("indexJobMatchesView", () => {
  const base = (patch: Partial<IndexJobSnapshot>): IndexJobSnapshot => ({
    job_id: "1",
    slug: "gas",
    scope_path: "tkp",
    status: "running",
    phase: "indexing",
    total: 1,
    processed: 0,
    updated: 0,
    failed: 0,
    percent: 0,
    current_file: null,
    elapsed_seconds: 0,
    eta_seconds: null,
    queue_position: null,
    message: "",
    ...patch,
  });

  it("uses current_file for batch uploads", () => {
    expect(
      indexJobMatchesView(base({ scope_path: "tkp@batch-1", current_file: "tkp/a.pdf" }), "tkp"),
    ).toBe(true);
    expect(
      indexJobMatchesView(base({ scope_path: "tkp@batch-1", current_file: "other/a.pdf" }), "tkp"),
    ).toBe(false);
  });
});
