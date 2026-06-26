import { execFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const MAX_PHOTO_OCR_CHARS = 12_000;
const CYRILLIC_RE = /[А-Яа-яЁё]/g;
const CYRILLIC_WORD_RE = /[А-Яа-яЁё]{4,}/g;
/** Иероглифы и прочие ложные символы при плохом OCR. */
const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF]/g;
const PHOTO_PSM_MODES = ["4", "6", "3", "11"] as const;

type PreprocessRecipe = "screen_inverted" | "screen_binary" | "document";

function countCyrillicChars(text: string): number {
  return text.match(CYRILLIC_RE)?.length ?? 0;
}

function countCyrillicWords(text: string, minLen = 4): number {
  return (text.match(new RegExp(`[А-Яа-яЁё]{${minLen},}`, "g")) ?? []).length;
}

export function stripMisdetectedScripts(text: string): string {
  return text
    .replace(CJK_RE, "")
    .replace(/[\uAC00-\uD7AF]/g, "")
    .replace(/[\u0600-\u06FF]/g, "");
}

/** Чем выше — тем лучше для русскоязычного текста на фото. */
export function scorePhotoOcrQuality(text: string): number {
  const cleaned = stripMisdetectedScripts(text);
  const letters = cleaned.replace(/[\s\d\p{P}]/gu, "").length;
  if (letters === 0) return 0;

  const cyrillic = countCyrillicChars(cleaned);
  const latin = (cleaned.match(/[A-Za-z]/g) ?? []).length;
  const digits = (cleaned.match(/\d/g) ?? []).length;
  const cjkLeft = (cleaned.match(CJK_RE) ?? []).length;
  const weird = (cleaned.match(/[^\n\r\t A-Za-zА-Яа-яЁё0-9.,:;!?\-–—«»"'()\/\\%+№§°]/g) ?? []).length;
  const lower = cleaned.toLowerCase();

  let score =
    cyrillic * 3 +
    latin * 0.4 +
    digits * 0.3 +
    (cyrillic / Math.max(letters, 1)) * 120 -
    cjkLeft * 50 -
    weird * 2;

  if (/вопрос/.test(lower)) score += 30;
  if (/вариант/.test(lower)) score += 30;
  if (/разрешается|запрещается|не разрешается/.test(lower)) score += 25;
  if (/тепло|ремн|установ/.test(lower)) score += 15;
  if (/№\s*\d+/.test(cleaned)) score += 15;

  score += Math.min(countCyrillicWords(cleaned, 4), 12) * 4;
  return score;
}

function normalizePhotoText(raw: string): string | null {
  const lines = stripMisdetectedScripts(raw)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t|]+/g, " ").trim())
    .filter((line) => line.length > 1);

  const text = lines.join("\n").trim();
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
    return false;
  }
}

async function preprocessPhoto(
  sourcePath: string,
  outPath: string,
  recipe: PreprocessRecipe,
  timeoutMs: number,
): Promise<boolean> {
  const upscale = ["-auto-orient", "-filter", "Lanczos", "-resize", "3000x3000>"];

  if (recipe === "screen_inverted") {
    return runMagick(
      [
        sourcePath,
        ...upscale,
        "-colorspace",
        "Gray",
        "-gaussian-blur",
        "0x2.2",
        "-negate",
        "-contrast-stretch",
        "1.5%x1.5%",
        "-level",
        "10%,90%,1.0",
        "-sharpen",
        "0x1.4",
        outPath,
      ],
      timeoutMs,
    );
  }

  if (recipe === "screen_binary") {
    return runMagick(
      [
        sourcePath,
        ...upscale,
        "-colorspace",
        "Gray",
        "-gaussian-blur",
        "0x2.8",
        "-negate",
        "-contrast-stretch",
        "0%",
        "100%",
        "-black-threshold",
        "52%",
        "-sharpen",
        "0x1",
        outPath,
      ],
      timeoutMs,
    );
  }

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

async function runTesseract(
  imagePath: string,
  timeoutMs: number,
  psm: string,
  lang: string,
): Promise<string> {
  const { stdout } = await execFileAsync(
    "tesseract",
    [imagePath, "stdout", "-l", lang, "--oem", "1", "--psm", psm, "-c", "preserve_interword_spaces=1"],
    { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
  );
  return typeof stdout === "string" ? stdout : "";
}

async function ocrPhotoFile(imagePath: string, timeoutMs: number): Promise<{ text: string | null; score: number }> {
  const langs = ["rus", "rus+eng"] as const;
  let bestText = "";
  let bestScore = 0;

  const attempts = PHOTO_PSM_MODES.length * langs.length;
  const perAttempt = Math.max(10_000, Math.floor(timeoutMs / attempts));

  for (const lang of langs) {
    for (const psm of PHOTO_PSM_MODES) {
      try {
        const raw = await runTesseract(imagePath, perAttempt, psm, lang);
        const score = scorePhotoOcrQuality(raw);
        if (score > bestScore) {
          bestScore = score;
          bestText = raw;
        }
      } catch {
        // try next mode
      }
    }
  }

  if (bestScore < 20) return { text: null, score: bestScore };
  return { text: normalizePhotoText(bestText), score: bestScore };
}

export async function extractTextFromImageBuffer(
  buffer: Buffer,
  options?: { timeoutMs?: number },
): Promise<string | null> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const tmpRoot = await mkdtemp(join(tmpdir(), "doc-library-img-ocr-"));
  const sourcePath = join(tmpRoot, "source.bin");

  const recipes: PreprocessRecipe[] = ["screen_inverted", "screen_binary", "document"];
  let bestText: string | null = null;
  let bestScore = 0;

  try {
    await writeFile(sourcePath, buffer);

    const perRecipeTimeout = Math.max(25_000, Math.floor(timeoutMs / recipes.length));

    for (const recipe of recipes) {
      const outPath = join(tmpRoot, `${recipe}.png`);
      const ok = await preprocessPhoto(sourcePath, outPath, recipe, perRecipeTimeout);
      if (!ok) continue;

      const { text, score } = await ocrPhotoFile(outPath, perRecipeTimeout);
      if (text && score > bestScore) {
        bestScore = score;
        bestText = text;
      }
    }

    if (!bestText && (await preprocessPhoto(sourcePath, join(tmpRoot, "raw.png"), "document", perRecipeTimeout))) {
      const { text, score } = await ocrPhotoFile(sourcePath, perRecipeTimeout);
      if (text && score > bestScore) bestText = text;
    }

    return bestText;
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function isPhotoOcrUsable(text: string | null): boolean {
  if (!text) return false;
  const cleaned = stripMisdetectedScripts(text);
  const cyr = countCyrillicChars(cleaned);
  const words = countCyrillicWords(cleaned, 4);
  const score = scorePhotoOcrQuality(cleaned);

  if (words < 3) return false;
  if (cyr < 30) return false;
  if (score < 45) return false;

  const hasQuizShape = /вопрос|вариант|разрешается|запрещается/i.test(cleaned);
  if (hasQuizShape && cyr >= 25 && words >= 2 && score >= 35) return true;

  return score >= 55 && cyr >= 40;
}
