import { describe, expect, it } from "vitest";
import { ensureUniqueSlug, slugFromTitle } from "./slugify.js";

describe("slugFromTitle", () => {
  it("transliterates Russian", () => {
    expect(slugFromTitle("Газоснабжение")).toBe("gazosnabzhenie");
    expect(slugFromTitle("Охрана труда")).toBe("ohrana-truda");
  });

  it("keeps Latin words", () => {
    expect(slugFromTitle("Electro 2024")).toBe("electro-2024");
  });

  it("falls back for empty input", () => {
    expect(slugFromTitle("   ")).toBe("napravlenie");
  });
});

describe("ensureUniqueSlug", () => {
  it("appends suffix when taken", () => {
    expect(ensureUniqueSlug("Газ", ["gaz", "gaz-2"])).toBe("gaz-3");
  });
});
