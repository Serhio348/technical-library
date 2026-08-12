import { buildLibraryContextForQuery, type LibraryContextItem } from "./storage.js";
import { chatCompletion, type ChatMessage } from "./deepseek.js";
import { isDeepSeekConfigured } from "./config.js";
import {
  type AskAttachment,
  attachmentKindLabel,
  extractTextFromAskAttachment,
  isAskAttachmentTextUsable,
} from "./attachmentExtract.js";
import { extractScopeBoostTerms, extractSectionBoostTerms } from "./documentSearch.js";

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
  resolved_question: string;
  recognized_question?: string;
  attachment_filename?: string;
  /** Выделенные ограничения области (ЗРУ, ОРУ, ВЛ…) — для отладки/UI. */
  question_scope?: string[];
};

const MCQ_INSTRUCTIONS = `Если в вопросе есть варианты ответа — нумерованный или буквенный список (1), 2), 3), а), б), в) и т.п.), в том числе если текст пришёл с фото после OCR:
- Сначала восстанови и зафиксируй ТОЧНУЮ формулировку вопроса (стек), особенно ограничения области: ЗРУ, ОРУ, РУ, ВЛ, ТП, КЛ, «на рабочем месте», «только», «не».
- Не расширяй вопрос до «везде / во всех электроустановках», если в стеке указано конкретное место (например «в ЗРУ»).
- Для вариантов вида «всё перечисленное» / «все, что указано в других вариантах» проверь КАЖДЫЙ пункт именно в контексте указанной области (ЗРУ ≠ ОРУ ≠ ВЛ).
- Укажи номер или букву правильного варианта и приведи формулировку этого варианта так, как она дана в списке вопроса (не перефразируй вариант, если он уже есть в тексте).
- Кратко поясни опору на документ (раздел, пункт, страница) — без выдуманных норм.
- Если материалов недостаточно для уверенного выбора — прямо скажи об этом и не угадывай.`;

const SCOPE_INSTRUCTIONS = `Ограничения области вопроса (критично):
- Если в вопросе есть ЗРУ / ОРУ / РУ / ВЛ / ТП / КЛ / «рабочее место» — ответ и цитаты должны относиться именно к этой области.
- Не подменяй «в ЗРУ» общими правилами «для РУ» или «для всех электроустановок», если норма различает случаи.
- В начале ответа кратко повтори стек вопроса с сохранением области (1 фраза), затем вариант.`;

const FULL_SYSTEM_PROMPT = `Ты помощник по нормативной и технической документации (законы, ГОСТ, ТКП, инструкции).
Отвечай на русском языке, опираясь ТОЛЬКО на фрагменты документов ниже (могут быть с метками [стр. N]).
Если в фрагментах нет ответа — скажи об этом прямо и не выдумывай нормы, номера и даты.
Если видишь пометку «Индекс неполный» или только оглавление без текста раздела — сообщи, что нужна переиндексация PDF (OCR) в библиотеке.

${SCOPE_INSTRUCTIONS}

${MCQ_INSTRUCTIONS}

Для вопроса с вариантами ответа структура ответа:
1. Кратко: о чём вопрос и какая область (например «в ЗРУ»).
2. «Правильный вариант: N (или буква) — <формулировка варианта из списка>».
3. Обоснование со ссылкой на документ, раздел/пункт и цитатой из фрагментов — с той же областью, что в вопросе.
4. Если нужен более развёрнутый разбор других вариантов — пользователь может запросить подробнее.

В конце ответа укажи источники: названия файлов и номера страниц из фрагментов.`;

const PREVIEW_SYSTEM_PROMPT = `Ты помощник по нормативной и технической документации (законы, ГОСТ, ТКП, инструкции).
Пользователь задал вопрос. Ниже — только КОРОТКИЕ фрагменты для ориентации, не для полного ответа.

Задача: сэкономить токены. НЕ пиши развёрнутый ответ, длинные цитаты и пересказ норм.

${SCOPE_INSTRUCTIONS}

${MCQ_INSTRUCTIONS}

Если вопрос С вариантами ответа — ответь кратко (2–5 предложений) и СТРОГО по структуре:
1. Одна фраза: пересказ стека вопроса с сохранением области (ЗРУ/ОРУ/ВЛ…), без расширения до «везде».
2. «Правильный вариант: N (или буква) — <формулировка варианта из списка>».
3. В каком документе и где искать подтверждение: раздел/пункт/глава, страницы (по меткам [стр. N]).
4. Заверши фразой: «Напишите «покажи» или нажмите «Показать подробный ответ», если нужен полный разбор с цитатами.»

Если вопрос БЕЗ вариантов ответа — ответь кратко (2–5 предложений) и СТРОГО по структуре:
1. В каком документе и где именно искать ответ: раздел/пункт/глава, страницы (по меткам [стр. N] и заголовкам во фрагментах), с учётом области вопроса.
2. Одно предложение — о чём там материал, без формулировок нормы.
3. Заверши фразой: «Напишите «покажи» или нажмите «Показать подробный ответ», если нужен полный текст с цитатами.»

Если во фрагментах нет релевантного — скажи прямо и не выдумывай номера и даты.`;

