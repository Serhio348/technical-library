import { chatCompletion, type ChatMessage } from "./deepseek.js";
import { chatWithWebSearch } from "./deepseekWebSearch.js";
import { isDeepSeekConfigured } from "./config.js";
import { decideWebSearch } from "./webSearchIntent.js";

const FREE_CHAT_SYSTEM = `Ты дружелюбный русскоязычный ассистент в Telegram-боте технической библиотеки.
Это свободный чат: отвечай по своим знаниям, без доступа к загруженным PDF пользователя.
Если вопрос явно про нормы/ТКП/ГОСТ из библиотеки — кратко скажи, что для документов лучше кнопка «💬 По PDF».
Не выдумывай номера пунктов и даты нормативных актов, если не уверен.
Отвечай по делу, на русском.`;

const FREE_CHAT_WEB_SYSTEM = `${FREE_CHAT_SYSTEM}

Для этого вопроса нужны свежие данные из интернета.
Обязательно используй инструмент web_search, прежде чем отвечать.
В ответе опирайся на найденное; если данные противоречивы — скажи об этом.
В конце коротко перечисли 2–5 полезных ссылок, если они есть.`;

export type FreeChatResult = {
  answer: string;
  web_search: {
    use: boolean;
    reason: string;
    /** true — поиск реально вызвали (или пытались). */
    used: boolean;
    search_calls: number;
    sources: Array<{ title: string; url: string }>;
  };
};

function sanitizeHistory(history: Array<{ role: "user" | "assistant"; content: string }>): ChatMessage[] {
  return history
    .filter((m) => m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
}

function formatSources(sources: Array<{ title: string; url: string }>): string {
  if (sources.length === 0) return "";
  const lines = sources.map((s) => `• ${s.title}: ${s.url}`);
  return `\n\nИсточники:\n${lines.join("\n")}`;
}

function webSearchEnabled(): boolean {
  const raw = process.env.DEEPSEEK_WEB_SEARCH?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

/**
 * Свободный чат с моделью (без библиотеки).
 * При decideWebSearch.use — Anthropic-совместимый web_search DeepSeek.
 */
export async function answerFreeChat(
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
): Promise<FreeChatResult> {
  if (!isDeepSeekConfigured()) throw new Error("deepseek_not_configured");
  const q = message.trim();
  if (!q) throw new Error("empty_question");

  const decision = decideWebSearch(q, { mode: "chat" });
  const prior = sanitizeHistory(history);

  if (decision.use && webSearchEnabled()) {
    try {
      const messages: ChatMessage[] = [
        { role: "system", content: FREE_CHAT_WEB_SYSTEM },
        ...prior,
        { role: "user", content: q },
      ];
      const result = await chatWithWebSearch(messages, 1800);
      const prefix = result.search_calls > 0 ? "🌐 Ответ с поиском в интернете:\n\n" : "🌐 ";
      return {
        answer: `${prefix}${result.answer}${formatSources(result.sources)}`,
        web_search: {
          use: true,
          reason: decision.reason,
          used: true,
          search_calls: result.search_calls,
          sources: result.sources,
        },
      };
    } catch (e) {
      console.error("[freeChat] web search failed, fallback to knowledge:", e);
      const messages: ChatMessage[] = [
        {
          role: "system",
          content:
            FREE_CHAT_SYSTEM +
            "\n\nПоиск в интернете сейчас недоступен. Ответь по знаниям и честно скажи, если нужны свежие данные.",
        },
        ...prior,
        { role: "user", content: q },
      ];
      const answer = await chatCompletion(messages, 1600, { temperature: 0.5 });
      return {
        answer: `🌐 Поиск в сети не удалось выполнить, ответ по знаниям модели:\n\n${answer}`,
        web_search: {
          use: true,
          reason: decision.reason,
          used: false,
          search_calls: 0,
          sources: [],
        },
      };
    }
  }

  const messages: ChatMessage[] = [
    { role: "system", content: FREE_CHAT_SYSTEM },
    ...prior,
    { role: "user", content: q },
  ];
  const answer = await chatCompletion(messages, 1600, { temperature: 0.5 });

  return {
    answer,
    web_search: {
      use: decision.use,
      reason: decision.reason,
      used: false,
      search_calls: 0,
      sources: [],
    },
  };
}
