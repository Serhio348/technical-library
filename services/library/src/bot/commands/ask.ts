import type { Telegraf, Context } from "telegraf";
import { isDeepSeekConfigured } from "../../config.js";
import { isExpandRequest } from "../../ask.js";
import {
  attachmentKindLabel,
  isImageAttachmentFilename,
  type AskAttachment,
} from "../../attachmentExtract.js";
import { escHtml, truncate } from "../format.js";
import { askLibrary } from "../libraryClient.js";
import { clearInputMode, getSession } from "../session.js";
import { ensureDirectionOrPrompt } from "../direction.js";
import { mainKeyboard, MENU_BUTTONS } from "../keyboards.js";
import { runSearchQuery } from "./search.js";

export type RunAskOptions = {
  attachment?: AskAttachment | null;
};

export async function runAsk(
  ctx: Context,
  question: string,
  mode: "preview" | "full",
  options: RunAskOptions = {},
): Promise<void> {
  const session = getSession(ctx.chat!.id);
  if (!(await ensureDirectionOrPrompt(ctx))) return;

  if (!isDeepSeekConfigured()) {
    await ctx.reply("ИИ не настроен: добавьте DEEPSEEK_API_KEY в .env", mainKeyboard());
    return;
  }

  const q = question.trim();
  const attachment = options.attachment ?? null;
  const hasAttachment = Boolean(attachment?.buffer?.length);
  const isImage = attachment ? isImageAttachmentFilename(attachment.filename) : false;

  if (!q && !hasAttachment) {
    session.inputMode = "question";
    await ctx.reply(
      "💬 Введите вопрос или прикрепите файл (PDF, Word, фото) — можно с подписью.",
      mainKeyboard(),
    );
    return;
  }

  clearInputMode(session);

  const status = hasAttachment
    ? isImage
      ? "📷 Распознаю фото и ищу в документах…"
      : `📄 Читаю ${attachmentKindLabel(attachment!.filename)} и ищу в документах…`
    : mode === "full"
      ? "Формирую подробный ответ…"
      : "Ищу раздел в документах…";
  await ctx.reply(status);

  try {
    const history = mode === "full" ? session.askHistory : [];
    const result = await askLibrary(session.slug, q, session.scopePath, history, mode, attachment);

    const resolvedQuestion = result.resolved_question ?? q;
    const userHistoryContent = result.recognized_question
      ? q
        ? `${q}\n\n${result.recognized_question}`
        : result.recognized_question
      : resolvedQuestion;

    if (mode === "preview") {
      session.pendingQuestion = resolvedQuestion;
      session.askHistory.push({ role: "user", content: userHistoryContent });
      session.askHistory.push({ role: "assistant", content: result.answer });
    } else {
      session.pendingQuestion = null;
      session.askHistory.push({ role: "assistant", content: result.answer });
    }
    session.askHistory = session.askHistory.slice(-8);

    const extractedLabel = hasAttachment
      ? isImage
        ? "Распознано с фото"
        : `Из ${attachmentKindLabel(attachment!.filename)}`
      : null;
    const recognized =
      result.recognized_question && extractedLabel
        ? `<b>${extractedLabel}:</b>\n${escHtml(truncate(result.recognized_question, 700))}\n\n`
        : "";

    const sources =
      result.sources.length > 0
        ? `\n\n<b>Источники:</b>\n${result.sources.map((s) => `• ${escHtml(s.name)}`).join("\n")}`
        : "";

    const suffix = mode === "preview" ? "\n\n📖 Полный ответ — кнопка «Подробный ответ»" : "";

    await ctx.reply(truncate(`${recognized}${escHtml(result.answer)}${sources}${suffix}`), {
      parse_mode: "HTML",
      ...mainKeyboard(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    console.error("[bot/ask]", e);
    if (msg === "extract_no_text" || msg === "ocr_no_text") {
      if (isImage) {
        await ctx.reply(
          "Не удалось прочитать текст на фото.\n\n" +
            "• Не снимайте экран монитора — лучше скриншот (PNG) отправить файлом\n" +
            "• Держите телефон прямо, без бликов\n" +
            "• Текст должен быть крупным и чётким",
          mainKeyboard(),
        );
      } else {
        await ctx.reply(
          "Не удалось извлечь текст из файла.\n\n" +
            "• Для Word используйте .docx, не старый .doc\n" +
            "• Для PDF нужен текстовый слой или чёткий скан\n" +
            "• Можно добавить подпись с текстом вопроса",
          mainKeyboard(),
        );
      }
      return;
    }
    await ctx.reply("Не удалось получить ответ.", mainKeyboard());
  }
}

export async function runAskFull(ctx: Context): Promise<void> {
  const session = getSession(ctx.chat!.id);
  if (!session.pendingQuestion) {
    await ctx.reply("Сначала задайте вопрос — 💬 Вопрос ИИ", mainKeyboard());
    return;
  }
  await runAsk(ctx, session.pendingQuestion, "full");
}

export function registerAsk(bot: Telegraf<Context>): void {
  bot.command("ask", async (ctx) => {
    const question =
      ctx.message && "text" in ctx.message ? ctx.message.text.replace(/^\/ask\s*/i, "").trim() : "";
    await runAsk(ctx, question, "preview");
  });

  bot.command("show", async (ctx) => {
    await runAskFull(ctx);
  });

  bot.hears(/^(покажи|показать|да|подробнее)(?:\s+(?:полный|подробный))?(?:\s+ответ)?[.!?]*$/iu, async (ctx, next) => {
    const session = getSession(ctx.chat!.id);
    if (!session.pendingQuestion) return next();
    await runAskFull(ctx);
  });

  bot.on("text", async (ctx, next) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return next();
    if (MENU_BUTTONS.has(text)) return next();

    const session = getSession(ctx.chat!.id);

    if (session.inputMode === "search") {
      await runSearchQuery(ctx, text);
      return;
    }

    if (session.inputMode === "question") {
      await runAsk(ctx, text, "preview");
      return;
    }

    if (isExpandRequest(text) && session.pendingQuestion) {
      await runAskFull(ctx);
      return;
    }

    if (session.slug && text.length >= 3) {
      await runAsk(ctx, text, "preview");
      return;
    }

    return next();
  });
}
