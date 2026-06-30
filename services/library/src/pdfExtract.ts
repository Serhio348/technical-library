import { execFile } from "child_process";
import { mkdtemp, readFile, readdir, rm, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import type { DocumentPage } from "./documentSearch.js";
import { env } from "./config.js";
import { reportIndexJobOcrPage } from "./indexJobContext.js";
import { withOcrLock } from "./ocrLock.js";
import { runTesseractRu, sanitizeRuOcrText } from "./tesseractRu.js";

const execFileAsync = promisify(execFile);

const MAX_EXTRACTED_CHARS = 120_000;
const MIN_TEXT_CHARS = 120;
const MIN_CYRILLIC_CHARS = 20;
/** Мало текста на страницу — типичный скан с пустым/битым text layer. */
export const MIN_CHARS_PER_PAGE = 300;
/** Для многостраничных PDF всегда сравниваем text layer и OCR. */
export const MIN_PAGES_FOR_OCR_COMPARE = 3;
const CYRILLIC_RE = /[А-Яа-яЁё]/g;
/** Строки оглавления вида «8. ПОРЯДОК МОНТАЖА … 8». */
const TOC_ENTRY_RE =
  /\d+(?:\.\d+)?\.\s+[A-ZА-ЯЁ][A-ZА-ЯЁa-zа-яёA-Za-z0-9\s\-–—,/()«»"'\.]{4,120}?\s+\d{1,3}(?=\s|$|\d+\.)/g;

export type PdfExtractor = "pdf-parse" | "pdftotext" | "tesseract-ocr";

export type PdfExtractionResult = {
  text: string | null;
  extractor: PdfExtractor;
  confidence: number;
  pages: DocumentPage[] | null;
  source_pages: number;
};

function normalizePageText(raw: string): string {
  return sanitizeRuOcrText(raw).replace(/\s+/g, " ").trim();
}

function normalizeExtractedText(raw: string): string | null {
  const text = normalizePageText(raw);
  return text.length > 0 ? text.slice(0, MAX_EXTRACTED_CHARS) : null;
}

export function countCyrillicChars(text: string): number {
  return text.match(CYRILLIC_RE)?.length ?? 0;
}

export function looksLikeTocHeavyText(text: string, pageCount: number): boolean {
  if (text.length < MIN_TEXT_CHARS) return false;

  const entries = text.match(TOC_ENTRY_RE) ?? [];
  if (entries.length >= 4) {
    const entryChars = entries.reduce((sum, entry) => sum + entry.length, 0);
    if (entryChars / text.length >= 0.45) return true;
  }

  // ТКП/ГОСТ: много строк «14. ЭКСПЛУАТАЦИЯ БАКОВ...» без абзацев тела раздела
  const sectionHeadings =
    text.match(/^\s*\d+(?:\.\d+)*\.?\s+[А-ЯЁA-Z][^\n]{6,120}$/gm) ?? [];
  if (sectionHeadings.length >= 5) {
    const headingChars = sectionHeadings.reduce((sum, line) => sum + line.length, 0);
    const bodyParagraphs = text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 55 && !/^\d+(?:\.\d+)*\.?\s+[А-ЯЁA-Z]/.test(line));
    if (headingChars / text.length >= 0.2 && bodyParagraphs.length < sectionHeadings.length / 3) {
      return true;
    }
  }

  if (pageCount >= 3 && text.length / pageCount < MIN_CHARS_PER_PAGE) return true;
  return false;
}

export function hasUsableTextLayer(parsed: string | null, pageCount: number): boolean {
  if (!parsed || parsed.length < MIN_TEXT_CHARS) return false;
  const cyr = countCyrillicChars(parsed);
  if (cyr < MIN_CYRILLIC_CHARS) return false;

  // ТКП/ГОСТ на 200+ стр.: pdf-parse даёт мало символов *на страницу*, но текст в документе есть
  if (parsed.length >= 12_000 && cyr >= 400) return true;
  if (parsed.length >= 6_000 && cyr >= 200) return true;

  const charsPerPage = pageCount > 0 ? parsed.length / pageCount : parsed.length;
  // Большой документ: даже «мало на страницу» — это нормальный текстовый PDF, не скан
  if (pageCount >= 40 && parsed.length >= 3_000 && cyr >= 150) return true;
  if (charsPerPage >= 250) return true;
  if (pageCount >= 3 && charsPerPage < MIN_CHARS_PER_PAGE) {
    if (parsed.length >= 8_000 && cyr >= 250) return true;
    return false;
  }
  if (looksLikeTocHeavyText(parsed, pageCount)) {
    return parsed.length >= 10_000;
  }
  return true;
}

/** Нужен ли полный OCR (скан / почти нет текста). Иначе — только текстовый слой. */
export function shouldRunFullOcr(parsed: string | null, pageCount: number): boolean {
  if (hasUsableTextLayer(parsed, pageCount)) return false;
  if (!parsed || parsed.length < 800) return true;
  if (countCyrillicChars(parsed) < 15) return true;
  const cpp = pageCount > 0 ? parsed.length / pageCount : parsed.length;
  if (pageCount >= 5 && cpp < 80) return true;
  if (looksLikeTocHeavyText(parsed, pageCount) && parsed.length < 5_000) return true;
  return false;
}

export function needsOcrFallback(text: string | null, pageCount = 0): boolean {
  if (!text || text.length < MIN_TEXT_CHARS) return true;
  if (countCyrillicChars(text) < MIN_CYRILLIC_CHARS) return true;
  if (pageCount >= 3 && text.length / pageCount < MIN_CHARS_PER_PAGE) return true;
  if (looksLikeTocHeavyText(text, pageCount)) return true;
  return false;
}

/** Чем выше — тем полнее и полезнее извлечённый текст для ИИ. */
export function scoreExtractionQuality(text: string | null, pageCount: number): number {
  if (!text || text.length < MIN_TEXT_CHARS) return 0;

  const pages = Math.max(pageCount, 1);
  const charsPerPage = text.length / pages;
  const tocEntries = text.match(TOC_ENTRY_RE) ?? [];
  const tocRatio = tocEntries.reduce((sum, entry) => sum + entry.length, 0) / text.length;
  const words = text
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/\s+/)
    .filter((word) => word.length > 3);
  const uniqueWords = new Set(words).size;

  return (
    Math.min(charsPerPage, 2500) * 0.35 +
    uniqueWords * 1.8 +
    countCyrillicChars(text) * 0.04 -
    tocRatio * 8000
  );
}

