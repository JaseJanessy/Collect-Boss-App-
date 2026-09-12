/**
 * Evidence Pack PDF Generator.
 * Uses jsPDF (dynamic import) — browser-only, no SSR.
 * SECURITY: no bank/DuitNow details included by default.
 */

import { CASE_STATUS_METADATA } from "../domain/workflows.ts";
import { brandPdfColors } from "../brand/pdf-theme.ts";

// ─── Data types ────────────────────────────────────────────────────────────────

export interface EvidencePackReminder {
  sent_at:      string;
  sent_channel: string;
  message_type: string;
  status:       string;
}

export interface EvidencePackPayment {
  created_at:    string;
  amount:        number;
  payment_method: string;
  reference_no:  string | null;
  review_status: string;
}

export interface EvidencePackFile {
  evidence_id?:      string;
  file_name:       string;
  file_type:       string;
  evidence_type:   string;
  file_size_bytes: number | null;
  uploaded_at:     string;
  content_sha256?: string | null;
}

export interface EvidencePackTimeline {
  date:  string;
  event: string;
  type:  string;
}

export interface EvidencePackPlan {
  total_amount:       number;
  installment_count:  number;
  installment_amount: number;
  due_dates:          string[];
  debtor_confirmed:   boolean;
  confirmed_at:       string | null;
}

export interface EvidencePackData {
  caseId:            string;
  businessName:      string;
  // Debtor
  debtorName:        string;
  debtorCompany:     string | null;
  debtorRegNo:       string | null;
  debtorPhone:       string | null;
  debtorEmail:       string | null;
  debtorLocation:    string | null;
  // Financials
  amountOwed:        number;
  amountPaid:        number;
  balance:           number;
  dueDate:           string;
  invoiceNo:         string | null;
  daysOverdue:       number;
  status:            string;
  paymentLockMode:   string;
  // Relations
  reminders:         EvidencePackReminder[];
  payments:          EvidencePackPayment[];
  evidenceFiles:     EvidencePackFile[];
  // Checklist
  uploadedEvidenceTypes: string[];     // e.g. ["invoice","whatsapp"]
  missingMustHave:       string[];     // names of missing must-have types
  evidenceScore:         number;       // 0–100
  // Plan
  activePlan:        EvidencePackPlan | null;
  // Timeline
  timeline:          EvidencePackTimeline[];
  // Acknowledgement
  hasAcknowledgement: boolean;
  generatedAt?: string;
}

// ─── Formatters ────────────────────────────────────────────────────────────────

