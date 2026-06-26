import type { Telegraf, Context } from "telegraf";
import { escHtml } from "../format.js";
import { fetchDirections } from "../libraryClient.js";
import { getSession, resetAskState } from "../session.js";

function requireSlug(ctx: Context, slug: string): boolean {
  if (slug) return true;
  void ctx.reply("Сначала выберите направление: /directions → /dir slug");
  return false;
}

export function registerContext(bot: Telegraf<Context>): void {
  bot.command("dir", async (ctx) => {
    const arg = ctx.message && "text" in ctx.message ? ctx.message.text.replace(/^\/dir\s*/i, "").trim() : "";
    if (!arg) {
      await ctx.reply("Укажите slug: /dir electro");
      return;
    }

    const directions = await fetchDirections();
    const found = directions.find((d) => d.slug === arg);
    if (!found) {
      await ctx.reply(`Направление «${escHtml(arg)}» не найдено. /directions`);
      return;
    }

    const session = getSession(ctx.chat!.id);
    session.slug = found.slug;
    session.scopePath = "";
    resetAskState(session);
    await ctx.reply(`✅ Направление: <b>${escHtml(found.title)}</b> (<code>${escHtml(found.slug)}</code>)`, {
      parse_mode: "HTML",
    });
  });

  bot.command("folder", async (ctx) => {
    const session = getSession(ctx.chat!.id);
    if (!requireSlug(ctx, session.slug)) return;

    const arg =
      ctx.message && "text" in ctx.message ? ctx.message.text.replace(/^\/folder\s*/i, "").trim() : "";

    session.scopePath = arg.replace(/\\/g, "/");
    resetAskState(session);

    if (session.scopePath) {
      await ctx.reply(`📁 Папка: <code>${escHtml(session.scopePath)}</code>`, { parse_mode: "HTML" });
    } else {
      await ctx.reply("📁 Контекст: корень направления (все подпапки).");
    }
  });
}

export { requireSlug };