async function extractPdfTextViaPdfParse(
  filePath: string,
): Promise<{ text: string | null; pageCount: number }> {
  try {
    const pdfParse = (await import("pdf-parse")).default as (
      buffer: Buffer,
    ) => Promise<{ text: string; numpages?: number }>;
    const buf = await readFile(filePath);
    const result = await pdfParse(buf);
    return {
      text: normalizeExtractedText(result.text),
      pageCount: result.numpages ?? 0,
    };
  } catch {
    return { text: null, pageCount: 0 };
  }
}

async function extractPdfTextWithPdftotext(filePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", filePath, "-"],
      {
        timeout: 180_000,
        maxBuffer: 48 * 1024 * 1024,
        encoding: "utf8",
      },
    );
    return normalizeExtractedText(String(stdout));
  } catch {
    return null;
  }
}

function pickBestTextLayer(
  candidates: Array<{ text: string | null; source: "pdftotext" | "pdf-parse" }>,
  pageCount: number,
): { text: string | null; extractor: "pdftotext" | "pdf-parse" } {
  let best: { text: string | null; extractor: "pdftotext" | "pdf-parse" } = {
    text: null,
    extractor: "pdf-parse",
  };
  let bestScore = -1;
  for (const item of candidates) {
    if (!item.text) continue;
    const score =
      item.text.length +
      countCyrillicChars(item.text) * 3 +
      (hasUsableTextLayer(item.text, pageCount) ? 10_000 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = { text: item.text, extractor: item.source };
    }
  }
  return best;
}

async function extractPdfTextLayer(
  filePath: string,
): Promise<{ text: string | null; pageCount: number; extractor: "pdftotext" | "pdf-parse" }> {
  const pageCountFromInfo = await getPdfPageCount(filePath);
  const [popplerText, parsedLayer] = await Promise.all([
    extractPdfTextWithPdftotext(filePath),
    extractPdfTextViaPdfParse(filePath),
  ]);
  const pageCount = pageCountFromInfo || parsedLayer.pageCount || 0;
  const best = pickBestTextLayer(
    [
      { text: popplerText, source: "pdftotext" },
      { text: parsedLayer.text, source: "pdf-parse" },
    ],
    pageCount,
  );
  return { text: best.text, pageCount, extractor: best.extractor };
}

async function getPdfPageCount(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("pdfinfo", [filePath], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    });
    const match = String(stdout).match(/Pages:\s+(\d+)/i);
    if (match) return Number.parseInt(match[1]!, 10);
  } catch {
    // fallback below
  }
  const { pageCount } = await extractPdfTextViaPdfParse(filePath);
  return pageCount;
}

