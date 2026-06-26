import { buildLibraryContextForQuery, type LibraryContextItem } from "./storage.js";
import { chatCompletion, type ChatMessage } from "./deepseek.js";
import { isDeepSeekConfigured } from "./config.js";

export type AskHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export type AskSource = {
  path: string;
  name: string;
};

export type AskResult = {
  answer: string;
  sources: AskSource[];
  context_available: boolean;
};

const SYSTEM_PROMPT = `Ты помощник по нормативной и технической документации (законы, ГОСТ, ТКП, инструкции).
Отвечай на русском языке, опираясь ТОЛЬКО на фрагменты документов ниже (могут быть с метками [стр. N]).
Если в фрагментах нет ответа — скажи об этом прямо и не выдумывай нормы, номера и даты.
Если видишь пометку «Индекс неполный» или только оглавление без текста раздела — сообщи, что нужна переиндексация PDF (OCR) в библиотеке.
В конце ответа укажи источники: названия файлов и номера страниц из фрагментов.`;

function formatContext(items: LibraryContextItem[]): string {
  if (items.length === 0) {
    return "Фрагменты документов не найдены. Возможно, документы ещё не загружены или не проиндексированы (OCR).";
  }
  return items
    .map((item, idx) => {
      const note = item.extraction
        ? ` [extractor=${item.extraction.extractor}, confidence=${item.extraction.confidence.toFixed(2)}]`
        : "";
      return `[${idx + 1}] ${item.name} (${item.path})${note}\n${item.text}`;
    })
    .join("\n\n---\n\n");
}

function sanitizeHistory(history: unknown): AskHistoryItem[] {
  if (!Array.isArray(history)) return [];
  const out: AskHistoryItem[] = [];
  for (const item of history) {
    if (!item || typeof item !== "object") continue;
    const role = (item as AskHistoryItem).role;
    const content = typeof (item as AskHistoryItem).content === "string" ? (item as AskHistoryItem).content.trim() : "";
    if ((role === "user" || role === "assistant") && content) {
      out.push({ role, content: content.slice(0, 4000) });
    }
  }
  return out.slice(-8);
}

export function isAskConfigured(): boolean {
  return isDeepSeekConfigured();
}

export async function answerLibraryQuestion(
  root: string,
  slug: string,
  question: string,
  scopePath = "",
  history: unknown = [],
): Promise<AskResult> {
  if (!isDeepSeekConfigured()) {
    throw new Error("deepseek_not_configured");
  }

  const q = question.trim();
  if (!q) throw new Error("empty_question");

  const items = await buildLibraryContextForQuery(root, slug, q, {
    maxCharsPerDocument: 100_000,
    maxDocuments: 2,
    scope_path: scopePath,
    prefer_wide_context: true,
  });

  const contextBlock = formatContext(items);
  const userContent = `Вопрос: ${q}\n\nФрагменты из библиотеки:\n\n${contextBlock}`;

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...sanitizeHistory(history).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userContent },
  ];

  const answer = await chatCompletion(messages);

  return {
    answer,
    sources: items.map((item) => ({ path: item.path, name: item.name })),
    context_available: items.length > 0,
  };
}
