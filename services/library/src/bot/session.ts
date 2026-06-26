import { env, resolvedDefaultScopePath } from "../config.js";

export type BotSession = {
  slug: string;
  scopePath: string;
  pendingQuestion: string | null;
  askHistory: Array<{ role: "user" | "assistant"; content: string }>;
};

const sessions = new Map<number, BotSession>();

function defaultSession(): BotSession {
  return {
    slug: env.DEFAULT_DIRECTION_SLUG ?? "",
    scopePath: resolvedDefaultScopePath(),
    pendingQuestion: null,
    askHistory: [],
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
  const scope = session.scopePath ? ` / ${session.scopePath}` : "";
  return `<code>${esc(session.slug)}</code>${scope ? esc(scope) : ""}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
