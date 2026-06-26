import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "fs/promises";
import { join, relative } from "path";
import {
  extractDocxText,
  extractLegacyDocText,
  extractPdfWithFallback,
  extractTextFile,
} from "./pdfExtract.js";
import {
  isAllowedFilename,
  resolveLegacyFileUnderRoot,
  resolveLegacyUnderRoot,
  resolveUnderRoot,
  safeLibraryFilename,
} from "./paths.js";
import {
  buildDocumentContext,
  documentMatchesQuery,
  queryTerms,
  type DocumentContextOptions,
  type DocumentPage,
} from "./documentSearch.js";
import {
  catalogEntryMatchesPath,
  ensureCatalogSidecar,
  listDocumentCatalog,
  readCatalogEntry,
  writeCatalogEntry,
  type DocumentCatalogEntry,
  type DocumentType,
} from "./documentCatalog.js";
import { assessPdfIndexStatus, resolveIndexDisplay, type TextIndexStatus } from "./indexStatus.js";
import { env } from "./config.js";

export type InstallationMeta = {
  slug: string;
  title: string;
  created_at: string;
};

export type LibraryFileEntry = {
  name: string;
  path: string;
  size: number;
  modified_at: string;
  kind: "file";
  content_type: string;
  has_text: boolean;
  text_index_status: TextIndexStatus;
  text_index_note: string | null;
};

export type LibraryFolderEntry = {
  name: string;
  path: string;
  kind: "folder";
};

export type LibraryTree = {
  slug: string;
  title: string;
  path: string;
  folders: LibraryFolderEntry[];
  files: LibraryFileEntry[];
};

export type SearchHit = {
  path: string;
  name: string;
  snippet: string;
  score: number;
};

export type ExtractedTextMeta = {
  source_document: string;
  extracted_at: string;
  extractor: "pdf-parse" | "tesseract-ocr" | "mammoth" | "legacy-doc-fallback" | "plain-text";
  confidence: number;
  chars: number;
  source_pages?: number;
  indexed_pages?: number;
  index_status?: "ready" | "partial";
  index_note?: string | null;
};

export type TextExtractionOutcome = {
  text: string | null;
  meta: ExtractedTextMeta | null;
  pages: DocumentPage[] | null;
};

export type ReindexResultItem = {
  path: string;
  ok: boolean;
  extractor: ExtractedTextMeta["extractor"] | null;
  chars: number;
  error?: string;
};

export type ReindexResult = {
  processed: number;
  updated: number;
  failed: number;
  items: ReindexResultItem[];
};

export type ExtractedDocument = {
  path: string;
  name: string;
  text: string;
  extraction: ExtractedTextMeta | null;
};

function metaPath(root: string, slug: string): string {
  return resolveUnderRoot(root, slug, "_meta.json");
}

async function writeInstallationMeta(root: string, meta: InstallationMeta): Promise<void> {
  await writeFile(metaPath(root, meta.slug), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

export async function listInstallations(root: string): Promise<InstallationMeta[]> {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const out: InstallationMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.name)) continue;
    out.push(await readInstallationMeta(root, entry.name));
  }

  return out.sort((a, b) => a.title.localeCompare(b.title, "ru"));
}

export async function readInstallationMeta(root: string, slug: string): Promise<InstallationMeta> {
  try {
    const raw = await readFile(metaPath(root, slug), "utf8");
    const parsed = JSON.parse(raw) as { title?: string; created_at?: string };
    const title =
      typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : slug;
    return {
      slug,
      title,
      created_at: typeof parsed.created_at === "string" ? parsed.created_at : new Date(0).toISOString(),
    };
  } catch {
    return { slug, title: slug, created_at: new Date(0).toISOString() };
  }
}

export async function createInstallation(
  root: string,
  slug: string,
  title: string,
): Promise<InstallationMeta> {
  const installRoot = resolveUnderRoot(root, slug);
  await mkdir(installRoot, { recursive: true });
  const meta: InstallationMeta = {
    slug,
    title: title.trim() || slug,
    created_at: new Date().toISOString(),
  };
  await writeInstallationMeta(root, meta);
  return meta;
}

export async function ensureInstallation(root: string, slug: string, title: string): Promise<void> {
  try {
    await stat(resolveUnderRoot(root, slug));
  } catch {
    await createInstallation(root, slug, title);
  }
}

