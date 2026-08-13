/**
 * Логика «когда нужен интернет» (пункт 3).
 * Пока только решение — сам поиск подключим отдельно.
 *
 * Срабатывает (use=true), если в свободном чате:
 * - явная просьба искать в сети / погуглить / актуальные данные из интернета;
 * - признаки «свежести»: сегодня, сейчас, актуальный курс/цена/погода/новости;
 * - вопрос про события с явным текущим/будущим годом.
 *
 * НЕ срабатывает:
 * - режим «По документам» (библиотека) — туда интернет не мешаем;
 * - обычные учебные/нормативные вопросы без маркеров свежести;
 * - короткие уточнения без маркеров («а подробнее», «почему»).
 */

export type WebSearchDecision = {
  use: boolean;
  reason: string;
};

const EXPLICIT_WEB_RE =
  /(?:в\s+интернете|из\s+интернета|погугли|загугли|поиск(?:ай|ать)?\s+в\s+сети|найди\s+в\s+сети|web\s*search|google|гугл|актуальн\w*\s+данн|свеж\w*\s+инф)/i;

/** Без \\b: в JS word-boundary не работает с кириллицей. */
const FRESHNESS_RE =
  /(?:сегодня|сейчас|на\s+сегодня|на\s+этой\s+неделе|текущ\w*|актуальн\w*|новост|погод|курс\s+(?:валют|доллар|евро|руб)|цена\s+на|котиров)/i;

const CURRENT_YEAR = new Date().getFullYear();

export function decideWebSearch(
  message: string,
  options: { force?: boolean; mode?: "chat" | "library" } = {},
): WebSearchDecision {
  if (options.mode === "library") {
    return { use: false, reason: "library_mode" };
  }
  if (options.force) {
    return { use: true, reason: "forced" };
  }

  const text = message.trim();
  if (text.length < 4) {
    return { use: false, reason: "too_short" };
  }

  if (EXPLICIT_WEB_RE.test(text)) {
    return { use: true, reason: "explicit_web_request" };
  }

  if (FRESHNESS_RE.test(text)) {
    return { use: true, reason: "freshness_markers" };
  }

  // «в 2026 году…», «после 2025» — часто нужна свежая справка
  const years = [...text.matchAll(/\b(20[2-9]\d)\b/g)].map((m) => Number.parseInt(m[1]!, 10));
  if (years.some((y) => y >= CURRENT_YEAR)) {
    return { use: true, reason: "current_or_future_year" };
  }

  return { use: false, reason: "knowledge_sufficient" };
}
