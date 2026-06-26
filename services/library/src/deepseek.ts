import { env } from "./config.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

export async function chatCompletion(messages: ChatMessage[], maxTokens = 1200): Promise<string> {
  const key = env.DEEPSEEK_API_KEY?.trim();
  if (!key) throw new Error("deepseek_not_configured");

  const url = `${env.DEEPSEEK_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(90_000),
  });

  const data = (await res.json()) as ChatCompletionResponse;
  if (!res.ok) {
    const err = data.error?.message ?? res.statusText;
    throw new Error(`deepseek_http_${res.status}: ${err}`);
  }

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("deepseek_empty_response");
  return text;
}
