import { env, resolvedDefaultScopePath } from "../config.js";

export type InputMode = "none" | "search" | "question";

export type BotSession = {
  slug: string;
  directionTitle: string;
  scopePath: string;
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
  return session;
}

export function resetAskState(session: BotSession): void {
  session.pendingQuestion = null;
  session.askHistory = [];
}

export function sessionLabel(session: BotSession): string {
  if (!session.slug) return "направление не выбрано";
  const title = session.directionTitle || session.slug;
  if (!session.scopePath) return `${title} (все папки)`;
  const folderName = session.scopePath.split("/").pop() ?? session.scopePath;
  return `${title} → ${folderName}`;
}

export function clearInputMode(session: BotSession): void {
  session.inputMode = "none";
}
