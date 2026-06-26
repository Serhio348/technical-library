import { Markup } from "telegraf";
import { resolvedTelegramWebAppUrl } from "../config.js";

export const BTN_DIRECTION = "📚 Направление";
export const BTN_FOLDER = "📁 Папка";
export const BTN_SEARCH = "🔍 Поиск";
export const BTN_ASK = "💬 Вопрос ИИ";
export const BTN_VOICE_HELP = "🎤 Набор голосом";
export const BTN_WEB_CHAT_LABEL = "🎤 Чат с голосом";
export const BTN_SCOPE = "ℹ️ Где я?";
export const BTN_SHOW = "📖 Подробный ответ";

export const MENU_BUTTONS = new Set([
  BTN_DIRECTION,
  BTN_FOLDER,
  BTN_SEARCH,
  BTN_ASK,
  BTN_VOICE_HELP,
  BTN_SCOPE,
  BTN_SHOW,
]);

export function mainKeyboard() {
  const webAppUrl = resolvedTelegramWebAppUrl();
  const rows: Array<Array<string | ReturnType<typeof Markup.button.webApp>>> = [
    [BTN_DIRECTION, BTN_FOLDER],
    [BTN_SEARCH, BTN_ASK],
  ];

  if (webAppUrl) {
    rows.push([Markup.button.webApp(BTN_WEB_CHAT_LABEL, webAppUrl)]);
  } else {
    rows.push([BTN_VOICE_HELP]);
  }

  rows.push([BTN_SCOPE, BTN_SHOW]);

  return Markup.keyboard(rows).resize().persistent();
}

export function afterPreviewKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback(BTN_SHOW, "action:show")]]);
}
