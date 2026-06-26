import { execFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const MAX_PHOTO_OCR_CHARS = 12_000;
const CYRILLIC_RE = /[А-Яа-яЁё]/g;
/** Иероглифы и прочие ложные символы при плохом OCR. */
const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF]/g;
const PHOTO_PSM_MODES = ["11", "3", "6", "4"] as const;

function countCyrillicChars(text: string): number {
  return text.match(CYRILLIC_RE)?.length ?? 0;
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

  const cyrillicRatio = cyrillic / Math.max(letters, 1);
  return (
    cyrillic * 3 +
    latin * 0.4 +
    digits * 0.3 +
    cyrillicRatio * 120 -
    cjkLeft * 50 -
    weird * 2
  );
}

function normalizePhotoText(raw: string): string | null {
  const lines = stripMisdetectedScripts(raw)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0);

  const text = lines.join("\n").trim();
  if (!text) return null;
  return text.slice(0, MAX_PHOTO_OCR_CHARS);
}

async function preprocessPhotoForOcr(sourcePath: string, outPath: string, timeoutMs: number): Promise<boolean> {
  try {
    await execFileAsync(
      "magick",
      [
        sourcePath,
        "-auto-orient",
        "-colorspace",
        "Gray",
        "-contrast-stretch",
        "0.5%x0.5%",
        "-filter",
        "Lanczos",
        "-resize",
        "2200x2200>",
        "-sharpen",
        "0x0.9",
        "-normalize",
        outPath,
      ],
      { timeout: Math.min(timeoutMs, 25_000), maxBuffer: 8 * 1024 * 1024 },
    );
    return true;
  } catch {
    return false;
  }
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

async function ocrPhotoFile(imagePath: string, timeoutMs: number): Promise<string | null> {
  const langs = ["rus+eng", "rus"] as const;
  let bestText = "";
  let bestScore = 0;

  const perAttempt = Math.max(8_000, Math.floor(timeoutMs / (PHOTO_PSM_MODES.length * langs.length)));

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

  if (bestScore < 8) return null;
  return normalizePhotoText(bestText);
}

export async function extractTextFromImageBuffer(
  buffer: Buffer,
  options?: { timeoutMs?: number },
): Promise<string | null> {
  const timeoutMs = options?.timeoutMs ?? 90_000;
  const tmpRoot = await mkdtemp(join(tmpdir(), "doc-library-img-ocr-"));
  const sourcePath = join(tmpRoot, "source.bin");
  const preprocessedPath = join(tmpRoot, "pre.png");

  try {
    await writeFile(sourcePath, buffer);
    const ocrPath = (await preprocessPhotoForOcr(sourcePath, preprocessedPath, timeoutMs))
      ? preprocessedPath
      : sourcePath;
    return await ocrPhotoFile(ocrPath, timeoutMs);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function isPhotoOcrUsable(text: string | null): boolean {
  if (!text) return false;
  const cleaned = stripMisdetectedScripts(text);
  return countCyrillicChars(cleaned) >= 4 || (cleaned.length >= 20 && scorePhotoOcrQuality(cleaned) >= 12);
}
