import { updateIndexJobOcrPage } from "./indexJobs.js";

let activeJobId: string | null = null;

export async function runWithIndexJobContext<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  activeJobId = jobId;
  try {
    return await fn();
  } finally {
    activeJobId = null;
  }
}

export function reportIndexJobOcrPage(page: number, total: number): void {
  if (!activeJobId || total <= 0) return;
  updateIndexJobOcrPage(activeJobId, page, total);
}