async function renderPdfPage(
  filePath: string,
  outDir: string,
  pageNum: number,
  timeoutMs: number,
): Promise<string | null> {
  const prefix = join(outDir, `p${pageNum}`);
  const dpi = String(env.LIBRARY_OCR_DPI);
  await execFileAsync(
    "pdftoppm",
    ["-png", "-r", dpi, "-f", String(pageNum), "-l", String(pageNum), filePath, prefix],
    { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
  );
  const files = await readdir(outDir);
  const name = files.find((f) => f.startsWith(`p${pageNum}`) && f.endsWith(".png"));
  return name ? join(outDir, name) : null;
}

async function ocrImage(imagePath: string, timeoutMs: number, psm = "3"): Promise<string> {
  return runTesseractRu(imagePath, timeoutMs, psm, { preserveSpaces: false });
}

export { extractTextFromImageBuffer, isPhotoOcrUsable } from "./imageOcr.js";

export type OcrExtraction = {
  text: string | null;
  pages: DocumentPage[];
};

export async function extractPdfTextWithOcrDetailed(
  filePath: string,
  options?: { maxPages?: number; timeoutMs?: number },
): Promise<OcrExtraction> {
  return withOcrLock(async () => {
    const maxPages = options?.maxPages ?? env.LIBRARY_OCR_MAX_PAGES;
    const timeoutMs = options?.timeoutMs ?? env.LIBRARY_OCR_TIMEOUT_SEC * 1000;
    const tmpRoot = await mkdtemp(join(tmpdir(), "doc-library-ocr-"));

    try {
      const sourcePages = await getPdfPageCount(filePath);
      const totalPages = Math.min(sourcePages > 0 ? sourcePages : maxPages, maxPages);
      if (totalPages <= 0) return { text: null, pages: [] };

      const perPageTimeout = Math.max(15_000, Math.floor(timeoutMs / totalPages));
      const pages: DocumentPage[] = [];
      for (let page = 1; page <= totalPages; page += 1) {
        reportIndexJobOcrPage(page, totalPages);
        const imagePath = await renderPdfPage(filePath, tmpRoot, page, perPageTimeout);
        if (!imagePath) continue;
        try {
          const pageText = normalizePageText(await ocrImage(imagePath, perPageTimeout));
          if (pageText) pages.push({ page, text: pageText });
        } catch {
          // skip failed page
        } finally {
          await unlink(imagePath).catch(() => undefined);
        }
      }

      const joined = normalizeExtractedText(pages.map((p) => p.text).join("\n\n"));
      return { text: joined, pages };
    } catch {
      return { text: null, pages: [] };
    } finally {
      await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}

export async function extractPdfTextWithOcr(
  filePath: string,
  options?: { maxPages?: number; timeoutMs?: number },
): Promise<string | null> {
  const result = await extractPdfTextWithOcrDetailed(filePath, options);
  return result.text;
}

export async function extractPdfText(filePath: string): Promise<string | null> {
  const result = await extractPdfWithFallback(filePath);
  return result.text;
}

export async function extractPdfWithFallback(
  filePath: string,
  options?: { forceOcr?: boolean },
): Promise<PdfExtractionResult> {
  const { text: parsed, pageCount, extractor: textExtractor } = await extractPdfTextLayer(filePath);

  if (options?.forceOcr) {
    const ocr = await extractPdfTextWithOcrDetailed(filePath);
    if (ocr.text) {
      return {
        text: ocr.text,
        extractor: "tesseract-ocr",
        confidence: 0.65,
        pages: ocr.pages,
        source_pages: pageCount,
      };
    }
  }

  if (!shouldRunFullOcr(parsed, pageCount)) {
    return {
      text: parsed,
      extractor: textExtractor,
      confidence: hasUsableTextLayer(parsed, pageCount) ? 0.85 : 0.75,
      pages: null,
      source_pages: pageCount,
    };
  }

  const ocr = await extractPdfTextWithOcrDetailed(filePath);
  if (ocr.text) {
    return {
      text: ocr.text,
      extractor: "tesseract-ocr",
      confidence: 0.65,
      pages: ocr.pages,
      source_pages: pageCount,
    };
  }

  return {
    text: parsed,
    extractor: parsed ? textExtractor : "tesseract-ocr",
    confidence: parsed ? 0.5 : 0,
    pages: null,
    source_pages: pageCount,
  };
}

export async function extractDocxText(filePath: string): Promise<string | null> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ path: filePath });
    return normalizeExtractedText(result.value);
  } catch {
    return null;
  }
}

export async function extractLegacyDocText(filePath: string): Promise<string | null> {
  try {
    const buf = await readFile(filePath);
    const raw = buf.toString("latin1");
    const chunks = raw.match(/[ -~А-Яа-яЁё]{12,}/g) ?? [];
    return normalizeExtractedText(chunks.join(" "));
  } catch {
    return null;
  }
}

export async function extractTextFile(filePath: string): Promise<string | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return normalizeExtractedText(raw);
  } catch {
    return null;
  }
}
