import { describe, expect, it } from "vitest";
import {
  formatNormalizedQuiz,
  looksLikeQuizText,
  parseNormalizedQuizJson,
  quizOcrLooksCleanEnough,
} from "./quizNormalize.js";

describe("looksLikeQuizText", () => {
  it("detects numbered options and variant labels", () => {
    expect(
      looksLikeQuizText(
        "Какие требования в ЗРУ?\n1) Все перечисленное\n2) Только освещение",
      ),
    ).toBe(true);
    expect(looksLikeQuizText("Варианты ответа:\nа) да\nб) нет")).toBe(true);
    expect(looksLikeQuizText("Что такое электротравма?")).toBe(false);
  });
});

describe("parseNormalizedQuizJson", () => {
  it("parses plain and fenced JSON", () => {
    const raw = JSON.stringify({
      question: "Какие требования к месту присоединения в ЗРУ?",
      options: [
        { key: "1", text: "Все перечисленное" },
        { key: "2", text: "Только освещение" },
      ],
      scope: "ЗРУ",
      confidence: "ok",
      needs_clarification: false,
    });
    const quiz = parseNormalizedQuizJson(raw);
    expect(quiz?.question).toMatch(/ЗРУ/);
    expect(quiz?.options).toHaveLength(2);
    expect(quiz?.needs_clarification).toBe(false);
    expect(quiz?.formatted).toContain("1) Все перечисленное");
    expect(quiz?.formatted).toContain("Область: ЗРУ");

    const fenced = parseNormalizedQuizJson("```json\n" + raw + "\n```");
    expect(fenced?.options[0]?.text).toBe("Все перечисленное");
  });

  it("marks low confidence", () => {
    const quiz = parseNormalizedQuizJson(
      JSON.stringify({
        question: "Обрезанный вопрос",
        options: [],
        confidence: "low",
        needs_clarification: true,
      }),
    );
    expect(quiz?.needs_clarification).toBe(true);
    expect(quiz?.confidence).toBe("low");
  });

  it("does not block when question and options recovered despite low flag", () => {
    const quiz = parseNormalizedQuizJson(
      JSON.stringify({
        question: "Какие требования к месту присоединения в ЗРУ?",
        options: [
          { key: "1", text: "Все перечисленное" },
          { key: "2", text: "Только освещение" },
        ],
        confidence: "low",
        needs_clarification: true,
      }),
    );
    expect(quiz?.needs_clarification).toBe(false);
    expect(quiz?.confidence).toBe("ok");
  });
});

describe("quizOcrLooksCleanEnough", () => {
  it("skips LLM normalize for already clean MCQ OCR", () => {
    const clean =
      "Какие требования к месту присоединения переносного заземления в ЗРУ?\n" +
      "1) Все, что указано в других вариантах ответа.\n" +
      "2) Место должно освещаться лампами внутреннего освещения ЗРУ.\n" +
      "3) Только при наличии защитных средств.";
    expect(quizOcrLooksCleanEnough(clean)).toBe(true);
    expect(quizOcrLooksCleanEnough("Что такое электротравма?")).toBe(false);
  });
});

describe("formatNormalizedQuiz", () => {
  it("formats question and options", () => {
    const text = formatNormalizedQuiz({
      question: "Вопрос?",
      options: [{ key: "а", text: "первый" }],
      scope: null,
      confidence: "ok",
      needs_clarification: false,
    });
    expect(text).toBe("Вопрос?\nа) первый");
  });
});
