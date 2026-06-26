import { config as loadDotenv } from "dotenv";
import { resolve } from "path";
import { z } from "zod";
import { isValidRelativePath } from "./paths.js";

loadDotenv({ path: resolve(__dirname, "../../../.env") });
loadDotenv();

const envSchema = z.object({
  LIBRARY_PORT: z.coerce.number().int().positive().default(3021),
  LIBRARY_ROOT: z.string().default(resolve(__dirname, "../../../data/library")),
  /** Корневая коллекция (slug, латиница): regulations, corp-docs, … */
  INSTALLATION_SLUG: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).default("regulations"),
  INSTALLATION_TITLE: z.string().default("Technical Library"),
  /** Подпапка по умолчанию: gas, electro, ohrana-truda, buhgalteriya, … */
  INSTALLATION_LIBRARY_PATH: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().replace(/\\/g, "/") : ""),
    z.string().default(""),
  ),
  LIBRARY_SHARED_SECRET: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(8).optional(),
  ),
  LIBRARY_MAX_FILE_MB: z.coerce.number().int().positive().default(50),
  LIBRARY_OCR_MAX_PAGES: z.coerce.number().int().positive().default(150),
  LIBRARY_OCR_TIMEOUT_SEC: z.coerce.number().int().positive().default(900),
});

export type Env = z.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);

export function defaultInstallationLibraryPath(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/\\/g, "/");
  if (!trimmed || !isValidRelativePath(trimmed)) return "";
  return trimmed;
}

export function resolvedDefaultLibraryPath(): string {
  return defaultInstallationLibraryPath(env.INSTALLATION_LIBRARY_PATH);
}
