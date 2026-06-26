import { describe, expect, it } from "vitest";
import { isExpandRequest } from "./ask.js";

describe("isExpandRequest", () => {
  it("matches common expand phrases", () => {
    expect(isExpandRequest("покажи")).toBe(true);
    expect(isExpandRequest("Покажи подробный ответ")).toBe(true);
    expect(isExpandRequest("да")).toBe(true);
    expect(isExpandRequest("подробнее")).toBe(true);
  });

  it("rejects normal questions", () => {
    expect(isExpandRequest("Какие требования к газопроводу?")).toBe(false);
    expect(isExpandRequest("да, но сначала уточни")).toBe(false);
  });
});
