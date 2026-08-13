import type { Telegraf, Context } from "telegraf";
import {
  BTN_ASK,
  BTN_DIRECTION,
  BTN_FILE,
  BTN_FOLDER,
  BTN_SCOPE,
  BTN_SEARCH,
  BTN_SHOW,
  BTN_VOICE_HELP,
  mainKeyboard,
} from "../keyboards.js";
import {
  applyDirection,
  applyDocument,
  applyFolder,
  autoPickDirectionOnStart,
  promptChooseDirection,
  promptChooseDocument,
  promptChooseFolder,
} from "../direction.js";
import { fetchDirections } from "../libraryClient.js";
import { clearInputMode, getSession, sessionLabel } from "../session.js";
import { runAskFull } from "./ask.js";
import { runSearchQuery } from "./search.js";
import { replyVoiceTypingHelp } from "../voiceHelp.js";
import { resolvedTelegramWebAppUrl } from "../../config.js";

export function registerMenu(bot: Telegraf<Context>): void {
  // Slug-only pattern so it does not swallow file:* callbacks.
  bot.action(/^d:([a-z0-9][a-z0-9-]*)$/, async (ctx) => {
    const slug = ctx.match[1]!;
    const directions = await fetchDirections();
    const found = directions.find((d) => d.slug === slug);
    if (!found) {
      await ctx.answerCbQuery("Направление не найдено");
      return;
    }
    await ctx.answerCbQuery();
    await applyDirection(ctx, found);
  });

  bot.action(/^f:(.*)$/, async (ctx) => {
    const path = ctx.match[1] ?? "";
    await ctx.answerCbQuery();
    await applyFolder(ctx, path);
  });

  bot.action("file:all", async (ctx) => {
    await ctx.answerCbQuery();
    await applyDocument(ctx, "");
  });

  bot.action(/^file:(\d+)$/, async (ctx) => {
    const session = getSession(ctx.chat!.id);
    const idx = Number.parseInt(ctx.match[1]!, 10);
    const path = session.documentFiles[idx];
    if (!path) {
      await ctx.answerCbQuery("Список устарел — откройте 📄 Файл снова");
      return;
    }
    await ctx.answerCbQuery();
    await applyDocument(ctx, path);
  });

  bot.action(/^filepage:(\d+|noop)$/, async (ctx) => {
    const token = ctx.match[1]!;
    if (token === "noop") {
      await ctx.answerCbQuery();
      return;
    }
    await ctx.answerCbQuery();
    await promptChooseDocument(ctx, Number.parseInt(token, 10));
  });

  bot.action("action:show", async (ctx) => {
    await ctx.answerCbQuery();
    await runAskFull(ctx);
  });

  bot.hears(BTN_DIRECTION, async (ctx) => {
    clearInputMode(getSession(ctx.chat!.id));
    await promptChooseDirection(ctx);
  });

  bot.hears(BTN_FOLDER, async (ctx) => {
    clearInputMode(getSession(ctx.chat!.id));
    await promptChooseFolder(ctx);
  });

  bot.hears(BTN_FILE, async (ctx) => {
    clearInputMode(getSession(ctx.chat!.id));
    await promptChooseDocument(ctx, 0);
  });

  bot.hears(BTN_SEARCH, async (ctx) => {
    const session = getSession(ctx.chat!.id);
    if (!session.slug) {
      await ctx.reply("Сначала выберите направление — 📚 Направление.", mainKeyboard());
      await promptChooseDirection(ctx);
      return;
    }
    session.inputMode = "search";
    session.chatHistory = [];
    const fileHint = session.documentPath
      ? `\nСейчас только: ${session.documentPath.split("/").pop()}`
      : "";
    await ctx.reply(`🔍 Введите текст или 📷 фото для поиска:${fileHint}`, mainKeyboard());
  });

  async function enterDocsAsk(ctx: Context): Promise<void> {
    const session = getSession(ctx.chat!.id);
    if (!session.slug) {
      await ctx.reply("Сначала выберите направление — 📚 Направление.", mainKeyboard());
      await promptChooseDirection(ctx);
      return;
    }
    session.inputMode = "question";
    session.chatHistory = [];
    const fileHint = session.documentPath
      ? `\nИщем только в: ${session.documentPath.split("/").pop()}`
      : "\nЧтобы ограничить одним файлом — 📄 Файл.";
    await ctx.reply(
      "💬 <b>По документам</b> — ответ только из PDF библиотеки (не общий чат и не интернет).\n\n" +
        "Введите вопрос или 📷 фото (можно с подписью).\n" +
        "Для тестов с вариантами — сфотографируйте задание целиком." +
        fileHint +
        "\n\nСвободный чат без PDF — кнопка <b>🤖 Чат ИИ</b>.",
      { parse_mode: "HTML", ...mainKeyboard() },
    );
  }

  bot.hears(BTN_ASK, enterDocsAsk);

  bot.hears(BTN_VOICE_HELP, async (ctx) => {
    await replyVoiceTypingHelp(ctx, Boolean(resolvedTelegramWebAppUrl()));
  });

  bot.hears(BTN_SCOPE, async (ctx) => {
    clearInputMode(getSession(ctx.chat!.id));
    const session = getSession(ctx.chat!.id);
    await ctx.reply(`ℹ️ Сейчас: <b>${sessionLabel(session)}</b>`, {
      parse_mode: "HTML",
      ...mainKeyboard(),
    });
  });

  bot.hears(BTN_SHOW, async (ctx) => {
    await runAskFull(ctx);
  });
}

export { autoPickDirectionOnStart };
