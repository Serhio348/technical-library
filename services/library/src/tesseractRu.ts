import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Разрешённые символы после OCR: кириллица, латиница, цифры, типографика ТКП,
 * плюс символы таблиц/формул (| = _ [] и т.п.).
 */
const ALLOWED_OCR_CHAR_RE =
  /[^A-Za-zА-Яа-яЁё0-9.,:;!?\-–—«»"'()/\\%+№§°|=_\[\]{}*<>~\n\r\t ]/gu;

export const TESSERACT_RU_LANG = "rus";
/** Для фото викторин/приложений: rus+eng лучше, чем один rus при смешанном UI. */
export const TESSERACT_PHOTO_LANG = "rus+eng";

export const TESSERACT_RU_WHITELIST =
  "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" +
  "0123456789" +
  ".,:;!?-–—«»\"'()/\\%+№§°|=_[]{}*<>~ ";

export function sanitizeRuOcrText(raw: string): string {
  return raw.replace(ALLOWED_OCR_CHAR_RE, "");
}

export type TesseractRuOptions = {
  preserveSpaces?: boolean;
  /** LSTM + whitelist часто даёт мусор на фото — для фото отключать. */
  useWhitelist?: boolean;
  lang?: string;
};

export async function runTesseractRu(
  imagePath: string,
  timeoutMs: number,
  psm: string,
  options?: TesseractRuOptions,
): Promise<string> {
  const lang = options?.lang ?? TESSERACT_RU_LANG;
  const args = [
    imagePath,
    "stdout",
    "-l",
    lang,
    "--oem",
    "1",
    "--psm",
    psm,
  ];
  if (options?.useWhitelist !== false) {
    args.push("-c", `tessedit_char_whitelist=${TESSERACT_RU_WHITELIST}`);
  }
  if (options?.preserveSpaces !== false) {
    args.push("-c", "preserve_interword_spaces=1");
  }

  const { stdout } = await execFileAsync("tesseract", args, {
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    encoding: "utf8",
  });

  return sanitizeRuOcrText(typeof stdout === "string" ? stdout : "");
}

export type TesseractTsvOptions = {
  useWhitelist?: boolean;
  lang?: string;
  /** Отбросить слова с conf ниже порога (0–100). */
  minConf?: number;
};

/** TSV OCR: координаты слов → восстановление колонок таблиц. */
export async function runTesseractRuTsv(
  imagePath: string,
  timeoutMs: number,
  psm = "6",
  options?: TesseractTsvOptions,
): Promise<string> {
  const lang = options?.lang ?? TESSERACT_RU_LANG;
  const args = [
    imagePath,
    "stdout",
    "-l",
    lang,
    "--oem",
    "1",
    "--psm",
    psm,
    "-c",
    "preserve_interword_spaces=1",
    "tsv",
  ];
  if (options?.useWhitelist !== false) {
    // insert before "tsv"
    args.splice(args.length - 1, 0, "-c", `tessedit_char_whitelist=${TESSERACT_RU_WHITELIST}`);
  }

  const { stdout } = await execFileAsync("tesseract", args, {
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    encoding: "utf8",
  });

  return typeof stdout === "string" ? stdout : "";
}

type TsvWord = {
  level: number;
  page: number;
  block: number;
  par: number;
  line: number;
  wordNum: number;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
  text: string;
};

function parseTsvRow(line: string, minConf = 0): TsvWord | null {
  const cols = line.split("\t");
  if (cols.length < 12) return null;
  const level = Number(cols[0]);
  if (level !== 5) return null; // word level
  const text = (cols[11] ?? "").trim();
  if (!text) return null;
  const conf = Number(cols[10]);
  if (!Number.isFinite(conf) || conf < minConf) return null;
  return {
    level,
    page: Number(cols[1]) || 0,
    block: Number(cols[2]) || 0,
    par: Number(cols[3]) || 0,
    line: Number(cols[4]) || 0,
    wordNum: Number(cols[5]) || 0,
    left: Number(cols[6]) || 0,
    top: Number(cols[7]) || 0,
    width: Number(cols[8]) || 0,
    height: Number(cols[9]) || 0,
    conf,
    text: sanitizeRuOcrText(text),
  };
}

/**
 * Собирает текст с выравниванием по X — колонки таблиц не схлопываются в одну кучу.
 */
export function layoutTextFromTesseractTsv(tsv: string, minConf = 0): string {
  const words: TsvWord[] = [];
  for (const line of tsv.split(/\r?\n/)) {
    if (!line || line.startsWith("level\t")) continue;
    const word = parseTsvRow(line, minConf);
    if (word?.text) words.push(word);
  }
  if (words.length === 0) return "";

  const lineKey = (w: TsvWord) => `${w.block}:${w.par}:${w.line}`;
  const groups = new Map<string, TsvWord[]>();
  for (const word of words) {
    const key = lineKey(word);
    const list = groups.get(key) ?? [];
    list.push(word);
    groups.set(key, list);
  }

  const lines = [...groups.values()].map((group) => {
    group.sort((a, b) => a.left - b.left || a.top - b.top);
    const avgHeight =
      group.reduce((sum, w) => sum + Math.max(w.height, 1), 0) / group.length;
    // ~0.45 ширины символа как шаг колонки
    const colStep = Math.max(6, Math.round(avgHeight * 0.45));
    let cursor = group[0]!.left;
    let out = "";
    for (const word of group) {
      const gapPx = word.left - cursor;
      if (out && gapPx > colStep * 1.2) {
        const spaces = Math.min(24, Math.max(1, Math.round(gapPx / colStep)));
        out += " ".repeat(spaces);
      } else if (out) {
        out += " ";
      }
      out += word.text;
      cursor = word.left + Math.max(word.width, colStep);
    }
    return { top: group[0]!.top, text: out.trimEnd() };
  });

  lines.sort((a, b) => a.top - b.top);
  return lines
    .map((l) => l.text)
    .filter(Boolean)
    .join("\n")
    .trim();
}
