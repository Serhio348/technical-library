import { randomUUID } from "crypto";
import {
  createIndexJob,
  failIndexJob,
  finishIndexJob,
  updateIndexJobFileDone,
  updateIndexJobFileStart,
  updateIndexJobScanComplete,
} from "./indexJobs.js";
import { indexFileText, listIndexableFiles, reindexSingleFile } from "./storage.js";

/** Scope job key: one file — путь файла; несколько — уникальный batch (не блокирует папку). */
export function indexJobScopeForFiles(scopePath: string, filePaths: string[]): string {
  if (filePaths.length === 1) return filePaths[0]!;
  return `${scopePath}@batch-${randomUUID().slice(0, 8)}`;
}

export function startFolderReindexJob(root: string, slug: string, relPath: string): string {
  const job = createIndexJob(slug, relPath);
  void runFolderReindexJob(root, slug, relPath, job.job_id);
  return job.job_id;
}

export function startFilesIndexJob(
  root: string,
  slug: string,
  scopePath: string,
  filePaths: string[],
  force = false,
): string {
  const jobScope = indexJobScopeForFiles(scopePath, filePaths);
  const job = createIndexJob(slug, jobScope);
  void runFilesIndexJob(root, slug, job.job_id, filePaths, force);
  return job.job_id;
}

async function runFolderReindexJob(
  root: string,
  slug: string,
  relPath: string,
  jobId: string,
): Promise<void> {
  try {
    const paths = await listIndexableFiles(root, slug, relPath);
    updateIndexJobScanComplete(jobId, paths.length);
    if (paths.length === 0) {
      finishIndexJob(jobId, false);
      return;
    }

    for (let i = 0; i < paths.length; i += 1) {
      const path = paths[i]!;
      updateIndexJobFileStart(jobId, path, i, paths.length);
      const item = await reindexSingleFile(root, slug, path);
      updateIndexJobFileDone(jobId, item.ok);
    }
    finishIndexJob(jobId, false);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "reindex_failed";
    failIndexJob(jobId, msg);
  }
}

async function runFilesIndexJob(
  root: string,
  slug: string,
  jobId: string,
  filePaths: string[],
  force: boolean,
): Promise<void> {
  try {
    updateIndexJobScanComplete(jobId, filePaths.length);
    if (filePaths.length === 0) {
      finishIndexJob(jobId, false);
      return;
    }

    for (let i = 0; i < filePaths.length; i += 1) {
      const path = filePaths[i]!;
      updateIndexJobFileStart(jobId, path, i, filePaths.length);
      try {
        if (force) {
          const item = await reindexSingleFile(root, slug, path);
          updateIndexJobFileDone(jobId, item.ok);
        } else {
          await indexFileText(root, slug, path);
          updateIndexJobFileDone(jobId, true);
        }
      } catch {
        updateIndexJobFileDone(jobId, false);
      }
    }
    finishIndexJob(jobId, false);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "index_failed";
    failIndexJob(jobId, msg);
  }
}
