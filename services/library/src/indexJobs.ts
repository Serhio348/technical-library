import { randomUUID } from "crypto";
import { env } from "./config.js";
import { _resetIndexJobQueueForTests } from "./indexJobQueue.js";

export type IndexJobStatus = "queued" | "running" | "done" | "failed";

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
  ocr_page: number | null;
  ocr_page_total: number | null;
  elapsed_seconds: number;
  eta_seconds: number | null;
  queue_position: number | null;
  message: string;
};

type IndexJob = IndexJobSnapshot & {
  started_at_ms: number;
  file_started_at_ms: number | null;
};

const jobs = new Map<string, IndexJob>();
const MAX_JOBS = 40;
const MS_PER_OCR_PAGE = 6_000;

function typicalFileMsForJob(job: IndexJob): number {
  if (job.ocr_page_total && job.ocr_page_total > 0) {
    return job.ocr_page_total * MS_PER_OCR_PAGE;
  }
  const lower = job.current_file?.toLowerCase() ?? "";
  if (lower.endsWith(".pdf")) {
    return Math.min(env.LIBRARY_OCR_MAX_PAGES * MS_PER_OCR_PAGE, env.LIBRARY_OCR_TIMEOUT_SEC * 1000);
  }
  return 30_000;
}

function pruneJobs(): void {
  if (jobs.size <= MAX_JOBS) return;
  const sorted = [...jobs.entries()].sort((a, b) => a[1].started_at_ms - b[1].started_at_ms);
  while (jobs.size > MAX_JOBS && sorted.length > 0) {
    const entry = sorted.shift();
    if (entry) jobs.delete(entry[0]);
  }
}

export function indexActionLabel(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".pdf")) return "OCR";
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) return "Word";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "Текст";
  if (/\.(jpe?g|png)$/.test(lower)) return "OCR фото";
  return "Индексация";
}

export function indexActionHint(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return "OCR большого PDF может занять до 15 мин — полоска на 90%+ это нормально, дождитесь завершения.";
  }
  if (lower.endsWith(".docx") || lower.endsWith(".doc") || lower.endsWith(".txt") || lower.endsWith(".md")) {
    return "Word и текстовые файлы индексируются за секунды — OCR не нужен.";
  }
  return null;
}
export function inFileProgressWeight(
  currentFile: string | null,
  fileStartedAtMs: number | null,
  fileEstimateMs: number,
  nowMs = Date.now(),
  ocrPage: number | null = null,
  ocrPageTotal: number | null = null,
): number {
  if (ocrPageTotal && ocrPageTotal > 0 && ocrPage !== null && ocrPage >= 0) {
    return Math.min(0.99, Math.max(0.01, ocrPage / ocrPageTotal));
  }
  if (!currentFile || !fileStartedAtMs) return 0;
  const elapsed = Math.max(0, nowMs - fileStartedAtMs);
  if (elapsed <= 0) return 0.03;

  const estimate = Math.max(fileEstimateMs, 30_000);
  const fastRatio = Math.min(1, elapsed / estimate);
  const fastWeight = 0.03 + fastRatio * 0.89;

  if (fastRatio < 1) return fastWeight;

  const overtimeRatio = Math.min(1, (elapsed - estimate) / (estimate * 4));
  return Math.min(0.99, fastWeight + overtimeRatio * 0.07);
}

export function computePercent(
  processed: number,
  total: number,
  phase: IndexJobPhase,
  currentFile: string | null = null,
  fileStartedAtMs: number | null = null,
  nowMs = Date.now(),
  fileEstimateMs = 120_000,
  ocrPage: number | null = null,
  ocrPageTotal: number | null = null,
): number {
  if (phase === "scanning") return 0;
  if (total <= 0) return processed > 0 ? 100 : 0;
  const inFile = inFileProgressWeight(
    currentFile,
    fileStartedAtMs,
    fileEstimateMs,
    nowMs,
    ocrPage,
    ocrPageTotal,
  );
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
  fileEstimateMs = 120_000,
  ocrPage: number | null = null,
  ocrPageTotal: number | null = null,
): number | null {
  if (total <= 0) return null;
  if (processed >= total) return 0;

  const elapsed = Math.max(0, nowMs - startedAtMs);
  const inFile = inFileProgressWeight(
    currentFile,
    fileStartedAtMs,
    fileEstimateMs,
    nowMs,
    ocrPage,
    ocrPageTotal,
  );
  const effectiveDone = processed + inFile;

  if (effectiveDone > 0) {
    const perUnit = elapsed / effectiveDone;
    return Math.max(0, Math.round((perUnit * (total - effectiveDone)) / 1000));
  }

  return Math.round((total * fileEstimateMs) / 1000);
}

