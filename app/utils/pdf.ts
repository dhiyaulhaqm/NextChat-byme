const PDF_MIME_TYPE = "application/pdf";
export const MAX_PDF_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_PDF_TEXT_LENGTH = 120_000;

export interface PdfTextExtraction {
  name: string;
  size: number;
  pages: number;
  text: string;
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
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data }).promise;
  const pages: string[] = [];
  const pageCount = pdf.numPages;

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .trim();
      pages.push(pageText);
    }
  } finally {
    await pdf.destroy();
  }

  const text = pages
    .map((pageText, index) => `--- Page ${index + 1} ---\n${pageText}`)
    .join("\n\n")
    .trim();

  if (!text) {
    throw new Error(
      "No selectable text was found. Scanned PDFs require OCR and are not supported yet.",
    );
  }

  return {
    name: file.name,
    size: file.size,
    pages: pageCount,
    text: text.slice(0, MAX_PDF_TEXT_LENGTH),
  };
}
