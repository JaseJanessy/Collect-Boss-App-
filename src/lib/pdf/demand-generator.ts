/**
 * Versioned payment-notice PDF generator for the legacy formal-demand route.
 * Uses jsPDF (dynamic import) — browser-only, no SSR.
 *
 * SAFETY:
 * - No threats, no harassment, no fake legal identities
 * - No blacklist / CCRIS / CTOS claims
 * - No fake court warnings
 * - Always includes the legal disclaimer
 */

import { brandPdfColors } from "../brand/pdf-theme.ts";

export interface DemandPdfData {
  caseId:        string;
  businessName:  string;
  tone:          "standard" | "firm" | "final";
  deadlineDays:  number;
  deadlineDate:  string;
  today:         string;
  draftText:     string; // full pre-built draft text
  documentNumber?: string | null;
  templateVersion?: number;
}

// ─── Main generator ────────────────────────────────────────────────────────────

export async function generateDemandPdf(data: DemandPdfData): Promise<Blob> {
  const { jsPDF } = await import("jspdf");

  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });

  const W  = 210;
  const H  = 297;
  const ML = 20;
  const MR = 20;
  const MB = 20;
  const CW = W - ML - MR;

  let y = 20;

  const guard = (need: number) => {
    if (y + need > H - MB) {
      doc.addPage();
      y = 20;
      addFooter(doc.getNumberOfPages());
    }
  };

  const addFooter = (n: number) => {
    const saved = doc.getCurrentPageInfo().pageNumber;
    doc.setPage(n);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(180, 180, 180);
    doc.text(
      `${(data.templateVersion ?? 1) < 2 ? "Formal Demand" : "Payment Notice"} · ${data.caseId} · Page ${n} · CollectBoss`,
      W / 2, H - 8, { align: "center" }
    );
    doc.setPage(saved);
  };

  // ── Header bar ─────────────────────────────────────────────────────────────
  doc.setFillColor(...brandPdfColors.navy);
  doc.rect(0, 0, W, 18, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setFillColor(...brandPdfColors.surface);
  doc.roundedRect(ML - 2, 3, 43, 13, 1, 1, "F");
  doc.setTextColor(...brandPdfColors.navy);
  const collectW = doc.getTextWidth("Collect");
  doc.text("Collect", ML, 12);
  doc.setTextColor(...brandPdfColors.green);
  doc.text("Boss", ML + collectW, 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(180, 210, 230);
  const toneLabelMap: Record<string, string> = (data.templateVersion ?? 1) < 2 ? {
    standard: "Formal Payment Notice",
    firm:     "Formal Demand Notice",
    final:    "Final Notice of Outstanding Payment",
  } : {
    standard: "Formal Payment Reminder",
    firm:     "Firm Payment Reminder",
    final:    "Final Payment Notice",
  };
  doc.text(toneLabelMap[data.tone] ?? "Payment Notice", W - MR, 12, { align: "right" });

  y = 26;

  // ── Date / Reference ───────────────────────────────────────────────────────
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text(`Date: ${data.today}`, ML, y);
  doc.text(`Reference: ${data.documentNumber ?? data.caseId}`, ML + CW, y, { align: "right" });
  y += 5;

  doc.setDrawColor(229, 231, 235);
  doc.line(ML, y, ML + CW, y);
  y += 8;

  // ── Body text ──────────────────────────────────────────────────────────────
  const lines = data.draftText.split("\n");
  for (const raw of lines) {
    const line = raw.trimEnd();

    // Section headings (ALL CAPS lines)
    if (line.toUpperCase() === line && line.trim().length > 4 && !line.startsWith(" ")) {
      guard(10);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...brandPdfColors.navy);
      doc.text(line, ML, y);
      y += 6;
    } else if (line.trim() === "") {
      y += 3.5;
    } else {
      guard(6);
      // Detect "To:" / "RE:" prefix lines
      const isMeta = /^(To:|RE:|Re:|Reference:|Date:)/.test(line.trim());
      doc.setFont("helvetica", isMeta ? "bold" : "normal");
      doc.setFontSize(9);
      doc.setTextColor(isMeta ? 13 : 55, isMeta ? 27 : 65, isMeta ? 61 : 81);

      const wrapped = doc.splitTextToSize(line, CW);
      for (const wl of wrapped) {
        guard(5.5);
        doc.text(wl, ML, y);
        y += 5;
      }
    }
  }

  // ── Disclaimer box ─────────────────────────────────────────────────────────
  guard(22);
  y += 6;
  doc.setFillColor(242, 244, 247);
  doc.roundedRect(ML, y, CW, 17, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(107, 114, 128);
  doc.text("DISCLAIMER", ML + 3, y + 5);
  doc.setFont("helvetica", "normal");
  const disclaimer = (data.templateVersion ?? 1) < 2
    ? "CollectBoss helps prepare document drafts based on your case records. This is not legal advice. Please consult a qualified lawyer before taking legal action."
    : "CollectBoss prepares a factual payment-notice draft from creditor records. It is not a law firm, does not provide legal advice, and gives this document no lawyer or court authority. Obtain qualified legal review before legal action.";
  const dLines = doc.splitTextToSize(disclaimer, CW - 6);
  doc.text(dLines, ML + 3, y + 10);
  y += 22;

  // Add footers to all pages
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) addFooter(i);

  return doc.output("blob");
}
