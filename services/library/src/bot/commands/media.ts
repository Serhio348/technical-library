import type { Telegraf, Context } from "telegraf";
import {
  attachmentKindLabel,
  extractTextFromAskAttachment,
  isAskAttachmentFilename,
  isAskAttachmentTextUsable,
  isImageAttachmentFilename,
  type AskAttachment,
} from "../../attachmentExtract.js";
import { extractTextFromImageBuffer, isPhotoOcrUsable } from "../../imageOcr.js";
import { downloadTelegramFile } from "../telegramFiles.js";
import { getSession } from "../session.js";
import { ensureDirectionOrPrompt } from "../direction.js";
import { mainKeyboard } from "../keyboards.js";
import { runAsk } from "./ask.js";
import { runSearchQuery } from "./search.js";
import { replyVoiceTypingHelp } from "../voiceHelp.js";
import { resolvedTelegramWebAppUrl } from "../../config.js";

async function handleSearchFromExtractedText(
  ctx: Context,
  caption: string,
  text: string,
): Promise<void> {
  const query = caption ? `${caption}\n\n${text}` : text;
  await runSearchQuery(ctx, query);
}

async function handleImageBuffer(ctx: Context, buffer: Buffer, caption: string): Promise<void> {
  const session = getSession(ctx.chat!.id);
  if (!(await ensureDirectionOrPrompt(ctx))) return;

  if (session.inputMode === "search") {
    await ctx.reply("📷 Распознаю текст на фото…");
    try {
      const recognized = await extractTextFromImageBuffer(buffer);
      if (!isPhotoOcrUsable(recognized)) {
        await ctx.reply(
          "На фото не удалось прочитать текст.\n\n" +
            "• Не снимайте экран монитора — лучше скриншот (PNG) отправить файлом\n" +
            "• Держите телефон прямо, без бликов",
          mainKeyboard(),
        );
        return;
      }
      await handleSearchFromExtractedText(ctx, caption, recognized!);
    } catch (e) {
      console.error("[bot/media] search ocr", e);
      await ctx.reply("Не удалось распознать фото.", mainKeyboard());
    }
    return;
  }

  await runAsk(ctx, caption, "preview", {
    attachment: { buffer, filename: "photo.jpg" },
  });
}

async function handleDocumentBuffer(
  ctx: Context,
  buffer: Buffer,
  filename: string,
  caption: string,
): Promise<void> {
  const session = getSession(ctx.chat!.id);
  if (!(await ensureDirectionOrPrompt(ctx))) return;

  const kind = attachmentKindLabel(filename);

  if (session.inputMode === "search") {
    await ctx.reply(`📄 Читаю ${kind}…`);
    try {
      const text = await extractTextFromAskAttachment(buffer, filename);
      if (!isAskAttachmentTextUsable(text, filename)) {
        await ctx.reply("Не удалось извлечь текст из файла.", mainKeyboard());
        return;
      }
      await handleSearchFromExtractedText(ctx, caption, text!);
    } catch (e) {
      console.error("[bot/media] search document", e);
      await ctx.reply("Не удалось прочитать файл.", mainKeyboard());
    }
    return;
  }

  const attachment: AskAttachment = { buffer, filename };
  await runAsk(ctx, caption, "preview", { attachment });
}

export function registerMedia(bot: Telegraf<Context>): void {
  bot.on("photo", async (ctx) => {
    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1];
    if (!largest) return;

    const caption = ctx.message.caption?.trim() ?? "";
    try {
      const buffer = await downloadTelegramFile(ctx, largest.file_id);
      await handleImageBuffer(ctx, buffer, caption);
    } catch (e) {
      console.error("[bot/media] photo", e);
      await ctx.reply("Не удалось загрузить фото.", mainKeyboard());
    }
  });

  bot.on("document", async (ctx, next) => {
    const doc = ctx.message.document;
    const mime = doc.mime_type?.toLowerCase() ?? "";
    const filename = doc.file_name ?? "file.bin";
    const caption = ctx.message.caption?.trim() ?? "";

    if (mime.startsWith("image/") || isImageAttachmentFilename(filename)) {
      try {
        const buffer = await downloadTelegramFile(ctx, doc.file_id);
        await handleImageBuffer(ctx, buffer, caption);
      } catch (e) {
        console.error("[bot/media] document image", e);
        await ctx.reply("Не удалось загрузить изображение.", mainKeyboard());
      }
      return;
    }

    if (!isAskAttachmentFilename(filename)) return next();

    try {
      const buffer = await downloadTelegramFile(ctx, doc.file_id);
      await handleDocumentBuffer(ctx, buffer, filename, caption);
    } catch (e) {
      console.error("[bot/media] document", e);
      await ctx.reply("Не удалось загрузить файл.", mainKeyboard());
    }
  });

  bot.on("voice", async (ctx) => {
    await replyVoiceTypingHelp(ctx, Boolean(resolvedTelegramWebAppUrl()));
  });
}
