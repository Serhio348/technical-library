import { Telegraf } from "telegraf";
import type { Context } from "telegraf";
import { env, isTelegramBotConfigured } from "../config.js";
import { registerAsk } from "./commands/ask.js";
import { registerContext } from "./commands/context.js";
import { registerSearch } from "./commands/search.js";
import { registerStart } from "./commands/start.js";

let bot: Telegraf<Context> | null = null;

export function isBotRunning(): boolean {
  return bot !== null;
}

export function startBot(): Telegraf<Context> | null {
  if (!isTelegramBotConfigured()) {
    console.warn("[bot] TELEGRAM_BOT_TOKEN не задан — бот не запущен");
    return null;
  }

  if (env.TELEGRAM_BOT_DISABLED) {
    console.warn("[bot] TELEGRAM_BOT_DISABLED=true — бот не запущен");
    return null;
  }

  bot = new Telegraf(env.TELEGRAM_BOT_TOKEN!);

  registerStart(bot);
  registerContext(bot);
  registerSearch(bot);
  registerAsk(bot);

  bot.on("text", async (ctx) => {
    await ctx.reply(
      "Используйте /help или команды:\n/directions · /dir · /search · /ask",
    );
  });

  bot.catch((err, ctx) => {
    console.error(`[bot] ошибка (${ctx.updateType}):`, err);
  });

  void bot.telegram.setMyCommands([
    { command: "start", description: "Справка и направления" },
    { command: "directions", description: "Список направлений" },
    { command: "dir", description: "Выбрать направление" },
    { command: "folder", description: "Папка внутри направления" },
    { command: "search", description: "Поиск по тексту" },
    { command: "ask", description: "Вопрос по документам (кратко)" },
    { command: "show", description: "Полный ответ после /ask" },
    { command: "scope", description: "Текущий контекст" },
    { command: "help", description: "Справка" },
  ]);

  void bot.launch().then(() => {
    console.log("[bot] Telegram-бот запущен");
  });

  return bot;
}

export async function stopBot(reason = "shutdown"): Promise<void> {
  if (!bot) return;
  await bot.stop(reason);
  bot = null;
  console.log(`[bot] остановлен (${reason})`);
}
