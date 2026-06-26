import type { ChatMessage } from "./types";

const STORAGE_PREFIX = "tlibrary_chat";
const MAX_MESSAGES = 40;

function chatKey(slug: string, scopePath: string): string {
  return `${STORAGE_PREFIX}:${slug}:${scopePath || "_"}`;
}

export function loadChatHistory(slug: string, scopePath: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(chatKey(slug, scopePath));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-MAX_MESSAGES);
  } catch {
    return [];
  }
}

export function saveChatHistory(slug: string, scopePath: string, messages: ChatMessage[]): void {
  try {
    const slim = messages.map(({ imagePreview: _img, ...rest }) => rest);
    localStorage.setItem(chatKey(slug, scopePath), JSON.stringify(slim.slice(-MAX_MESSAGES)));
  } catch {
    /* quota or private mode */
  }
}

export function clearChatHistory(slug: string, scopePath: string): void {
  try {
    localStorage.removeItem(chatKey(slug, scopePath));
  } catch {
    /* ignore */
  }
}
