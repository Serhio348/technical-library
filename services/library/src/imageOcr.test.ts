import { describe, expect, it } from "vitest";
import { isPhotoOcrUsable, scorePhotoOcrQuality, stripMisdetectedScripts } from "./imageOcr.js";

describe("photo OCR cleanup", () => {
  it("removes misdetected CJK characters", () => {
    expect(stripMisdetectedScripts("Какой 答案 вариант правильный?")).toBe("Какой  вариант правильный?");
  });

  it("scores russian text higher than hieroglyph garbage", () => {
    const good = "Какие требования к давлению на входе установки? 1) 2,5 бар 2) 4,0 бар";
    const bad = "工力エ問 фыва 漢字 テスト";
    expect(scorePhotoOcrQuality(good)).toBeGreaterThan(scorePhotoOcrQuality(bad));
  });

  it("rejects unusable OCR output", () => {
    expect(isPhotoOcrUsable("工力漢字テスト")).toBe(false);
    expect(isPhotoOcrUsable("аЦИ падает! се т")).toBe(false);
    expect(isPhotoOcrUsable("Какой вариант ответа верный?")).toBe(false);
    const quiz =
      "Вопрос № 5 из 23\nРазрешается ли надевать, снимать и поправлять на ходу приводные ремни теплоустановок?\n" +
      "1. Разрешается при использовании защитных рукавиц.\n2. Не разрешается.";
    expect(isPhotoOcrUsable(quiz)).toBe(true);
  });
});
