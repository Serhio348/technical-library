import { execFile } from "child_process";
import { access } from "fs/promises";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type ExtractedPdfTable = {
  page: number;
  markdown: string;
};

function scriptCandidates(): string[] {
  return [
    join(__dirname, "../scripts/extract_pdf_tables.py"),
    join(__dirname, "../../scripts/extract_pdf_tables.py"),
    join(process.cwd(), "scripts/extract_pdf_tables.py"),
    join(process.cwd(), "services/library/scripts/extract_pdf_tables.py"),
  ];
}

async function resolveScriptPath(): Promise<string | null> {
  for (const candidate of scriptCandidates()) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function pythonBins(): string[] {
  const fromEnv = process.env.LIBRARY_PYTHON?.trim();
  return [fromEnv, "python3", "python"].filter(Boolean) as string[];
}

/**
 * Таблицы из текстового слоя PDF через pdfplumber → Markdown.
 * Если Python/pdfplumber недоступны — пустой список (не ломает индексацию).
 */
export async function extractPdfTablesMarkdown(
  filePath: string,
  options?: { maxPages?: number; timeoutMs?: number },
): Promise<ExtractedPdfTable[]> {
  const script = await resolveScriptPath();
  if (!script) return [];

  const maxPages = options?.maxPages ?? 0;
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const args = [script, filePath];
  if (maxPages > 0) args.push(String(maxPages));

  for (const bin of pythonBins()) {
    try {
      const { stdout } = await execFileAsync(bin, args, {
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        encoding: "utf8",
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      const parsed = JSON.parse(String(stdout || "{}")) as {
        tables?: Array<{ page?: number; markdown?: string }>;
      };
      if (!Array.isArray(parsed.tables)) return [];
      return parsed.tables
        .filter((t) => typeof t.markdown === "string" && t.markdown.trim())
        .map((t) => ({
          page: typeof t.page === "number" && t.page > 0 ? t.page : 1,
          markdown: t.markdown!.trim(),
        }));
    } catch {
      // try next python binary / give up
    }
  }
  return [];
}

/** Вставляет markdown-таблицы в текст страниц (или в общий текст). */
export function mergeTablesIntoPages(
  pages: Array<{ page: number; text: string }> | null,
  tables: ExtractedPdfTable[],
  fullText: string | null,
): { pages: Array<{ page: number; text: string }> | null; text: string | null } {
  if (tables.length === 0) {
    return { pages, text: fullText };
  }

  if (pages && pages.length > 0) {
    const byPage = new Map<number, string[]>();
    for (const table of tables) {
      const list = byPage.get(table.page) ?? [];
      list.push(table.markdown);
      byPage.set(table.page, list);
    }
    const merged = pages.map((entry) => {
      const extras = byPage.get(entry.page);
      if (!extras?.length) return entry;
      const block = extras.map((md, i) => `[таблица ${i + 1}]\n${md}`).join("\n\n");
      return {
        page: entry.page,
        text: `${entry.text}\n\n${block}`.trim(),
      };
    });
    // pages without text but with tables
    for (const [page, extras] of byPage) {
      if (merged.some((p) => p.page === page)) continue;
      merged.push({
        page,
        text: extras.map((md, i) => `[таблица ${i + 1}]\n${md}`).join("\n\n"),
      });
    }
    merged.sort((a, b) => a.page - b.page);
    const text = merged.map((p) => p.text).join("\n\n");
    return { pages: merged, text };
  }

  const appendix = tables
    .map((t, i) => `[таблица ${i + 1}, стр. ${t.page}]\n${t.markdown}`)
    .join("\n\n");
  const text = fullText ? `${fullText}\n\n${appendix}` : appendix;
  return { pages, text };
}
