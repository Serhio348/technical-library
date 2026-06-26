import type { Telegraf } from "telegraf";
import type { Context } from "telegraf";
import { escHtml, truncate } from "../format.js";
import { fetchDirections } from "../libraryClient.js";
import { getSession, sessionLabel } from "../session.js";

function helpText(): string {
  return (
    "<b>Нормативная библиотека</b>\n\n" +
    "Команды:\n" +
    "/directions — список направлений\n" +
    "/dir slug — выбрать направление (например <code>/dir electro</code>)\n" +
    "/folder путь — папка внутри направления (например <code>/folder tkp</code>)\n" +
    "/search текст — поиск по индексу PDF\n" +
    "/ask вопрос — подсказка, где искать ответ (кратко)\n" +
    "/show — полный ответ после /ask\n" +
    "/scope — текущее направление и папка\n" +
    "/help — эта справка\n\n" +
    "Любой текст без команды — короткий ответ ИИ (preview), как в веб-чате."
  );
}

async function replyDirections(ctx: Context): Promise<void> {
  const directions = await fetchDirections();
  if (directions.length === 0) {
    await ctx.reply("Пока нет направлений. Создайте их в веб-интерфейсе.");
    return;
  }
  const lines = directions.map((d) => `• <code>${escHtml(d.slug)}</code> — ${escHtml(d.title)}`);
  await ctx.reply(truncate(`<b>Направления:</b>\n\n${lines.join("\n")}\n\nВыберите: /dir slug`), {
    parse_mode: "HTML",
  });
}

export function registerStart(bot: Telegraf<Context>): void {
  bot.command("start", async (ctx) => {
    const session = getSession(ctx.chat!.id);
    await ctx.reply(
      truncate(
        `👋 ${helpText()}\n\nТекущий контекст: ${sessionLabel(session)}`,
      ),
      { parse_mode: "HTML" },
    );
    await replyDirections(ctx);
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(truncate(helpText()), { parse_mode: "HTML" });
  });

  bot.command("directions", async (ctx) => {
    await replyDirections(ctx);
  });

  bot.command("scope", async (ctx) => {
    const session = getSession(ctx.chat!.id);
    await ctx.reply(`Контекст: ${sessionLabel(session)}`, { parse_mode: "HTML" });
  });
}