export async function createSubfolder(
  root: string,
  slug: string,
  relPath: string,
): Promise<void> {
  const abs = resolveUnderRoot(root, slug, relPath);
  await mkdir(abs, { recursive: true });
}

export async function deleteSubfolder(root: string, slug: string, relPath: string): Promise<void> {
  const abs = resolveUnderRoot(root, slug, relPath);
  const entries = await readdir(abs);
  const visible = entries.filter(
    (n) =>
      !n.startsWith(".") &&
      !n.endsWith(".extracted.txt") &&
      !n.endsWith(".extracted.meta.json") &&
      !n.endsWith(".extracted.pages.json"),
  );
  if (visible.length > 0) throw new Error("folder_not_empty");
  await rm(abs, { recursive: true });
}

async function fileIndexDisplay(
  root: string,
  slug: string,
  relFile: string,
  hasText: boolean,
): Promise<{ text_index_status: TextIndexStatus; text_index_note: string | null }> {
  if (!hasText) return { text_index_status: "none", text_index_note: null };
  const isPdf = relFile.toLowerCase().endsWith(".pdf");
  const meta = await readExtractedTextMeta(root, slug, relFile);
  const pages = await readExtractedPages(root, slug, relFile);
  return resolveIndexDisplay(meta, isPdf, pages?.length ?? null);
}

async function listDir(
  root: string,
  slug: string,
  relPath: string,
): Promise<{ folders: LibraryFolderEntry[]; files: LibraryFileEntry[] }> {
  const abs = resolveUnderRoot(root, slug, relPath);
  await mkdir(abs, { recursive: true });
  const entries = await readdir(abs, { withFileTypes: true });
  const folders: LibraryFolderEntry[] = [];
  const files: LibraryFileEntry[] = [];

  for (const entry of entries) {
    if (
      entry.name.startsWith(".") ||
      entry.name.endsWith(".extracted.txt") ||
      entry.name.endsWith(".extracted.meta.json") ||
      entry.name.endsWith(".extracted.pages.json")
    ) {
      continue;
    }
    const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      folders.push({ name: entry.name, path: childRel.replace(/\\/g, "/"), kind: "folder" });
      continue;
    }
    if (!entry.isFile() || !isAllowedFilename(entry.name)) continue;
    const st = await stat(join(abs, entry.name));
    const extractedPath = `${childRel}.extracted.txt`;
    let hasText = false;
    try {
      await stat(resolveLegacyUnderRoot(root, slug, extractedPath));
      hasText = true;
    } catch {
      try {
        await stat(resolveUnderRoot(root, slug, extractedPath));
        hasText = true;
      } catch {
        hasText = false;
      }
    }
    const indexDisplay = await fileIndexDisplay(root, slug, childRel.replace(/\\/g, "/"), hasText);
    files.push({
      name: entry.name,
      path: childRel.replace(/\\/g, "/"),
      size: st.size,
      modified_at: st.mtime.toISOString(),
      kind: "file",
      content_type: contentTypeFor(entry.name),
      has_text: hasText,
      text_index_status: indexDisplay.text_index_status,
      text_index_note: indexDisplay.text_index_note,
    });
  }

  folders.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  files.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return { folders, files };
}

