import type { Telegraf, Context } from "telegraf";
import { escHtml, truncate } from "../format.js";
import { searchLibrary } from "../libraryClient.js";
import { clearDocumentFilter, clearInputMode, getSession } from "../session.js";
import { ensureDirectionOrPrompt } from "../direction.js";
import { mainKeyboard } from "../keyboards.js";

export async function runSearchQuery(ctx: Context, query: string): Promise<void> {
  const session = getSession(ctx.chat!.id);
  if (!(await ensureDirectionOrPrompt(ctx))) return;

  const q = query.trim();
  if (!q) {
    session.inputMode = "search";
    await ctx.reply("🔍 Введите текст для поиска:", mainKeyboard());
    return;
  }

  clearInputMode(session);
  const documents = session.documentPath ? [session.documentPath] : [];
  const usedFileFilter = documents.length > 0;
  // One-shot: фильтр действует на этот поиск и сразу сбрасывается
  clearDocumentFilter(session);

  const status = usedFileFilter
    ? `🔍 Ищу в файле «${documents[0]!.split("/").pop()}»…`
    : "🔍 Ищу…";
  await ctx.reply(status);

  try {
    const hits = await searchLibrary(session.slug, q, session.scopePath, documents);
    const filterNote = usedFileFilter
      ? "\n\n📄 Фильтр по файлу сброшен — следующий поиск снова по всей области."
      : "";
    if (hits.length === 0) {
      await ctx.reply(
        `Ничего не найдено. Проверьте, что у файлов в веб-интерфейсе есть метка ИИ.${filterNote}`,
        mainKeyboard(),
      );
      return;
    }

    const lines = hits.map(
      (h, i) => `${i + 1}. <b>${escHtml(h.name)}</b>\n   ${escHtml(h.excerpt)}`,
    );

    await ctx.reply(
      truncate(`<b>Найдено ${hits.length}:</b>\n\n${lines.join("\n\n")}${filterNote}`),
      {
        parse_mode: "HTML",
        ...mainKeyboard(),
      },
    );
  } catch (e) {
    console.error("[bot/search]", e);
    await ctx.reply("Ошибка поиска.", mainKeyboard());
  }
}

export function registerSearch(bot: Telegraf<Context>): void {
  bot.command("search", async (ctx) => {
    const query =
      ctx.message && "text" in ctx.message ? ctx.message.text.replace(/^\/search\s*/i, "").trim() : "";
    await runSearchQuery(ctx, query);
  });
}
