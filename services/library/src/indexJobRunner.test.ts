import { describe, expect, it } from "vitest";
import { indexJobScopeForFiles } from "./indexJobRunner.js";

describe("indexJobScopeForFiles", () => {
  it("uses file path for a single file", () => {
    expect(indexJobScopeForFiles("tkp", ["tkp/doc.pdf"])).toBe("tkp/doc.pdf");
  });

  it("uses unique batch scope for multiple files", () => {
    const scope = indexJobScopeForFiles("tkp", ["tkp/a.pdf", "tkp/b.pdf"]);
    expect(scope).toMatch(/^tkp@batch-[a-f0-9]{8}$/);
  });
});
