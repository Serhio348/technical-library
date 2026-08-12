/** Поиск релевантных фрагментов в извлечённом тексте документа (для контекста ИИ). */

import { looksLikeTocHeavyText } from "./pdfExtract.js";

export type DocumentPage = {
  page: number;
  text: string;
};

export type DocumentContextOptions = {
  boostTerms?: string[];
  /** Больше страниц/текста — для одного документа в папке или вопроса по разделу */
  preferWide?: boolean;
};

/** Номера разделов/пунктов из вопроса — для поиска по ТКП/ГОСТ */
export function extractSectionBoostTerms(query: string): string[] {
  const terms: string[] = [];
  for (const m of query.matchAll(/раздел\w*[^0-9]{0,24}(\d+(?:\.\d+)*)/gi)) {
    const num = m[1]!;
    terms.push(num, `${num}.`, `${num} `, `раздел ${num}`, `§ ${num}`);
  }
  for (const m of query.matchAll(/(?:глав\w*|пункт|§|п\.?\s*)\s*(\d+(?:\.\d+)*)/gi)) {
    const num = m[1]!;
    terms.push(num, `${num}.`, `${num} `);
  }
  for (const m of query.matchAll(/\b(\d{1,2})\s*(?:раздел|глав)/gi)) {
    terms.push(m[1]!, `${m[1]!}.`);
  }
  return [...new Set(terms)];
}

/**
 * Область применения из вопроса (ЗРУ/ОРУ/ВЛ…) — чтобы контекст и ответ
 * не подменялись общими нормами «для всех электроустановок».
 */
export function extractScopeBoostTerms(query: string): string[] {
  const q = query.toLowerCase().replace(/ё/g, "е");
  const terms: string[] = [];
  const add = (...items: string[]) => {
    for (const item of items) terms.push(item);
  };

  const hasAbbr = (abbr: string) => new RegExp(`(?:^|[^a-zа-яё0-9])${abbr}(?=[^a-zа-яё0-9]|$)`, "i").test(q);
  if (hasAbbr("зру") || /закрыт[а-яё]*\s+распределительн/.test(q)) {
    add("зру", "закрытом распределительном", "закрытых распределительных", "в зру");
  }
  if (hasAbbr("ору") || /открыт[а-яё]*\s+распределительн/.test(q)) {
    add("ору", "открытом распределительном", "открытых распределительных", "в ору");
  }
  if (hasAbbr("вру")) add("вру", "в вру");
  if (hasAbbr("вл") || /воздушн[а-яё]*\s+лини/.test(q)) add("вл", "воздушной линии", "воздушных линий");
  if (hasAbbr("кл") || /кабельн[а-яё]*\s+лини/.test(q)) add("кл", "кабельной линии", "кабельных линий");
  if (hasAbbr("тп") || /трансформаторн[а-яё]*\s+подстан/.test(q)) add("тп", "трансформаторной подстанции");
  if (/токоведущ/.test(q)) add("токоведущие", "токоведущих", "токоведущим");
  if (/переносн\w*\s+заземл|заземлен/.test(q)) add("заземления", "переносных заземлений", "присоединения");
  if (/рабоч\w*\s+мест/.test(q)) add("рабочем месте", "рабочего места");

  return [...new Set(terms)];
}

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
  // Вопросительные/служебные — иначе «что такое X» ранжирует огромные ТКП по слову «что»
  "что",
  "чем",
  "чего",
  "кому",
  "кого",
  "где",
  "когда",
  "куда",
  "откуда",
  "почему",
  "зачем",
  "как",
  "каков",
  "какова",
  "каково",
  "такое",
  "такой",
  "такая",
  "такие",
  "это",
  "эта",
  "этот",
  "эти",
  "есть",
  "быть",
  "был",
  "была",
  "были",
  "или",
  "для",
  "при",
  "без",
  "под",
  "над",
  "про",
  "между",
  "после",
  "перед",
  "через",
  "также",
  "тоже",
  "уже",
  "еще",
  "ещё",
  "можно",
  "нужно",
  "надо",
  "лишь",
  "только",
  "очень",
  "более",
  "менее",
  "определение",
  "определения",
  "термин",
  "термина",
  "означает",
  "значит",
  "пожалуйста",
  "скажи",
  "расскажи",
  "объясни",
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
  const { primary, expanded } = analyzeQueryTerms(query);
  return [...new Set([...primary, ...expanded])].slice(0, 20);
}

