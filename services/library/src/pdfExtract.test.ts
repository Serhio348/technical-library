import { describe, expect, it } from "vitest";
import { countCyrillicChars, looksLikeTocHeavyText, needsOcrFallback, scoreExtractionQuality } from "./pdfExtract";

describe("pdf OCR quality gate", () => {
  it("requests OCR for empty or very short text", () => {
    expect(needsOcrFallback(null)).toBe(true);
    expect(needsOcrFallback("")).toBe(true);
    expect(needsOcrFallback("short text")).toBe(true);
  });

  it("requests OCR when text is long but almost without cyrillic", () => {
    const latinOnly = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(4);
    expect(countCyrillicChars(latinOnly)).toBe(0);
    expect(needsOcrFallback(latinOnly)).toBe(true);
  });

  it("keeps pdf-parse path for sufficient russian text", () => {
    const russian =
      "Установка обратного осмоса EBC. Производительность пермеата 1,2 м3/ч. Давление на входе 2,5-4,0 бар. " +
      "Режим промывки мембран при проводимости выше 450 мкСм/см.";
    expect(countCyrillicChars(russian)).toBeGreaterThan(20);
    expect(needsOcrFallback(russian)).toBe(false);
  });

  it("requests OCR when text layer is sparse relative to page count", () => {
    const sparse =
      "1. ВВЕДЕНИЕ 3 2. НАЗНАЧЕНИЕ 4 3. ТЕХНИЧЕСКИЕ ХАРАКТЕРИСТИКИ 5 4. КОМПЛЕКТАЦИЯ 6 5. МОНТАЖ 7";
    expect(needsOcrFallback(sparse, 40)).toBe(true);
  });

  it("detects table-of-contents-only text", () => {
    const toc =
      "1. ВВЕДЕНИЕ 1 2. НАЗНАЧЕНИЕ 2 3. ТЕХНИЧЕСКИЕ ХАРАКТЕРИСТИКИ 3 4. КОМПЛЕКТАЦИЯ 4 " +
      "5. МОНТАЖ 5 6. ЭКСПЛУАТАЦИЯ 6 7. ТЕХОБСЛУЖИВАНИЕ 7 8. ПОРЯДОК МОНТАЖА И ПУСКОНАЛАДОЧНЫХ РАБОТ 8 " +
      "9. БЕЗОПАСНОСТЬ 9 10. ИЗВЛЕЧЕНИЕ ЭЛЕМЕНТОВ 10";
    expect(looksLikeTocHeavyText(toc, 30)).toBe(true);
    expect(needsOcrFallback(toc, 30)).toBe(true);
  });

  it("scores body text higher than toc-only layer", () => {
    const toc = "8. ПОРЯДОК МОНТАЖА 8 10. ИЗВЛЕЧЕНИЕ 10";
    const body = "Первый запуск. Проверьте давление. Запустите насос. ".repeat(30);
    expect(scoreExtractionQuality(body, 20)).toBeGreaterThan(scoreExtractionQuality(toc, 20));
  });
});
