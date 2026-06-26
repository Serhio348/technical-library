import type { Telegraf, Context } from "telegraf";
import { isDeepSeekConfigured } from "../../config.js";
import { isExpandRequest } from "../../ask.js";
import { escHtml, truncate } from "../format.js";
import { askLibrary } from "../libraryClient.js";
import { getSession } from "../session.js";
import { requireSlug } from "./context.js";

async function runAsk(ctx: Context, question: string, mode: "preview" | "full"): Promise<void> {
  const session = getSession(ctx.chat!.id);
  if (!requireSlug(ctx, session.slug)) return;

  if (!isDeepSeekConfigured()) {
    await ctx.reply("ИИ не настроен: добавьте DEEPSEEK_API_KEY в .env");
    return;
  }

  const q = question.trim();
  if (!q) {
    await ctx.reply("Пример: /ask Какие требования к газопроводу?");
    return;
  }

  await ctx.reply(mode === "full" ? "Формирую подробный ответ…" : "Ищу раздел в документах…");

  try {
    const history = mode === "full" ? session.askHistory : [];
    const result = await askLibrary(session.slug, q, session.scopePath, history, mode);

    if (mode === "preview") {
      session.pendingQuestion = q;
      session.askHistory.push({ role: "user", content: q });
      session.askHistory.push({ role: "assistant", content: result.answer });
    } else {
      session.pendingQuestion = null;
      session.askHistory.push({ role: "assistant", content: result.answer });
    }
    session.askHistory = session.askHistory.slice(-8);

    const sources =
      result.sources.length > 0
        ? `\n\n<b>Источники:</b>\n${result.sources.map((s) => `• ${escHtml(s.name)}`).join("\n")}`
        : "";

    const suffix = mode === "preview" ? "\n\nПолный ответ: /show или «покажи»" : "";

    await ctx.reply(truncate(`${escHtml(result.answer)}${sources}${suffix}`), { parse_mode: "HTML" });
  } catch (e) {
    console.error("[bot/ask]", e);
    await ctx.reply("Не удалось получить ответ. Проверьте DEEPSEEK_API_KEY и индекс документов.");
  }
}

export function registerAsk(bot: Telegraf<Context>): void {
  bot.command("ask", async (ctx) => {
    const question =
      ctx.message && "text" in ctx.message ? ctx.message.text.replace(/^\/ask\s*/i, "").trim() : "";
    await runAsk(ctx, question, "preview");
  });

  bot.command("show", async (ctx) => {
    const session = getSession(ctx.chat!.id);
    if (!session.pendingQuestion) {
      await ctx.reply("Сначала задайте вопрос: /ask …");
      return;
    }
    await runAsk(ctx, session.pendingQuestion, "full");
  });

  bot.hears(/^(покажи|показать|да|подробнее)(?:\s+(?:полный|подробный))?(?:\s+ответ)?[.!?]*$/iu, async (ctx, next) => {
    const session = getSession(ctx.chat!.id);
    if (!session.pendingQuestion) return next();
    await runAsk(ctx, session.pendingQuestion, "full");
  });

  bot.on("text", async (ctx, next) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return next();

    const session = getSession(ctx.chat!.id);
    if (isExpandRequest(text) && session.pendingQuestion) {
      await runAsk(ctx, session.pendingQuestion, "full");
      return;
    }

    if (session.slug && text.length >= 3) {
      await runAsk(ctx, text, "preview");
      return;
    }

    return next();
  });
}