export function analyzeQueryTerms(query: string): { primary: string[]; expanded: string[] } {
  const words =
    query
      .toLowerCase()
      .replace(/ё/g, "е")
      .match(/[a-zа-я0-9]{3,}/g) ?? [];

  const primary: string[] = [];
  const expanded: string[] = [];

  for (const word of words) {
    if (STOP_WORDS.has(word)) continue;
    // Для длинных терминов держим полный вид + удлинённый стем,
    // иначе «электротравма» → «электрот» ловит «электротравматизм» и путается с шумом.
    const stemLen = word.length >= 10 ? Math.min(word.length, 12) : Math.min(word.length, 8);
    const stem = word.slice(0, stemLen);
    primary.push(stem);
    if (word.length > stemLen) primary.push(word);

    const extra = QUERY_EXPANSIONS[stem.slice(0, 8)] ?? QUERY_EXPANSIONS[word.slice(0, 5)] ?? [];
    expanded.push(...extra);
  }

  return {
    primary: [...new Set(primary)],
    expanded: [...new Set(expanded)].filter((t) => !primary.includes(t)),
  };
}

/**
 * Вес термина для ранжирования: длинные/редкие слова важнее коротких.
 * Без этого «что»/«как» (если просочились) или короткие стемы забивают счётчик
 * в больших регламентах, а нужный ГОСТ с одним вхождением термина проигрывает.
 */
export function termMatchWeight(term: string): number {
  const t = term.trim().toLowerCase();
  if (!t) return 0;
  if (t.length >= 12) return 16;
  if (t.length >= 10) return 12;
  if (t.length >= 8) return 8;
  if (t.length >= 6) return 4;
  if (t.length >= 5) return 2.5;
  return 1;
}

/** Подсчёт вхождений с насыщением — не давать гигантским файлам бесконечный score. */
export function countTermHits(haystack: string, term: string, maxHits = 40): number {
  if (!term) return 0;
  let count = 0;
  let idx = 0;
  while (idx < haystack.length && count < maxHits) {
    const hit = haystack.indexOf(term, idx);
    if (hit < 0) break;
    count += 1;
    idx = hit + term.length;
  }
  return count;
}

export function scoreTextWeighted(
  normalized: string,
  terms: string[],
  expandedTerms: string[] = [],
): number {
  let score = 0;
  for (const term of terms) {
    const hits = countTermHits(normalized, term);
    if (hits <= 0) continue;
    const w = termMatchWeight(term);
    // Логарифмическое насыщение: 1 вхождение ≈ w, 10 ≈ ~3w, а не 10w
    score += w * (1 + Math.log2(hits));
  }
  // Синонимы/расширения — только лёгкий буст, иначе оглавление «Пусконаладка» бьёт тело главы
  for (const term of expandedTerms) {
    const hits = countTermHits(normalized, term, 12);
    if (hits <= 0) continue;
    const w = termMatchWeight(term) * 0.25;
    score += w * (1 + Math.log2(hits));
  }
  return score;
}

function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
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
  if (trimmed.length <= maxChars && !pages?.length) {
    return skipLeadingToc(trimmed);
  }

  const terms = mergeQueryTerms(query, options.boostTerms);
  const preferWide = options.preferWide ?? false;

  if (pages && pages.length > 0) {
    if (preferWide) {
      return buildFromPagesWide(pages, terms.primary, terms.expanded, maxChars);
    }
    return buildFromPages(pages, terms.primary, terms.expanded, maxChars);
  }

  if (preferWide || terms.primary.length === 0) {
    return sliceBodyPreferringChapters(trimmed, maxChars);
  }

  return buildFromWindows(trimmed, [...terms.primary, ...terms.expanded], maxChars);
}

const TOC_LINE_HINT_RE =
  /^\d+(?:\.\d+)?\.?\s+\S.{3,100}?\s+\d{1,3}$/;

