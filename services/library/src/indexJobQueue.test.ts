import { describe, expect, it, vi } from "vitest";
import {
  _resetIndexJobsForTests,
  createIndexJob,
  getIndexJob,
} from "./indexJobs.js";
import {
  countActiveIndexWorkers,
  countPendingIndexJobs,
  getMaxConcurrentIndexJobs,
  scheduleIndexJob,
} from "./indexJobQueue.js";

describe("index job queue", () => {
  it("runs at most three jobs in parallel by default", async () => {
    _resetIndexJobsForTests();
    const max = getMaxConcurrentIndexJobs();
    expect(max).toBe(3);

    let running = 0;
    let maxRunning = 0;
    const release: Array<() => void> = [];

    for (let i = 0; i < 5; i += 1) {
      const job = createIndexJob("test", `scope-${i}`);
      scheduleIndexJob(
        job.job_id,
        () =>
          new Promise<void>((resolve) => {
            running += 1;
            maxRunning = Math.max(maxRunning, running);
            release.push(() => {
              running -= 1;
              resolve();
            });
          }),
      );
    }

    await vi.waitFor(() => {
      expect(countActiveIndexWorkers()).toBe(max);
      expect(countPendingIndexJobs()).toBe(2);
    });

    expect(maxRunning).toBeLessThanOrEqual(max);

    while (release.length > 0) {
      release.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    }

    await vi.waitFor(() => {
      expect(countActiveIndexWorkers()).toBe(0);
      expect(countPendingIndexJobs()).toBe(0);
    });
  });

  it("reports queue position for waiting jobs", async () => {
    _resetIndexJobsForTests();
    const release: Array<() => void> = [];

    for (let i = 0; i < 3; i += 1) {
      const job = createIndexJob("slug", `block-${i}`);
      scheduleIndexJob(
        job.job_id,
        () =>
          new Promise<void>((resolve) => {
            release.push(() => resolve());
          }),
      );
    }

    await vi.waitFor(() => expect(countActiveIndexWorkers()).toBe(3));

    const queued = createIndexJob("slug", "waiting.pdf");
    scheduleIndexJob(queued.job_id, async () => undefined);

    await vi.waitFor(() => {
      const snap = getIndexJob(queued.job_id);
      expect(snap?.status).toBe("queued");
      expect(snap?.queue_position).toBe(4);
    });

    for (const done of release) done();
    await vi.waitFor(() => expect(countActiveIndexWorkers()).toBe(0));
  });
});