function contentTypeFor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".jpeg") || lower.endsWith(".jpg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

async function extractTextFromFile(absFile: string, rel: string): Promise<TextExtractionOutcome> {
  const lower = absFile.toLowerCase();
  let extracted: string | null = null;
  let extractor: ExtractedTextMeta["extractor"] | null = null;
  let confidence = 0;
  let pages: DocumentPage[] | null = null;
  let pdfResult: Awaited<ReturnType<typeof extractPdfWithFallback>> | null = null;

  if (lower.endsWith(".pdf")) {
    pdfResult = await extractPdfWithFallback(absFile);
    extracted = pdfResult.text;
    extractor = pdfResult.extractor;
    confidence = pdfResult.confidence;
    pages = pdfResult.pages;
  } else if (lower.endsWith(".docx")) {
    extracted = await extractDocxText(absFile);
    extractor = "mammoth";
    confidence = 0.8;
  } else if (lower.endsWith(".doc")) {
    extracted = await extractLegacyDocText(absFile);
    extractor = "legacy-doc-fallback";
    confidence = 0.35;
  } else if (lower.endsWith(".md") || lower.endsWith(".txt")) {
    extracted = await extractTextFile(absFile);
    extractor = "plain-text";
    confidence = 1;
  }

  if (!extracted || !extractor) {
    return { text: null, meta: null, pages: null };
  }

  const baseMeta = {
    source_document: rel,
    extracted_at: new Date().toISOString(),
    extractor,
    confidence,
    chars: extracted.length,
  };

  if (pdfResult) {
    const assessment = assessPdfIndexStatus(pdfResult, env.LIBRARY_OCR_MAX_PAGES);
    return {
      text: extracted,
      pages,
      meta: {
        ...baseMeta,
        extractor: pdfResult.extractor,
        confidence: pdfResult.confidence,
        source_pages: assessment.source_pages,
        indexed_pages: assessment.indexed_pages,
        index_status: assessment.index_status,
        index_note: assessment.index_note,
      },
    };
  }

  return {
    text: extracted,
    pages,
    meta: {
      ...baseMeta,
      source_pages: 0,
      indexed_pages: pages?.length ?? 0,
      index_status: "ready" as const,
      index_note: null,
    },
  };
}

async function writeExtractedSidecar(
  root: string,
  slug: string,
  rel: string,
  outcome: TextExtractionOutcome,
): Promise<void> {
  if (!outcome.text || !outcome.meta) return;
  const extractedRel = `${rel}.extracted.txt`;
  const metaRel = `${rel}.extracted.meta.json`;
  const pagesRel = `${rel}.extracted.pages.json`;
  await writeFile(resolveLegacyUnderRoot(root, slug, extractedRel), outcome.text, "utf8");
  await writeFile(
    resolveLegacyUnderRoot(root, slug, metaRel),
    `${JSON.stringify(outcome.meta, null, 2)}\n`,
    "utf8",
  );
  if (outcome.pages && outcome.pages.length > 0) {
    await writeFile(
      resolveLegacyUnderRoot(root, slug, pagesRel),
      `${JSON.stringify({ pages: outcome.pages }, null, 2)}\n`,
      "utf8",
    );
  } else {
    try {
      await unlink(resolveLegacyUnderRoot(root, slug, pagesRel));
    } catch {
      // no pages sidecar
    }
  }
}

async function removeExtractedSidecar(root: string, slug: string, rel: string): Promise<void> {
  try {
    await unlink(resolveLegacyUnderRoot(root, slug, `${rel}.extracted.txt`));
  } catch {
    // no extracted sidecar
  }
  try {
    await unlink(resolveLegacyUnderRoot(root, slug, `${rel}.extracted.meta.json`));
  } catch {
    // no extracted meta sidecar
  }
  try {
    await unlink(resolveLegacyUnderRoot(root, slug, `${rel}.extracted.pages.json`));
  } catch {
    // no extracted pages sidecar
  }
}

export async function getTree(root: string, slug: string, relPath = ""): Promise<LibraryTree> {
  const meta = await readInstallationMeta(root, slug);
  const { folders, files } = await listDir(root, slug, relPath);
  return {
    slug,
    title: meta.title,
    path: relPath.replace(/\\/g, "/"),
    folders,
    files,
  };
}

export async function writeUploadedFile(
  root: string,
  slug: string,
  relDir: string,
  filename: string,
  buffer: Buffer,
): Promise<LibraryFileEntry> {
  const safeFilename = safeLibraryFilename(filename);
  const safeDir = relDir.trim().replace(/\\/g, "/");
  const absDir = resolveUnderRoot(root, slug, safeDir);
  await mkdir(absDir, { recursive: true });
  const absFile = join(absDir, safeFilename);
  await writeFile(absFile, buffer);

  const rel = safeDir ? `${safeDir}/${safeFilename}` : safeFilename;
  const st = await stat(absFile);
  return {
    name: safeFilename,
    path: rel,
    size: st.size,
    modified_at: st.mtime.toISOString(),
    kind: "file",
    content_type: contentTypeFor(filename),
    has_text: false,
    text_index_status: "none",
    text_index_note: null,
  };
}

/** Extract searchable text sidecar for an already stored file. */
export async function indexFileText(
  root: string,
  slug: string,
  rel: string,
): Promise<TextExtractionOutcome> {
  const absFile = resolveFilePath(root, slug, rel);
  const outcome = await extractTextFromFile(absFile, rel);
  await writeExtractedSidecar(root, slug, rel, outcome);
  await ensureCatalogSidecar(root, slug, rel);
  return outcome;
}

export async function saveUploadedFile(
  root: string,
  slug: string,
  relDir: string,
  filename: string,
  buffer: Buffer,
): Promise<LibraryFileEntry> {
  const entry = await writeUploadedFile(root, slug, relDir, filename, buffer);
  const outcome = await indexFileText(root, slug, entry.path);
  const indexDisplay = await fileIndexDisplay(root, slug, entry.path, Boolean(outcome.text));
  return { ...entry, has_text: Boolean(outcome.text), ...indexDisplay };
}

export function resolveFilePath(root: string, slug: string, relFile: string): string {
  const filename = relFile.split(/[/\\]/).pop() ?? "";
  if (!isAllowedFilename(filename)) throw new Error("invalid_file_type");
  try {
    return resolveUnderRoot(root, slug, relFile);
  } catch {
    return resolveLegacyFileUnderRoot(root, slug, relFile);
  }
}

export async function deleteFile(root: string, slug: string, relFile: string): Promise<void> {
  const abs = resolveFilePath(root, slug, relFile);
  await unlink(abs);
  try {
    await unlink(resolveLegacyUnderRoot(root, slug, `${relFile}.extracted.txt`));
  } catch {
    // no extracted sidecar
  }
  try {
    await unlink(resolveLegacyUnderRoot(root, slug, `${relFile}.extracted.meta.json`));
  } catch {
    // no extracted meta sidecar
  }
  try {
    await unlink(resolveLegacyUnderRoot(root, slug, `${relFile}.extracted.pages.json`));
  } catch {
    // no extracted pages sidecar
  }
}

export async function readExtractedText(
  root: string,
  slug: string,
  relFile: string,
  maxChars = 8000,
): Promise<string | null> {
  try {
    const raw = await readFile(resolveLegacyUnderRoot(root, slug, `${relFile}.extracted.txt`), "utf8");
    return raw.trim().slice(0, maxChars) || null;
  } catch {
    return null;
  }
}

export async function readExtractedPages(
  root: string,
  slug: string,
  relFile: string,
): Promise<DocumentPage[] | null> {
  try {
    const raw = await readFile(
      resolveLegacyUnderRoot(root, slug, `${relFile}.extracted.pages.json`),
      "utf8",
    );
    const parsed = JSON.parse(raw) as { pages?: DocumentPage[] };
    return Array.isArray(parsed.pages) && parsed.pages.length > 0 ? parsed.pages : null;
  } catch {
    return null;
  }
}

export async function readExtractedTextMeta(
  root: string,
  slug: string,
  relFile: string,
): Promise<ExtractedTextMeta | null> {
  try {
    const raw = await readFile(
      resolveLegacyUnderRoot(root, slug, `${relFile}.extracted.meta.json`),
      "utf8",
    );
    return JSON.parse(raw) as ExtractedTextMeta;
  } catch {
    return null;
  }
}

export async function listExtractedDocuments(
  root: string,
  slug: string,
  maxCharsPerDocument = 120_000,
): Promise<ExtractedDocument[]> {
  const installRoot = resolveUnderRoot(root, slug);
  const out: ExtractedDocument[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) await walk(abs);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".extracted.txt")) continue;

      const rel = relative(installRoot, abs).replace(/\\/g, "/");
      const sourcePath = rel.replace(/\.extracted\.txt$/, "");
      const text = await readFile(abs, "utf8");
      const trimmed = text.trim();
      if (!trimmed) continue;

      out.push({
        path: sourcePath,
        name: sourcePath.split("/").pop() ?? sourcePath,
        text: trimmed.slice(0, maxCharsPerDocument),
        extraction: await readExtractedTextMeta(root, slug, sourcePath),
      });
    }
  }

  await walk(installRoot);
  out.sort((a, b) => a.path.localeCompare(b.path, "ru"));
  return out;
}

