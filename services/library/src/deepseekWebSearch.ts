import { env } from "./config.js";
import type { ChatMessage } from "./deepseek.js";

export type WebSearchSource = {
  title: string;
  url: string;
};

export type WebSearchChatResult = {
  answer: string;
  sources: WebSearchSource[];
  /** Сколько раз модель вызвала web_search (по блокам ответа). */
  search_calls: number;
};

type AnthropicContentBlock = {
  type?: string;
  text?: string;
  name?: string;
  title?: string;
  url?: string;
  content?: AnthropicContentBlock[] | string;
  citations?: Array<{ title?: string; url?: string }>;
};

type AnthropicMessagesResponse = {
  content?: AnthropicContentBlock[];
  error?: { message?: string; type?: string };
};

function anthropicBaseUrl(): string {
  const root = env.DEEPSEEK_BASE_URL.replace(/\/$/, "");
  // https://api.deepseek.com → https://api.deepseek.com/anthropic
  if (root.endsWith("/anthropic")) return root;
  return `${root}/anthropic`;
}

function collectSources(blocks: AnthropicContentBlock[]): WebSearchSource[] {
  const out: WebSearchSource[] = [];
  const seen = new Set<string>();

  const push = (title: string, url: string) => {
    const u = url.trim();
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push({ title: title.trim() || u, url: u });
  };

  const walk = (items: AnthropicContentBlock[] | undefined) => {
    if (!items) return;
    for (const block of items) {
      if (block.type === "web_search_result" && typeof block.url === "string") {
        push(typeof block.title === "string" ? block.title : "", block.url);
      }
      if (Array.isArray(block.citations)) {
        for (const c of block.citations) {
          if (typeof c.url === "string") push(c.title ?? "", c.url);
        }
      }
      if (Array.isArray(block.content)) walk(block.content);
    }
  };

  walk(blocks);
  return out.slice(0, 8);
}

function extractAnswer(blocks: AnthropicContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      parts.push(block.text.trim());
    }
  }
  return parts.join("\n\n").trim();
}

function countSearchCalls(blocks: AnthropicContentBlock[]): number {
  let n = 0;
  const walk = (items: AnthropicContentBlock[] | undefined) => {
    if (!items) return;
    for (const block of items) {
      if (block.type === "server_tool_use" && block.name === "web_search") n += 1;
      if (Array.isArray(block.content)) walk(block.content);
    }
  };
  walk(blocks);
  return n;
}

/**
 * Чат через Anthropic-совместимый endpoint DeepSeek с server-side web_search.
 * Поиск выполняет DeepSeek на своей стороне; клиенту приходят ответ + ссылки.
 */
export async function chatWithWebSearch(
  messages: ChatMessage[],
  maxTokens = 1800,
): Promise<WebSearchChatResult> {
  const key = env.DEEPSEEK_API_KEY?.trim();
  if (!key) throw new Error("deepseek_not_configured");

  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const dialog = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  if (dialog.length === 0) throw new Error("empty_messages");

  const url = `${anthropicBaseUrl()}/v1/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      Authorization: `Bearer ${key}`,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL,
      max_tokens: maxTokens,
      temperature: 0.4,
      system: systemParts.join("\n\n") || undefined,
      messages: dialog,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 5,
        },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const data = (await res.json()) as AnthropicMessagesResponse;
  if (!res.ok) {
    const err = data.error?.message ?? res.statusText;
    throw new Error(`deepseek_web_http_${res.status}: ${err}`);
  }

  const blocks = Array.isArray(data.content) ? data.content : [];
  const answer = extractAnswer(blocks);
  if (!answer) throw new Error("deepseek_web_empty_response");

  return {
    answer,
    sources: collectSources(blocks),
    search_calls: countSearchCalls(blocks),
  };
}
