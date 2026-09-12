import "server-only";

import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractionConfig } from "./config";
import type { ExtractedLine, NativePdfExtraction } from "./types";

type PdfTextItem = { str: string; transform: number[]; width: number; height: number };

function isTextItem(value: unknown): value is PdfTextItem {
  return Boolean(value && typeof value === "object" && "str" in value && "transform" in value);
}

export async function extractNativePdfText(bytes: Uint8Array): Promise<NativePdfExtraction> {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const document = await task.promise;
  try {
    const pages = [];
    let rawCharacterCount = 0;
    const pageLimit = Math.min(document.numPages, extractionConfig.maxPages);
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
      const lines: ExtractedLine[] = [];
      for (const value of content.items) {
        if (!isTextItem(value) || !value.str.trim()) continue;
        lines.push({
          text: value.str,
          confidence: 1,
          boundingBox: {
            x: value.transform[4],
            y: value.transform[5],
            width: Math.max(0, value.width),
            height: Math.max(0, value.height),
          },
        });
      }
      const text = lines.map((line) => line.text).join(" ").replace(/\s+/gu, " ").trim();
      rawCharacterCount += text.replace(/\s/gu, "").length;
      pages.push({ page: pageNumber, imageId: null, text, lines });
    }
    return {
      pageCount: document.numPages,
      pages,
      rawCharacterCount,
      usable: rawCharacterCount >= extractionConfig.minimumNativeTextCharacters,
    };
  } finally {
    await task.destroy();
  }
}

export async function renderPdfPagesToPng(bytes: Uint8Array, pages: readonly number[]): Promise<Array<{ page: number; bytes: Uint8Array }>> {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const document = await task.promise;
  try {
    const rendered = [];
    for (const pageNumber of pages) {
      if (pageNumber < 1 || pageNumber > document.numPages) continue;
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      rendered.push({ page: pageNumber, bytes: new Uint8Array(await canvas.encode("png")) });
    }
    return rendered;
  } finally {
    await task.destroy();
  }
}
