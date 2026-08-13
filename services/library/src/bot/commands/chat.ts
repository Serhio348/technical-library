import type { Telegraf, Context } from "telegraf";
import { isDeepSeekConfigured } from "../../config.js";
import { answerFreeChat } from "../../freeChat.js";
import { escHtml, truncate } from "../format.js";
import { BTN_CHAT, mainKeyboard, MENU_BUTTONS } from "../keyboards.js";
import { getSession, resetChatState } from "../session.js";

const MAX_CHAT_HISTORY = 12;

export async function enterFreeChat(ctx: Context): Promise<void> {
  const session = getSession(ctx.chat!.id);
  session.inputMode = "chat";
  // Не смешиваем с диалогом по документам
  session.pendingQuestion = null;

  await ctx.reply(
    "🤖 <b>Чат ИИ</b> — обычный разговор с моделью, <b>без</b> ваших PDF.\n\n" +
      "Для норм/ТКП из библиотеки — <b>💬 По документам</b>.\n\n" +
      "<b>Как будет поиск в интернете:</b>\n" +
      "1) Вы пишете вопрос\n" +
      "2) Если нужны свежие данные («погугли», курс, погода, новости) — бот сам сходит в сеть\n" +
      "3) Прочитает найденное и ответит уже с этим\n\n" +
      "<i>Сейчас шаг 2–3 ещё не включён:</i> на такие вопросы отвечает из памяти модели и предупреждает об этом.\n\n" +
      "Выход: любая другая кнопка меню.",
    { parse_mode: "HTML", ...mainKeyboard() },
  );
}

export async function runFreeChat(ctx: Context, message: string): Promise<void> {
  const session = getSession(ctx.chat!.id);

  if (!isDeepSeekConfigured()) {
    await ctx.reply("ИИ не настроен: добавьте DEEPSEEK_API_KEY в .env", mainKeyboard());
    return;
  }

  const q = message.trim();
  if (!q) {
    session.inputMode = "chat";
    await ctx.reply("🤖 Введите сообщение для чата.", mainKeyboard());
    return;
  }

  await ctx.reply("Думаю…");

  try {
    const result = await answerFreeChat(q, session.chatHistory);

    session.inputMode = "chat";
    session.chatHistory.push({ role: "user", content: q });
    session.chatHistory.push({ role: "assistant", content: result.answer });
    session.chatHistory = session.chatHistory.slice(-MAX_CHAT_HISTORY);

    await ctx.reply(truncate(escHtml(result.answer)), {
      parse_mode: "HTML",
      ...mainKeyboard(),
    });
  } catch (e) {
    console.error("[bot/chat]", e);
    await ctx.reply("Не удалось ответить в чате.", mainKeyboard());
  }
}

export function registerChat(bot: Telegraf<Context>): void {
  bot.command("chat", async (ctx) => {
    const text =
      ctx.message && "text" in ctx.message ? ctx.message.text.replace(/^\/chat\s*/i, "").trim() : "";
    if (text) {
      const session = getSession(ctx.chat!.id);
      session.inputMode = "chat";
      await runFreeChat(ctx, text);
      return;
    }
    await enterFreeChat(ctx);
  });

  bot.hears(BTN_CHAT, async (ctx) => {
    await enterFreeChat(ctx);
  });

  bot.hears(/^\/newchat$/i, async (ctx) => {
    const session = getSession(ctx.chat!.id);
    resetChatState(session);
    session.inputMode = "chat";
    await ctx.reply("История чата очищена. Задайте новый вопрос.", mainKeyboard());
  });
}

/** Вызывать из ask text-handler до library ask. */
export function tryHandleChatText(ctx: Context, text: string): boolean {
  if (MENU_BUTTONS.has(text)) return false;
  const session = getSession(ctx.chat!.id);
  if (session.inputMode !== "chat") return false;
  void runFreeChat(ctx, text);
  return true;
}
