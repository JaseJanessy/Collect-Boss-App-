/**
 * Small Claim Pack PDF Generator.
 * Uses jsPDF (dynamic import) — browser-only, no SSR.
 *
 * SAFETY:
 * - No legal guarantees, no fake court submission
 * - No threatening language, no harassment
 * - Always includes disclaimer
 */

export interface SmallClaimCheckItem {
  id:    string;
  label: string;
  done:  boolean;
}

export interface SmallClaimPdfData {
  caseId:           string;
  businessName:     string;
  today:            string;
  // Debtor
  debtorName:       string;
  debtorCompany:    string | null;
  debtorRegNo:      string | null;
  debtorPhone:      string | null;
  debtorEmail:      string | null;
  debtorLocation:   string | null;
  // Financials
  amountOwed:       number;
  amountPaid:       number;
  balance:          number;
  dueDate:          string;
  invoiceNo:        string | null;
  daysOverdue:      number;
  isEligible:       boolean;
  // Readiness
  checklist:        SmallClaimCheckItem[];
  readinessStatus:  "not_ready" | "almost_ready" | "ready";
  readinessPct:     number;
  // History
  reminderCount:    number;
  paymentCount:     number;
  hasEvidencePack:  boolean;
  hasFormalDemand:  boolean;
  hasPaymentPlan:   boolean;
  hasAcknowledgement: boolean;
  // Timeline
  timeline:         Array<{ date: string; event: string }>;
  // Evidence files
  evidenceFiles:    Array<{ name: string; type: string }>;
  // Missing items
  missingItems:     string[];
}

