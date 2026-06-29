import { describe, expect, it } from "vitest";
import {
  isAskAttachmentFilename,
  isAskAttachmentTextUsable,
  isImageAttachmentFilename,
} from "./attachmentExtract.js";

describe("ask attachment helpers", () => {
  it("recognizes supported filenames", () => {
    expect(isAskAttachmentFilename("test.docx")).toBe(true);
    expect(isAskAttachmentFilename("test.doc")).toBe(true);
    expect(isAskAttachmentFilename("test.pdf")).toBe(true);
    expect(isAskAttachmentFilename("test.exe")).toBe(false);
    expect(isImageAttachmentFilename("photo.jpg")).toBe(true);
  });

  it("validates extracted document text", () => {
    const quiz =
      "Вопрос № 5 из 23\nРазрешается ли надевать, снимать и поправлять на ходу приводные ремни теплоустановок?\n" +
      "1. Разрешается при использовании защитных рукавиц.\n2. Не разрешается.";
    expect(isAskAttachmentTextUsable(quiz, "question.docx")).toBe(true);
    expect(isAskAttachmentTextUsable("short", "question.docx")).toBe(false);
  });
});
