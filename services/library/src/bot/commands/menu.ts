import type { Telegraf, Context } from "telegraf";
import {
  BTN_ASK,
  BTN_DIRECTION,
  BTN_FOLDER,
  BTN_SCOPE,
  BTN_SEARCH,
  BTN_SHOW,
  mainKeyboard,
} from "../keyboards.js";
import {
  applyDirection,
  applyFolder,
  autoPickDirectionOnStart,
  promptChooseDirection,
  promptChooseFolder,
} from "../direction.js";
import { fetchDirections } from "../libraryClient.js";
import { clearInputMode, getSession, sessionLabel } from "../session.js";
import { runAskFull } from "./ask.js";
import { runSearchQuery } from "./search.js";

export function registerMenu(bot: Telegraf<Context>): void {
  bot.action(/^d:(.+)$/, async (ctx) => {
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

  bot.hears(BTN_SEARCH, async (ctx) => {
    const session = getSession(ctx.chat!.id);
    if (!session.slug) {
      await ctx.reply("Сначала выберите направление — 📚 Направление.", mainKeyboard());
      await promptChooseDirection(ctx);
      return;
    }
    session.inputMode = "search";
    await ctx.reply("🔍 Введите текст или 📷 фото для поиска:", mainKeyboard());
  });

  bot.hears(BTN_ASK, async (ctx) => {
    const session = getSession(ctx.chat!.id);
    if (!session.slug) {
      await ctx.reply("Сначала выберите направление — 📚 Направление.", mainKeyboard());
      await promptChooseDirection(ctx);
      return;
    }
    session.inputMode = "question";
    await ctx.reply(
      "💬 Введите вопрос или 📷 фото вопроса (можно с подписью).\n" +
        "Для тестов с вариантами ответа — сфотографируйте задание целиком.",
      mainKeyboard(),
    );
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
