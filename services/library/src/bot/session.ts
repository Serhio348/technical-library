import { env, resolvedDefaultScopePath } from "../config.js";

export type InputMode = "none" | "search" | "question" | "chat";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type BotSession = {
  slug: string;
  directionTitle: string;
  scopePath: string;
  /**
   * Optional file filter within the current folder/direction.
   * Empty / omitted = search all files in the scope.
   * Держится на уточняющих вопросах; сбрасывается явно (📄 → все файлы / смена папки).
   */
  documentPath: string;
  /** Temporary list for document picker (callback data size limit). */
  documentFiles: string[];
  pendingQuestion: string | null;
  /** История диалога по документам («По документам»). */
  askHistory: ChatMessage[];
  /** История свободного чата без библиотеки («Чат ИИ»). */
  chatHistory: ChatMessage[];
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
    pendingQuestion: null,
    askHistory: [],
    chatHistory: [],
    inputMode: "none",
  };
}

export function getSession(chatId: number): BotSession {
  let session = sessions.get(chatId);
  if (!session) {
    session = defaultSession();
    sessions.set(chatId, session);
  }
  // Backfill fields for sessions created before document filter / free chat existed.
  if (typeof session.documentPath !== "string") session.documentPath = "";
  if (!Array.isArray(session.documentFiles)) session.documentFiles = [];
  if (!Array.isArray(session.chatHistory)) session.chatHistory = [];
  return session;
}

export function resetAskState(session: BotSession): void {
  session.pendingQuestion = null;
  session.askHistory = [];
}

export function resetChatState(session: BotSession): void {
  session.chatHistory = [];
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

/** Явный сброс фильтра «только этот файл» (все файлы / смена папки / направления). */
export function clearDocumentFilter(session: BotSession): void {
  session.documentPath = "";
}
