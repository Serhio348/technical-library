import type { IndexJob } from "./types";

export function indexJobIsActive(job: IndexJob): boolean {
  return job.status === "running" || job.status === "queued";
}

export function indexJobMatchesScope(scopePath: string, path: string): boolean {
  if (!path) {
    return (
      !scopePath.includes("/") ||
      scopePath.includes("@batch") ||
      scopePath.split("/").length === 1
    );
  }
  if (scopePath === path) return true;
  if (scopePath.startsWith(`${path}@batch`)) return true;
  if (scopePath.startsWith(`${path}/`)) return true;
  if (!scopePath.includes("@batch") && path.startsWith(`${scopePath}/`)) return true;
  return false;
}

export function indexJobMatchesView(job: IndexJob, path: string): boolean {
  if (job.current_file) {
    if (!path) return true;
    return job.current_file === path || job.current_file.startsWith(`${path}/`);
  }
  return indexJobMatchesScope(job.scope_path, path);
}

export function mergeIndexJob(list: IndexJob[], job: IndexJob): IndexJob[] {
  const idx = list.findIndex((j) => j.job_id === job.job_id);
  if (idx >= 0) {
    const copy = [...list];
    copy[idx] = job;
    return copy;
  }
  return [...list, job];
}

export function mergeIndexJobs(list: IndexJob[], jobs: IndexJob[]): IndexJob[] {
  return jobs.reduce(mergeIndexJob, list);
}

export function jobAffectsFile(job: IndexJob, filePath: string): boolean {
  if (!indexJobIsActive(job)) return false;
  if (job.scope_path === filePath) return true;
  if (job.current_file === filePath) return true;
  if (job.status === "queued" && job.scope_path.includes("@batch")) {
    const base = job.scope_path.replace(/@batch.*$/, "");
    return filePath === base || filePath.startsWith(`${base}/`);
  }
  return false;
}
