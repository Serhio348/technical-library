import { Telegraf } from "telegraf";
import type { Context } from "telegraf";
import { env, isTelegramBotConfigured } from "../config.js";
import { registerAsk } from "./commands/ask.js";
import { registerContext } from "./commands/context.js";
import { registerMenu } from "./commands/menu.js";
import { registerSearch } from "./commands/search.js";
import { registerStart } from "./commands/start.js";

let bot: Telegraf<Context> | null = null;
let botRunning = false;

const CONNECT_TIMEOUT_MS = 20_000;

export function isBotRunning(): boolean {
  return botRunning;
}

function tokenHint(): string {
  const t = env.TELEGRAM_BOT_TOKEN ?? "";
  if (!t.includes(":")) return "формат токена: 123456789:ABC… от @BotFather";
  return "проверьте TELEGRAM_BOT_TOKEN в .env (без кавычек)";
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} (таймаут ${ms / 1000} с — нет доступа к api.telegram.org?)`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function bootTelegram(instance: Telegraf<Context>): Promise<void> {
  console.log("[bot] проверка токена (getMe)…");
  const me = await withTimeout(instance.telegram.getMe(), CONNECT_TIMEOUT_MS, "getMe");

  console.log(`[bot] бот: @${me.username ?? "?"} (${me.first_name ?? "Telegram"})`);

  await instance.telegram.setMyCommands([
    { command: "start", description: "Главное меню" },
    { command: "search", description: "Поиск по тексту" },
    { command: "ask", description: "Вопрос по документам" },
    { command: "help", description: "Справка" },
  ]);

  console.log("[bot] запуск long polling…");
  void instance.launch({ dropPendingUpdates: true }).catch((err: unknown) => {
    botRunning = false;
    bot = null;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bot] polling остановлен: ${msg}`);
  });

  bot = instance;
  botRunning = true;
  console.log("[bot] Telegram-бот запущен");
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

  const telegramOptions = env.TELEGRAM_API_ROOT?.trim()
    ? { apiRoot: env.TELEGRAM_API_ROOT.trim() }
    : undefined;

  const instance = new Telegraf(token, telegramOptions ? { telegram: telegramOptions } : undefined);

  registerStart(instance);
  registerContext(instance);
  registerMenu(instance);
  registerSearch(instance);
  registerAsk(instance);

  instance.catch((err, ctx) => {
    console.error(`[bot] ошибка (${ctx.updateType}):`, err);
  });

  void bootTelegram(instance).catch((err: unknown) => {
    bot = null;
    botRunning = false;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bot] не удалось запустить бота: ${msg}. API продолжает работать. ${tokenHint()}`);
    console.error("[bot] проверка с VPS: curl -s https://api.telegram.org/bot<TOKEN>/getMe");
  });
}

export async function stopBot(reason = "shutdown"): Promise<void> {
  if (!bot) return;
  botRunning = false;
  await bot.stop(reason);
  bot = null;
  console.log(`[bot] остановлен (${reason})`);
}
