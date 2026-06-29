import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { extractPdfWithFallback } from "./pdfExtract.js";
import { extractTextFromImageBuffer, isPhotoOcrUsable } from "./imageOcr.js";

const MAX_ASK_ATTACHMENT_CHARS = 12_000;
const CYRILLIC_RE = /[А-Яа-яЁё]/g;

export const ASK_ATTACHMENT_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".md",
  ".jpg",
  ".jpeg",
  ".png",
] as const;

export type AskAttachment = {
  buffer: Buffer;
  filename: string;
};

function countCyrillicChars(text: string): number {
  return text.match(CYRILLIC_RE)?.length ?? 0;
}

function capText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MAX_ASK_ATTACHMENT_CHARS ? trimmed : trimmed.slice(0, MAX_ASK_ATTACHMENT_CHARS);
}

export function isAskAttachmentFilename(name: string): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 1) return false;
  return (ASK_ATTACHMENT_EXTENSIONS as readonly string[]).includes(lower.slice(dot));
}

export function isImageAttachmentFilename(name: string): boolean {
  return /\.(jpe?g|png)$/i.test(name);
}

export async function extractTextFromAskAttachment(
  buffer: Buffer,
  filename: string,
): Promise<string | null> {
  const lower = filename.toLowerCase();

  if (isImageAttachmentFilename(lower)) {
    return extractTextFromImageBuffer(buffer);
  }

  if (lower.endsWith(".docx")) {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value?.trim();
      return text ? capText(text) : null;
    } catch {
      return null;
    }
  }

  if (lower.endsWith(".doc")) {
    const raw = buffer.toString("latin1");
    const chunks = raw.match(/[ -~А-Яа-яЁё]{8,}/g) ?? [];
    const text = chunks.join(" ").trim();
    return text ? capText(text) : null;
  }

  if (lower.endsWith(".pdf")) {
    const tmpRoot = await mkdtemp(join(tmpdir(), "doc-library-ask-pdf-"));
    const pdfPath = join(tmpRoot, "attachment.pdf");
    try {
      await writeFile(pdfPath, buffer);
      const result = await extractPdfWithFallback(pdfPath);
      const text = result.text?.trim();
      return text ? capText(text) : null;
    } finally {
      await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    const text = buffer.toString("utf8").trim();
    return text ? capText(text) : null;
  }

  return null;
}

export function isAskAttachmentTextUsable(text: string | null, filename: string): boolean {
  if (!text?.trim()) return false;
  if (isImageAttachmentFilename(filename)) return isPhotoOcrUsable(text);
  const trimmed = text.trim();
  if (trimmed.length < 25) return false;
  if (countCyrillicChars(trimmed) >= 15) return true;
  return trimmed.length >= 80;
}

export function attachmentKindLabel(filename: string): string {
  const lower = filename.toLowerCase();
  if (isImageAttachmentFilename(lower)) return "фото";
  if (lower.endsWith(".pdf")) return "PDF";
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) return "Word";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "текст";
  return "файл";
}
