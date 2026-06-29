import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Разрешённые символы после OCR: кириллица, латиница, цифры, типографика вопросов/ТКП. */
const ALLOWED_OCR_CHAR_RE = /[^A-Za-zА-Яа-яЁё0-9.,:;!?\-–—«»"'()/\\%+№§°\n\r\t ]/gu;

export const TESSERACT_RU_LANG = "rus";

export const TESSERACT_RU_WHITELIST =
  "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" +
  "0123456789" +
  ".,:;!?-–—«»\"'()/\\%+№§° ";

export function sanitizeRuOcrText(raw: string): string {
  return raw.replace(ALLOWED_OCR_CHAR_RE, "");
}

export async function runTesseractRu(
  imagePath: string,
  timeoutMs: number,
  psm: string,
  options?: { preserveSpaces?: boolean },
): Promise<string> {
  const args = [
    imagePath,
    "stdout",
    "-l",
    TESSERACT_RU_LANG,
    "--oem",
    "1",
    "--psm",
    psm,
    "-c",
    `tessedit_char_whitelist=${TESSERACT_RU_WHITELIST}`,
  ];
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
