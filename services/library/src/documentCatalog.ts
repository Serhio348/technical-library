import { readFile, writeFile } from "fs/promises";
import { join, relative } from "path";
import { isAllowedFilename, resolveUnderRoot } from "./paths.js";

export const DOCUMENT_TYPES = [
  "law",
  "standard",
  "tkp",
  "regulation",
  "instruction",
  "classifier",
  "other",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export function isValidDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

export type DocumentCatalogEntry = {
  doc_id: string;
  path: string;
  title: string;
  doc_type: DocumentType;
  topics: string[];
  aliases: string[];
  references: string[];
  sections_hint: Record<string, string>;
  priority: number;
};

function catalogSidecarRel(sourcePath: string): string {
  return `${sourcePath}.library.json`;
}

function slugifyDocId(path: string): string {
  const base = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "document";
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function detectDocType(path: string): DocumentType {
  const nameLower = (path.split("/").pop() ?? path).toLowerCase();
  if (/классиф|classif|okof|окоф|окpd/i.test(nameLower)) return "classifier";
  if (/^fz|фз|закон|kodex|кодекс/i.test(nameLower)) return "law";
  if (/gost|гост|\bsp[\s_-]|\bсп[\s_-]/i.test(nameLower)) return "standard";
  if (/tkp|ткp|typov/i.test(nameLower)) return "tkp";
  if (/prikaz|приказ|postanov|постанов|pravil|правил|reglament|регламент/i.test(nameLower)) return "regulation";
  if (/инструк|instruction/i.test(nameLower)) return "instruction";
  return "other";
}

function defaultTopics(docType: DocumentType): string[] {
  switch (docType) {
    case "law":
      return ["закон", "норма", "требование", "ответственность"];
    case "standard":
      return ["стандарт", "гост", "сп", "технические требования"];
    case "tkp":
      return ["типовой проект", "ткp", "проектирование"];
    case "regulation":
      return ["правила", "приказ", "регламент", "порядок"];
    case "instruction":
      return ["инструкция", "процедура", "безопасность"];
    case "classifier":
      return ["код", "классификатор", "номенклатура"];
    default:
      return [];
  }
}

function defaultPriority(docType: DocumentType): number {
  switch (docType) {
    case "law":
      return 10;
    case "regulation":
      return 9;
    case "standard":
      return 8;
    case "tkp":
      return 7;
    case "instruction":
      return 6;
    case "classifier":
      return 5;
    default:
      return 1;
  }
}

function defaultSectionsHint(_docType: DocumentType): Record<string, string> {
  return {};
}

function defaultReferences(_path: string, _docType: DocumentType): string[] {
  return [];
}

function defaultAliases(path: string, docType: DocumentType): string[] {
  const name = path.split("/").pop() ?? path;
  const aliases = new Set<string>([name]);
  if (docType === "law") aliases.add("закон");
  if (docType === "standard") {
    aliases.add("гост");
    aliases.add("сп");
  }
  if (docType === "tkp") aliases.add("ткp");
  if (docType === "regulation") aliases.add("правила");
  if (docType === "instruction") aliases.add("инструкция");
  if (docType === "classifier") aliases.add("классификатор");
  return [...aliases];
}

export function inferCatalogEntry(path: string): DocumentCatalogEntry {
  const normalizedPath = path.replace(/\\/g, "/");
  const docType = detectDocType(normalizedPath);
  const fileName = normalizedPath.split("/").pop() ?? normalizedPath;

  return {
    doc_id: slugifyDocId(normalizedPath),
    path: normalizedPath,
    title: fileName.replace(/\.[^.]+$/, ""),
    doc_type: docType,
    topics: defaultTopics(docType),
    aliases: defaultAliases(normalizedPath, docType),
    references: defaultReferences(normalizedPath, docType),
    sections_hint: defaultSectionsHint(docType),
    priority: defaultPriority(docType),
  };
}

function mergeCatalogEntry(
  inferred: DocumentCatalogEntry,
  stored: Partial<DocumentCatalogEntry>,
): DocumentCatalogEntry {
  return {
    doc_id: stored.doc_id?.trim() || inferred.doc_id,
    path: inferred.path,
    title: stored.title?.trim() || inferred.title,
    doc_type: stored.doc_type ?? inferred.doc_type,
    topics: stored.topics?.length ? stored.topics : inferred.topics,
    aliases: stored.aliases?.length
      ? [...new Set([...inferred.aliases, ...stored.aliases])]
      : inferred.aliases,
    references: stored.references?.length
      ? [...new Set([...inferred.references, ...stored.references])]
      : inferred.references,
    sections_hint: { ...inferred.sections_hint, ...(stored.sections_hint ?? {}) },
    priority: stored.priority ?? inferred.priority,
  };
}

export async function readCatalogEntry(
  root: string,
  slug: string,
  sourcePath: string,
): Promise<DocumentCatalogEntry> {
  const inferred = inferCatalogEntry(sourcePath);
  const sidecar = resolveUnderRoot(root, slug, catalogSidecarRel(sourcePath));
  try {
    const raw = JSON.parse(await readFile(sidecar, "utf8")) as Partial<DocumentCatalogEntry>;
    return mergeCatalogEntry(inferred, raw);
  } catch {
    return inferred;
  }
}

export async function writeCatalogEntry(
  root: string,
  slug: string,
  entry: DocumentCatalogEntry,
): Promise<void> {
  const sidecar = resolveUnderRoot(root, slug, catalogSidecarRel(entry.path));
  const payload: DocumentCatalogEntry = {
    doc_id: entry.doc_id,
    path: entry.path,
    title: entry.title,
    doc_type: entry.doc_type,
    topics: entry.topics,
    aliases: entry.aliases,
    references: entry.references,
    sections_hint: entry.sections_hint,
    priority: entry.priority,
  };
  await writeFile(sidecar, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function ensureCatalogSidecar(
  root: string,
  slug: string,
  sourcePath: string,
): Promise<DocumentCatalogEntry> {
  const entry = await readCatalogEntry(root, slug, sourcePath);
  const sidecar = resolveUnderRoot(root, slug, catalogSidecarRel(sourcePath));
  try {
    await readFile(sidecar, "utf8");
    return entry;
  } catch {
    await writeCatalogEntry(root, slug, entry);
    return entry;
  }
}

function pathWithinScope(path: string, scope: string): boolean {
  if (!scope) return true;
  return path === scope || path.startsWith(`${scope}/`);
}

export async function listDocumentCatalog(
  root: string,
  slug: string,
  scopePath = "",
): Promise<DocumentCatalogEntry[]> {
  const installRoot = resolveUnderRoot(root, slug);
  const items: DocumentCatalogEntry[] = [];

  async function walk(dir: string): Promise<void> {
    const { readdir } = await import("fs/promises");
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) await walk(abs);
        continue;
      }
      if (
        entry.name.endsWith(".extracted.txt") ||
        entry.name.endsWith(".extracted.meta.json") ||
        entry.name.endsWith(".extracted.pages.json") ||
        entry.name.endsWith(".library.json")
      ) {
        continue;
      }
      if (!entry.isFile() || !isAllowedFilename(entry.name)) continue;

      const rel = relative(installRoot, abs).replace(/\\/g, "/");
      if (!pathWithinScope(rel, scopePath)) continue;
      items.push(await readCatalogEntry(root, slug, rel));
    }
  }

  await walk(installRoot);
  items.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title, "ru"));
  return items;
}

export function catalogEntryMatchesPath(entry: DocumentCatalogEntry, filter: string): boolean {
  const normalized = filter.replace(/\\/g, "/");
  if (entry.path === normalized) return true;
  const base = entry.path.split("/").pop() ?? entry.path;
  return base === normalized || base.toLowerCase() === normalized.toLowerCase();
}

export function catalogEntryMatchesAlias(entry: DocumentCatalogEntry, alias: string): boolean {
  const needle = alias.trim().toLowerCase();
  if (!needle) return false;
  return entry.aliases.some((item) => item.toLowerCase() === needle);
}
