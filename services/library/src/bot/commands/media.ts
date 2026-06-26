import type { Telegraf, Context } from "telegraf";
import { extractTextFromImageBuffer } from "../../pdfExtract.js";
import { downloadTelegramFile } from "../telegramFiles.js";
import { getSession } from "../session.js";
import { ensureDirectionOrPrompt } from "../direction.js";
import { mainKeyboard } from "../keyboards.js";
import { runAsk } from "./ask.js";
import { runSearchQuery } from "./search.js";

async function handleImageBuffer(
  ctx: Context,
  buffer: Buffer,
  caption: string,
): Promise<void> {
  const session = getSession(ctx.chat!.id);
  if (!(await ensureDirectionOrPrompt(ctx))) return;

  if (session.inputMode === "search") {
    await ctx.reply("📷 Распознаю текст на фото…");
    try {
      const recognized = await extractTextFromImageBuffer(buffer);
      if (!recognized) {
        await ctx.reply(
          "На фото не найден текст. Снимите ближе при хорошем свете или добавьте подпись к фото.",
          mainKeyboard(),
        );
        return;
      }
      const query = caption ? `${caption}\n\n${recognized}` : recognized;
      await runSearchQuery(ctx, query);
    } catch (e) {
      console.error("[bot/media] search ocr", e);
      await ctx.reply("Не удалось распознать фото.", mainKeyboard());
    }
    return;
  }

  await runAsk(ctx, caption, "preview", { imageBuffer: buffer });
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
    if (!mime.startsWith("image/")) return next();

    const caption = ctx.message.caption?.trim() ?? "";
    try {
      const buffer = await downloadTelegramFile(ctx, doc.file_id);
      await handleImageBuffer(ctx, buffer, caption);
    } catch (e) {
      console.error("[bot/media] document image", e);
      await ctx.reply("Не удалось загрузить изображение.", mainKeyboard());
    }
  });
}
