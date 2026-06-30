import { config as loadDotenv } from "dotenv";
import { resolve } from "path";
import { z } from "zod";
import { isValidRelativePath } from "./paths.js";

loadDotenv({ path: resolve(__dirname, "../../../.env") });
loadDotenv();

const envSchema = z.object({
  LIBRARY_PORT: z.coerce.number().int().positive().default(3021),
  LIBRARY_ROOT: z.string().default(resolve(__dirname, "../../../data/library")),
  /** Опционально: направление по умолчанию для клиента (UI / bot). */
  DEFAULT_DIRECTION_SLUG: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  ),
  /** Опционально: подпапка внутри направления (подвид). */
  DEFAULT_SCOPE_PATH: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().replace(/\\/g, "/") : ""),
    z.string().default(""),
  ),
  LIBRARY_SHARED_SECRET: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(8).optional(),
  ),
  LIBRARY_MAX_FILE_MB: z.coerce.number().int().positive().default(200),
  LIBRARY_UPLOAD_MAX_FILES: z.coerce.number().int().positive().default(20),
  LIBRARY_OCR_MAX_PAGES: z.coerce.number().int().positive().default(150),
  LIBRARY_OCR_TIMEOUT_SEC: z.coerce.number().int().positive().default(900),
  /** DPI для pdftoppm (150 быстрее, 200 точнее). */
  LIBRARY_OCR_DPI: z.coerce.number().int().positive().default(150),
  /** Сколько OCR-пайплайнов одновременно (tesseract). На VPS обычно 1. */
  LIBRARY_OCR_MAX_CONCURRENT: z.coerce.number().int().positive().default(1),
  LIBRARY_INDEX_MAX_CONCURRENT: z.coerce.number().int().positive().default(2),
  DEEPSEEK_API_KEY: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(8).optional(),
  ),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  TELEGRAM_BOT_TOKEN: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.preprocess(
      (value) => (typeof value === "string" && value === "" ? undefined : value),
      z.string().min(20).optional(),
    ),
  ),
  TELEGRAM_BOT_DISABLED: z.preprocess(
    (value) => value === "true" || value === "1",
    z.boolean().default(false),
  ),
  /** Опционально: прокси/local Bot API (если api.telegram.org недоступен с VPS). */
  TELEGRAM_API_ROOT: z.preprocess((value) => {
    const v = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
    return v || undefined;
  }, z.string().url().optional()),
  /** HTTPS URL веб-UI для кнопки Mini App «Чат с голосом» в Telegram. */
  TELEGRAM_WEB_APP_URL: z.preprocess((value) => {
    const v = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
    return v || undefined;
  }, z.string().url().optional()),
});

export type Env = z.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);

export function normalizeScopePath(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/\\/g, "/");
  if (!trimmed || !isValidRelativePath(trimmed)) return "";
  return trimmed;
}

export function resolvedDefaultScopePath(): string {
  return normalizeScopePath(env.DEFAULT_SCOPE_PATH);
}

export function isDeepSeekConfigured(): boolean {
  return Boolean(env.DEEPSEEK_API_KEY?.trim());
}

export function isTelegramBotConfigured(): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN?.trim());
}

export function resolvedTelegramWebAppUrl(): string | undefined {
  const raw = env.TELEGRAM_WEB_APP_URL?.trim().replace(/\/+$/, "");
  if (!raw?.startsWith("https://")) return undefined;
  return raw;
}
