import { describe, expect, it } from "vitest";
import { detectQuestionScopeLabels, isExpandRequest } from "./ask.js";
import { extractScopeBoostTerms } from "./documentSearch.js";

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

describe("question scope (ЗРУ vs везде)", () => {
  it("detects ЗРУ scope and does not broaden to plain РУ", () => {
    const q =
      "Какие требования к месту присоединения переносного заземления к токоведущим частям в ЗРУ?\n" +
      "1) Все, что указано в других вариантах ответа.\n" +
      "2) Место должно освещаться лампами внутреннего освещения ЗРУ.";
    expect(detectQuestionScopeLabels(q)).toEqual(["ЗРУ"]);
    const boost = extractScopeBoostTerms(q);
    expect(boost.some((t) => t.includes("зру"))).toBe(true);
    expect(boost.some((t) => t.includes("токоведущ"))).toBe(true);
  });

  it("detects ОРУ and ВЛ separately", () => {
    expect(detectQuestionScopeLabels("работы на ВЛ под наведенным напряжением")).toContain("ВЛ");
    expect(detectQuestionScopeLabels("в ОРУ открытого типа")).toContain("ОРУ");
  });
});
