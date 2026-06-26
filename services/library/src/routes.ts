import { Router } from "express";
import multer from "multer";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { env, resolvedDefaultScopePath } from "./config.js";
import { requireLibrarySecret } from "./auth.js";
import { contentTypeForFilename, isValidRelativePath, isValidSlug } from "./paths.js";
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
  reindexInstallation,
  resolveFilePath,
  indexFileText,
  writeUploadedFile,
  searchInstallation,
  listDocumentCatalog,
  readCatalogEntry,
  writeCatalogEntry,
} from "./storage.js";

function routeSlug(raw: string | string[] | undefined): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0] ?? "";
  return "";
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.LIBRARY_MAX_FILE_MB * 1024 * 1024, files: 10 },
});

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
    const slug = typeof req.body?.slug === "string" ? req.body.slug.trim() : "";
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : slug;
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "invalid_slug" });
      return;
    }
    try {
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

  router.post(`${basePath}/:slug/upload`, requireLibrarySecret, upload.array("files", 10), async (req, res) => {
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
      for (const file of files) {
        const entry = await writeUploadedFile(root, slug, relDir, file.originalname, file.buffer);
        if (docTypeRaw) {
          const current = await readCatalogEntry(root, slug, entry.path);
          await writeCatalogEntry(root, slug, { ...current, doc_type: docTypeRaw });
        }
        saved.push(entry);
        void indexFileText(root, slug, entry.path).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[library] index after upload failed path=${entry.path}:`, msg);
        });
      }
      res.status(201).json({ items: saved, indexing: "background" });
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
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "invalid_params" });
      return;
    }
    try {
      const hits = await searchInstallation(root, slug, q);
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

  router.post(`${basePath}/:slug/reindex`, requireLibrarySecret, async (req, res) => {
    const slug = routeSlug(req.params.slug);
    const relPath = typeof req.body?.path === "string" ? req.body.path.trim() : "";
    if (!isValidSlug(slug) || !isValidRelativePath(relPath)) {
      res.status(400).json({ error: "invalid_params" });
      return;
    }
    void reindexInstallation(root, slug, relPath)
      .then((result) => {
        console.log(
          `[library] reindex done direction=${slug} path=${relPath || "/"} processed=${result.processed} updated=${result.updated} failed=${result.failed}`,
        );
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[library] reindex failed direction=${slug} path=${relPath || "/"}:`, msg || e);
      });
    res.status(202).json({
      ok: true,
      status: "running",
      message:
        "Переиндексация запущена в фоне (OCR может занять 10–20 мин). Следите: docker logs -f technical-library",
    });
  });
}

export function createLibraryRouter(): Router {
  const router = Router();
  const root = env.LIBRARY_ROOT;

  mountDirectionRoutes(router, root, "/directions");
  mountDirectionRoutes(router, root, "/installations");

  return router;
}
