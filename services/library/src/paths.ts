import { resolve, relative, sep } from "path";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const SEGMENT_RE = /^[a-zA-Z0-9._,\-\u0400-\u04FF №()]+$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export function isValidRelativePath(relPath: string): boolean {
  if (!relPath) return true;
  if (relPath.startsWith("/") || relPath.startsWith("\\")) {
    return false;
  }
  const parts = relPath.split(/[/\\]/).filter(Boolean);
  if (parts.length === 0) return true;
  // Reject traversal segments only — «2006г..docx» in a filename is valid.
  return parts.every((p) => p !== ".." && p !== "." && SEGMENT_RE.test(p));
}

/** Resolves relative path under installation root; throws if escapes root. */
export function resolveUnderRoot(root: string, installationSlug: string, relPath = ""): string {
  if (!isValidSlug(installationSlug)) throw new Error("invalid_slug");
  if (!isValidRelativePath(relPath)) throw new Error("invalid_path");

  const installRoot = resolve(root, installationSlug);
  const abs = resolve(installRoot, relPath || ".");
  const rel = relative(installRoot, abs);
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) throw new Error("path_traversal");
  return abs;
}

/** For legacy paths created before filename normalization; still blocks traversal. */
export function resolveLegacyUnderRoot(root: string, installationSlug: string, relPath: string): string {
  if (!isValidSlug(installationSlug)) throw new Error("invalid_slug");
  if (!relPath || relPath.includes("\0") || relPath.startsWith("/") || relPath.startsWith("\\")) {
    throw new Error("invalid_path");
  }
  const parts = relPath.split(/[/\\]/).filter(Boolean);
  if (parts.some((p) => p === ".." || p === ".")) throw new Error("invalid_path");

  const installRoot = resolve(root, installationSlug);
  const abs = resolve(installRoot, relPath);
  const rel = relative(installRoot, abs);
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) throw new Error("path_traversal");
  return abs;
}

export function resolveLegacyFileUnderRoot(root: string, installationSlug: string, relPath: string): string {
  if (!isAllowedFilename(relPath.split(/[/\\]/).pop() ?? "")) throw new Error("invalid_file_type");
  return resolveLegacyUnderRoot(root, installationSlug, relPath);
}

export const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".jpeg",
  ".jpg",
  ".png",
  ".md",
  ".txt",
]);

export function isAllowedFilename(name: string): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 1) return false;
  return ALLOWED_EXTENSIONS.has(lower.slice(dot));
}

function decodeMojibakeUtf8(value: string): string {
  if (!/[ÃÂÐÑ]/.test(value)) return value;
  try {
    const decoded = Buffer.from(value, "latin1").toString("utf8");
    const score = (text: string): number => (text.match(/[\u0400-\u04FF]/g) ?? []).length;
    return score(decoded) > score(value) ? decoded : value;
  } catch {
    return value;
  }
}

export function safeLibraryFilename(name: string): string {
  const base = decodeMojibakeUtf8(name)
    .split(/[/\\]/)
    .pop()
    ?.trim()
    .replace(/\s+/g, " ")
    .replace(/\.{2,}/g, ".")
    .replace(/[^a-zA-Z0-9._,\-\u0400-\u04FF №()]/g, "_");
  if (!base || !isAllowedFilename(base)) throw new Error("invalid_file_type");
  return base;
}

export function contentTypeForFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".jpeg") || lower.endsWith(".jpg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}
