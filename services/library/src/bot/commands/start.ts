import type { Telegraf, Context } from "telegraf";
import { mainKeyboard } from "../keyboards.js";
import { autoPickDirectionOnStart } from "./menu.js";
import { getSession, sessionLabel } from "../session.js";
import { promptChooseDirection } from "../direction.js";

function welcomeText(): string {
  return (
    "👋 <b>Нормативная библиотека</b>\n\n" +
    "1. Нажмите <b>📚 Направление</b> и выберите из списка\n" +
    "2. При необходимости — <b>📁 Папка</b>\n" +
    "3. <b>🔍 Поиск</b> или <b>💬 Вопрос ИИ</b>\n\n" +
    "<b>Запрос можно отправить:</b>\n" +
    "• текстом\n" +
    "• 📷 фото вопроса (или файл-картинку, подпись необязательна)\n" +
    "• 🎤 текст голосом — кнопка <b>🎤 Набор голосом</b> (не круглая 🎤 в Telegram!)\n\n" +
    "Команды /dir и /search тоже работают, но проще пользоваться кнопками."
  );
}

export function registerStart(bot: Telegraf<Context>): void {
  bot.command("start", async (ctx) => {
    const session = getSession(ctx.chat!.id);
    await ctx.reply(`${welcomeText()}\n\nСейчас: <b>${sessionLabel(session)}</b>`, {
      parse_mode: "HTML",
      ...mainKeyboard(),
    });
    await autoPickDirectionOnStart(ctx);
    if (!getSession(ctx.chat!.id).slug) {
      await promptChooseDirection(ctx);
    }
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(welcomeText(), { parse_mode: "HTML", ...mainKeyboard() });
  });

  bot.command("directions", async (ctx) => {
    await promptChooseDirection(ctx);
  });

  bot.command("scope", async (ctx) => {
    const session = getSession(ctx.chat!.id);
    await ctx.reply(`ℹ️ ${sessionLabel(session)}`, { parse_mode: "HTML", ...mainKeyboard() });
  });
}