function fmtRM(n: number): string {
  return `RM ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

const DISCLAIMER =
  "CollectBoss helps organize documents for your own record keeping and review. " +
  "This is not legal advice and does not submit any claim to court. " +
  "Consult a qualified lawyer or visit the official Malaysian Judiciary website before filing.";

export async function generateSmallClaimPdf(data: SmallClaimPdfData): Promise<Blob> {
  const { jsPDF } = await import("jspdf");

  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });

  const W  = 210;
  const H  = 297;
  const ML = 14;
  const MR = 14;
  const MB = 18;
  const CW = W - ML - MR;

  let y = 14;

  const guard = (need: number) => {
    if (y + need > H - MB) {
      doc.addPage();
      y = 14;
      addFooter(doc.getNumberOfPages());
    }
  };

  const addFooter = (n: number) => {
    const cur = doc.getCurrentPageInfo().pageNumber;
    doc.setPage(n);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(180, 180, 180);
    doc.text(
      `Small Claim Pack · ${data.caseId} · Page ${n} · CollectBoss`,
      W / 2, H - 6, { align: "center" }
    );
    doc.setPage(cur);
  };

  // ── Header ──────────────────────────────────────────────────────────────────
  doc.setFillColor(13, 27, 61);
  doc.rect(0, 0, W, 18, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  const cw = doc.getTextWidth("Collect");
  doc.text("Collect", ML, 12);
  doc.setTextColor(0, 153, 102);
  doc.text("Boss", ML + cw, 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(180, 210, 230);
  doc.text("Small Claim Case Pack", W - MR, 12, { align: "right" });

  y = 24;

  // Date / Ref
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text(`Date: ${data.today}`, ML, y);
  doc.text(`Reference: ${data.caseId}`, ML + CW, y, { align: "right" });
  y += 4;
  doc.setDrawColor(229, 231, 235);
  doc.line(ML, y, ML + CW, y);
  y += 7;

  // ── Eligibility notice ───────────────────────────────────────────────────────
  const eligColor: [number, number, number] = data.isEligible
    ? [236, 253, 245] : [255, 251, 235];
  const eligBorder: [number, number, number] = data.isEligible
    ? [167, 243, 208] : [253, 230, 138];
  const eligText: [number, number, number] = data.isEligible
    ? [6, 95, 70] : [120, 53, 15];

  doc.setFillColor(...eligColor);
  doc.setDrawColor(...eligBorder);
  doc.roundedRect(ML, y, CW, 10, 1.5, 1.5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...eligText);
  doc.text(
    data.isEligible
      ? `✓ Eligible for Small Claims Court — ${fmtRM(data.balance)} (≤ RM 5,000)`
      : `⚠  Amount ${fmtRM(data.balance)} exceeds RM 5,000 small claims limit.`,
    ML + 3, y + 6.5
  );
  y += 14;

  // ── Section helper ────────────────────────────────────────────────────────────
  const section = (title: string) => {
    guard(12);
    y += 2;
    doc.setFillColor(13, 27, 61);
    doc.rect(ML, y, CW, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(title.toUpperCase(), ML + 3, y + 5);
    y += 9.5;
  };

  const kv = (label: string, value: string, bold = false) => {
    guard(6.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(107, 114, 128);
    doc.text(label, ML + 2, y);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setTextColor(31, 41, 55);
    doc.text(value, ML + 50, y);
    y += 5.5;
  };

  const checkRow = (label: string, done: boolean) => {
    guard(7);
    // Box
    if (done) {
      doc.setFillColor(0, 153, 102);
      doc.roundedRect(ML + 2, y - 3.5, 4, 4, 0.5, 0.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(255, 255, 255);
      doc.text("✓", ML + 2.7, y - 0.3);
    } else {
      doc.setFillColor(254, 242, 242);
      doc.setDrawColor(252, 165, 165);
      doc.roundedRect(ML + 2, y - 3.5, 4, 4, 0.5, 0.5, "FD");
    }
    doc.setFont("helvetica", done ? "normal" : "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(done ? 31 : 185, done ? 41 : 28, done ? 55 : 26);
    doc.text(label, ML + 9, y - 0.3);
    if (!done) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(220, 38, 38);
      const lw = doc.getTextWidth(label);
      doc.text("NEEDED", ML + 9 + lw + 2, y - 0.3);
    }
    y += 6;
  };

  // ── Business / Case ──────────────────────────────────────────────────────────
  section("Business & Case Reference");
  kv("Business",       data.businessName);
  kv("Case Reference", data.caseId);
  kv("Generated",      data.today);

  // ── Debtor ───────────────────────────────────────────────────────────────────
  section("Debtor Details");
  kv("Name",     data.debtorName);
  if (data.debtorCompany && data.debtorCompany !== data.debtorName)
    kv("Company",  data.debtorCompany);
  if (data.debtorRegNo)   kv("Reg No.",  data.debtorRegNo);
  if (data.debtorPhone)   kv("Phone",    data.debtorPhone);
  if (data.debtorEmail)   kv("Email",    data.debtorEmail);
  if (data.debtorLocation) kv("Address", data.debtorLocation);

  // ── Outstanding amount ────────────────────────────────────────────────────────
  section("Outstanding Amount");
  kv("Amount Owed",  fmtRM(data.amountOwed));
  kv("Amount Paid",  fmtRM(data.amountPaid));
  kv("Balance Due",  fmtRM(data.balance), true);
  kv("Due Date",     data.dueDate);
  if (data.invoiceNo) kv("Invoice No.", data.invoiceNo);
  kv("Days Overdue", data.daysOverdue > 0 ? `${data.daysOverdue} days` : "Not overdue");

  // ── Readiness checklist ────────────────────────────────────────────────────────
  section(`Readiness Checklist (${data.readinessPct}%)`);
  for (const item of data.checklist) {
    checkRow(item.label, item.done);
  }
  y += 2;

  // ── Evidence & documents ───────────────────────────────────────────────────────
  section("Documents & Evidence Summary");
  kv("Evidence Files",       `${data.evidenceFiles.length} file(s) uploaded`);
  kv("Reminder History",     data.reminderCount > 0 ? `${data.reminderCount} reminder(s) sent` : "None recorded");
  kv("Payment History",      data.paymentCount > 0  ? `${data.paymentCount} payment record(s)` : "None recorded");
  kv("Evidence Pack",        data.hasEvidencePack   ? "Generated" : "Not yet generated");
  kv("Formal Demand",        data.hasFormalDemand   ? "Draft saved" : "Not yet created");
  kv("Payment Plan",         data.hasPaymentPlan    ? "Active" : "None");
  kv("Debt Acknowledgement", data.hasAcknowledgement ? "Confirmed" : "Not yet confirmed");

  // ── Evidence files ─────────────────────────────────────────────────────────────
  if (data.evidenceFiles.length > 0) {
    section(`Uploaded Evidence Files (${data.evidenceFiles.length})`);
    for (const f of data.evidenceFiles) {
      guard(6.5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(31, 41, 55);
      doc.text(`• ${f.name} [${f.type}]`, ML + 2, y);
      y += 5.5;
    }
  }

  // ── Missing items ──────────────────────────────────────────────────────────────
  if (data.missingItems.length > 0) {
    section("Missing Information");
    for (const item of data.missingItems) {
      guard(6.5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(220, 38, 38);
      doc.text(`• ${item}`, ML + 2, y);
      y += 5.5;
    }
    y += 2;
  }

  // ── Case timeline ──────────────────────────────────────────────────────────────
  if (data.timeline.length > 0) {
    section(`Case Timeline (${data.timeline.length} events)`);
    for (const t of data.timeline) {
      guard(7);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(156, 163, 175);
      doc.text(t.date, ML + 2, y);
      doc.setFontSize(8.5);
      doc.setTextColor(55, 65, 81);
      const wrapped = doc.splitTextToSize(t.event, CW - 32);
      doc.text(wrapped, ML + 32, y);
      y += Math.max(5.5, wrapped.length * 4.5);
    }
  }

  // ── Next steps guide ──────────────────────────────────────────────────────────
  section("Next Steps Guide");
  const steps = [
    "Ensure all required documents are complete before proceeding.",
    "Visit your nearest Magistrate Court to file using Form 198 (Tuntutan Kecil).",
    "Pay the filing fee at the court cashier and keep your receipt.",
    "Attend your hearing date and present your case calmly with all documents.",
    "Consider consulting a lawyer if the amount exceeds RM 5,000.",
  ];
  for (const [i, step] of steps.entries()) {
    guard(8);
    doc.setFillColor(13, 27, 61);
    doc.circle(ML + 4, y - 1, 2.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text(String(i + 1), ML + 4, y + 0.8, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const wrapped = doc.splitTextToSize(step, CW - 12);
    doc.setTextColor(55, 65, 81);
    doc.text(wrapped, ML + 9, y + 0.5);
    y += Math.max(7, wrapped.length * 5) + 1;
  }

  // ── Disclaimer ─────────────────────────────────────────────────────────────────
  guard(20);
  y += 4;
  doc.setFillColor(242, 244, 247);
  doc.roundedRect(ML, y, CW, 16, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(107, 114, 128);
  doc.text("DISCLAIMER", ML + 3, y + 5);
  doc.setFont("helvetica", "normal");
  const dLines = doc.splitTextToSize(DISCLAIMER, CW - 6);
  doc.text(dLines, ML + 3, y + 10);
  y += 16 + dLines.length * 4.5;

  // Footers on all pages
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) addFooter(i);

  return doc.output("blob");
}
