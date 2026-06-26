import type { Telegraf, Context } from "telegraf";
import { escHtml, truncate } from "../format.js";
import { searchLibrary } from "../libraryClient.js";
import { getSession } from "../session.js";
import { requireSlug } from "./context.js";

export function registerSearch(bot: Telegraf<Context>): void {
  bot.command("search", async (ctx) => {
    const session = getSession(ctx.chat!.id);
    if (!requireSlug(ctx, session.slug)) return;

    const query =
      ctx.message && "text" in ctx.message ? ctx.message.text.replace(/^\/search\s*/i, "").trim() : "";

    if (!query) {
      await ctx.reply("Пример: /search требования к газопроводу");
      return;
    }

    await ctx.reply("🔍 Ищу…");

    try {
      const hits = await searchLibrary(session.slug, query, session.scopePath);
      if (hits.length === 0) {
        await ctx.reply("Ничего не найдено. Проверьте индекс (ИИ) в веб-интерфейсе.");
        return;
      }

      const lines = hits.map(
        (h, i) =>
          `${i + 1}. <b>${escHtml(h.name)}</b>\n` +
          `   <code>${escHtml(h.path)}</code>\n` +
          `   ${escHtml(h.excerpt)}`,
      );

      await ctx.reply(
        truncate(`<b>Найдено ${hits.length}:</b>\n\n${lines.join("\n\n")}`),
        { parse_mode: "HTML" },
      );
    } catch (e) {
      console.error("[bot/search]", e);
      await ctx.reply("Ошибка поиска. Проверьте логи сервера.");
    }
  });
}