function snapshot(job: IndexJob): IndexJobSnapshot {
  const fileEstimateMs = typicalFileMsForJob(job);
  const nowMs = Date.now();
  const elapsed_seconds =
    job.status === "queued"
      ? 0
      : Math.max(0, Math.round((nowMs - job.started_at_ms) / 1000));
  const percent =
    job.status === "queued"
      ? 0
      : computePercent(
          job.processed,
          job.total,
          job.phase,
          job.current_file,
          job.file_started_at_ms,
          nowMs,
          fileEstimateMs,
          job.ocr_page,
          job.ocr_page_total,
        );
  const eta_seconds =
    job.status === "queued"
      ? null
      : computeEtaSeconds(
          job.started_at_ms,
          job.processed,
          job.total,
          job.current_file,
          job.file_started_at_ms,
          nowMs,
          fileEstimateMs,
          job.ocr_page,
          job.ocr_page_total,
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
    ocr_page: job.ocr_page,
    ocr_page_total: job.ocr_page_total,
    elapsed_seconds,
    eta_seconds,
    queue_position: job.queue_position,
    message: job.message,
  };
}

function touchJob(job: IndexJob, patch: Partial<IndexJob>): void {
  Object.assign(job, patch);
}

/** Проверяет, относится ли задача к папке path (включая batch-загрузки и файлы внутри). */
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

export function indexJobMatchesView(job: IndexJobSnapshot, path: string): boolean {
  if (job.current_file) {
    if (!path) return true;
    return job.current_file === path || job.current_file.startsWith(`${path}/`);
  }
  return indexJobMatchesScope(job.scope_path, path);
}

export function listActiveIndexJobs(slug: string, path = ""): IndexJobSnapshot[] {
  const items: IndexJobSnapshot[] = [];
  for (const job of jobs.values()) {
    if (job.slug !== slug) continue;
    if (job.status !== "running" && job.status !== "queued") continue;
    if (path && !indexJobMatchesView(snapshot(job), path)) continue;
    items.push(snapshot(job));
  }
  items.sort((a, b) => {
    const aq = a.queue_position ?? 999;
    const bq = b.queue_position ?? 999;
    if (aq !== bq) return aq - bq;
    return a.job_id.localeCompare(b.job_id);
  });
  return items;
}

export function getIndexJob(jobId: string): IndexJobSnapshot | null {
  const job = jobs.get(jobId);
  return job ? snapshot(job) : null;
}

export function findRunningIndexJob(slug: string, scopePath: string): IndexJobSnapshot | null {
  return findActiveIndexJob(slug, scopePath);
}

export function findActiveIndexJob(slug: string, scopePath: string): IndexJobSnapshot | null {
  for (const job of jobs.values()) {
    if (
      job.slug === slug &&
      job.scope_path === scopePath &&
      (job.status === "running" || job.status === "queued")
    ) {
      return snapshot(job);
    }
  }
  return null;
}

export function createIndexJob(slug: string, scopePath: string): IndexJob {
  const active = findActiveIndexJob(slug, scopePath);
  if (active) {
    throw new Error("index_job_running");
  }

  const job: IndexJob = {
    job_id: randomUUID(),
    slug,
    scope_path: scopePath,
    status: "queued",
    phase: "scanning",
    total: 0,
    processed: 0,
    updated: 0,
    failed: 0,
    percent: 0,
    current_file: null,
    ocr_page: null,
    ocr_page_total: null,
    elapsed_seconds: 0,
    eta_seconds: null,
    queue_position: null,
    message: "В очереди…",
    started_at_ms: Date.now(),
    file_started_at_ms: null,
  };

  jobs.set(job.job_id, job);
  pruneJobs();
  return job;
}

export function setIndexJobQueuePositions(positions: Map<string, number>): void {
  for (const job of jobs.values()) {
    if (job.status !== "queued") continue;
    const position = positions.get(job.job_id) ?? null;
    touchJob(job, {
      queue_position: position,
      message:
        position === null
          ? "В очереди…"
          : position <= 1
            ? "Скоро начнётся…"
            : `В очереди: ${position}`,
    });
  }
}

export function activateIndexJob(jobId: string): void {
  const job = jobs.get(jobId);
  if (!job || job.status !== "queued") return;
  touchJob(job, {
    status: "running",
    queue_position: null,
    phase: "scanning",
    message: "Поиск файлов…",
    started_at_ms: Date.now(),
    file_started_at_ms: null,
    processed: 0,
    updated: 0,
    failed: 0,
    total: 0,
    percent: 0,
    current_file: null,
    elapsed_seconds: 0,
    eta_seconds: null,
  });
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
  const action = indexActionLabel(filePath);
  const slowHint = action === "OCR" ? " (может занять несколько минут)" : "";
  touchJob(job, {
    phase: "indexing",
    total,
    current_file: filePath,
    ocr_page: null,
    ocr_page_total: null,
    file_started_at_ms: Date.now(),
    message: `${action} ${index + 1}/${total}: ${name}${slowHint}`,
  });
}

export function updateIndexJobOcrPage(jobId: string, page: number, total: number): void {
  const job = jobs.get(jobId);
  if (!job || job.status !== "running") return;
  const name = job.current_file?.split("/").pop() ?? job.current_file ?? "файл";
  touchJob(job, {
    ocr_page: page,
    ocr_page_total: total,
    message: `OCR ${page}/${total} стр.: ${name}`,
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
    ocr_page: null,
    ocr_page_total: null,
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
    ocr_page: null,
    ocr_page_total: null,
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
  _resetIndexJobQueueForTests();
}

export function _getJobKey(slug: string, scopePath: string): string {
  return `${slug}::${scopePath}`;
}
