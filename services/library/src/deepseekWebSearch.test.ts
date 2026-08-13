import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./config.js", () => ({
  env: {
    DEEPSEEK_API_KEY: "sk-test-key-12345678",
    DEEPSEEK_BASE_URL: "https://api.deepseek.com",
    DEEPSEEK_MODEL: "deepseek-chat",
  },
  isDeepSeekConfigured: () => true,
}));

import { chatWithWebSearch } from "./deepseekWebSearch.js";

describe("chatWithWebSearch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("parses text answer and source urls from Anthropic-style response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            {
              type: "server_tool_use",
              id: "toolu_1",
              name: "web_search",
              input: { query: "курс доллара" },
            },
            {
              type: "web_search_tool_result",
              tool_use_id: "toolu_1",
              content: [
                {
                  type: "web_search_result",
                  title: "НБРБ",
                  url: "https://www.nbrb.by/statistics/rates/ratesdaily.asp",
                },
              ],
            },
            {
              type: "text",
              text: "Курс около 3.2 BYN за доллар.",
              citations: [{ title: "НБРБ", url: "https://www.nbrb.by/statistics/rates/ratesdaily.asp" }],
            },
          ],
        }),
      })),
    );

    const result = await chatWithWebSearch([
      { role: "system", content: "sys" },
      { role: "user", content: "Какой курс доллара сегодня?" },
    ]);

    expect(result.answer).toContain("3.2");
    expect(result.search_calls).toBe(1);
    expect(result.sources).toEqual([
      {
        title: "НБРБ",
        url: "https://www.nbrb.by/statistics/rates/ratesdaily.asp",
      },
    ]);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      tools: Array<{ type: string; name: string }>;
    };
    expect(body.tools[0]?.type).toBe("web_search_20250305");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/anthropic/v1/messages");
  });

  it("throws on http error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "bad tool" } }),
      })),
    );

    await expect(
      chatWithWebSearch([{ role: "user", content: "погугли новости" }]),
    ).rejects.toThrow(/deepseek_web_http_400/);
  });
});
