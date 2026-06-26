import type { Telegraf, Context } from "telegraf";
import { escHtml } from "../format.js";
import { fetchDirections } from "../libraryClient.js";
import { applyDirection, ensureDirectionOrPrompt, promptChooseDirection } from "../direction.js";
import { getSession, resetAskState } from "../session.js";
import { mainKeyboard } from "../keyboards.js";

export function registerContext(bot: Telegraf<Context>): void {
  bot.command("dir", async (ctx) => {
    const arg = ctx.message && "text" in ctx.message ? ctx.message.text.replace(/^\/dir\s*/i, "").trim() : "";
    if (!arg) {
      await promptChooseDirection(ctx);
      return;
    }

    const directions = await fetchDirections();
    const found =
      directions.find((d) => d.slug === arg) ??
      directions.find((d) => d.title.toLowerCase() === arg.toLowerCase());
    if (!found) {
      await ctx.reply(`«${escHtml(arg)}» не найдено. Выберите из списка:`, mainKeyboard());
      await promptChooseDirection(ctx);
      return;
    }

    await applyDirection(ctx, found);
  });

  bot.command("folder", async (ctx) => {
    if (!(await ensureDirectionOrPrompt(ctx))) return;

    const arg =
      ctx.message && "text" in ctx.message ? ctx.message.text.replace(/^\/folder\s*/i, "").trim() : "";

    const session = getSession(ctx.chat!.id);
    session.scopePath = arg.replace(/\\/g, "/");
    resetAskState(session);

    const label = session.scopePath ? session.scopePath.split("/").pop() : "все папки";
    await ctx.reply(`📁 Папка: <b>${label ?? "все папки"}</b>`, { parse_mode: "HTML", ...mainKeyboard() });
  });
}

export { ensureDirectionOrPrompt as requireSlug };
