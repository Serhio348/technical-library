import { describe, expect, it } from "vitest";
import {
  catalogEntryMatchesAlias,
  catalogEntryMatchesPath,
  inferCatalogEntry,
} from "./documentCatalog.js";

describe("documentCatalog", () => {
  it("infers law from filename", () => {
    const entry = inferCatalogEntry("gas/ФЗ-123 газоснабжение.pdf");
    expect(entry.doc_type).toBe("law");
  });

  it("infers standard from GOST filename", () => {
    const entry = inferCatalogEntry("electro/ГОСТ 12345-2020.pdf");
    expect(entry.doc_type).toBe("standard");
  });

  it("infers classifier", () => {
    const entry = inferCatalogEntry("buhgalteriya/Классификатор ОКОФ.pdf");
    expect(entry.doc_type).toBe("classifier");
    expect(entry.aliases).toContain("классификатор");
  });

  it("matches path and alias filters", () => {
    const entry = inferCatalogEntry("ohrana-truda/Инструкция по СИЗ.pdf");
    expect(catalogEntryMatchesPath(entry, "Инструкция по СИЗ.pdf")).toBe(true);
    expect(catalogEntryMatchesAlias(entry, "инструкция")).toBe(true);
  });
});