export async function searchInstallation(
  root: string,
  slug: string,
  query: string,
  limit = 8,
): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];

  const installRoot = resolveUnderRoot(root, slug);
  const hits: SearchHit[] = [];
  const terms = queryTerms(q);

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) await walk(abs);
        continue;
      }
      const rel = relative(installRoot, abs).replace(/\\/g, "/");
      if (
        entry.name.endsWith(".extracted.meta.json") ||
        entry.name.endsWith(".extracted.pages.json")
      ) {
        continue;
      }
      if (entry.name.endsWith(".extracted.txt")) {
        const basePath = rel.replace(/\.extracted\.txt$/, "");
        const text = await readFile(abs, "utf8");
        const name = basePath.split("/").pop() ?? basePath;
        if (!documentMatchesQuery(text, name, q)) continue;

        const normalized = text.toLowerCase().replace(/ё/g, "е");
        const score =
          2 +
          terms.reduce((sum, term) => {
            let count = 0;
            let idx = 0;
            while (idx < normalized.length) {
              const hit = normalized.indexOf(term, idx);
              if (hit < 0) break;
              count += 1;
              idx = hit + term.length;
            }
            return sum + count;
          }, 0);

        const firstHit = terms
          .map((term) => normalized.indexOf(term))
          .filter((idx) => idx >= 0)
          .sort((a, b) => a - b)[0];
        const snippetStart = Math.max(0, firstHit ?? 0);
        const snippet = text
          .slice(snippetStart, snippetStart + 220)
          .replace(/\s+/g, " ")
          .trim();

        hits.push({
          path: basePath,
          name,
          snippet: snippet || `Файл: ${name}`,
          score,
        });
        continue;
      }
      if (!isAllowedFilename(entry.name)) continue;
      const nameLower = entry.name.toLowerCase();
      if (nameLower.includes(q.toLowerCase())) {
        hits.push({
          path: rel,
          name: entry.name,
          snippet: `Файл: ${entry.name}`,
          score: 1,
        });
      }
    }
  }

  await walk(installRoot);
  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ru"));
  return hits.slice(0, limit);
}