/** Убирает ведущее оглавление, если оно занимает начало файла. */
export function skipLeadingToc(text: string): string {
  const lines = text.split(/\n/);
  let offset = 0;
  let tocLines = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) {
      offset += line.length + 1;
      continue;
    }
    const isHeading = /^\d+(?:\.\d+)*\.?\s+[А-ЯЁA-Z]/.test(trimmed);
    const isTocLine = TOC_LINE_HINT_RE.test(trimmed) || (isHeading && trimmed.length < 140);
    if (isTocLine) {
      tocLines += 1;
      offset += line.length + 1;
      if (tocLines > 120 || offset > 24_000) break;
      continue;
    }
    // После серии пунктов оглавления — тело документа
    if (tocLines >= 4 && trimmed.length > 40) {
      return text.slice(offset).trim() || text;
    }
    break;
  }

  if (tocLines >= 4 && offset > 0 && offset < text.length - 200) {
    return text.slice(offset).trim() || text;
  }

  // Fallback: компактный префикс (не весь head с телом глав)
  const prefix = text.slice(0, Math.min(text.length, 2_500));
  if (!looksLikeTocHeavyText(prefix, 5)) return text;

  const start = Math.min(Math.max(offset, Math.floor(text.length * 0.08)), 24_000);
  if (start > 0 && start < text.length - 500) {
    return text.slice(start).trim() || text;
  }
  return text;
}

function sliceBodyPreferringChapters(text: string, maxChars: number): string {
  const body = skipLeadingToc(text);
  if (body.length <= maxChars) return body;
  // Равномерная выборка по документу, а не только начало
  const chunkSize = Math.max(2_000, Math.floor(maxChars / 4));
  const step = Math.max(chunkSize, Math.floor(body.length / 4));
  const parts: string[] = [];
  let used = 0;
  for (let i = 0; i < body.length && used < maxChars && parts.length < 6; i += step) {
    const chunk = body.slice(i, i + chunkSize).trim();
    if (!chunk) continue;
    if (looksLikeTocHeavyText(chunk, 1) && i < body.length * 0.2) continue;
    parts.push(i > 0 ? `... ${chunk}` : chunk);
    used += chunk.length + 2;
  }
  if (parts.length === 0) return body.slice(0, maxChars);
  return parts.join("\n\n").slice(0, maxChars);
}

function mergeQueryTerms(
  query: string,
  boostTerms: string[] | undefined,
): { primary: string[]; expanded: string[] } {
  const base = analyzeQueryTerms(query);
  if (!boostTerms?.length) return base;
  const extraPrimary: string[] = [];
  const extraExpanded: string[] = [];
  for (const term of boostTerms) {
    const analyzed = analyzeQueryTerms(term);
    extraPrimary.push(...analyzed.primary);
    extraExpanded.push(...analyzed.expanded);
  }
  return {
    primary: [...new Set([...base.primary, ...extraPrimary])].slice(0, 24),
    expanded: [...new Set([...base.expanded, ...extraExpanded])]
      .filter((t) => !base.primary.includes(t) && !extraPrimary.includes(t))
      .slice(0, 16),
  };
}

