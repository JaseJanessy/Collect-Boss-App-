import { describe, expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";

vi.mock("server-only", () => ({}));

import { extractNativePdfText } from "@/lib/document-intake/extraction/pdf";

describe("native PDF text extraction", () => {
  it("preserves page boundaries and text coordinates", async () => {
    const document = new jsPDF();
    document.text("CollectBoss Invoice MYR 125.50", 20, 20);
    document.addPage();
    document.text("Reference INV12345", 20, 20);
    const extracted = await extractNativePdfText(new Uint8Array(document.output("arraybuffer")));
    expect(extracted.pageCount).toBe(2);
    expect(extracted.pages[0].text).toContain("CollectBoss Invoice");
    expect(extracted.pages[1].text).toContain("INV12345");
    expect(extracted.pages[0].lines[0].boundingBox).toBeDefined();
    expect(extracted.usable).toBe(true);
  });
});

