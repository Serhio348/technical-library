import { execFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import {
  layoutTextFromTesseractTsv,
  runTesseractRu,
  runTesseractRuTsv,
  sanitizeRuOcrText,
  TESSERACT_PHOTO_LANG,
} from "./tesseractRu.js";

const execFileAsync = promisify(execFile);

const MAX_PHOTO_OCR_CHARS = 12_000;
const CYRILLIC_RE = /[А-Яа-яЁё]/g;
/** PSM для скринов тестов: единый блок / колонка / авто. */
const PHOTO_PSM_MODES = ["6", "4", "3"] as const;

type PreprocessRecipe = "document" | "screen_soft" | "screen_inverted" | "adaptive";

function countCyrillicChars(text: string): number {
  return text.match(CYRILLIC_RE)?.length ?? 0;
}

function countCyrillicWords(text: string, minLen = 4): number {
  return (text.match(new RegExp(`[А-Яа-яЁё]{${minLen},}`, "g")) ?? []).length;
}

export function stripMisdetectedScripts(text: string): string {
  return sanitizeRuOcrText(text);
}

const WATERMARK_RE =
  /бесплатн[а-яё]*\s+лицензи|непрофессиональн[а-яё]*\s+использован|abbyy|fine\s*reader|trial\s*version|unregistered|watermark|только\s+для\s+ознакомлен/i;

/** Строка-мусор: мало кириллицы, много латиницы/обрывков. */
export function isGarbageOcrLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (WATERMARK_RE.test(trimmed)) return true;
  if (trimmed.length < 3) return true;

  const cyr = countCyrillicChars(trimmed);
  const latin = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  const letters = (trimmed.match(/[A-Za-zА-Яа-яЁё]/g) ?? []).length;
  if (letters === 0) return trimmed.length > 8; // длинная каша без букв
  const cyrRatio = cyr / letters;

  // «МО 1762 02605 ГЕ Ели титаиний» / «ехох эвовов» — почти нет нормальных слов
  const cyrWords = countCyrillicWords(trimmed, 4);
  if (cyrRatio < 0.35 && latin >= 4) return true;
  if (trimmed.length >= 12 && cyrWords === 0 && cyrRatio < 0.7) return true;
  if (/^[A-Za-z0-9\s=_\-|\[\]]{8,}$/.test(trimmed) && cyr < 2) return true;
  // «МО 1762 02605 ГЕ Ели титаиний» — цифры/латиница + обрывки без смысла вопроса
  const tokens = trimmed.split(/\s+/);
  const digitish = tokens.filter((t) => /^[\dA-Za-z.=_-]{1,10}$/.test(t)).length;
  if (
    digitish >= 3 &&
    cyrWords <= 2 &&
    trimmed.length >= 16 &&
    !/вопрос|вариант|заземл|токоведущ|напряжен|электро|ткп/i.test(trimmed)
  ) {
    return true;
  }
  // Повторяющиеся «= ЕЕ Ее» и подобные артефакты UI
  if (((trimmed.match(/[=_]/g) ?? []).length >= 3 || (trimmed.match(/[=_]{2,}/g) ?? []).length >= 1) && cyrWords < 2) {
    return true;
  }
  return false;
}

/**
 * Убирает водяные знаки и строки-мусор после OCR фото.
 * Сохраняет строки с вопросом/вариантами даже при частичном шуме.
 */
export function cleanupPhotoOcrText(raw: string): string {
  const lines = stripMisdetectedScripts(raw)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t|]+/g, " ").trim())
    .filter((line) => line.length > 1);

  const kept = lines.filter((line) => {
    if (WATERMARK_RE.test(line)) return false;
    if (/вопрос|вариант|токоведущ|заземл|напряжен|электроустанов|ткп|птэ|разреша|запреща/i.test(line)) {
      return true;
    }
    return !isGarbageOcrLine(line);
  });

  // Если всё отфильтровали слишком агрессивно — оставим строки с кириллическими словами
  if (kept.length === 0) {
    return lines
      .filter((line) => countCyrillicWords(line, 4) >= 1 && !WATERMARK_RE.test(line))
      .join("\n")
      .trim();
  }

  return kept.join("\n").trim();
}

