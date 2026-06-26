import type { Telegraf, Context } from "telegraf";
import { escHtml, truncate } from "../format.js";
import { searchLibrary } from "../libraryClient.js";
import { clearInputMode, getSession } from "../session.js";
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
  await ctx.reply("🔍 Ищу…");

  try {
    const hits = await searchLibrary(session.slug, q, session.scopePath);
    if (hits.length === 0) {
      await ctx.reply("Ничего не найдено. Проверьте, что у файлов в веб-интерфейсе есть метка ИИ.", mainKeyboard());
      return;
    }

    const lines = hits.map(
      (h, i) => `${i + 1}. <b>${escHtml(h.name)}</b>\n   ${escHtml(h.excerpt)}`,
    );

    await ctx.reply(truncate(`<b>Найдено ${hits.length}:</b>\n\n${lines.join("\n\n")}`), {
      parse_mode: "HTML",
      ...mainKeyboard(),
    });
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
