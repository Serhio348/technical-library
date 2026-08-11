import { describe, expect, it } from "vitest";
import { mergeTablesIntoPages } from "./pdfTables.js";

describe("pdfTables merge", () => {
  it("appends appendix when pages are missing", () => {
    const merged = mergeTablesIntoPages(null, [{ page: 3, markdown: "| X | Y |\n| --- | --- |\n| a | b |" }], "Текст");
    expect(merged.text).toContain("стр. 3");
    expect(merged.text).toContain("| a | b |");
  });
});
