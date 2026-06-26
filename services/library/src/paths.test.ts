import { describe, expect, it } from "vitest";
import { isAllowedFilename, isValidRelativePath, isValidSlug, resolveUnderRoot, safeLibraryFilename } from "./paths";

describe("library paths", () => {
  it("validates slugs", () => {
    expect(isValidSlug("osmos-sidorovich")).toBe(true);
    expect(isValidSlug("../x")).toBe(false);
  });

  it("blocks path traversal", () => {
    expect(() => resolveUnderRoot("/tmp", "osmos-a", "../secret")).toThrow();
  });

  it("allows known extensions", () => {
    expect(isAllowedFilename("manual.pdf")).toBe(true);
    expect(isAllowedFilename("virus.exe")).toBe(false);
  });

  it("validates relative paths", () => {
    expect(isValidRelativePath("")).toBe(true);
    expect(isValidRelativePath("registr/manual.pdf")).toBe(true);
    expect(isValidRelativePath("../x")).toBe(false);
  });

  it("decodes mojibake UTF-8 filenames from multipart headers", () => {
    const mojibake = Buffer.from("Паспорт.pdf", "utf8").toString("latin1");
    expect(safeLibraryFilename(mojibake)).toBe("Паспорт.pdf");
  });
});
