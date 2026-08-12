import { buildLibraryContextForQuery, type LibraryContextItem } from "./storage.js";
import { chatCompletion, type ChatMessage } from "./deepseek.js";
import { isDeepSeekConfigured } from "./config.js";
import {
  type AskAttachment,
  attachmentKindLabel,
  extractTextFromAskAttachment,
  isAskAttachmentTextUsable,
  isImageAttachmentFilename,
} from "./attachmentExtract.js";
import { extractScopeBoostTerms, extractSectionBoostTerms } from "./documentSearch.js";
import { cleanupPhotoOcrText, isPhotoOcrDoubtful } from "./imageOcr.js";
import { looksLikeQuizText, normalizeQuizFromOcr, quizOcrLooksCleanEnough } from "./quizNormalize.js";

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
  /** Вопрос после LLM-нормализации OCR (стек + варианты). */
  normalized_question?: string;
  attachment_filename?: string;
  /** Выделенные ограничения области (ЗРУ, ОРУ, ВЛ…) — для отладки/UI. */
  question_scope?: string[];
  /** Качество OCR фото: low — лучше уточнить формулировку. */
  ocr_confidence?: "ok" | "low";
  /** Не искали в библиотеке — ждём уточнения текста/фото. */
  needs_clarification?: boolean;
  /** Какой пайплайн OCR/нормализации сработал. */
  ocr_pipeline?: "tesseract" | "tesseract+normalize";
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
  documents: string[] = [],
): Promise<LibraryContextItem[]> {
  // Без лимита «только N файлов»: упаковка по суммарному бюджету символов.
  // documents[] — явное ограничение «искать только в этих файлах».
  if (mode === "preview") {
    return buildLibraryContextForQuery(root, slug, question, {
      maxCharsPerDocument: 10_000,
      maxDocuments: 0,
      totalCharsBudget: 36_000,
      scope_path: scopePath,
      prefer_wide_context: false,
      boost_terms: boostTerms,
      documents,
    });
  }

  return buildLibraryContextForQuery(root, slug, question, {
    maxCharsPerDocument: 50_000,
    maxDocuments: 0,
    totalCharsBudget: 180_000,
    scope_path: scopePath,
    prefer_wide_context: true,
    boost_terms: boostTerms,
    documents,
  });
}

export function isAskConfigured(): boolean {
  return isDeepSeekConfigured();
}

export type AskOptions = {
  documents?: string[];
};

