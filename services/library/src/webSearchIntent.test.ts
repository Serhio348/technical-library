import { describe, expect, it } from "vitest";
import { decideWebSearch } from "./webSearchIntent.js";

describe("decideWebSearch", () => {
  it("never triggers in library mode", () => {
    expect(decideWebSearch("погугли курс доллара", { mode: "library" }).use).toBe(false);
    expect(decideWebSearch("погода сегодня", { mode: "library" }).reason).toBe("library_mode");
  });

  it("triggers on explicit web request", () => {
    const d = decideWebSearch("Найди в интернете последние изменения ПТЭ");
    expect(d.use).toBe(true);
    expect(d.reason).toBe("explicit_web_request");
  });

  it("triggers on google/погугли aliases", () => {
    expect(decideWebSearch("погугли кто президент Франции").use).toBe(true);
    expect(decideWebSearch("загугли это").use).toBe(true);
  });

  it("triggers on freshness markers", () => {
    expect(decideWebSearch("Какая погода сегодня в Минске?").use).toBe(true);
    expect(decideWebSearch("Актуальный курс доллара сейчас").use).toBe(true);
    expect(decideWebSearch("какие новости по энергетике").reason).toBe("freshness_markers");
  });

  it("triggers on current or future year", () => {
    const year = new Date().getFullYear();
    const d = decideWebSearch(`Что изменилось в ТКП в ${year} году?`);
    expect(d.use).toBe(true);
    expect(d.reason).toBe("current_or_future_year");
  });

  it("skips ordinary knowledge questions", () => {
    const d = decideWebSearch("Что такое электротравма?");
    expect(d.use).toBe(false);
    expect(d.reason).toBe("knowledge_sufficient");
  });

  it("skips short clarifications without freshness", () => {
    expect(decideWebSearch("а подробнее").use).toBe(false);
    expect(decideWebSearch("почему").use).toBe(false);
  });

  it("respects force flag", () => {
    expect(decideWebSearch("что угодно", { force: true }).reason).toBe("forced");
  });
});
