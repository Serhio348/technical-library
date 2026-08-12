import { env, resolvedDefaultScopePath } from "../config.js";

export type InputMode = "none" | "search" | "question";

export type BotSession = {
  slug: string;
  directionTitle: string;
  scopePath: string;
  /**
   * Optional file filter within the current folder/direction.
   * Empty / omitted = search all files in the scope.
   * Relative path under the direction root (same as catalog entry.path).
   * One-shot: снимается после запроса (для «подробнее» хранится в expandDocuments).
   */
  documentPath: string;
  /** Temporary list for document picker (callback data size limit). */
  documentFiles: string[];
  /** Документы, зафиксированные на preview — для «Подробный ответ». */
  expandDocuments: string[];
  pendingQuestion: string | null;
  askHistory: Array<{ role: "user" | "assistant"; content: string }>;
  inputMode: InputMode;
};

const sessions = new Map<number, BotSession>();

function defaultSession(): BotSession {
  return {
    slug: env.DEFAULT_DIRECTION_SLUG ?? "",
    directionTitle: "",
    scopePath: resolvedDefaultScopePath(),
    documentPath: "",
    documentFiles: [],
    expandDocuments: [],
    pendingQuestion: null,
    askHistory: [],
    inputMode: "none",
  };
}

export function getSession(chatId: number): BotSession {
  let session = sessions.get(chatId);
  if (!session) {
    session = defaultSession();
    sessions.set(chatId, session);
  }
  // Backfill fields for sessions created before document filter existed.
  if (typeof session.documentPath !== "string") session.documentPath = "";
  if (!Array.isArray(session.documentFiles)) session.documentFiles = [];
  if (!Array.isArray(session.expandDocuments)) session.expandDocuments = [];
  return session;
}

export function resetAskState(session: BotSession): void {
  session.pendingQuestion = null;
  session.askHistory = [];
  session.expandDocuments = [];
}

export function sessionLabel(session: BotSession): string {
  if (!session.slug) return "направление не выбрано";
  const title = session.directionTitle || session.slug;
  const folder = session.scopePath
    ? (session.scopePath.split("/").pop() ?? session.scopePath)
    : "все папки";
  if (!session.documentPath) return `${title} → ${folder}`;
  const fileName = session.documentPath.split("/").pop() ?? session.documentPath;
  return `${title} → ${folder} → ${fileName}`;
}

export function clearInputMode(session: BotSession): void {
  session.inputMode = "none";
}

/** Сброс фильтра «только этот файл» (после запроса или при смене области). */
export function clearDocumentFilter(session: BotSession): void {
  session.documentPath = "";
}
