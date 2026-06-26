import type { Context } from "telegraf";
import { mainKeyboard } from "./keyboards.js";

export const VOICE_TYPING_HELP =
  "<b>🎤 Как говорить и видеть текст перед отправкой</b>\n\n" +
  "В Telegram <b>две разные</b> кнопки микрофона:\n\n" +
  "❌ <b>Круглая 🎤</b> справа от поля «Сообщение» — это <b>голосовое сообщение</b> (запись). " +
  "Оно сразу уходит боту как аудио, текст в строке не появляется.\n\n" +
  "✅ <b>Нужен набор текста голосом:</b>\n" +
  "1. Нажмите <b>💬 Вопрос ИИ</b>\n" +
  "2. Нажмите в поле «Сообщение» — откроется <b>клавиатура</b>\n" +
  "3. На <b>клавиатуре телефона</b> нажмите 🎤 (у пробела, не круглую в Telegram)\n" +
  "4. Говорите — <b>текст появится в строке</b>\n" +
  "5. Нажмите ➤ отправить\n\n" +
  "<i>iPhone: 🎤 слева от пробела. Android: 🎤 на Gboard / клавиатуре Google.</i>";

export function voiceTypingHelpExtra(webAppConfigured: boolean): string {
  if (webAppConfigured) {
    return "\n\nИли нажмите <b>🎤 Чат с голосом</b> — откроется веб-чат как на сайте, с кнопкой микрофона.";
  }
  return "";
}

export async function replyVoiceTypingHelp(ctx: Context, webAppConfigured = false): Promise<void> {
  await ctx.reply(`${VOICE_TYPING_HELP}${voiceTypingHelpExtra(webAppConfigured)}`, {
    parse_mode: "HTML",
    ...mainKeyboard(),
  });
}
