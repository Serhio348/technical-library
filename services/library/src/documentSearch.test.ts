import { describe, expect, it } from "vitest";
import { buildDocumentContext, documentMatchesQuery, queryTerms } from "./documentSearch";
import {
  countCyrillicChars,
  looksLikeTocHeavyText,
  needsOcrFallback,
  scoreExtractionQuality,
} from "./pdfExtract";

describe("pdf OCR quality gate", () => {
  it("requests OCR for empty or very short text", () => {
    expect(needsOcrFallback(null)).toBe(true);
    expect(needsOcrFallback("")).toBe(true);
    expect(needsOcrFallback("short text")).toBe(true);
  });

  it("keeps pdf-parse path for sufficient russian text", () => {
    const russian =
      "Установка обратного осмоса EBC. Производительность пермеата 1,2 м3/ч. Давление на входе 2,5-4,0 бар. " +
      "Режим промывки мембран при проводимости выше 450 мкСм/см.";
    expect(countCyrillicChars(russian)).toBeGreaterThan(20);
    expect(needsOcrFallback(russian)).toBe(false);
  });

  it("detects table-of-contents-only text", () => {
    const toc =
      "1. ВВЕДЕНИЕ 1 2. НАЗНАЧЕНИЕ 2 3. ТЕХНИЧЕСКИЕ ХАРАКТЕРИСТИКИ 3 4. КОМПЛЕКТАЦИЯ 4 " +
      "5. МОНТАЖ 5 6. ЭКСПЛУАТАЦИЯ 6 7. ТЕХОБСЛУЖИВАНИЕ 7 8. ПОРЯДОК МОНТАЖА И ПУСКОНАЛАДОЧНЫХ РАБОТ 8 " +
      "9. БЕЗОПАСНОСТЬ 9 10. ИЗВЛЕЧЕНИЕ ЭЛЕМЕНТОВ 10";
    expect(looksLikeTocHeavyText(toc, 30)).toBe(true);
    expect(needsOcrFallback(toc, 30)).toBe(true);
  });
});

describe("scoreExtractionQuality", () => {
  it("prefers body text over toc-only layer", () => {
    const toc =
      "1. ВВЕДЕНИЕ 1 2. НАЗНАЧЕНИЕ 2 8. ПОРЯДОК МОНТАЖА И ПУСКОНАЛАДОЧНЫХ РАБОТ 8 10. ИЗВЛЕЧЕНИЕ ЭЛЕМЕНТОВ 10";
    const body =
      "8. Порядок монтажа и пусконаладочных работ. Перед первым запуском проверьте давление на входе. " +
      "Откройте кран подачи воды. Запустите насос высокого давления. Контролируйте проводимость пермеата. ".repeat(
        20,
      );
    expect(scoreExtractionQuality(body, 30)).toBeGreaterThan(scoreExtractionQuality(toc, 30));
  });
});

describe("documentSearch", () => {
  it("expands startup query terms", () => {
    const terms = queryTerms("Как произвести первый запуск установки?");
    expect(terms.some((t) => t.includes("пуск"))).toBe(true);
  });

  it("ranks pages by query", () => {
    const pages = [
      { page: 1, text: "Оглавление 8. Пусконаладочные работы 8" },
      { page: 12, text: "Первый запуск. Откройте кран. Запустите насос. Проверьте давление." },
    ];
    const ctx = buildDocumentContext(
      pages.map((p) => p.text).join("\n\n"),
      "первый запуск установки",
      80,
      pages,
    );
    expect(ctx).toContain("[стр. 12]");
    expect(ctx).toContain("Первый запуск");
  });

  it("matches documents by expanded terms", () => {
    expect(
      documentMatchesQuery(
        "Раздел про пусконаладочные работы",
        "Паспорт ОО.pdf",
        "первый запуск",
      ),
    ).toBe(true);
  });
});
