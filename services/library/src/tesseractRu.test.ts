import { describe, expect, it } from "vitest";
import { sanitizeRuOcrText } from "./tesseractRu.js";

describe("sanitizeRuOcrText", () => {
  it("removes CJK and other misdetected scripts", () => {
    expect(sanitizeRuOcrText("Какой 答案 вариант правильный?")).toBe("Какой  вариант правильный?");
    expect(sanitizeRuOcrText("工力エ問 фыва 漢字 テスト")).toBe(" фыва  ");
  });

  it("keeps russian quiz punctuation", () => {
    const quiz = "Вопрос № 5: 1) 2,5 бар; 2) «не разрешается».";
    expect(sanitizeRuOcrText(quiz)).toBe(quiz);
  });
});
