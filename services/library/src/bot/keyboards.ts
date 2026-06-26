import { Markup } from "telegraf";

export const BTN_DIRECTION = "📚 Направление";
export const BTN_FOLDER = "📁 Папка";
export const BTN_SEARCH = "🔍 Поиск";
export const BTN_ASK = "💬 Вопрос ИИ";
export const BTN_SCOPE = "ℹ️ Где я?";
export const BTN_SHOW = "📖 Подробный ответ";

export const MENU_BUTTONS = new Set([
  BTN_DIRECTION,
  BTN_FOLDER,
  BTN_SEARCH,
  BTN_ASK,
  BTN_SCOPE,
  BTN_SHOW,
]);

export function mainKeyboard() {
  return Markup.keyboard([
    [BTN_DIRECTION, BTN_FOLDER],
    [BTN_SEARCH, BTN_ASK],
    [BTN_SCOPE, BTN_SHOW],
  ])
    .resize()
    .persistent();
}

export function afterPreviewKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback(BTN_SHOW, "action:show")]]);
}
