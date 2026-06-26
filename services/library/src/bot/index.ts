import { Telegraf } from "telegraf";
import type { Context } from "telegraf";
import { env, isTelegramBotConfigured } from "../config.js";
import { registerAsk } from "./commands/ask.js";
import { registerContext } from "./commands/context.js";
import { registerSearch } from "./commands/search.js";
import { registerStart } from "./commands/start.js";

let bot: Telegraf<Context> | null = null;
let botRunning = false;

export function isBotRunning(): boolean {
  return botRunning;
}

function tokenHint(): string {
  const t = env.TELEGRAM_BOT_TOKEN ?? "";
  if (!t.includes(":")) return "формат токена: 123456789:ABC… от @BotFather";
  return "проверьте токен в .env (без кавычек и пробелов)";
}

export function startBot(): void {
  if (!isTelegramBotConfigured()) {
    console.warn("[bot] TELEGRAM_BOT_TOKEN не задан — бот не запущен");
    return;
  }

  if (env.TELEGRAM_BOT_DISABLED) {
    console.warn("[bot] TELEGRAM_BOT_DISABLED=true — бот не запущен");
    return;
  }

  const token = env.TELEGRAM_BOT_TOKEN!.trim();
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    console.error(`[bot] TELEGRAM_BOT_TOKEN некорректен (${tokenHint()}) — бот не запущен`);
    return;
  }

  const instance = new Telegraf(token);

  registerStart(instance);
  registerContext(instance);
  registerSearch(instance);
  registerAsk(instance);

  instance.on("text", async (ctx) => {
    await ctx.reply("Используйте /help или команды:\n/directions · /dir · /search · /ask");
  });

  instance.catch((err, ctx) => {
    console.error(`[bot] ошибка (${ctx.updateType}):`, err);
  });

  console.log("[bot] подключение к Telegram…");

  void instance.telegram
    .setMyCommands([
      { command: "start", description: "Справка и направления" },
      { command: "directions", description: "Список направлений" },
      { command: "dir", description: "Выбрать направление" },
      { command: "folder", description: "Папка внутри направления" },
      { command: "search", description: "Поиск по тексту" },
      { command: "ask", description: "Вопрос по документам (кратко)" },
      { command: "show", description: "Полный ответ после /ask" },
      { command: "scope", description: "Текущий контекст" },
      { command: "help", description: "Справка" },
    ])
    .catch((err) => {
      console.error("[bot] не удалось задать команды меню:", err);
    });

  void instance
    .launch()
    .then(() => {
      bot = instance;
      botRunning = true;
      console.log("[bot] Telegram-бот запущен");
    })
    .catch((err: unknown) => {
      bot = null;
      botRunning = false;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[bot] не удалось запустить бота (${msg}). API продолжает работать. ${tokenHint()}`);
    });
}

export async function stopBot(reason = "shutdown"): Promise<void> {
  if (!bot) return;
  botRunning = false;
  await bot.stop(reason);
  bot = null;
  console.log(`[bot] остановлен (${reason})`);
}
