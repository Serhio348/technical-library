import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { createReadStream } from "fs";
import { mkdirSync } from "fs";
import { unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { stat } from "fs/promises";
import { env, resolvedDefaultScopePath } from "./config.js";
import { requireLibrarySecret } from "./auth.js";
import { contentTypeForFilename, isValidRelativePath, isValidSlug } from "./paths.js";
import { ensureUniqueSlug } from "./slugify.js";
import { findActiveIndexJob, findRunningIndexJob, getIndexJob, listActiveIndexJobs } from "./indexJobs.js";
import { startFilesIndexJob, startFolderReindexJob } from "./indexJobRunner.js";
import { answerLibraryQuestion } from "./ask.js";
import {
  isAskAttachmentFilename,
  isImageAttachmentFilename,
  type AskAttachment,
} from "./attachmentExtract.js";
import { extractTextFromImageBuffer } from "./pdfExtract.js";
import { isPhotoOcrUsable } from "./imageOcr.js";
import type { DocumentCatalogEntry } from "./documentCatalog.js";
import { isValidDocumentType } from "./documentCatalog.js";
import {
  buildLibraryContextForQuery,
  createDirection,
  createSubfolder,
  deleteFile,
  deleteSubfolder,
  getTree,
  listDirections,
  listExtractedDocuments,
  readExtractedText,
  readExtractedTextMeta,
  resolveFilePath,
  writeUploadedFile,
  searchInstallation,
  listDocumentCatalog,
  readCatalogEntry,
  writeCatalogEntry,
  writeUploadedFileFromPath,
} from "./storage.js";

const uploadTmpDir = join(tmpdir(), "technical-library-uploads");
mkdirSync(uploadTmpDir, { recursive: true });

async function cleanupMulterTemp(file: Express.Multer.File): Promise<void> {
  if (file.path) await unlink(file.path).catch(() => undefined);
}

function routeSlug(raw: string | string[] | undefined): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0] ?? "";
  return "";
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadTmpDir),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 120);
      cb(null, `${randomUUID()}-${safe}`);
    },
  }),
  limits: {
    fileSize: env.LIBRARY_MAX_FILE_MB * 1024 * 1024,
    files: env.LIBRARY_UPLOAD_MAX_FILES,
  },
});

const photoOcrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

const askUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.LIBRARY_MAX_FILE_MB * 1024 * 1024, files: 1 },
}).fields([
  { name: "image", maxCount: 1 },
  { name: "document", maxCount: 1 },
]);

function pickAskUploadFile(
  req: { file?: Express.Multer.File; files?: Record<string, Express.Multer.File[]> | Express.Multer.File[] },
): Express.Multer.File | undefined {
  const files = req.files;
  if (files && !Array.isArray(files)) {
    const image = files.image?.[0];
    const document = files.document?.[0];
    if (image && document) return undefined;
    return document ?? image;
  }
  return req.file;
}

