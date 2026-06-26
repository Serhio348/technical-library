import { describe, expect, it } from "vitest";
import { computeEtaSeconds, computePercent } from "./indexJobs.js";

describe("computePercent", () => {
  it("returns 0 while scanning", () => {
    expect(computePercent(0, 10, "scanning")).toBe(0);
  });

  it("calculates indexing percent", () => {
    expect(computePercent(5, 10, "indexing")).toBe(50);
    expect(computePercent(10, 10, "indexing")).toBe(100);
  });
});

describe("computeEtaSeconds", () => {
  it("estimates remaining time", () => {
    const started = 1_000_000;
    const now = started + 10_000;
    expect(computeEtaSeconds(started, 2, 10, now)).toBe(40);
  });

  it("returns null when done or empty", () => {
    expect(computeEtaSeconds(1000, 0, 5)).toBeNull();
    expect(computeEtaSeconds(1000, 5, 5)).toBeNull();
  });
});
