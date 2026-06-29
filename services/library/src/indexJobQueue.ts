import { env } from "./config.js";
import { activateIndexJob, setIndexJobQueuePositions } from "./indexJobs.js";

type QueuedIndexTask = {
  jobId: string;
  run: () => Promise<void>;
};

const pending: QueuedIndexTask[] = [];
let activeCount = 0;

export function getMaxConcurrentIndexJobs(): number {
  return env.LIBRARY_INDEX_MAX_CONCURRENT;
}

export function countActiveIndexWorkers(): number {
  return activeCount;
}

export function countPendingIndexJobs(): number {
  return pending.length;
}

function syncQueuePositions(): void {
  const positions = new Map<string, number>();
  pending.forEach((task, index) => {
    positions.set(task.jobId, activeCount + index + 1);
  });
  setIndexJobQueuePositions(positions);
}

function drainQueue(): void {
  while (activeCount < getMaxConcurrentIndexJobs() && pending.length > 0) {
    const task = pending.shift()!;
    void runTask(task);
  }
  syncQueuePositions();
}

async function runTask(task: QueuedIndexTask): Promise<void> {
  activateIndexJob(task.jobId);
  activeCount += 1;
  syncQueuePositions();
  try {
    await task.run();
  } finally {
    activeCount = Math.max(0, activeCount - 1);
    drainQueue();
  }
}

export function scheduleIndexJob(jobId: string, run: () => Promise<void>): void {
  pending.push({ jobId, run });
  syncQueuePositions();
  drainQueue();
}

/** @internal tests */
export function _resetIndexJobQueueForTests(): void {
  pending.length = 0;
  activeCount = 0;
}
