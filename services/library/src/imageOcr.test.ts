import { describe, expect, it } from "vitest";
import {
  cleanupPhotoOcrText,
  isGarbageOcrLine,
  isPhotoOcrUsable,
  scorePhotoOcrQuality,
  stripMisdetectedScripts,
} from "./imageOcr.js";

describe("photo OCR cleanup", () => {
  it("removes misdetected CJK characters", () => {
    expect(stripMisdetectedScripts("Какой 答案 вариант правильный?")).toBe("Какой  вариант правильный?");
  });

  it("scores russian text higher than hieroglyph garbage", () => {
    const good = "Какие требования к давлению на входе установки? 1) 2,5 бар 2) 4,0 бар";
    const bad = "工力エ問 фыва 漢字 テスト";
    expect(scorePhotoOcrQuality(good)).toBeGreaterThan(scorePhotoOcrQuality(bad));
  });

  it("strips watermark and latin garbage lines from phone OCR", () => {
    const messy = [
      "МО 1762 02605 ГЕ Ели титаиний нана",
      "Бесплатная лицензия (для непрофессионального использования) ехох эвовов",
      "Технические мероприятия при работах со снятием напряжения",
      "Вопрос № 3 из 20",
      "Токоведущие части электроустановки были заземлены со всех сторон?",
      "Варианты ответа:",
      "1. Когда эти части могут оказаться под наведенным напряжением (потенциалом).",
      "= == ЕЕ Ее ВОН",
    ].join("\n");

    const cleaned = cleanupPhotoOcrText(messy);
    expect(cleaned).not.toMatch(/Бесплатная лицензия/i);
    expect(cleaned).not.toMatch(/ехох эвовов/i);
    expect(cleaned).toMatch(/Вопрос № 3/i);
    expect(cleaned).toMatch(/Токоведущие части/i);
    expect(cleaned).toMatch(/наведенным напряжением/i);
    expect(isGarbageOcrLine("= == ЕЕ Ее ВОН")).toBe(true);
  });

  it("rejects unusable OCR output", () => {
    expect(isPhotoOcrUsable("工力漢字テスト")).toBe(false);
    expect(isPhotoOcrUsable("аЦИ падает! се т")).toBe(false);
    expect(isPhotoOcrUsable("Какой вариант ответа верный?")).toBe(false);
    const watermarkNoise =
      "МО 1762 ГЕ Ели титаиний\nБесплатная лицензия (для непрофессионального использования)\nехох эвовов у = ео]";
    expect(isPhotoOcrUsable(watermarkNoise)).toBe(false);

    const quiz =
      "Вопрос № 5 из 23\nРазрешается ли надевать, снимать и поправлять на ходу приводные ремни теплоустановок?\n" +
      "1. Разрешается при использовании защитных рукавиц.\n2. Не разрешается.";
    expect(isPhotoOcrUsable(quiz)).toBe(true);
  });

  it("accepts cleaned quiz with leftover noise filtered", () => {
    const messyQuiz = [
      "Бесплатная лицензия (для непрофессионального использования)",
      "Вопрос № 3 из 20",
      "Токоведущие части электроустановки были заземлены со всех сторон на рабочем месте?",
      "Варианты ответа:",
      "1. Когда эти части могут оказаться под наведенным напряжением (потенциалом).",
      "2. Требуется во всех указанных случаях.",
    ].join("\n");
    const cleaned = cleanupPhotoOcrText(messyQuiz);
    expect(isPhotoOcrUsable(cleaned)).toBe(true);
    expect(scorePhotoOcrQuality(cleaned)).toBeGreaterThan(scorePhotoOcrQuality(messyQuiz) - 5);
  });
});