async function scoreExtractedDocument(
  root: string,
  slug: string,
  basePath: string,
  query: string,
  terms: string[],
): Promise<SearchHit | null> {
  const text = await readExtractedText(root, slug, basePath, 120_000);
  if (!text) return null;
  const name = basePath.split("/").pop() ?? basePath;
  if (!documentMatchesQuery(text, name, query)) return null;

  const normalized = text.toLowerCase().replace(/ё/g, "е");
  let score =
    2 +
    terms.reduce((sum, term) => {
      let count = 0;
      let idx = 0;
      while (idx < normalized.length) {
        const hit = normalized.indexOf(term, idx);
        if (hit < 0) break;
        count += 1;
        idx = hit + term.length;
      }
      return sum + count;
    }, 0);

  const meta = await readExtractedTextMeta(root, slug, basePath);
  if (meta?.index_status === "partial") score *= 0.85;

  const firstHit = terms
    .map((term) => normalized.indexOf(term))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b)[0];
  const snippetStart = Math.max(0, firstHit ?? 0);
  const snippet = text
    .slice(snippetStart, snippetStart + 220)
    .replace(/\s+/g, " ")
    .trim();

  return {
    path: basePath,
    name,
    snippet: snippet || `Файл: ${name}`,
    score,
  };
}

export async function searchInstallationPaths(
  root: string,
  slug: string,
  query: string,
  paths: string[],
  limit = 8,
): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q || paths.length === 0) return [];

  const terms = queryTerms(q);
  const hits: SearchHit[] = [];
  for (const path of paths) {
    const hit = await scoreExtractedDocument(root, slug, path.replace(/\\/g, "/"), q, terms);
    if (hit) hits.push(hit);
  }

  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ru"));
  return hits.slice(0, limit);
}

function filterHitsByDocuments(hits: SearchHit[], documents: string[]): SearchHit[] {
  if (documents.length === 0) return hits;
  return hits.filter((hit) =>
    documents.some((doc) => catalogEntryMatchesPath({ path: hit.path } as DocumentCatalogEntry, doc)),
  );
}

function filterHitsByDocTypes(
  hits: SearchHit[],
  docTypes: DocumentType[],
  catalog: DocumentCatalogEntry[],
): SearchHit[] {
  if (docTypes.length === 0) return hits;
  const byPath = new Map(catalog.map((entry) => [entry.path, entry]));
  return hits.filter((hit) => {
    const entry = byPath.get(hit.path);
    return entry ? docTypes.includes(entry.doc_type) : false;
  });
}

function resolveCatalogDocumentPaths(
  catalog: DocumentCatalogEntry[],
  documents: string[],
): string[] {
  if (documents.length === 0) return [];
  const paths = new Set<string>();
  for (const filter of documents) {
    for (const entry of catalog) {
      if (catalogEntryMatchesPath(entry, filter)) paths.add(entry.path);
    }
  }
  return [...paths];
}

