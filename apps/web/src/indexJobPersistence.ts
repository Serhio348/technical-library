import type { IndexJob } from "./types";
import { indexJobIsActive } from "./indexJobUtils";

const STORAGE_KEY = "tl-index-job-refs";

export type IndexJobRef = { slug: string; job_id: string };

export function loadPersistedIndexJobRefs(): IndexJobRef[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is IndexJobRef =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as IndexJobRef).slug === "string" &&
        typeof (item as IndexJobRef).job_id === "string",
    );
  } catch {
    return [];
  }
}

export function savePersistedIndexJobRefs(jobs: IndexJob[]): void {
  try {
    const refs = jobs
      .filter(indexJobIsActive)
      .map((job) => ({ slug: job.slug, job_id: job.job_id }));
    if (refs.length === 0) {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(refs));
  } catch {
    // ignore quota / private mode
  }
}
