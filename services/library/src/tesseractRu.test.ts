import { describe, expect, it } from "vitest";
import { layoutTextFromTesseractTsv, sanitizeRuOcrText } from "./tesseractRu.js";
import { mergeTablesIntoPages } from "./pdfTables.js";

describe("sanitizeRuOcrText", () => {
  it("removes CJK and other misdetected scripts", () => {
    expect(sanitizeRuOcrText("Какой 答案 вариант правильный?")).toBe("Какой  вариант правильный?");
    expect(sanitizeRuOcrText("工力エ問 фыва 漢字 テスト")).toBe(" фыва  ");
  });

  it("keeps russian quiz punctuation", () => {
    const quiz = "Вопрос № 5: 1) 2,5 бар; 2) «не разрешается».";
    expect(sanitizeRuOcrText(quiz)).toBe(quiz);
  });

  it("keeps table markdown characters", () => {
    const table = "| Параметр | Значение |\n| --- | --- |\n| P | 2,5 |";
    expect(sanitizeRuOcrText(table)).toBe(table);
  });
});

describe("layoutTextFromTesseractTsv", () => {
  it("reconstructs column gaps from word coordinates", () => {
    const tsv = [
      "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
      "5\t1\t1\t1\t1\t1\t10\t10\t40\t20\t90\tИмя",
      "5\t1\t1\t1\t1\t2\t200\t10\t60\t20\t88\tЗначение",
      "5\t1\t1\t1\t2\t1\t10\t40\t40\t20\t91\tДавление",
      "5\t1\t1\t1\t2\t2\t200\t40\t40\t20\t92\t2.5",
    ].join("\n");
    const text = layoutTextFromTesseractTsv(tsv);
    expect(text).toContain("Имя");
    expect(text).toContain("Значение");
    expect(text.split("\n")[0]).toMatch(/Имя\s{2,}Значение/);
    expect(text.split("\n")[1]).toMatch(/Давление\s{2,}2\.5/);
  });
});

describe("mergeTablesIntoPages", () => {
  it("appends markdown tables to matching pages", () => {
    const merged = mergeTablesIntoPages(
      [{ page: 2, text: "Глава про параметры." }],
      [{ page: 2, markdown: "| A | B |\n| --- | --- |\n| 1 | 2 |" }],
      "Глава про параметры.",
    );
    expect(merged.pages?.[0]?.text).toContain("[таблица 1]");
    expect(merged.pages?.[0]?.text).toContain("| A | B |");
    expect(merged.text).toContain("| 1 | 2 |");
  });
});