export type LibraryContextItem = {
  path: string;
  name: string;
  text: string;
  extraction: ExtractedTextMeta | null;
};

export async function buildLibraryContextForQuery(
  root: string,
  slug: string,
  query: string,
  options: {
    maxCharsPerDocument?: number;
    maxDocuments?: number;
    folders?: string[];
    documents?: string[];
    doc_types?: DocumentType[];
    boost_terms?: string[];
    scope_path?: string;
  } = {},
): Promise<LibraryContextItem[]> {
  const maxCharsPerDocument = options.maxCharsPerDocument ?? 20_000;
  const maxDocuments = options.maxDocuments ?? 4;
  const folders = options.folders ?? [];
  const documents = options.documents ?? [];
  const docTypes = options.doc_types ?? [];
  const contextOptions: DocumentContextOptions = {
    boostTerms: options.boost_terms,
  };

  const catalog = await listDocumentCatalog(root, slug, options.scope_path ?? "");
  const routedPaths = resolveCatalogDocumentPaths(catalog, documents);

  let hits: SearchHit[];
  if (routedPaths.length > 0) {
    hits = await searchInstallationPaths(root, slug, query, routedPaths, 12);
  } else {
    hits = await searchInstallation(root, slug, query, 12);
  }

  let filtered =
    folders.length > 0
      ? hits.filter((h) => folders.some((f) => h.path.startsWith(`${f}/`) || h.path.includes(`/${f}/`)))
      : hits;
  filtered = filterHitsByDocTypes(filtered, docTypes, catalog);
  filtered = filterHitsByDocuments(filtered, documents);

  const items: LibraryContextItem[] = [];
  for (const hit of filtered.slice(0, maxDocuments)) {
    const fullText = await readExtractedText(root, slug, hit.path, 120_000);
    if (!fullText) continue;
    const pages = await readExtractedPages(root, slug, hit.path);
    const text = buildDocumentContext(fullText, query, maxCharsPerDocument, pages, contextOptions);
    items.push({
      path: hit.path,
      name: hit.name,
      text,
      extraction: await readExtractedTextMeta(root, slug, hit.path),
    });
  }

  return items;
}

export { listDocumentCatalog, readCatalogEntry, writeCatalogEntry };

export async function reindexInstallation(
  root: string,
  slug: string,
  relPath = "",
): Promise<ReindexResult> {
  const installRoot = resolveUnderRoot(root, slug);
  const absDir = relPath ? resolveUnderRoot(root, slug, relPath) : installRoot;
  await mkdir(absDir, { recursive: true });
  const items: ReindexResultItem[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "readdir_failed";
      throw new Error(`reindex_readdir_failed:${msg}`);
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) {
          try {
            await walk(abs);
          } catch (e) {
            const msg = e instanceof Error ? e.message : "walk_failed";
            items.push({
              path: relative(installRoot, abs).replace(/\\/g, "/"),
              ok: false,
              extractor: null,
              chars: 0,
              error: msg,
            });
          }
        }
        continue;
      }
      if (
        entry.name.endsWith(".extracted.txt") ||
        entry.name.endsWith(".extracted.meta.json") ||
        entry.name.endsWith(".extracted.pages.json")
      ) {
        continue;
      }
      if (!entry.isFile() || !isAllowedFilename(entry.name)) continue;

      const rel = relative(installRoot, abs).replace(/\\/g, "/");
      try {
        const outcome = await extractTextFromFile(abs, rel);
        await removeExtractedSidecar(root, slug, rel);
        await writeExtractedSidecar(root, slug, rel, outcome);
        items.push({
          path: rel,
          ok: true,
          extractor: outcome.meta?.extractor ?? null,
          chars: outcome.text?.length ?? 0,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "reindex_failed";
        items.push({
          path: rel,
          ok: false,
          extractor: null,
          chars: 0,
          error: msg,
        });
      }
    }
  }

  await walk(absDir);
  items.sort((a, b) => a.path.localeCompare(b.path, "ru"));
  const updated = items.filter((item) => item.ok && item.chars > 0).length;
  const failed = items.filter((item) => !item.ok).length;
  return {
    processed: items.length,
    updated,
    failed,
    items,
  };
}
