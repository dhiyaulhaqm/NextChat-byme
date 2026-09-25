import {
  buildPdfReviewPrompt,
  formatPdfExtractionWarning,
  formatPdfPages,
  formatPdfTextItems,
  getPdfPagesWithoutText,
  isPdfTextTruncated,
  limitPdfText,
  MAX_PDF_TEXT_LENGTH,
} from "../app/utils/pdf";

describe("PDF text extraction helpers", () => {
  test("rebuilds lines in reading order while keeping table row content together", () => {
    const text = formatPdfTextItems([
      { str: "Value B", dir: "ltr", width: 40, height: 10, transform: [1, 0, 0, 1, 120, 90], fontName: "Helvetica", hasEOL: false },
      { str: "Header A", dir: "ltr", width: 50, height: 10, transform: [1, 0, 0, 1, 10, 100], fontName: "Helvetica", hasEOL: false },
      { str: "Value A", dir: "ltr", width: 40, height: 10, transform: [1, 0, 0, 1, 10, 90], fontName: "Helvetica", hasEOL: false },
      { str: "Header B", dir: "ltr", width: 50, height: 10, transform: [1, 0, 0, 1, 120, 100], fontName: "Helvetica", hasEOL: false },
      { str: "Next line", dir: "ltr", width: 60, height: 10, transform: [1, 0, 0, 1, 10, 80], fontName: "Helvetica", hasEOL: false },
    ]);

    expect(text).toBe("Header A Header B\nValue A Value B\nNext line");
  });

  test("marks pages without extractable text", () => {
    expect(getPdfPagesWithoutText(["text", "  ", "more text"])).toEqual([2]);
    expect(formatPdfExtractionWarning([2, 4], false)).toContain("2, 4");
  });

  test("detects and limits oversized extracted text", () => {
    const text = "x".repeat(MAX_PDF_TEXT_LENGTH + 3);
    expect(isPdfTextTruncated(text)).toBe(true);
    expect(limitPdfText(text)).toHaveLength(MAX_PDF_TEXT_LENGTH);
    expect(formatPdfExtractionWarning([], true)).toContain("truncated");
  });

  test("adds page markers and a useful default review request", () => {
    const extraction = {
      name: "thesis.pdf",
      size: 100,
      pages: 2,
      text: formatPdfPages(["Chapter one", "Chapter two"]),
      warnings: ["No selectable text was found on page(s): 2."],
    };
    const prompt = buildPdfReviewPrompt("", extraction);

    expect(prompt).toContain("academic peer reviewer");
    expect(prompt).toContain("research design");
    expect(prompt).toContain("page references");
    expect(prompt).toContain("Do not invent missing details");
    expect(prompt).toContain("--- Page 1 ---");
    expect(prompt).toContain("--- Page 2 ---");
    expect(prompt).toContain("No selectable text");
  });

  test("keeps a user's specific request while adding academic review standards", () => {
    const extraction = {
      name: "thesis.pdf",
      size: 100,
      pages: 1,
      text: formatPdfPages(["Study content"]),
      warnings: [],
    };
    const prompt = buildPdfReviewPrompt("Focus on the sampling method", extraction);

    expect(prompt).toContain("Focus on the sampling method");
    expect(prompt).toContain("academic peer reviewer");
    expect(prompt).toContain("sampling/data sources");
  });
});
