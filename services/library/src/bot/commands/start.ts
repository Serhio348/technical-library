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
    "3. Чтобы искать только в одном PDF — <b>📄 Файл</b>\n" +
    "4. <b>🔍 Поиск</b> или <b>💬 По документам</b> — ответы из ваших PDF\n" +
    "5. <b>🤖 Чат ИИ</b> — обычный разговор с моделью <i>без</i> библиотеки\n\n" +
    "<b>Поиск в интернете</b> (пока готовим, только в «Чат ИИ»):\n" +
    "бот сам решит, нужен ли свежий ответ из сети — например «погугли», курс, погода, новости.\n" +
    "Тогда спросит поисковик, прочитает пару ссылок и ответит уже с учётом этого.\n" +
    "В «По документам» интернет не используется — только ваши PDF.\n\n" +
    "<b>Запрос можно отправить:</b>\n" +
    "• текстом\n" +
    "• 📷 фото вопроса (для документов)\n" +
    "• 🎤 текст голосом — кнопка <b>🎤 Набор голосом</b> (не круглая 🎤 в Telegram!)\n\n" +
    "Команды: /ask, /chat, /search, /dir."
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
