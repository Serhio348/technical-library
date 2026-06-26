import { describe, expect, it } from "vitest";
import { assessPdfIndexStatus, resolveIndexDisplay } from "./indexStatus";

describe("assessPdfIndexStatus", () => {
  it("marks full OCR as ready", () => {
    const result = assessPdfIndexStatus(
      {
        text: "body ".repeat(500),
        extractor: "tesseract-ocr",
        confidence: 0.65,
        pages: Array.from({ length: 100 }, (_, i) => ({ page: i + 1, text: "x" })),
        source_pages: 100,
      },
      150,
    );
    expect(result.index_status).toBe("ready");
  });

  it("marks truncated OCR as partial", () => {
    const result = assessPdfIndexStatus(
      {
        text: "body ".repeat(500),
        extractor: "tesseract-ocr",
        confidence: 0.65,
        pages: Array.from({ length: 80 }, (_, i) => ({ page: i + 1, text: "x" })),
        source_pages: 120,
      },
      80,
    );
    expect(result.index_status).toBe("partial");
    expect(result.index_note).toContain("80");
  });

  it("marks pdf-parse on large manual as partial", () => {
    const toc =
      "1. INTRO 1 2. PARAMS 35 3. CODES 94 ".repeat(20) +
      "Chapter 7 Parameter table page 35 Chapter 8 codes page 94";
    const result = assessPdfIndexStatus(
      {
        text: toc,
        extractor: "pdf-parse",
        confidence: 0.8,
        pages: null,
        source_pages: 100,
      },
      80,
    );
    expect(result.index_status).toBe("partial");
  });
});

describe("resolveIndexDisplay", () => {
  it("uses stored index_status when present", () => {
    expect(
      resolveIndexDisplay(
        { index_status: "partial", index_note: "test", extractor: "pdf-parse" },
        true,
        null,
      ).text_index_status,
    ).toBe("partial");
  });

  it("infers partial for legacy pdf-parse without index_status", () => {
    expect(
      resolveIndexDisplay({ extractor: "pdf-parse", chars: 10000 }, true, null).text_index_status,
    ).toBe("partial");
  });
});