/** Чем выше — тем лучше для русскоязычного текста на фото. */
export function scorePhotoOcrQuality(text: string): number {
  const cleaned = cleanupPhotoOcrText(text);
  const letters = cleaned.replace(/[\s\d\p{P}]/gu, "").length;
  if (letters === 0) return 0;

  const cyr = countCyrillicChars(cleaned);
  const latin = (cleaned.match(/[A-Za-z]/g) ?? []).length;
  const digits = (cleaned.match(/\d/g) ?? []).length;
  const weird = (cleaned.match(/[^\n\r\t A-Za-zА-Яа-яЁё0-9.,:;!?\-–—«»"'()\/\\%+№§°|=_\[\]{}*<>~]/g) ?? []).length;
  const lower = cleaned.toLowerCase();
  const cyrWords = countCyrillicWords(cleaned, 4);
  const garbageLines = cleaned.split("\n").filter((l) => isGarbageOcrLine(l)).length;

  let score =
    cyr * 3 +
    latin * 0.15 +
    digits * 0.3 +
    (cyr / Math.max(letters, 1)) * 140 -
    weird * 4 -
    garbageLines * 18 -
    Math.max(0, latin - cyr * 0.35) * 1.5;

  if (WATERMARK_RE.test(text)) score -= 80;
  if (/вопрос/.test(lower)) score += 35;
  if (/вариант/.test(lower)) score += 35;
  if (/разрешается|запрещается|не разрешается|заземл|токоведущ|напряжен/.test(lower)) score += 28;
  if (/№\s*\d+|вопрос\s*№?\s*\d+/i.test(cleaned)) score += 20;
  if (/(?:^|\n)\s*[1-9a-dа-г](?:[.]|\))\s+\S/i.test(cleaned)) score += 18;

  score += Math.min(cyrWords, 16) * 5;
  return score;
}

function normalizePhotoText(raw: string): string | null {
  const text = cleanupPhotoOcrText(raw);
  if (!text) return null;
  return text.slice(0, MAX_PHOTO_OCR_CHARS);
}

async function runMagick(args: string[], timeoutMs: number): Promise<boolean> {
  try {
    await execFileAsync("magick", args, {
      timeout: Math.min(timeoutMs, 35_000),
      maxBuffer: 16 * 1024 * 1024,
    });
    return true;
  } catch {
    // ImageMagick 6 fallback
    try {
      await execFileAsync("convert", args, {
        timeout: Math.min(timeoutMs, 35_000),
        maxBuffer: 16 * 1024 * 1024,
      });
      return true;
    } catch {
      return false;
    }
  }
}

async function preprocessPhoto(
  sourcePath: string,
  outPath: string,
  recipe: PreprocessRecipe,
  timeoutMs: number,
): Promise<boolean> {
  // Без сильного blur — он убивает кириллицу на скринах тестов
  const upscale = ["-auto-orient", "-filter", "Lanczos", "-resize", "2800x2800>"];

  if (recipe === "screen_soft") {
    return runMagick(
      [
        sourcePath,
        ...upscale,
        "-colorspace",
        "Gray",
        "-contrast-stretch",
        "2%x2%",
        "-sharpen",
        "0x1.0",
        "-normalize",
        outPath,
      ],
      timeoutMs,
    );
  }

  if (recipe === "screen_inverted") {
    return runMagick(
      [
        sourcePath,
        ...upscale,
        "-colorspace",
        "Gray",
        "-negate",
        "-contrast-stretch",
        "1%x1%",
        "-sharpen",
        "0x1.1",
        outPath,
      ],
      timeoutMs,
    );
  }

  if (recipe === "adaptive") {
    return runMagick(
      [
        sourcePath,
        ...upscale,
        "-colorspace",
        "Gray",
        "-lat",
        "25x25+5%",
        "-sharpen",
        "0x0.8",
        outPath,
      ],
      timeoutMs,
    );
  }

  // document — светлый фон, обычное фото бумаги/экрана
  return runMagick(
    [
      sourcePath,
      ...upscale,
      "-colorspace",
      "Gray",
      "-contrast-stretch",
      "0.5%x0.5%",
      "-sharpen",
      "0x0.9",
      "-normalize",
      outPath,
    ],
    timeoutMs,
  );
}

async function ocrOnce(
  imagePath: string,
  timeoutMs: number,
  psm: string,
): Promise<{ text: string; score: number }> {
  // 1) TSV + порог уверенности — отсекает «титанний / ехох» мусор
  try {
    const tsv = await runTesseractRuTsv(imagePath, timeoutMs, psm, {
      useWhitelist: false,
      lang: TESSERACT_PHOTO_LANG,
      minConf: 45,
    });
    const laidOut = layoutTextFromTesseractTsv(tsv, 45);
    if (laidOut.length >= 20) {
      const score = scorePhotoOcrQuality(laidOut);
      return { text: laidOut, score };
    }
  } catch {
    // fallback below
  }

  const raw = await runTesseractRu(imagePath, timeoutMs, psm, {
    preserveSpaces: true,
    useWhitelist: false,
    lang: TESSERACT_PHOTO_LANG,
  });
  return { text: raw, score: scorePhotoOcrQuality(raw) };
}

async function ocrPhotoFile(
  imagePath: string,
  timeoutMs: number,
  options?: { fast?: boolean },
): Promise<{ text: string | null; score: number }> {
  let bestText = "";
  let bestScore = 0;

  const modes = options?.fast ? (["6", "4"] as const) : PHOTO_PSM_MODES;
  const perAttempt = Math.max(8_000, Math.floor(timeoutMs / modes.length));

  for (const psm of modes) {
    try {
      const { text, score } = await ocrOnce(imagePath, perAttempt, psm);
      if (score > bestScore) {
        bestScore = score;
        bestText = text;
      }
      // Fast: достаточно хорошего PSM 6 — не гоняем остальные
      if (options?.fast && bestScore >= 80 && bestText.length >= 40) break;
    } catch {
      // try next mode
    }
  }

  if (bestScore < 25) return { text: null, score: bestScore };
  return { text: normalizePhotoText(bestText), score: bestScore };
}

export async function extractTextFromImageBuffer(
  buffer: Buffer,
  options?: { timeoutMs?: number; /** Быстрый путь для ask/бота: меньше preprocess/PSM. */ fast?: boolean },
): Promise<string | null> {
  const fast = options?.fast === true;
  const timeoutMs = options?.timeoutMs ?? (fast ? 45_000 : 120_000);
  const tmpRoot = await mkdtemp(join(tmpdir(), "doc-library-img-ocr-"));
  const sourcePath = join(tmpRoot, "source.bin");

  // Fast: 1–2 preprocess вместо 4; early-exit ниже
  const recipes: PreprocessRecipe[] = fast
    ? ["screen_soft", "document"]
    : ["document", "screen_soft", "adaptive", "screen_inverted"];
  let bestText: string | null = null;
  let bestScore = 0;

  try {
    await writeFile(sourcePath, buffer);

    const perRecipeTimeout = Math.max(
      fast ? 14_000 : 28_000,
      Math.floor(timeoutMs / (recipes.length + 1)),
    );

    // Сначала сырой файл — часто достаточно для скрина теста
    {
      const rawAttempt = await ocrPhotoFile(sourcePath, perRecipeTimeout, { fast });
      if (rawAttempt.text && rawAttempt.score > bestScore) {
        bestScore = rawAttempt.score;
        bestText = rawAttempt.text;
      }
      if (fast && bestScore >= 70 && bestText && isPhotoOcrUsable(bestText)) {
        return bestText;
      }
      if (bestScore >= 160 && bestText && /вопрос|вариант/i.test(bestText)) {
        return bestText;
      }
    }

    for (const recipe of recipes) {
      const outPath = join(tmpRoot, `${recipe}.png`);
      const ok = await preprocessPhoto(sourcePath, outPath, recipe, perRecipeTimeout);
      if (!ok) continue;

      const { text, score } = await ocrPhotoFile(outPath, perRecipeTimeout, { fast });
      if (text && score > bestScore) {
        bestScore = score;
        bestText = text;
      }
      if (fast && bestScore >= 75 && bestText && isPhotoOcrUsable(bestText)) break;
      if (bestScore >= 160 && bestText && /вопрос|вариант/i.test(bestText)) break;
    }

    return bestText;
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function isPhotoOcrUsable(text: string | null): boolean {
  if (!text) return false;
  const cleaned = cleanupPhotoOcrText(text);
  const cyr = countCyrillicChars(cleaned);
  const words = countCyrillicWords(cleaned, 4);
  const score = scorePhotoOcrQuality(cleaned);
  const latin = (cleaned.match(/[A-Za-z]/g) ?? []).length;
  const letters = (cleaned.match(/[A-Za-zА-Яа-яЁё]/g) ?? []).length || 1;
  const cyrRatio = cyr / letters;

  if (WATERMARK_RE.test(text) && words < 8) return false;
  if (words < 4) return false;
  if (cyr < 40) return false;
  if (cyrRatio < 0.45 && latin > cyr) return false;
  if (score < 55) return false;

  const hasQuizShape = /вопрос|вариант|заземл|токоведущ|разрешается|запрещается/i.test(cleaned);
  if (hasQuizShape && cyr >= 35 && words >= 4 && score >= 50 && cyrRatio >= 0.4) return true;

  return score >= 70 && cyr >= 50 && cyrRatio >= 0.5;
}

/**
 * Текст читается, но качество сомнительное (смаз, блики, обрезка).
 * Раньше порог был слишком строгим (score&lt;95) — почти все фото шли в «плохое».
 * Сейчас doubtful только при реально слабом OCR без нормальной структуры теста.
 */
export function isPhotoOcrDoubtful(text: string | null): boolean {
  if (!text?.trim()) return true;
  if (!isPhotoOcrUsable(text)) return true;

  const cleaned = cleanupPhotoOcrText(text);
  const score = scorePhotoOcrQuality(cleaned);
  const words = countCyrillicWords(cleaned, 4);
  const lines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);
  const garbage = lines.filter((l) => isGarbageOcrLine(l)).length;
  const hasQuizShape = /вопрос|вариант|(?:^|\n)\s*(?:[1-9]|[a-dа-г])(?:[.)])\s+\S/im.test(cleaned);
  const optionLines = lines.filter((l) => /^(?:[1-9]|[a-dа-г])(?:[.)]|\s)/i.test(l)).length;

  // Явная структура теста с вариантами — не считаем doubtful из‑за среднего score
  if (hasQuizShape && optionLines >= 2 && words >= 6 && score >= 50) return false;

  // Реально слабый OCR
  if (score < 55) return true;
  if (words < 6 && !hasQuizShape) return true;
  if (lines.length >= 5 && garbage / lines.length >= 0.45) return true;

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const tiny = tokens.filter((t) => /^[А-Яа-яЁёA-Za-z]{1,2}$/.test(t)).length;
  if (tokens.length >= 16 && tiny / tokens.length >= 0.45) return true;

  return false;
}
