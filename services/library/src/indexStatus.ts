import {
  looksLikeTocHeavyText,
  MIN_CHARS_PER_PAGE,
  MIN_PAGES_FOR_OCR_COMPARE,
  needsOcrFallback,
  type PdfExtractionResult,
} from "./pdfExtract.js";

export type TextIndexStatus = "none" | "ready" | "partial";

export type StoredIndexMeta = {
  extractor?: string;
  chars?: number;
  index_status?: "ready" | "partial";
  index_note?: string | null;
  source_pages?: number;
  indexed_pages?: number;
};

export type IndexStatusInfo = {
  source_pages: number;
  indexed_pages: number;
  index_status: Exclude<TextIndexStatus, "none">;
  index_note: string | null;
};

/** Оценка полноты индекса PDF сразу после извлечения. */
export function assessPdfIndexStatus(
  result: PdfExtractionResult,
  ocrMaxPages: number,
): IndexStatusInfo {
  const sourcePages = Math.max(result.source_pages, 0);
  const indexedPages = result.pages?.length ?? 0;

  if (sourcePages < MIN_PAGES_FOR_OCR_COMPARE) {
    return {
      source_pages: sourcePages,
      indexed_pages: indexedPages || (result.text ? 1 : 0),
      index_status: "ready",
      index_note: null,
    };
  }

  if (result.extractor === "tesseract-ocr") {
    if (sourcePages > indexedPages) {
      return {
        source_pages: sourcePages,
        indexed_pages: indexedPages,
        index_status: "partial",
        index_note:
          indexedPages < ocrMaxPages && sourcePages > ocrMaxPages
            ? `OCR: ${indexedPages} из ${sourcePages} стр. (лимит ${ocrMaxPages}). Увеличьте LIBRARY_OCR_MAX_PAGES и переиндексируйте.`
            : `OCR: ${indexedPages} из ${sourcePages} стр. Запустите переиндексацию.`,
      };
    }
    return { source_pages: sourcePages, indexed_pages: indexedPages, index_status: "ready", index_note: null };
  }

  const sparseLayer =
    !result.text ||
    result.text.length / Math.max(sourcePages, 1) < MIN_CHARS_PER_PAGE ||
    looksLikeTocHeavyText(result.text, sourcePages) ||
    needsOcrFallback(result.text, sourcePages);

  if (sparseLayer) {
    return {
      source_pages: sourcePages,
      indexed_pages: 0,
      index_status: "partial",
      index_note: "Текстовый слой PDF (часто только оглавление). Нужен полный OCR — переиндексируйте (↻).",
    };
  }

  if (
    (result.extractor === "pdf-parse" || result.extractor === "pdftotext") &&
    sourcePages >= MIN_PAGES_FOR_OCR_COMPARE &&
    looksLikeTocHeavyText(result.text ?? "", sourcePages)
  ) {
    return {
      source_pages: sourcePages,
      indexed_pages: 0,
      index_status: "partial",
      index_note: "В индексе похоже только оглавление. Переиндексируйте файл (↻) для полного OCR.",
    };
  }

  return { source_pages: sourcePages, indexed_pages: 0, index_status: "ready", index_note: null };
}

/** Статус для UI/API по сохранённым sidecar (в т.ч. старые meta без index_status). */
export function resolveIndexDisplay(
  meta: StoredIndexMeta | null,
  isPdf: boolean,
  indexedPageCount: number | null,
): { text_index_status: TextIndexStatus; text_index_note: string | null } {
  if (!meta) return { text_index_status: "none", text_index_note: null };

  if (meta.index_status === "ready" || meta.index_status === "partial") {
    return {
      text_index_status: meta.index_status,
      text_index_note: meta.index_note ?? null,
    };
  }

  if (!isPdf) {
    return { text_index_status: "ready", text_index_note: null };
  }

  if (meta.extractor !== "tesseract-ocr") {
    const chars = meta.chars ?? 0;
    const sourcePages = meta.source_pages ?? 0;
    const denseLayer =
      chars >= 120 &&
      (sourcePages <= 1 || chars / Math.max(sourcePages, 1) >= MIN_CHARS_PER_PAGE);
    if (meta.index_status === undefined && denseLayer) {
      return { text_index_status: "ready", text_index_note: null };
    }
    return {
      text_index_status: "partial",
      text_index_note: "Текстовый слой PDF — для ИИ может быть неполным. Запустите переиндексацию.",
    };
  }

  const sourcePages = meta.source_pages ?? 0;
  const indexed = indexedPageCount ?? meta.indexed_pages ?? 0;
  if (sourcePages > 0 && indexed > 0 && indexed < sourcePages) {
    return {
      text_index_status: "partial",
      text_index_note: `OCR: ${indexed} из ${sourcePages} стр. Запустите переиндексацию с большим лимитом.`,
    };
  }

  if (indexedPageCount === null && meta.indexed_pages === undefined) {
    return {
      text_index_status: "partial",
      text_index_note: "Нет постраничного индекса. Запустите переиндексацию.",
    };
  }

  return { text_index_status: "ready", text_index_note: null };
}