export async function answerLibraryQuestion(
  root: string,
  slug: string,
  question: string,
  scopePath = "",
  history: unknown = [],
  mode: AskMode = "preview",
  attachment?: AskAttachment | null,
  options: AskOptions = {},
): Promise<AskResult> {
  if (!isDeepSeekConfigured()) {
    throw new Error("deepseek_not_configured");
  }

  let extractedFromAttachment: string | null = null;
  let rawOcrText: string | undefined;
  let attachmentFilename: string | undefined;
  let ocrConfidence: "ok" | "low" | undefined;
  let ocrPipeline: AskResult["ocr_pipeline"] | undefined;
  let normalizedQuestion: string | undefined;

  if (attachment?.buffer?.length) {
    attachmentFilename = attachment.filename;
    const raw = await extractTextFromAskAttachment(attachment.buffer, attachment.filename);
    if (isAskAttachmentTextUsable(raw, attachment.filename)) {
      extractedFromAttachment = isImageAttachmentFilename(attachment.filename)
        ? cleanupPhotoOcrText(raw!)
        : raw;
      rawOcrText = extractedFromAttachment ?? undefined;
      if (isImageAttachmentFilename(attachment.filename) && isPhotoOcrDoubtful(extractedFromAttachment)) {
        ocrConfidence = "low";
      } else if (isImageAttachmentFilename(attachment.filename)) {
        ocrConfidence = "ok";
      }
      ocrPipeline = isImageAttachmentFilename(attachment.filename) ? "tesseract" : undefined;
    } else if (!question.trim()) {
      throw new Error("extract_no_text");
    }
  }

  const userCaption = question.trim();
  // Нормализация LLM — только если OCR «кривой»; чистый тест с вариантами идём сразу в поиск
  const shouldNormalizeQuiz =
    Boolean(extractedFromAttachment) &&
    !quizOcrLooksCleanEnough(extractedFromAttachment ?? "") &&
    (ocrConfidence === "low" ||
      looksLikeQuizText(extractedFromAttachment ?? "") ||
      looksLikeQuizText(userCaption));

  if (shouldNormalizeQuiz && extractedFromAttachment) {
    const normalized = await normalizeQuizFromOcr(extractedFromAttachment, userCaption, {
      force: ocrConfidence === "low",
    });
    if (normalized) {
      ocrPipeline = "tesseract+normalize";
      if (normalized.confidence === "low") ocrConfidence = "low";
      else if (ocrConfidence !== "low") ocrConfidence = "ok";

      // Блокируем только если реально нечего искать (нет стека/вариантов) и нет подписи
      if (normalized.needs_clarification && !userCaption) {
        const preview = (normalized.formatted || extractedFromAttachment).slice(0, 900);
        return {
          answer:
            "Текст с фото распознан неуверенно (таблица/варианты могли «поехать»). Чтобы не ответить не на тот вопрос, нужно уточнение.\n\n" +
            `Восстановлено:\n«${preview}${preview.length >= 900 ? "…" : ""}»\n\n` +
            "Пришлите более чёткий скриншот или наберите/поправьте вопрос текстом. " +
            "Фильтр по файлу и история диалога сохраняются.",
          sources: [],
          context_available: false,
          mode,
          resolved_question: normalized.formatted || extractedFromAttachment,
          recognized_question: rawOcrText ?? extractedFromAttachment,
          normalized_question: normalized.formatted,
          attachment_filename: attachmentFilename,
          ocr_confidence: "low",
          needs_clarification: true,
          ocr_pipeline: ocrPipeline,
        };
      }

      normalizedQuestion = normalized.formatted;
      if (normalized.options.length >= 2) ocrConfidence = "ok";
    } else if (
      ocrConfidence === "low" &&
      !userCaption &&
      isImageAttachmentFilename(attachmentFilename ?? "") &&
      !looksLikeQuizText(extractedFromAttachment)
    ) {
      // Совсем нечитаемо и не похоже на тест — просим уточнить
      const preview = extractedFromAttachment.slice(0, 900);
      return {
        answer:
          "Текст с фото распознан неуверенно (смаз, блики или обрезка). Чтобы не ответить не на тот вопрос, нужно уточнение.\n\n" +
          `Распознано:\n«${preview}${extractedFromAttachment.length > 900 ? "…" : ""}»\n\n` +
          "Пришлите более чёткий скриншот/фото или наберите вопрос текстом (можно коротко поправить распознанное). " +
          "Фильтр по файлу и история диалога сохраняются.",
        sources: [],
        context_available: false,
        mode,
        resolved_question: extractedFromAttachment,
        recognized_question: extractedFromAttachment,
        attachment_filename: attachmentFilename,
        ocr_confidence: "low",
        needs_clarification: true,
        ocr_pipeline: ocrPipeline,
      };
    }
    // Если OCR low, но похож на тест — всё равно идём в поиск по сырому тексту (быстрее, чем отказ)
  }

  const q = normalizedQuestion
    ? normalizedQuestion
    : [userCaption, extractedFromAttachment?.trim()].filter(Boolean).join("\n\n");
  if (!q) throw new Error("empty_question");

  const documents = (options.documents ?? [])
    .map((d) => d.trim().replace(/\\/g, "/"))
    .filter(Boolean);

  const scopeLabels = detectQuestionScopeLabels(q);
  const boostTerms = [
    ...extractScopeBoostTerms(q),
    ...extractSectionBoostTerms(q),
    ...scopeLabels,
  ];

  const items = await fetchContext(root, slug, q, scopePath, mode, boostTerms, documents);
  const contextBlock = formatContext(items);
  const attachmentNote = attachmentFilename
    ? ` (из прикреплённого ${attachmentKindLabel(attachmentFilename)}${attachmentFilename ? `: ${attachmentFilename}` : ""})`
    : "";
  const docFilterNote =
    documents.length === 1
      ? `\n\nИскать ТОЛЬКО в указанном файле: ${documents[0]}.`
      : documents.length > 1
        ? `\n\nИскать ТОЛЬКО в указанных файлах:\n${documents.map((d) => `• ${d}`).join("\n")}`
        : "";
  const scopeBlock =
    scopeLabels.length > 0
      ? `\n\nВАЖНО — область вопроса (не расширять): ${scopeLabels.join(", ")}. Отвечай только в этих рамках.`
      : "";
  const ocrWarn =
    ocrConfidence === "low"
      ? "\n\nВнимание: текст с фото распознан неуверенно. Если формулировка сомнительна — скажи об этом и попроси уточнить, не угадывай."
      : "";
  const normalizedNote = normalizedQuestion
    ? "\n\nНиже вопрос уже нормализован из OCR (стек + варианты). Опирайся на эту формулировку."
    : "";
  const followUpNote =
    "\n\nЕсли сообщение — уточнение к предыдущему вопросу в истории (короткое «а в ЗРУ?», «только пункт 2» и т.п.) — сохрани контекст предыдущего вопроса.";
  const userContent =
    mode === "preview"
      ? `Вопрос пользователя${attachmentNote} (может содержать варианты ответа, в т.ч. из файла или фото):\n${q}${docFilterNote}${scopeBlock}${ocrWarn}${normalizedNote}${followUpNote}\n\nКороткие фрагменты для ориентации:\n\n${contextBlock}`
      : `Вопрос пользователя${attachmentNote} (может содержать варианты ответа, в т.ч. из файла или фото):\n${q}${docFilterNote}${scopeBlock}${ocrWarn}${normalizedNote}${followUpNote}\n\nФрагменты из библиотеки:\n\n${contextBlock}`;

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
    ...((normalizedQuestion || rawOcrText || extractedFromAttachment)
      ? { recognized_question: normalizedQuestion ?? rawOcrText ?? extractedFromAttachment ?? undefined }
      : {}),
    ...(normalizedQuestion ? { normalized_question: normalizedQuestion } : {}),
    ...(attachmentFilename ? { attachment_filename: attachmentFilename } : {}),
    ...(scopeLabels.length > 0 ? { question_scope: scopeLabels } : {}),
    ...(ocrConfidence ? { ocr_confidence: ocrConfidence } : {}),
    ...(ocrPipeline ? { ocr_pipeline: ocrPipeline } : {}),
  };
}
