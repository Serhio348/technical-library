import { chatCompletion, type ChatMessage } from "./deepseek.js";

export type QuizOption = {
  key: string;
  text: string;
};

export type NormalizedQuiz = {
  question: string;
  options: QuizOption[];
  scope: string | null;
  confidence: "ok" | "low";
  needs_clarification: boolean;
  /** Готовый текст для поиска/ответа в библиотеке. */
  formatted: string;
  /** Сырой ответ модели (отладка). */
  rawModel?: string;
};

const NORMALIZE_SYSTEM = `Ты восстанавливаешь текст экзаменационного/тестового вопроса из шумного OCR (часто таблица вариантов, скрин телефона).

Задача: вернуть ТОЛЬКО валидный JSON без markdown-обёртки:
{
  "question": "полная формулировка вопроса",
  "options": [{"key":"1","text":"..."},{"key":"2","text":"..."}],
  "scope": "ЗРУ|ОРУ|ВЛ|null или кратко",
  "confidence": "ok"|"low",
  "needs_clarification": true|false
}

Правила:
- Не выдумывай варианты и факты, которых нет в OCR/подписи.
- Сохрани нумерацию/буквы вариантов как в исходнике (1/2/3 или а/б/в).
- Если строки таблицы OCR «поехали» — аккуратно слей обрывки в целые варианты.
- scope — только если явно следует из текста (ЗРУ, ОРУ, ВЛ, рабочее место…).
- needs_clarification=true и confidence=low, если вопрос или варианты нечитаемы / явно обрезаны.
- Пиши по-русски, как в исходнике.`;

/** Похоже на тест с вариантами (в т.ч. после кривого OCR таблицы). */
export function looksLikeQuizText(text: string): boolean {
  const t = text.trim();
  if (t.length < 20) return false;
  if (/вариант/i.test(t)) return true;
  if (/вопрос\s*№?\s*\d+/i.test(t)) return true;
  const numbered = t.match(/(?:^|\n)\s*(?:[1-9]|[a-dа-г])(?:[.)]|、)\s+\S/gim);
  if (numbered && numbered.length >= 2) return true;
  // Таблица/колонки: несколько коротких строк с номерами
  const lines = t.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const optLines = lines.filter((l) => /^(?:[1-9]|[a-dа-г])(?:[.)]|\s)/i.test(l));
  if (optLines.length >= 2) return true;
  return false;
}

export function formatNormalizedQuiz(quiz: Omit<NormalizedQuiz, "formatted" | "rawModel">): string {
  const lines = [quiz.question.trim()];
  if (quiz.scope) lines.push(`Область: ${quiz.scope}`);
  for (const opt of quiz.options) {
    const key = opt.key.trim();
    const text = opt.text.trim();
    if (!text) continue;
    lines.push(`${key}) ${text}`);
  }
  return lines.filter(Boolean).join("\n");
}

export function parseNormalizedQuizJson(raw: string): NormalizedQuiz | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let jsonText = trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) jsonText = fenced[1].trim();
  else {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) jsonText = trimmed.slice(start, end + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const question = typeof obj.question === "string" ? obj.question.trim() : "";
  if (!question || question.length < 8) return null;

  const optionsRaw = Array.isArray(obj.options) ? obj.options : [];
  const options: QuizOption[] = [];
  for (const item of optionsRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const key = String(row.key ?? row.label ?? options.length + 1).trim();
    const text = String(row.text ?? row.value ?? "").trim();
    if (!text) continue;
    options.push({ key: key.replace(/[.)]$/, ""), text });
  }

  const confidence = obj.confidence === "low" ? "low" : "ok";
  const needsClarification = obj.needs_clarification === true || confidence === "low";
  const scope =
    typeof obj.scope === "string" && obj.scope.trim() && obj.scope.trim().toLowerCase() !== "null"
      ? obj.scope.trim()
      : null;

  const base = {
    question,
    options,
    scope,
    confidence: confidence as "ok" | "low",
    needs_clarification: needsClarification,
  };

  return {
    ...base,
    formatted: formatNormalizedQuiz(base),
    rawModel: trimmed.slice(0, 4000),
  };
}

/**
 * Чинит OCR теста через DeepSeek (text). Не вызывает vision.
 * @returns null — нормализация не нужна/не удалась, используйте исходный OCR.
 */
export async function normalizeQuizFromOcr(
  ocrText: string,
  userCaption = "",
  options: { force?: boolean } = {},
): Promise<NormalizedQuiz | null> {
  const ocr = ocrText.trim();
  if (!ocr) return null;
  if (!options.force && !looksLikeQuizText(ocr) && !looksLikeQuizText(userCaption)) {
    return null;
  }

  const messages: ChatMessage[] = [
    { role: "system", content: NORMALIZE_SYSTEM },
    {
      role: "user",
      content:
        (userCaption.trim() ? `Подпись пользователя (приоритетнее при конфликте):\n${userCaption.trim()}\n\n` : "") +
        `OCR с фото/скана:\n${ocr.slice(0, 6000)}`,
    },
  ];

  try {
    const raw = await chatCompletion(messages, 900);
    return parseNormalizedQuizJson(raw);
  } catch (e) {
    console.warn("[quizNormalize] failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
