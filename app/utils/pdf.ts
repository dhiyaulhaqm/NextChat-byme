const PDF_MIME_TYPE = "application/pdf";
export const MAX_PDF_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_PDF_TEXT_LENGTH = 120_000;

export interface PdfTextExtraction {
  name: string;
  size: number;
  pages: number;
  text: string;
  warnings: string[];
}

type PdfTextContentItem = Awaited<
  ReturnType<import("pdfjs-dist").PDFPageProxy["getTextContent"]>
>["items"][number];
type PdfTextItem = Extract<
  PdfTextContentItem,
  { str: string; transform: number[] }
>;

function isPdfTextItem(item: PdfTextContentItem): item is PdfTextItem {
  return "str" in item && "transform" in item;
}

/** Rebuild reading lines from PDF.js text items so columns and tables are less flattened. */
export function formatPdfTextItems(items: PdfTextItem[]) {
  const orderedItems = items
    .filter((item) => item.str.trim())
    .map((item, index) => ({
      text: item.str.trim(),
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      index,
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x || a.index - b.index);
  const lines: { y: number; items: typeof orderedItems }[] = [];

  for (const item of orderedItems) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) < 2);
    if (line) {
      line.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) =>
      line.items
        .sort((a, b) => a.x - b.x || a.index - b.index)
        .map((item) => item.text)
        .join(" "),
    )
    .join("\n")
    .trim();
}

export function isPdfTextTruncated(text: string) {
  return text.length >= MAX_PDF_TEXT_LENGTH;
}

export function formatPdfPages(pages: string[]) {
  return pages
    .map((pageText, index) => `--- Page ${index + 1} ---\n${pageText}`)
    .join("\n\n")
    .trim();
}

export function getPdfPagesWithoutText(pages: string[]) {
  return pages.flatMap((pageText, index) =>
    pageText.trim() ? [] : [index + 1],
  );
}

export function limitPdfText(text: string) {
  return text.slice(0, MAX_PDF_TEXT_LENGTH);
}

export function formatPdfExtractionWarning(
  pagesWithoutText: number[],
  truncated: boolean,
) {
  const warnings: string[] = [];
  if (pagesWithoutText.length) {
    warnings.push(
      `No selectable text was found on page(s): ${pagesWithoutText.join(
        ", ",
      )}.`,
    );
  }
  if (truncated) {
    warnings.push(
      `Extracted text exceeded ${MAX_PDF_TEXT_LENGTH.toLocaleString()} characters and was truncated.`,
    );
  }
  return warnings.join(" ");
}

export function buildPdfReviewPrompt(
  userInput: string,
  extraction: PdfTextExtraction,
) {
  const warning = extraction.warnings.length
    ? `\n\n[PDF extraction note: ${extraction.warnings.join(" ")}]`
    : "";
  const academicReviewGuidance = [
    "Review this research document as a rigorous, constructive academic peer reviewer. Ground every substantive judgment in the document and cite page numbers whenever possible.",
    "Assess: (1) the research problem, objectives, research questions or hypotheses, and significance; (2) originality and contribution as presented in the document; (3) the theoretical or conceptual framework and relevance of the literature; (4) research design, sampling/data sources, instruments, procedures, and analysis; (5) whether results support the claims and conclusions; and (6) limitations, validity, bias, ethics, and reproducibility where the text provides evidence.",
    "Report a concise overall assessment, major strengths, major concerns with specific evidence and page references, minor or editorial issues, and prioritized actionable recommendations. Distinguish explicit facts from your interpretation. Do not invent missing details, citations, results, or page references; clearly state when an aspect cannot be evaluated from the extracted text. Note that tables, figures, and images may be incomplete or absent in the extraction.",
  ].join("\n");
  const taskInstruction = userInput.trim()
    ? `User's specific request: ${userInput.trim()}\n\nApply the request while retaining the evidence-based academic review standards below.`
    : "Use the following academic review standards:";
  return `${taskInstruction}\n${academicReviewGuidance}\n\n[PDF: ${extraction.name}, ${extraction.pages} page(s)]\n${extraction.text}${warning}`;
}

function isPdfName(name: string) {
  return name.toLowerCase().endsWith(".pdf");
}

export function validatePdfFile(file: File) {
  if (file.size === 0) {
    throw new Error("The PDF file is empty.");
  }
  if (file.size > MAX_PDF_FILE_SIZE) {
    throw new Error("PDF files must be 10 MB or smaller.");
  }
  if (file.type && file.type !== PDF_MIME_TYPE) {
    throw new Error("Please select a PDF file.");
  }
  if (!isPdfName(file.name)) {
    throw new Error("Please select a file with a .pdf extension.");
  }
}

async function hasPdfSignature(file: File) {
  const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return new TextDecoder().decode(header) === "%PDF-";
}

export async function extractPdfText(file: File): Promise<PdfTextExtraction> {
  validatePdfFile(file);
  if (!(await hasPdfSignature(file))) {
    throw new Error("The selected file is not a valid PDF.");
  }

  // PDF.js is loaded only when a PDF is selected so normal chat does not pay
  // the parser's bundle cost. The legacy build supports the browser and static
  // app environments used by this project.
  const { getDocument, GlobalWorkerOptions } = await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  );
  GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data }).promise;
  const pages: string[] = [];
  const pageCount = pdf.numPages;

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = formatPdfTextItems(
        textContent.items.filter(isPdfTextItem),
      );
      pages.push(pageText);
    }
  } finally {
    await pdf.destroy();
  }

  const fullText = formatPdfPages(pages);

  if (!fullText) {
    throw new Error(
      "No selectable text was found. Scanned PDFs require OCR and are not supported yet.",
    );
  }

  const warnings = formatPdfExtractionWarning(
    getPdfPagesWithoutText(pages),
    isPdfTextTruncated(fullText),
  );
  const limitedText = limitPdfText(fullText);

  return {
    name: file.name,
    size: file.size,
    pages: pageCount,
    text: limitedText,
    warnings: warnings ? [warnings] : [],
  };
}
