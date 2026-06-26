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

export type AskMode = "preview" | "full";

export type AskResult = {
  answer: string;
  sources: AskSource[];
  context_available: boolean;
  mode: AskMode;
};

const FULL_SYSTEM_PROMPT = `Ты помощник по нормативной и технической документации (законы, ГОСТ, ТКП, инструкции).
Отвечай на русском языке, опираясь ТОЛЬКО на фрагменты документов ниже (могут быть с метками [стр. N]).
Если в фрагментах нет ответа — скажи об этом прямо и не выдумывай нормы, номера и даты.
Если видишь пометку «Индекс неполный» или только оглавление без текста раздела — сообщи, что нужна переиндексация PDF (OCR) в библиотеке.
В конце ответа укажи источники: названия файлов и номера страниц из фрагментов.`;

const PREVIEW_SYSTEM_PROMPT = `Ты помощник по нормативной и технической документации (законы, ГОСТ, ТКП, инструкции).
Пользователь задал вопрос. Ниже — только КОРОТКИЕ фрагменты для ориентации, не для полного ответа.

Задача: сэкономить токены. НЕ пиши развёрнутый ответ, длинные цитаты и пересказ норм.

Ответь кратко (2–5 предложений) и СТРОГО по структуре:
1. В каком документе и где именно искать ответ: раздел/пункт/глава, страницы (по меткам [стр. N] и заголовкам во фрагментах).
2. Одно предложение — о чём там материал, без формулировок нормы.
3. Заверши фразой: «Напишите «покажи» или нажмите «Показать подробный ответ», если нужен полный текст с цитатами.»

Если во фрагментах нет релевантного — скажи прямо и не выдумывай номера и даты.`;

const EXPAND_REQUEST_RE =
  /^(?:да|покажи|показать|подробнее|разверни|открой|выведи)(?:\s+(?:полный|подробный))?(?:\s+ответ|\s+текст)?[.!?]*$/iu;

export function isExpandRequest(message: string): boolean {
  return EXPAND_REQUEST_RE.test(message.trim());
}

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

async function fetchContext(
  root: string,
  slug: string,
  question: string,
  scopePath: string,
  mode: AskMode,
): Promise<LibraryContextItem[]> {
  if (mode === "preview") {
    return buildLibraryContextForQuery(root, slug, question, {
      maxCharsPerDocument: 4_000,
      maxDocuments: 2,
      scope_path: scopePath,
      prefer_wide_context: false,
    });
  }

  return buildLibraryContextForQuery(root, slug, question, {
    maxCharsPerDocument: 100_000,
    maxDocuments: 2,
    scope_path: scopePath,
    prefer_wide_context: true,
  });
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
  mode: AskMode = "preview",
): Promise<AskResult> {
  if (!isDeepSeekConfigured()) {
    throw new Error("deepseek_not_configured");
  }

  const q = question.trim();
  if (!q) throw new Error("empty_question");

  const items = await fetchContext(root, slug, q, scopePath, mode);
  const contextBlock = formatContext(items);
  const userContent =
    mode === "preview"
      ? `Вопрос: ${q}\n\nКороткие фрагменты для ориентации:\n\n${contextBlock}`
      : `Вопрос: ${q}\n\nФрагменты из библиотеки:\n\n${contextBlock}`;

  const messages: ChatMessage[] = [
    { role: "system", content: mode === "preview" ? PREVIEW_SYSTEM_PROMPT : FULL_SYSTEM_PROMPT },
    ...sanitizeHistory(history).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userContent },
  ];

  const answer = await chatCompletion(messages);

  return {
    answer,
    sources: items.map((item) => ({ path: item.path, name: item.name })),
    context_available: items.length > 0,
    mode,
  };
}