function parseCsvQuery(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function listDirectionsPayload() {
  const defaultScope = resolvedDefaultScopePath();
  return {
    ...(env.DEFAULT_DIRECTION_SLUG ? { default_direction: env.DEFAULT_DIRECTION_SLUG } : {}),
    ...(defaultScope ? { default_scope_path: defaultScope } : {}),
  };
}

function mountDirectionRoutes(router: Router, root: string, basePath: string): void {
  router.get(basePath, async (_req, res) => {
    try {
      const directions = await listDirections(root);
      res.json({
        directions,
        ...listDirectionsPayload(),
        ...(basePath === "/installations" ? { items: directions, deprecated: "use /directions" } : {}),
      });
    } catch {
      res.status(500).json({ error: "library_unavailable" });
    }
  });

  router.post(basePath, requireLibrarySecret, async (req, res) => {
    const titleRaw = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const slugRaw = typeof req.body?.slug === "string" ? req.body.slug.trim() : "";
    if (!titleRaw && !slugRaw) {
      res.status(400).json({ error: "title_required" });
      return;
    }
    try {
      let slug = slugRaw;
      const title = titleRaw || slugRaw;
      if (!slug) {
        const existing = await listDirections(root);
        slug = ensureUniqueSlug(
          title,
          existing.map((d) => d.slug),
        );
      }
      if (!isValidSlug(slug)) {
        res.status(400).json({ error: "invalid_slug" });
        return;
      }
      const direction = await createDirection(root, slug, title);
      res.status(201).json({ direction, item: direction });
    } catch {
      res.status(500).json({ error: "library_unavailable" });
    }
  });

  router.get(`${basePath}/:slug/tree`, async (req, res) => {
    const slug = routeSlug(req.params.slug);
    const pathParam = typeof req.query.path === "string" ? req.query.path : "";
    if (!isValidSlug(slug) || !isValidRelativePath(pathParam)) {
      res.status(400).json({ error: "invalid_params" });
      return;
    }
    try {
      const tree = await getTree(root, slug, pathParam);
      res.json({ ...tree, direction: slug });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "invalid_slug" || msg === "invalid_path" || msg === "path_traversal") {
        res.status(400).json({ error: "invalid_params" });
        return;
      }
      res.status(500).json({ error: "library_unavailable" });
    }
  });

  router.get(`${basePath}/:slug/catalog`, async (req, res) => {
    const slug = routeSlug(req.params.slug);
    const pathParam = typeof req.query.path === "string" ? req.query.path : "";
    if (!isValidSlug(slug) || !isValidRelativePath(pathParam)) {
      res.status(400).json({ error: "invalid_params" });
      return;
    }
    try {
      const items = await listDocumentCatalog(root, slug, pathParam);
      res.json({ items, direction: slug, scope_path: pathParam || null });
    } catch {
      res.status(500).json({ error: "library_unavailable" });
    }
  });

  router.put(`${basePath}/:slug/catalog`, requireLibrarySecret, async (req, res) => {
    const slug = routeSlug(req.params.slug);
    const pathParam = typeof req.body?.path === "string" ? req.body.path.trim() : "";
    if (!isValidSlug(slug) || !pathParam || !isValidRelativePath(pathParam)) {
      res.status(400).json({ error: "invalid_params" });
      return;
    }

    const docTypeRaw = typeof req.body?.doc_type === "string" ? req.body.doc_type.trim() : "";
    const titleRaw = typeof req.body?.title === "string" ? req.body.title.trim() : "";

    if (docTypeRaw && !isValidDocumentType(docTypeRaw)) {
      res.status(400).json({ error: "invalid_doc_type" });
      return;
    }

    try {
      await stat(resolveFilePath(root, slug, pathParam));
      const current = await readCatalogEntry(root, slug, pathParam);
      const updated: DocumentCatalogEntry = {
        ...current,
        ...(docTypeRaw ? { doc_type: docTypeRaw as DocumentCatalogEntry["doc_type"] } : {}),
        ...(titleRaw ? { title: titleRaw } : {}),
      };
      await writeCatalogEntry(root, slug, updated);
      res.json({ item: updated });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("invalid") || msg.includes("path_traversal")) {
        res.status(400).json({ error: "invalid_params" });
        return;
      }
      res.status(404).json({ error: "not_found" });
    }
  });

  router.post(`${basePath}/:slug/folders`, requireLibrarySecret, async (req, res) => {
    const slug = routeSlug(req.params.slug);
    const pathParam = typeof req.body?.path === "string" ? req.body.path.trim() : "";
    if (!isValidSlug(slug) || !pathParam || !isValidRelativePath(pathParam)) {
      res.status(400).json({ error: "invalid_params" });
      return;
    }
    try {
      await createSubfolder(root, slug, pathParam);
      res.status(201).json({ ok: true, path: pathParam });
    } catch {
      res.status(500).json({ error: "library_unavailable" });
    }
  });

  router.delete(`${basePath}/:slug/folders`, requireLibrarySecret, async (req, res) => {
    const slug = routeSlug(req.params.slug);
    const pathParam = typeof req.query.path === "string" ? req.query.path.trim() : "";
    if (!isValidSlug(slug) || !pathParam || !isValidRelativePath(pathParam)) {
      res.status(400).json({ error: "invalid_params" });
      return;
    }
    try {
      await deleteSubfolder(root, slug, pathParam);
      res.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "folder_not_empty") {
        res.status(409).json({ error: "folder_not_empty" });
        return;
      }
      res.status(404).json({ error: "not_found" });
    }
  });

  router.post(`${basePath}/:slug/upload`, requireLibrarySecret, upload.array("files", env.LIBRARY_UPLOAD_MAX_FILES), async (req, res) => {
    const slug = routeSlug(req.params.slug);
    const relDir = typeof req.body?.path === "string" ? req.body.path.trim() : "";
    if (!isValidSlug(slug) || !isValidRelativePath(relDir)) {
      res.status(400).json({ error: "invalid_params" });
      return;
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const docTypeRaw = typeof req.body?.doc_type === "string" ? req.body.doc_type.trim() : "";
    if (docTypeRaw && !isValidDocumentType(docTypeRaw)) {
      res.status(400).json({ error: "invalid_doc_type" });
      return;
    }
    if (files.length === 0) {
      res.status(400).json({ error: "no_files" });
      return;
    }
    try {
      const saved = [];
      const savedPaths: string[] = [];
      for (const file of files) {
        try {
          const entry = await writeUploadedFileFromPath(root, slug, relDir, file.originalname, file.path);
          if (docTypeRaw) {
            const current = await readCatalogEntry(root, slug, entry.path);
            await writeCatalogEntry(root, slug, { ...current, doc_type: docTypeRaw });
          }
          saved.push(entry);
          savedPaths.push(entry.path);
        } finally {
          await cleanupMulterTemp(file);
        }
      }
      let jobId: string;
      try {
        jobId = startFilesIndexJob(root, slug, relDir, savedPaths, false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg === "index_job_running" && savedPaths.length === 1) {
          const existing = findActiveIndexJob(slug, savedPaths[0]!);
          if (existing) {
            res.status(201).json({
              items: saved,
              indexing: "background",
              job_id: existing.job_id,
              already_indexing: true,
            });
            return;
          }
        }
        throw e;
      }
      res.status(201).json({ items: saved, indexing: "background", job_id: jobId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "invalid_file_type") {
        res.status(400).json({ error: "invalid_file_type" });
        return;
      }
      console.error("[library] upload failed:", msg || e);
      res.status(500).json({ error: "library_unavailable" });
    }
  });

  router.get(`${basePath}/:slug/file`, async (req, res) => {
    const slug = routeSlug(req.params.slug);
    const relFile = typeof req.query.path === "string" ? req.query.path.trim() : "";
    if (!isValidSlug(slug) || !relFile) {
      res.status(400).json({ error: "invalid_params" });
      return;
    }
    try {
      const abs = resolveFilePath(root, slug, relFile);
      const st = await stat(abs);
      res.setHeader("Content-Type", contentTypeForFilename(relFile.split("/").pop() ?? ""));
      res.setHeader("Content-Length", String(st.size));
      res.setHeader("Cache-Control", "no-store");
      createReadStream(abs).pipe(res);
    } catch {
      res.status(404).json({ error: "not_found" });
    }
  });

  router.delete(`${basePath}/:slug/file`, requireLibrarySecret, async (req, res) => {
    const slug = routeSlug(req.params.slug);
    const relFile = typeof req.query.path === "string" ? req.query.path.trim() : "";
    if (!isValidSlug(slug) || !relFile) {
      res.status(400).json({ error: "invalid_params" });
      return;
    }
    try {
      await deleteFile(root, slug, relFile);
      res.json({ ok: true });
    } catch {
      res.status(404).json({ error: "not_found" });
    }
  });

  router.get(`${basePath}/:slug/search`, async (req, res) => {
    const slug = routeSlug(req.params.slug);
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const scopePath = typeof req.query.scope_path === "string" ? req.query.scope_path.trim() : "";
    if (!isValidSlug(slug) || !q.trim() || !isValidRelativePath(scopePath)) {
      res.status(400).json({ error: "invalid_params" });
      return;
    }
    try {
      let hits = await searchInstallation(root, slug, q, 12);
      if (scopePath) {
        hits = hits.filter((h) => h.path === scopePath || h.path.startsWith(`${scopePath}/`));
      }
      const enriched = await Promise.all(
        hits.map(async (hit) => ({
          ...hit,
          text: (await readExtractedText(root, slug, hit.path, 2000)) ?? hit.snippet,
          extraction: await readExtractedTextMeta(root, slug, hit.path),
        })),
      );
      res.json({ items: enriched });
    } catch {
      res.status(500).json({ error: "library_unavailable" });
    }
  });

  router.get(`${basePath}/:slug/context`, async (req, res) => {
    const slug = routeSlug(req.params.slug);
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const folders = parseCsvQuery(req.query.folders);
    const documents = parseCsvQuery(req.query.documents);
    const docTypes = parseCsvQuery(req.query.doc_types);
    const boostTerms = parseCsvQuery(req.query.boost_terms);
    const scopePath = typeof req.query.scope_path === "string" ? req.query.scope_path : "";
    const maxCharsRaw =
      typeof req.query.max_chars === "string" && req.query.max_chars.trim()
        ? Number.parseInt(req.query.max_chars, 10)
        : 20_000;
    const maxChars = Number.isFinite(maxCharsRaw)
      ? Math.max(2000, Math.min(120_000, maxCharsRaw))
      : 20_000;
    if (!isValidSlug(slug) || !q.trim()) {
      res.status(400).json({ error: "invalid_params" });
      return;
    }
    try {
      const items = await buildLibraryContextForQuery(root, slug, q, {
        maxCharsPerDocument: maxChars,
        maxDocuments: 4,
        folders,
        documents,
        doc_types: docTypes.filter(isValidDocumentType),
        boost_terms: boostTerms,
        scope_path: scopePath,
      });
      res.json({ items, direction: slug });
    } catch {
      res.status(500).json({ error: "library_unavailable" });
    }
  });

  router.post(`${basePath}/:slug/ask`, askUpload, async (req, res) => {
    const slug = routeSlug(req.params.slug);
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const scopePath = typeof req.body?.scope_path === "string" ? req.body.scope_path.trim() : "";
    const historyRaw = typeof req.body?.history === "string" ? req.body.history : req.body?.history;
    let history: unknown = [];
    if (typeof historyRaw === "string") {
      try {
        history = JSON.parse(historyRaw) as unknown;
      } catch {
        history = [];
      }
    } else {
      history = historyRaw;
    }
    const mode = req.body?.mode === "full" ? "full" : "preview";
    const uploadFile = pickAskUploadFile(req);
    if (uploadFile === undefined && req.files && !Array.isArray(req.files)) {
      const hasBoth = Boolean(req.files.image?.[0] && req.files.document?.[0]);
      if (hasBoth) {
        res.status(400).json({ error: "invalid_params" });
        return;
      }
    }
    const attachment: AskAttachment | null = uploadFile
      ? { buffer: uploadFile.buffer, filename: uploadFile.originalname || "attachment.bin" }
      : null;
    if (!isValidSlug(slug) || (!message && !attachment?.buffer?.length) || !isValidRelativePath(scopePath)) {
      res.status(400).json({ error: "invalid_params" });
      return;
    }
    if (attachment?.buffer?.length) {
      if (!isAskAttachmentFilename(attachment.filename)) {
        res.status(400).json({ error: "invalid_file_type" });
        return;
      }
      if (isImageAttachmentFilename(attachment.filename)) {
        const mime = uploadFile?.mimetype?.toLowerCase() ?? "";
        if (!mime.startsWith("image/")) {
          res.status(400).json({ error: "invalid_image_type" });
          return;
        }
      }
    }
    try {
      const result = await answerLibraryQuestion(
        root,
        slug,
        message,
        scopePath,
        history,
        mode,
        attachment,
      );
      res.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "deepseek_not_configured") {
        res.status(503).json({ error: "deepseek_not_configured" });
        return;
      }
      if (msg === "extract_no_text" || msg === "ocr_no_text") {
        res.status(422).json({ error: "extract_no_text" });
        return;
      }
      if (msg === "empty_question") {
        res.status(400).json({ error: "invalid_params" });
        return;
      }
      console.error("[library] ask failed:", msg || e);
      res.status(500).json({ error: "ask_failed" });
    }
  });

  router.get(`${basePath}/:slug/extracted-documents`, async (req, res) => {
    const slug = routeSlug(req.params.slug);
    const maxCharsRaw =
      typeof req.query.max_chars === "string" && req.query.max_chars.trim()
        ? Number.parseInt(req.query.max_chars, 10)
        : 120_000;
    const maxChars = Number.isFinite(maxCharsRaw) ? Math.max(1000, Math.min(200_000, maxCharsRaw)) : 120_000;
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "invalid_params" });
      return;
    }
    try {
      const items = await listExtractedDocuments(root, slug, maxChars);
      res.json({ items });
    } catch {
      res.status(500).json({ error: "library_unavailable" });
    }
  });

  router.get(`${basePath}/:slug/reindex/status`, async (req, res) => {
    const slug = routeSlug(req.params.slug);
    const jobId = typeof req.query.job_id === "string" ? req.query.job_id.trim() : "";
    const pathParam = typeof req.query.path === "string" ? req.query.path.trim() : "";
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "invalid_params" });
      return;
    }
    if (req.query.list === "1") {
      res.json({ items: listActiveIndexJobs(slug, pathParam) });
      return;
    }
    const job = jobId ? getIndexJob(jobId) : listActiveIndexJobs(slug, pathParam)[0] ?? null;
    if (!job || job.slug !== slug) {
      res.status(404).json({ error: "job_not_found" });
      return;
    }
    res.json({ job });
  });

  router.post(`${basePath}/:slug/reindex`, requireLibrarySecret, async (req, res) => {
    const slug = routeSlug(req.params.slug);
    const relPath = typeof req.body?.path === "string" ? req.body.path.trim() : "";
    const filesRaw = req.body?.files;
    const filePaths =
      Array.isArray(filesRaw) && filesRaw.every((f) => typeof f === "string")
        ? filesRaw.map((f) => f.trim()).filter(Boolean)
        : [];
    if (!isValidSlug(slug) || !isValidRelativePath(relPath)) {
      res.status(400).json({ error: "invalid_params" });
      return;
    }
    for (const filePath of filePaths) {
      if (!isValidRelativePath(filePath)) {
        res.status(400).json({ error: "invalid_params" });
        return;
      }
    }
    try {
      const running =
        filePaths.length === 1
          ? findRunningIndexJob(slug, filePaths[0]!)
          : filePaths.length > 0
            ? null
            : findRunningIndexJob(slug, relPath);
      if (running) {
        res.status(202).json({ ok: true, status: "running", job_id: running.job_id, job: running });
        return;
      }
      const forceOcr = req.body?.force === true;
      const jobId =
        filePaths.length > 0
          ? startFilesIndexJob(root, slug, relPath, filePaths, forceOcr)
          : startFolderReindexJob(root, slug, relPath);
      const job = getIndexJob(jobId);
      res.status(202).json({
        ok: true,
        status: "running",
        job_id: jobId,
        job,
        message:
          filePaths.length > 0
            ? "Индексация файлов запущена."
            : "Переиндексация папки запущена.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "index_job_running") {
        res.status(409).json({ error: "index_job_running" });
        return;
      }
      res.status(500).json({ error: "library_unavailable" });
    }
  });
}

export function createLibraryRouter(): Router {
  const router = Router();
  const root = env.LIBRARY_ROOT;

  router.post("/ocr", photoOcrUpload.single("image"), async (req, res) => {
    const file = req.file;
    if (!file?.buffer?.length) {
      res.status(400).json({ error: "no_image" });
      return;
    }
    const mime = file.mimetype?.toLowerCase() ?? "";
    if (!mime.startsWith("image/")) {
      res.status(400).json({ error: "invalid_image_type" });
      return;
    }
    try {
      const text = await extractTextFromImageBuffer(file.buffer);
      if (!isPhotoOcrUsable(text)) {
        res.status(422).json({ error: "ocr_no_text" });
        return;
      }
      res.json({ text });
    } catch (e) {
      console.error("[library] image ocr failed:", e instanceof Error ? e.message : e);
      res.status(500).json({ error: "ocr_failed" });
    }
  });

  mountDirectionRoutes(router, root, "/directions");
  mountDirectionRoutes(router, root, "/installations");

  return router;
}
