/** Поиск релевантных фрагментов в извлечённом тексте документа (для контекста ИИ). */

import { looksLikeTocHeavyText } from "./pdfExtract.js";

export type DocumentPage = {
  page: number;
  text: string;
};

export type DocumentContextOptions = {
  boostTerms?: string[];
};

const STOP_WORDS = new Set([
  "какие",
  "какой",
  "какая",
  "какое",
  "сколько",
  "данной",
  "этой",
  "установке",
  "установка",
  "установки",
  "посмотри",
  "напиши",
  "найди",
  "весь",
  "паспорт",
  "необходимо",
  "необходим",
  "произвести",
  "производ",
]);

/** Расширение запросов по документации — общие синонимы, не привязка к одному паспорту. */
const QUERY_EXPANSIONS: Record<string, string[]> = {
  запуск: ["пуск", "пусконалад", "монтаж", "ввод", "эксплуата", "commission"],
  первый: ["первичн", "начальн"],
  монтаж: ["монтаж", "пусконалад", "установк"],
  извлечен: ["извлеч", "элемент", "мембран", "картридж"],
  элемент: ["элемент", "мембран", "картридж", "фильтр"],
  инструк: ["инструк", "руковод", "регламент", "раздел"],
};

export function queryTerms(query: string): string[] {
  const words =
    query
      .toLowerCase()
      .replace(/ё/g, "е")
      .match(/[a-zа-я0-9]{3,}/g) ?? [];

  const stems = words
    .filter((word) => !STOP_WORDS.has(word))
    .flatMap((word) => {
      const base = word.slice(0, Math.min(word.length, 8));
      const extra = QUERY_EXPANSIONS[base] ?? QUERY_EXPANSIONS[word.slice(0, 5)] ?? [];
      return [base, ...extra];
    });

  return [...new Set(stems)].slice(0, 16);
}

function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}

function scoreText(normalized: string, terms: string[]): number {
  let score = 0;
  for (const term of terms) {
    let idx = 0;
    while (idx < normalized.length) {
      const hit = normalized.indexOf(term, idx);
      if (hit < 0) break;
      score += 1;
      idx = hit + term.length;
    }
  }
  return score;
}

function mergeRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Array<{ start: number; end: number }> = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.start <= last.end + 200) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push(cur);
    }
  }
  return out;
}

/**
 * Выбирает фрагменты текста по запросу.
 * Если есть постраничный OCR — ранжирует страницы; иначе режет текст на окна.
 */
export function buildDocumentContext(
  fullText: string,
  query: string,
  maxChars: number,
  pages: DocumentPage[] | null = null,
  options: DocumentContextOptions = {},
): string {
  const trimmed = fullText.trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxChars) return trimmed;

  const terms = mergeQueryTerms(query, options.boostTerms);
  if (terms.length === 0) return trimmed.slice(0, maxChars);

  if (pages && pages.length > 0) {
    return buildFromPages(pages, terms, maxChars);
  }

  return buildFromWindows(trimmed, terms, maxChars);
}

function mergeQueryTerms(query: string, boostTerms: string[] | undefined): string[] {
  const base = queryTerms(query);
  if (!boostTerms?.length) return base;
  const extra = boostTerms.flatMap((term) => queryTerms(term));
  return [...new Set([...base, ...extra])].slice(0, 24);
}

function buildFromPages(pages: DocumentPage[], terms: string[], maxChars: number): string {
  const scored = pages
    .map((entry) => {
      const normalized = normalizeForSearch(entry.text);
      let score = scoreText(normalized, terms);
      if (looksLikeTocHeavyText(entry.text, 1)) score *= 0.12;
      return { entry, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.page - b.entry.page);

  if (scored.length === 0) {
    const fallback = pages
      .slice(0, Math.min(4, pages.length))
      .map((p) => `[стр. ${p.page}]\n${p.text.trim()}`)
      .join("\n\n");
    return fallback.slice(0, maxChars);
  }

  const chunks: string[] = [];
  let used = 0;
  for (const { entry } of scored) {
    if (used >= maxChars) break;
    const block = `[стр. ${entry.page}]\n${entry.text.trim()}`;
    if (used + block.length > maxChars && chunks.length > 0) break;
    chunks.push(block);
    used += block.length + 2;
  }

  return chunks.join("\n\n").slice(0, maxChars);
}

function buildFromWindows(text: string, terms: string[], maxChars: number): string {
  const normalized = normalizeForSearch(text);
  const windowRadius = 2200;
  const ranges: Array<{ start: number; end: number; score: number }> = [];

  for (const term of terms) {
    let idx = 0;
    while (idx < normalized.length) {
      const hit = normalized.indexOf(term, idx);
      if (hit < 0) break;
      ranges.push({
        start: Math.max(0, hit - windowRadius),
        end: Math.min(text.length, hit + windowRadius),
        score: 1,
      });
      idx = hit + term.length;
    }
  }

  if (ranges.length === 0) return text.slice(0, maxChars);

  ranges.sort((a, b) => b.score - a.score || a.start - b.start);
  const merged = mergeRanges(ranges.map(({ start, end }) => ({ start, end })));

  const chunks: string[] = [];
  let used = 0;
  for (const range of merged) {
    if (used >= maxChars) break;
    const chunk = text.slice(range.start, range.end).trim();
    if (!chunk) continue;
    const prefix = range.start > 0 ? "... " : "";
    const suffix = range.end < text.length ? " ..." : "";
    chunks.push(`${prefix}${chunk}${suffix}`);
    used += chunk.length + 2;
  }

  return chunks.join("\n\n").slice(0, maxChars);
}

/** Поиск документов: true если любой термин запроса встречается в тексте или имени. */
export function documentMatchesQuery(
  text: string,
  fileName: string,
  query: string,
): boolean {
  const terms = queryTerms(query);
  if (terms.length === 0) return true;
  const haystack = normalizeForSearch(`${fileName} ${text}`);
  return terms.some((term) => haystack.includes(term));
}