function fmtRM(amount: number): string {
  return `RM ${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-MY", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch {
    return iso;
  }
}

const STATUS_LABELS: Record<string, string> = {
  action_needed:       CASE_STATUS_METADATA.action_needed.label,
  payment_promise:     CASE_STATUS_METADATA.payment_promise.label,
  partial_paid:        CASE_STATUS_METADATA.partial_paid.label,
  paid:                CASE_STATUS_METADATA.paid.label,
  overdue:             CASE_STATUS_METADATA.overdue.label,
  formal_demand_ready: CASE_STATUS_METADATA.formal_demand_ready.label,
};

const LOCK_LABELS: Record<string, string> = {
  immediate: "Immediate (visible to debtor)",
  approval:  "Requires Approval",
  manual:    "Manual (creditor shares separately)",
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  email:    "Email",
  sms:      "SMS",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  duitnow_qr:    "DuitNow QR",
  bank_transfer: "Bank Transfer",
  cash:          "Cash",
  cheque:        "Cheque",
  tng_ewallet:   "TNG eWallet",
};

const EVIDENCE_TYPE_NAMES: Record<string, string> = {
  invoice:        "Invoice",
  whatsapp:       "WhatsApp / Chat Screenshot",
  payment_proof:  "Payment Proof",
  contract:       "Contract / Agreement",
  delivery_order: "Delivery Order (DO)",
  notes:          "Notes / Other Evidence",
};

const MUST_HAVE_TYPES = new Set(["invoice", "whatsapp", "payment_proof"]);

// ─── Main generator ────────────────────────────────────────────────────────────

export async function generateEvidencePackPdf(data: EvidencePackData): Promise<Blob> {
  const { jsPDF } = await import("jspdf");

  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });

  // ── Layout constants ────────────────────────────────────────────────────────
  const W  = 210;
  const H  = 297;
  const ML = 14;
  const MR = 14;
  const MB = 18;
  const CW = W - ML - MR;   // 182 mm content width

  let y = 14;

  // ── Color setters ────────────────────────────────────────────────────────────
  const navy     = () => doc.setTextColor(...brandPdfColors.navy);
  const emerald  = () => doc.setTextColor(...brandPdfColors.green);
  const dark     = () => doc.setTextColor(31, 41, 55);
  const mid      = () => doc.setTextColor(107, 114, 128);
  const light    = () => doc.setTextColor(156, 163, 175);
  const white    = () => doc.setTextColor(255, 255, 255);
  const red      = () => doc.setTextColor(220, 38, 38);

  const fillNavy    = () => doc.setFillColor(...brandPdfColors.navy);
  const fillEme     = () => doc.setFillColor(...brandPdfColors.green);
  const fillLGray   = () => doc.setFillColor(242, 244, 247);
  const fillWhite   = () => doc.setFillColor(255, 255, 255);
  const fillMissing = () => doc.setFillColor(254, 242, 242);

  // ── Page break helper ────────────────────────────────────────────────────────
  const guard = (need: number) => {
    if (y + need > H - MB) {
      doc.addPage();
      y = 14;
      footerOnPage(doc.getNumberOfPages());
    }
  };

  const footerOnPage = (n: number) => {
    const savedPage = doc.getCurrentPageInfo().pageNumber;
    doc.setPage(n);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    light();
    doc.text(
      `CollectBoss Case Evidence Export · Case: ${data.caseId} · Page ${n}`,
      W / 2, H - 6, { align: "center" }
    );
    doc.setPage(savedPage);
  };

  // ── Drawing helpers ──────────────────────────────────────────────────────────

  const sectionHeader = (title: string) => {
    guard(14);
    y += 3;
    fillNavy();
    doc.rect(ML, y, CW, 7.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    white();
    doc.text(title, ML + 3, y + 5);
    y += 10;
  };

  const kv = (
    label: string,
    value: string,
    opts: { bold?: boolean; color?: "emerald" | "red" | "dark" | "navy"; indent?: number } = {}
  ) => {
    guard(6.5);
    const indent = opts.indent ?? 0;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    mid();
    doc.text(label, ML + indent, y);
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    if      (opts.color === "emerald") emerald();
    else if (opts.color === "red")     red();
    else if (opts.color === "navy")    navy();
    else                               dark();
    doc.text(value, ML + 45 + indent, y);
    y += 5.5;
  };

  const gap = (h = 3) => { y += h; };

  const smallText = (text: string, indent = 0) => {
    guard(5.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    mid();
    doc.text(text, ML + indent, y);
    y += 4.5;
  };

  const checkRow = (label: string, checked: boolean, mustHave: boolean) => {
    guard(7);
    // Checkbox
    if (checked) {
      fillEme();
      doc.roundedRect(ML, y - 3.5, 4, 4, 0.5, 0.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      white();
      doc.text("✓", ML + 0.7, y - 0.4);
    } else {
      doc.setDrawColor(229, 231, 235);
      if (mustHave) fillMissing(); else fillWhite();
      doc.roundedRect(ML, y - 3.5, 4, 4, 0.5, 0.5, "FD");
    }

    doc.setFont("helvetica", checked ? "normal" : "bold");
    doc.setFontSize(8.5);
    if (checked) { dark(); } else if (mustHave) { red(); } else { mid(); }
    doc.text(label, ML + 6, y - 0.2);

    if (!checked && mustHave) {
      const lw = doc.getTextWidth(label);
      doc.setFontSize(6.5);
      red();
      doc.setFont("helvetica", "bold");
      doc.text("MUST HAVE", ML + 6 + lw + 2, y - 0.2);
    }
    y += 6;
  };

  const timelineRow = (date: string, event: string) => {
    guard(7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    light();
    doc.text(date, ML + 2, y);
    dark();
    doc.setFontSize(8);
    // Wrap long text
    const wrapped = doc.splitTextToSize(event, CW - 32);
    doc.text(wrapped, ML + 32, y);
    y += Math.max(5.5, wrapped.length * 4.5);
  };

  const fileRow = (file: EvidencePackFile) => {
    guard(10);
    fillLGray();
    doc.roundedRect(ML, y - 1, CW, 8.5, 1, 1, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    dark();
    doc.text(file.file_name.length > 50 ? file.file_name.slice(0, 47) + "…" : file.file_name, ML + 3, y + 3.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    mid();
    const typeName = EVIDENCE_TYPE_NAMES[file.evidence_type] ?? file.evidence_type;
    const size = file.file_size_bytes ? `${Math.round(file.file_size_bytes / 1024)} KB` : "";
    doc.text(`${typeName}${size ? " · " + size : ""} · ${fmtDate(file.uploaded_at)}`, ML + 3, y + 7);
    y += 11;
  };

  // ────────────────────────────────────────────────────────────────────────────
  // PAGE 1 — COVER BANNER
  // ────────────────────────────────────────────────────────────────────────────

  fillNavy();
  doc.rect(0, 0, W, 46, "F");

  // CollectBoss wordmark
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setFillColor(...brandPdfColors.surface);
  doc.roundedRect(ML - 2, 5, 59, 19, 1, 1, "F");
  navy();
  const collectW = doc.getTextWidth("Collect");
  doc.text("Collect", ML, 18);
  doc.setTextColor(...brandPdfColors.green);
  doc.text("Boss", ML + collectW, 18);

  // Title
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  white();
  doc.text("FACTUAL CASE EVIDENCE EXPORT", ML, 27);

  // Meta
  doc.setFontSize(8);
  doc.setTextColor(147, 197, 233);
  const genDate = new Date(data.generatedAt ?? Date.now()).toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric" });
  doc.text(`Case: ${data.caseId}  ·  Generated: ${genDate}`, ML, 36);

  // Evidence score pill
  const scoreColor: [number, number, number] =
    data.evidenceScore >= 60 ? [0, 153, 102] :
    data.evidenceScore >= 30 ? [217, 119, 6]  : [220, 38, 38];
  doc.setFillColor(...scoreColor);
  doc.roundedRect(W - MR - 26, 28, 26, 9, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  white();
  doc.text(`${data.evidenceScore}% Complete`, W - MR - 13, 33.5, { align: "center" });

  y = 52;

  // ── Missing documents warning ───────────────────────────────────────────────
  if (data.missingMustHave.length > 0) {
    fillMissing();
    doc.roundedRect(ML, y, CW, 10, 1.5, 1.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    red();
    doc.text("⚠  Missing must-have documents:", ML + 3, y + 4);
    doc.setFont("helvetica", "normal");
    doc.text(data.missingMustHave.join(", "), ML + 3, y + 8.5);
    y += 14;
  }

  // ── Business profile ────────────────────────────────────────────────────────
  sectionHeader("Business Profile");
  kv("Business",       data.businessName);
  kv("Case Reference", data.caseId);
  gap();

  // ── Debtor details ──────────────────────────────────────────────────────────
  sectionHeader("Debtor Details");
  kv("Name", data.debtorName);
  if (data.debtorCompany && data.debtorCompany !== data.debtorName)
    kv("Company", data.debtorCompany);
  if (data.debtorRegNo)   kv("Reg No.",  data.debtorRegNo);
  if (data.debtorPhone)   kv("Phone",    data.debtorPhone);
  if (data.debtorEmail)   kv("Email",    data.debtorEmail);
  if (data.debtorLocation) kv("Location", data.debtorLocation);
  if (data.invoiceNo)     kv("Invoice No.", data.invoiceNo);
  gap();

  // ── Outstanding amount ──────────────────────────────────────────────────────
  sectionHeader("Outstanding Amount");
  kv("Amount Owed",  fmtRM(data.amountOwed));
  kv("Amount Paid",  fmtRM(data.amountPaid),  { color: "emerald" });
  kv("Balance Due",  fmtRM(data.balance),     { bold: true, color: data.balance > 0 ? "red" : "emerald" });
  kv("Due Date",     data.dueDate);
  kv("Days Overdue", data.daysOverdue > 0 ? `${data.daysOverdue} days` : "Not overdue",
     { color: data.daysOverdue > 0 ? "red" : "dark" });
  kv("Case Status",  STATUS_LABELS[data.status] ?? data.status);
  kv("Payment Lock", LOCK_LABELS[data.paymentLockMode] ?? data.paymentLockMode);
  gap();

  // ── Reminder history ────────────────────────────────────────────────────────
  sectionHeader(`Reminder History (${data.reminders.length})`);
  if (data.reminders.length === 0) {
    smallText("No reminders sent.");
  } else {
    for (const r of data.reminders) {
      timelineRow(
        fmtDate(r.sent_at),
        `${r.message_type}  via ${CHANNEL_LABELS[r.sent_channel] ?? r.sent_channel}  —  ${r.status}`
      );
    }
  }
  gap();

  // The manifest deliberately excludes storage object paths and signed URLs.
  sectionHeader(`Evidence Manifest (${data.evidenceFiles.length})`);
  if (data.evidenceFiles.length === 0) {
    smallText("No evidence files were selected for this pack.");
  } else {
    for (const [index, file] of data.evidenceFiles.entries()) {
      const checksum = file.content_sha256 ? file.content_sha256.slice(0, 16) : "not recorded";
      smallText(`${index + 1}. ${file.file_name} | SHA-256: ${checksum}`, 2);
    }
  }
  gap();

  // ── Payment history ─────────────────────────────────────────────────────────
  sectionHeader(`Payment History (${data.payments.length})`);
  if (data.payments.length === 0) {
    smallText("No payment records.");
  } else {
    for (const p of data.payments) {
      guard(7);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      dark();
      const method = PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method;
      doc.text(`${fmtDate(p.created_at)}  ·  ${method}${p.reference_no ? "  Ref: " + p.reference_no : ""}`, ML + 2, y);
      doc.setFont("helvetica", "bold");
      if (p.review_status === "approved") { emerald(); } else { mid(); }
      doc.text(fmtRM(p.amount), ML + CW, y, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      mid();
      doc.text(p.review_status === "approved" ? "Verified" : "Pending Review", ML + CW - 24, y + 4);
      y += 7.5;
    }
  }
  gap();

  // ── Evidence checklist ──────────────────────────────────────────────────────
  const uploadedSet = new Set(data.uploadedEvidenceTypes);
  sectionHeader(`Evidence Checklist (${data.evidenceScore}% complete)`);
  const checklistItems = [
    { id: "invoice",        name: "Invoice" },
    { id: "whatsapp",       name: "WhatsApp / Chat Screenshot" },
    { id: "payment_proof",  name: "Payment Proof" },
    { id: "contract",       name: "Contract / Agreement" },
    { id: "delivery_order", name: "Delivery Order (DO)" },
    { id: "notes",          name: "Notes / Other Evidence" },
  ];
  for (const item of checklistItems) {
    checkRow(item.name, uploadedSet.has(item.id), MUST_HAVE_TYPES.has(item.id));
  }
  gap();

  // ── Uploaded evidence files ─────────────────────────────────────────────────
  sectionHeader(`Uploaded Documents (${data.evidenceFiles.length})`);
  if (data.evidenceFiles.length === 0) {
    smallText("No documents uploaded.");
  } else {
    for (const f of data.evidenceFiles) {
      fileRow(f);
    }
  }
  gap();

  // ── Payment plan status ─────────────────────────────────────────────────────
  sectionHeader("Payment Plan Status");
  if (!data.activePlan) {
    smallText("No active payment plan.");
  } else {
    const p = data.activePlan;
    kv("Total Amount",  fmtRM(p.total_amount), { bold: true });
    kv("Instalments",   `${p.installment_count} × ${fmtRM(p.installment_amount)}`);
    kv("First Due",     p.due_dates[0] ? fmtDate(p.due_dates[0]) : "—");
    kv("Debtor Confirmed", p.debtor_confirmed
      ? `Yes${p.confirmed_at ? " · " + fmtDate(p.confirmed_at) : ""}`
      : "Awaiting confirmation",
      { color: p.debtor_confirmed ? "emerald" : "dark" }
    );
  }
  gap();

  // ── Debt acknowledgement ────────────────────────────────────────────────────
  sectionHeader("Debt Acknowledgement");
  kv("Status", data.hasAcknowledgement ? "Signed by creditor" : "Not yet signed",
     { color: data.hasAcknowledgement ? "emerald" : "dark" });
  gap();

  // ── Case timeline ───────────────────────────────────────────────────────────
  if (data.timeline.length > 0) {
    sectionHeader(`Case Timeline (${data.timeline.length} events)`);
    for (const t of data.timeline) {
      timelineRow(t.date, t.event);
    }
    gap();
  }

  // ── Disclaimer ──────────────────────────────────────────────────────────────
  guard(20);
  y += 4;
  fillLGray();
  doc.roundedRect(ML, y, CW, 14, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  mid();
  doc.text("DISCLAIMER", ML + 3, y + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const disclaimer =
    "CollectBoss helps organize case records and documents. This document is not legal advice. " +
    "Consult a qualified lawyer before taking legal action. All amounts are stated as recorded " +
    "in the CollectBoss system and have not been independently verified.";
  const disclaimerLines = doc.splitTextToSize(disclaimer, CW - 6);
  mid();
  doc.text(disclaimerLines, ML + 3, y + 10);
  y += 14 + disclaimerLines.length * 4 + 4;

  // Add footer to all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    footerOnPage(i);
  }

  return doc.output("blob");
}