function buildFromPages(
  pages: DocumentPage[],
  primary: string[],
  expanded: string[],
  maxChars: number,
): string {
  const scored = pages
    .map((entry) => {
      const normalized = normalizeForSearch(entry.text);
      let score = scoreTextWeighted(normalized, primary, expanded);
      if (looksLikeTocHeavyText(entry.text, 1)) score *= 0.12;
      return { entry, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.page - b.entry.page);

  if (scored.length === 0) {
    return fallbackPageSpread(pages, maxChars);
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

/** Широкий контекст: релевантные страницы + соседние + заполнение по порядку */
function buildFromPagesWide(
  pages: DocumentPage[],
  primary: string[],
  expanded: string[],
  maxChars: number,
): string {
  const byPage = new Map(pages.map((p) => [p.page, p]));
  const scored = pages
    .map((entry) => {
      const normalized = normalizeForSearch(entry.text);
      let score = scoreTextWeighted(normalized, primary, expanded);
      if (looksLikeTocHeavyText(entry.text, 1)) score *= 0.08;
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score || a.entry.page - b.entry.page);

  const selected = new Set<number>();

  for (const { entry, score } of scored) {
    if (score <= 0 && selected.size >= 8) continue;
    selected.add(entry.page);
    if (score > 0) {
      selected.add(entry.page - 1);
      selected.add(entry.page + 1);
    }
    if (selected.size >= 24) break;
  }

  if (selected.size === 0) {
    return fallbackPageSpread(pages, maxChars);
  }

  for (const entry of pages) {
    if (selected.size >= 40) break;
    if (!looksLikeTocHeavyText(entry.text, 1) || entry.page > 5) {
      selected.add(entry.page);
    }
  }

  const ordered = [...selected]
    .sort((a, b) => a - b)
    .map((n) => byPage.get(n))
    .filter((p): p is DocumentPage => Boolean(p));

  const chunks: string[] = [];
  let used = 0;
  for (const entry of ordered) {
    if (used >= maxChars) break;
    const block = `[стр. ${entry.page}]\n${entry.text.trim()}`;
    if (used + block.length > maxChars && chunks.length > 0) continue;
    chunks.push(block);
    used += block.length + 2;
  }

  return chunks.join("\n\n").slice(0, maxChars);
}

/** Не только первые 4 стр. (часто оглавление) — равномерная выборка по документу */
function fallbackPageSpread(pages: DocumentPage[], maxChars: number): string {
  const body = pages.filter((p) => !looksLikeTocHeavyText(p.text, 1) || p.page > 4);
  const pool = body.length >= 5 ? body : pages;
  const step = Math.max(1, Math.floor(pool.length / 12));
  const picked: DocumentPage[] = [];
  for (let i = 0; i < pool.length && picked.length < 16; i += step) {
    picked.push(pool[i]!);
  }
  if (picked.length === 0) picked.push(...pages.slice(0, 6));

  const chunks: string[] = [];
  let used = 0;
  for (const entry of picked.sort((a, b) => a.page - b.page)) {
    if (used >= maxChars) break;
    const block = `[стр. ${entry.page}]\n${entry.text.trim()}`;
    chunks.push(block);
    used += block.length + 2;
  }
  return chunks.join("\n\n").slice(0, maxChars);
}

function buildFromWindows(text: string, terms: string[], maxChars: number): string {
  const body = skipLeadingToc(text);
  const normalized = normalizeForSearch(body);
  const windowRadius = 2200;
  const ranges: Array<{ start: number; end: number; score: number }> = [];

  for (const term of terms) {
    let idx = 0;
    while (idx < normalized.length) {
      const hit = normalized.indexOf(term, idx);
      if (hit < 0) break;
      const start = Math.max(0, hit - windowRadius);
      const end = Math.min(body.length, hit + windowRadius);
      const windowText = body.slice(start, end);
      let score = 1;
      if (looksLikeTocHeavyText(windowText, 1)) score = 0.15;
      ranges.push({ start, end, score });
      idx = hit + term.length;
    }
  }

  if (ranges.length === 0) return sliceBodyPreferringChapters(body, maxChars);

  ranges.sort((a, b) => b.score - a.score || a.start - b.start);
  const merged = mergeRanges(ranges.map(({ start, end }) => ({ start, end })));

  const chunks: string[] = [];
  let used = 0;
  for (const range of merged) {
    if (used >= maxChars) break;
    const chunk = body.slice(range.start, range.end).trim();
    if (!chunk) continue;
    if (looksLikeTocHeavyText(chunk, 1) && chunks.length > 0) continue;
    const prefix = range.start > 0 ? "... " : "";
    const suffix = range.end < body.length ? " ..." : "";
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
  const { primary, expanded } = analyzeQueryTerms(query);
  if (primary.length === 0 && expanded.length === 0) return true;
  const haystack = normalizeForSearch(`${fileName} ${text}`);
  const strong = primary.filter((t) => t.length >= 5);
  const primaryCheck = strong.length > 0 ? strong : primary;
  if (primaryCheck.some((term) => haystack.includes(term))) return true;
  // Синонимы (пуск ← запуск) — тоже считаем совпадением на уровне файла
  return expanded.some((term) => term.length >= 4 && haystack.includes(term));
}
