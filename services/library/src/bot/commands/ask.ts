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

  const fileLabel = session.documentPath
    ? (session.documentPath.split("/").pop() ?? session.documentPath)
    : null;
  const status = hasAttachment
    ? isImage
      ? "📷 Распознаю фото и восстанавливаю варианты…"
      : `📄 Читаю ${attachmentKindLabel(attachment!.filename)} и ищу в документах…`
    : mode === "full"
      ? "Формирую подробный ответ…"
      : fileLabel
        ? `Ищу в файле «${fileLabel}»…`
        : "Ищу раздел в документах…";
  await ctx.reply(status);

  try {
    // История нужна и для preview — иначе уточнения («а в ЗРУ?») теряют контекст
    const history = session.askHistory;
    const documents = session.documentPath ? [session.documentPath] : [];

    const result = await askLibrary(
      session.slug,
      q,
      session.scopePath,
      history,
      mode,
      attachment,
      documents,
    );

    const resolvedQuestion = result.resolved_question ?? q;
    const userHistoryContent = result.recognized_question
      ? q
        ? `${q}\n\n${result.recognized_question}`
        : result.recognized_question
      : resolvedQuestion;

    if (result.needs_clarification) {
      // Не затираем диалог «успешным» ответом — ждём текст/новое фото
      session.pendingQuestion = null;
      await ctx.reply(truncate(escHtml(result.answer)), {
        parse_mode: "HTML",
        ...mainKeyboard(),
      });
      return;
    }

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
        ? result.ocr_pipeline === "tesseract+normalize"
          ? result.ocr_confidence === "low"
            ? "Восстановлено с фото (неуверенно)"
            : "Восстановлено с фото"
          : result.ocr_confidence === "low"
            ? "Распознано с фото (неуверенно)"
            : "Распознано с фото"
        : `Из ${attachmentKindLabel(attachment!.filename)}`
      : null;
    const recognized =
      (result.normalized_question || result.recognized_question) && extractedLabel
        ? `<b>${extractedLabel}:</b>\n${escHtml(truncate(result.normalized_question ?? result.recognized_question ?? "", 900))}\n\n`
        : "";

    const sources =
      result.sources.length > 0
        ? `\n\n<b>Источники:</b>\n${result.sources.map((s) => `• ${escHtml(s.name)}`).join("\n")}`
        : "";

    const fileStay =
      documents.length > 0
        ? `\n\n📄 Фильтр: <i>${escHtml(documents[0]!.split("/").pop() ?? documents[0]!)}</i> — действует и на уточнения. Сброс: 📄 Файл → все файлы.`
        : "";
    const suffix = mode === "preview" ? "\n\n📖 Полный ответ — кнопка «Подробный ответ»" : "";

    await ctx.reply(truncate(`${recognized}${escHtml(result.answer)}${sources}${suffix}${fileStay}`), {
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
            "• Текст должен быть крупным и чётким\n" +
            "• Можно добавить подпись с текстом вопроса",
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
