import { chatCompletion, type ChatMessage } from "./deepseek.js";
import { isDeepSeekConfigured } from "./config.js";
import { decideWebSearch } from "./webSearchIntent.js";

const FREE_CHAT_SYSTEM = `Ты дружелюбный русскоязычный ассистент в Telegram-боте технической библиотеки.
Это свободный чат: отвечай по своим знаниям, без доступа к загруженным PDF пользователя.
Если вопрос явно про нормы/ТКП/ГОСТ из библиотеки — кратко скажи, что для документов лучше кнопка «💬 По документам».
Не выдумывай номера пунктов и даты нормативных актов, если не уверен.
Отвечай по делу, на русском.`;

export type FreeChatResult = {
  answer: string;
  /** Решение логики п.3 — интернет пока не вызываем. */
  web_search: { use: boolean; reason: string; deferred: boolean };
};

function sanitizeHistory(history: Array<{ role: "user" | "assistant"; content: string }>): ChatMessage[] {
  return history
    .filter((m) => m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
}

/**
 * Свободный чат с моделью (без библиотеки).
 * Интернет-поиск (п.3): пока только детект намерения; при use=true отвечаем из знаний
 * и помечаем, что живой поиск будет подключён отдельно.
 */
export async function answerFreeChat(
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
): Promise<FreeChatResult> {
  if (!isDeepSeekConfigured()) throw new Error("deepseek_not_configured");
  const q = message.trim();
  if (!q) throw new Error("empty_question");

  const decision = decideWebSearch(q, { mode: "chat" });
  const webNote = decision.use
    ? "\n\n(Служебно: для этого вопроса пригодится интернет-поиск — он будет подключён отдельно. Пока ответь по знаниям модели и честно скажи, если нужны свежие данные из сети.)"
    : "";

  const messages: ChatMessage[] = [
    { role: "system", content: FREE_CHAT_SYSTEM + webNote },
    ...sanitizeHistory(history),
    { role: "user", content: q },
  ];

  const answer = await chatCompletion(messages, 1600, { temperature: 0.5 });

  const prefix = decision.use
    ? "🌐 Сюда позже подключим поиск в сети (бот сам сходит в интернет и уточнит ответ). Пока — из знаний модели:\n\n"
    : "";

  return {
    answer: `${prefix}${answer}`,
    web_search: { use: decision.use, reason: decision.reason, deferred: decision.use },
  };
}