const EXPAND_REQUEST_RE =
  /^(?:да|покажи|показать|подробнее|разверни|открой|выведи)(?:\s+(?:полный|подробный))?(?:\s+ответ|\s+текст)?[.!?]*$/iu;

export function isExpandRequest(message: string): boolean {
  return EXPAND_REQUEST_RE.test(message.trim());
}

/** Человекочитаемые метки области из вопроса (для промпта). */
export function detectQuestionScopeLabels(question: string): string[] {
  const q = question.toLowerCase().replace(/ё/g, "е");
  const labels: string[] = [];
  // \b не работает с кириллицей (\w = ASCII) — границы через классы букв
  const b = (abbr: string) => new RegExp(`(?:^|[^a-zа-яё0-9])${abbr}(?=[^a-zа-яё0-9]|$)`, "i");
  const checks: Array<[RegExp, string]> = [
    [b("зру"), "ЗРУ"],
    [/закрыт[а-яё]*\s+распределительн/i, "ЗРУ"],
    [b("ору"), "ОРУ"],
    [/открыт[а-яё]*\s+распределительн/i, "ОРУ"],
    [b("вру"), "ВРУ"],
    [b("вл"), "ВЛ"],
    [/воздушн[а-яё]*\s+лини/i, "ВЛ"],
    [b("кл"), "КЛ"],
    [/кабельн[а-яё]*\s+лини/i, "КЛ"],
    [b("тп"), "ТП"],
    [/трансформаторн[а-яё]*\s+подстан/i, "ТП"],
    [b("ру"), "РУ"],
    [/распределительн[а-яё]*\s+устройств/i, "РУ"],
    [/рабоч[а-яё]*\s+мест/i, "рабочее место"],
  ];
  for (const [re, label] of checks) {
    if (re.test(q)) labels.push(label);
  }
  // Если есть ЗРУ/ОРУ — общее «РУ» часто шумит; оставим более точное
  if (labels.includes("ЗРУ") || labels.includes("ОРУ") || labels.includes("ВРУ")) {
    return labels.filter((l) => l !== "РУ");
  }
  return [...new Set(labels)];
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
  boostTerms: string[] = [],
): Promise<LibraryContextItem[]> {
  // Без лимита «только N файлов»: упаковка по суммарному бюджету символов.
  // Папка из 8 PDF и рост библиотеки — все релевантные файлы участвуют, пока хватает бюджета.
  if (mode === "preview") {
    return buildLibraryContextForQuery(root, slug, question, {
      maxCharsPerDocument: 6_000,
      maxDocuments: 0,
      totalCharsBudget: 28_000,
      scope_path: scopePath,
      prefer_wide_context: false,
      boost_terms: boostTerms,
    });
  }

  return buildLibraryContextForQuery(root, slug, question, {
    maxCharsPerDocument: 50_000,
    maxDocuments: 0,
    totalCharsBudget: 180_000,
    scope_path: scopePath,
    prefer_wide_context: true,
    boost_terms: boostTerms,
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
  attachment?: AskAttachment | null,
): Promise<AskResult> {
  if (!isDeepSeekConfigured()) {
    throw new Error("deepseek_not_configured");
  }

  let extractedFromAttachment: string | null = null;
  let attachmentFilename: string | undefined;
  if (attachment?.buffer?.length) {
    attachmentFilename = attachment.filename;
    const raw = await extractTextFromAskAttachment(attachment.buffer, attachment.filename);
    if (isAskAttachmentTextUsable(raw, attachment.filename)) {
      extractedFromAttachment = raw;
    } else if (!question.trim()) {
      throw new Error("extract_no_text");
    }
  }

  const q = [question.trim(), extractedFromAttachment?.trim()].filter(Boolean).join("\n\n");
  if (!q) throw new Error("empty_question");

  const scopeLabels = detectQuestionScopeLabels(q);
  const boostTerms = [
    ...extractScopeBoostTerms(q),
    ...extractSectionBoostTerms(q),
    ...scopeLabels,
  ];

  const items = await fetchContext(root, slug, q, scopePath, mode, boostTerms);
  const contextBlock = formatContext(items);
  const attachmentNote = attachmentFilename
    ? ` (из прикреплённого ${attachmentKindLabel(attachmentFilename)}${attachmentFilename ? `: ${attachmentFilename}` : ""})`
    : "";
  const scopeBlock =
    scopeLabels.length > 0
      ? `\n\nВАЖНО — область вопроса (не расширять): ${scopeLabels.join(", ")}. Отвечай только в этих рамках.`
      : "";
  const userContent =
    mode === "preview"
      ? `Вопрос пользователя${attachmentNote} (может содержать варианты ответа, в т.ч. из файла или фото):\n${q}${scopeBlock}\n\nКороткие фрагменты для ориентации:\n\n${contextBlock}`
      : `Вопрос пользователя${attachmentNote} (может содержать варианты ответа, в т.ч. из файла или фото):\n${q}${scopeBlock}\n\nФрагменты из библиотеки:\n\n${contextBlock}`;

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
    resolved_question: q,
    ...(extractedFromAttachment ? { recognized_question: extractedFromAttachment } : {}),
    ...(attachmentFilename ? { attachment_filename: attachmentFilename } : {}),
    ...(scopeLabels.length > 0 ? { question_scope: scopeLabels } : {}),
  };
}
