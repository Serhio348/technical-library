import { randomUUID } from "crypto";
import { env } from "./config.js";

export type IndexJobStatus = "running" | "done" | "failed";

export type IndexJobPhase = "scanning" | "indexing";

export type IndexJobSnapshot = {
  job_id: string;
  slug: string;
  scope_path: string;
  status: IndexJobStatus;
  phase: IndexJobPhase;
  total: number;
  processed: number;
  updated: number;
  failed: number;
  percent: number;
  current_file: string | null;
  elapsed_seconds: number;
  eta_seconds: number | null;
  message: string;
};

type IndexJob = IndexJobSnapshot & {
  started_at_ms: number;
  file_started_at_ms: number | null;
};

const jobs = new Map<string, IndexJob>();
const MAX_JOBS = 40;

function typicalFileMs(): number {
  return Math.min(env.LIBRARY_OCR_TIMEOUT_SEC * 500, 120_000);
}

function pruneJobs(): void {
  if (jobs.size <= MAX_JOBS) return;
  const sorted = [...jobs.entries()].sort((a, b) => a[1].started_at_ms - b[1].started_at_ms);
  while (jobs.size > MAX_JOBS && sorted.length > 0) {
    const entry = sorted.shift();
    if (entry) jobs.delete(entry[0]);
  }
}

/** Доля текущего файла (0…~0.92), пока OCR ещё идёт. */
export function inFileProgressWeight(
  currentFile: string | null,
  fileStartedAtMs: number | null,
  fileEstimateMs: number,
  nowMs = Date.now(),
): number {
  if (!currentFile || !fileStartedAtMs) return 0;
  const elapsed = Math.max(0, nowMs - fileStartedAtMs);
  if (elapsed <= 0) return 0.03;
  const ratio = Math.min(1, elapsed / fileEstimateMs);
  return 0.03 + ratio * 0.89;
}

export function computePercent(
  processed: number,
  total: number,
  phase: IndexJobPhase,
  currentFile: string | null = null,
  fileStartedAtMs: number | null = null,
  nowMs = Date.now(),
  fileEstimateMs = typicalFileMs(),
): number {
  if (phase === "scanning") return 0;
  if (total <= 0) return processed > 0 ? 100 : 0;
  const inFile = inFileProgressWeight(currentFile, fileStartedAtMs, fileEstimateMs, nowMs);
  const raw = ((processed + inFile) / total) * 100;
  if (currentFile && processed < total) {
    return Math.min(99, Math.max(1, Math.round(raw)));
  }
  return Math.min(100, Math.round(raw));
}

export function computeEtaSeconds(
  startedAtMs: number,
  processed: number,
  total: number,
  currentFile: string | null = null,
  fileStartedAtMs: number | null = null,
  nowMs = Date.now(),
  fileEstimateMs = typicalFileMs(),
): number | null {
  if (total <= 0) return null;
  if (processed >= total) return 0;

  const elapsed = Math.max(0, nowMs - startedAtMs);
  const inFile = inFileProgressWeight(currentFile, fileStartedAtMs, fileEstimateMs, nowMs);
  const effectiveDone = processed + inFile;

  if (effectiveDone > 0) {
    const perUnit = elapsed / effectiveDone;
    return Math.max(0, Math.round((perUnit * (total - effectiveDone)) / 1000));
  }

  return Math.round((total * fileEstimateMs) / 1000);
}

function snapshot(job: IndexJob): IndexJobSnapshot {
  const fileEstimateMs = typicalFileMs();
  const nowMs = Date.now();
  const elapsed_seconds = Math.max(0, Math.round((nowMs - job.started_at_ms) / 1000));
  const percent = computePercent(
    job.processed,
    job.total,
    job.phase,
    job.current_file,
    job.file_started_at_ms,
    nowMs,
    fileEstimateMs,
  );
  const eta_seconds = computeEtaSeconds(
    job.started_at_ms,
    job.processed,
    job.total,
    job.current_file,
    job.file_started_at_ms,
    nowMs,
    fileEstimateMs,
  );
  return {
    job_id: job.job_id,
    slug: job.slug,
    scope_path: job.scope_path,
    status: job.status,
    phase: job.phase,
    total: job.total,
    processed: job.processed,
    updated: job.updated,
    failed: job.failed,
    percent,
    current_file: job.current_file,
    elapsed_seconds,
    eta_seconds,
    message: job.message,
  };
}

function touchJob(job: IndexJob, patch: Partial<IndexJob>): void {
  Object.assign(job, patch);
}

export function getIndexJob(jobId: string): IndexJobSnapshot | null {
  const job = jobs.get(jobId);
  return job ? snapshot(job) : null;
}

export function findRunningIndexJob(slug: string, scopePath: string): IndexJobSnapshot | null {
  for (const job of jobs.values()) {
    if (job.slug === slug && job.scope_path === scopePath && job.status === "running") {
      return snapshot(job);
    }
  }
  return null;
}

export function createIndexJob(slug: string, scopePath: string): IndexJob {
  const running = findRunningIndexJob(slug, scopePath);
  if (running) {
    throw new Error("index_job_running");
  }

  const job: IndexJob = {
    job_id: randomUUID(),
    slug,
    scope_path: scopePath,
    status: "running",
    phase: "scanning",
    total: 0,
    processed: 0,
    updated: 0,
    failed: 0,
    percent: 0,
    current_file: null,
    elapsed_seconds: 0,
    eta_seconds: null,
    message: "Поиск файлов…",
    started_at_ms: Date.now(),
    file_started_at_ms: null,
  };

  jobs.set(job.job_id, job);
  pruneJobs();
  return job;
}

export function updateIndexJobScanComplete(jobId: string, total: number): void {
  const job = jobs.get(jobId);
  if (!job || job.status !== "running") return;
  touchJob(job, {
    phase: "indexing",
    total,
    message: total > 0 ? `Индексация: 0 из ${total}` : "Нет файлов для индексации",
  });
}

export function updateIndexJobFileStart(jobId: string, filePath: string, index: number, total: number): void {
  const job = jobs.get(jobId);
  if (!job || job.status !== "running") return;
  const name = filePath.split("/").pop() ?? filePath;
  touchJob(job, {
    phase: "indexing",
    total,
    current_file: filePath,
    file_started_at_ms: Date.now(),
    message: `OCR ${index + 1}/${total}: ${name} (может занять несколько минут)`,
  });
}

export function updateIndexJobFileDone(jobId: string, ok: boolean): void {
  const job = jobs.get(jobId);
  if (!job || job.status !== "running") return;
  touchJob(job, {
    processed: job.processed + 1,
    updated: job.updated + (ok ? 1 : 0),
    failed: job.failed + (ok ? 0 : 1),
    current_file: null,
    file_started_at_ms: null,
    message:
      job.total > 0
        ? `Индексация: ${job.processed + 1} из ${job.total}`
        : "Индексация завершена",
  });
}

export function finishIndexJob(jobId: string, failed: boolean, message?: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  touchJob(job, {
    status: failed ? "failed" : "done",
    phase: "indexing",
    current_file: null,
    file_started_at_ms: null,
    message:
      message ??
      (failed
        ? "Индексация завершилась с ошибкой"
        : job.total > 0
          ? `Готово: ${job.updated} файлов, ошибок ${job.failed}`
          : "Нет файлов для индексации"),
  });
}

export function failIndexJob(jobId: string, message: string): void {
  finishIndexJob(jobId, true, message);
}

/** @internal tests */
export function _resetIndexJobsForTests(): void {
  jobs.clear();
}

export function _getJobKey(slug: string, scopePath: string): string {
  return `${slug}::${scopePath}`;
}
