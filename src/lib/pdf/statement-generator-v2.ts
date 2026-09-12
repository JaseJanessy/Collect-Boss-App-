import { jsPDF } from "jspdf";
import type { Statement2Data } from "../statements/service.ts";
import { formatCurrency, formatDate, formatMinorCurrency } from "../international/formatting.ts";
import { LEGACY_MALAYSIA_REGION } from "../international/registry.ts";
import { brandPdfColors } from "../brand/pdf-theme.ts";

const PAGE_WIDTH = 210;
const MARGIN = 14;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const status = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function fit(doc: jsPDF, value: string, width: number): string {
  if (doc.getTextWidth(value) <= width) return value;
  let text = value;
  while (text && doc.getTextWidth(`${text}...`) > width) text = text.slice(0, -1);
  return `${text}...`;
}

export function generateStatementPdfV2(data: Statement2Data): Uint8Array {
  const region = data.region ?? LEGACY_MALAYSIA_REGION;
  const money = (value: number) => formatCurrency(value, region, data.currency);
  const moneyMinor = (value: number) => formatMinorCurrency(value, region, data.currency);
  const date = (value: string) => formatDate(value, region);
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
  let y = 16;
  let page = 1;

  function footer() {
    doc.setDrawColor(226, 232, 240); doc.line(MARGIN, 283, PAGE_WIDTH - MARGIN, 283);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
    doc.text(`Generated from CollectBoss ledger records. Currency: ${data.currency}. This statement is not a tax invoice or payment receipt.`, MARGIN, 288);
    doc.text(`Page ${page}`, PAGE_WIDTH - MARGIN, 288, { align: "right" });
  }
  function nextPage() { footer(); doc.addPage(); page += 1; y = 16; }
  function ensure(height: number) { if (y + height > 279) nextPage(); }
  function section(title: string) {
    ensure(14); y += 4; doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...brandPdfColors.navy); doc.text(title, MARGIN, y); y += 5;
  }
  function tableHeader(columns: Array<{ label: string; x: number; align?: "left" | "right" }>) {
    ensure(8); doc.setFillColor(248, 250, 252); doc.rect(MARGIN, y, CONTENT_WIDTH, 7, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.5); doc.setTextColor(100, 116, 139);
    for (const column of columns) doc.text(column.label, column.x, y + 4.6, { align: column.align ?? "left" });
    y += 7;
  }

  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(...brandPdfColors.navy); doc.text("Collect", MARGIN, y); const collectWidth = doc.getTextWidth("Collect"); doc.setTextColor(...brandPdfColors.green); doc.text("Boss", MARGIN + collectWidth, y); y += 8; doc.setTextColor(...brandPdfColors.navy);
  doc.setFontSize(14); doc.text(data.statementType === "recovery" ? "Recovery Statement" : "Account Statement", MARGIN, y);
  doc.setFontSize(8); doc.setTextColor(5, 150, 105); doc.text("STATEMENT 2.0", PAGE_WIDTH - MARGIN, y, { align: "right" }); y += 7;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(71, 85, 105);
  doc.text(`Business: ${fit(doc, data.businessName, 120)}`, MARGIN, y); doc.text(`Generated: ${date(data.generatedAt)}`, PAGE_WIDTH - MARGIN, y, { align: "right" }); y += 5;
  if (data.businessRegistrationNo) { doc.text(`Registration: ${data.businessRegistrationNo}`, MARGIN, y); y += 5; }
  doc.text(`Customer: ${fit(doc, data.customerCompany ? `${data.customerName} (${data.customerCompany})` : data.customerName, 125)}`, MARGIN, y); doc.text(`Currency: ${data.currency}`, PAGE_WIDTH - MARGIN, y, { align: "right" }); y += 5;
  doc.text(`Period: ${data.periodLabel}`, MARGIN, y); y += 9;

  doc.setFillColor(236, 253, 245); doc.roundedRect(MARGIN, y, CONTENT_WIDTH, 28, 2, 2, "F");
  doc.setFont("helvetica", "bold"); doc.setTextColor(6, 78, 59); doc.setFontSize(7); doc.text("CLOSING BALANCE", MARGIN + 6, y + 8); doc.text("TOTAL OUTSTANDING", MARGIN + 68, y + 8); doc.text("MOVEMENT", MARGIN + 132, y + 8);
  doc.setFontSize(14); doc.text(money(data.summary.closingBalance), MARGIN + 6, y + 18); doc.text(money(data.summary.totalOutstanding), MARGIN + 68, y + 18); doc.text(money(data.summary.movement), MARGIN + 132, y + 18); y += 34;

  const metrics = [
    ["Opening balance", money(data.summary.openingBalance)], ["Obligations / debit adjustments", money(data.summary.periodDebits)],
    ["Payments", money(data.summary.periodPayments)], ["Credits / credit adjustments", money(data.summary.periodCredits)],
    ["Write-offs", money(data.summary.periodWriteOffs ?? 0)], ["Settlement adjustments", money(data.summary.periodSettlements ?? 0)],
    ["Other adjustments", money(data.summary.periodAdjustments ?? 0)], ["Payment reversals", money(data.summary.periodReversals)],
  ];
  doc.setFillColor(248, 250, 252); doc.roundedRect(MARGIN, y, CONTENT_WIDTH, 41, 2, 2, "F");
  metrics.forEach(([label, value], index) => { const col = index % 3; const row = Math.floor(index / 3); const x = MARGIN + 5 + col * 60; const rowY = y + 6 + row * 13; doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(100, 116, 139); doc.text(label, x, rowY); doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(30, 41, 59); doc.text(value, x, rowY + 5); }); y += 44;

  section("Accounts and invoices");
  const accountColumns = [{ label: "ACCOUNT", x: 15 }, { label: "INVOICE", x: 50 }, { label: "STATUS", x: 88 }, { label: "OPENING", x: 142, align: "right" as const }, { label: "MOVEMENT", x: 169, align: "right" as const }, { label: "CLOSING", x: 195, align: "right" as const }];
  tableHeader(accountColumns);
  if (!data.accounts.length) { doc.setFontSize(8); doc.setTextColor(100, 116, 139); doc.text("No accounts existed in this period.", MARGIN, y + 6); y += 10; }
  for (const account of data.accounts) {
    if (y + 9 > 279) { nextPage(); tableHeader(accountColumns); }
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(51, 65, 85);
    doc.text(fit(doc, account.caseReference, 31), 15, y + 5); doc.text(fit(doc, account.invoiceNo ?? "—", 34), 50, y + 5); doc.text(fit(doc, status(account.status), 35), 88, y + 5);
    doc.text(moneyMinor(account.openingBalanceMinor), 142, y + 5, { align: "right" }); doc.text(moneyMinor(account.movementMinor), 169, y + 5, { align: "right" }); doc.setFont("helvetica", "bold"); doc.text(moneyMinor(account.closingBalanceMinor), 195, y + 5, { align: "right" });
    doc.setDrawColor(226, 232, 240); doc.line(MARGIN, y + 8, PAGE_WIDTH - MARGIN, y + 8); y += 8;
  }

  section("Transaction history");
  const transactionColumns = [{ label: "DATE", x: 15 }, { label: "ACCOUNT / INVOICE", x: 39 }, { label: "TYPE", x: 92 }, { label: "AMOUNT", x: 160, align: "right" as const }, { label: "BALANCE EFFECT", x: 195, align: "right" as const }];
  tableHeader(transactionColumns);
  if (!data.transactions.length) { doc.setFontSize(8); doc.setTextColor(100, 116, 139); doc.text("No statement movements were recorded in this period.", MARGIN, y + 6); y += 10; }
  for (const transaction of data.transactions) {
    if (y + 10 > 279) { nextPage(); tableHeader(transactionColumns); }
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(51, 65, 85);
    doc.text(date(transaction.occurredAt), 15, y + 5); doc.text(fit(doc, `${transaction.caseReference}${transaction.invoiceNo ? ` / ${transaction.invoiceNo}` : ""}`, 48), 39, y + 5); doc.text(fit(doc, transaction.label, 56), 92, y + 5);
    doc.text(moneyMinor(transaction.amountMinor), 160, y + 5, { align: "right" }); doc.setFont("helvetica", "bold"); doc.setTextColor(transaction.balanceEffectMinor <= 0 ? 4 : 190, transaction.balanceEffectMinor <= 0 ? 120 : 60, transaction.balanceEffectMinor <= 0 ? 87 : 60); doc.text(`${transaction.balanceEffectMinor > 0 ? "+" : "-"}${moneyMinor(Math.abs(transaction.balanceEffectMinor))}`, 195, y + 5, { align: "right" });
    doc.setDrawColor(226, 232, 240); doc.line(MARGIN, y + 9, PAGE_WIDTH - MARGIN, y + 9); y += 9;
  }

  if (data.recovery) {
    section("Recovery activity");
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(71, 85, 105);
    doc.text(`Reminders: ${data.recovery.reminderCount}   Promises: ${data.recovery.promiseCount}   Active plans: ${data.recovery.activePaymentPlans}   Disputes: ${data.recovery.disputeCount}`, MARGIN, y + 4); y += 8;
    doc.text(`Last contact: ${data.recovery.lastContactAt ? date(data.recovery.lastContactAt) : "No confirmed contact recorded"}`, MARGIN, y + 4); y += 7;
    const recoveryColumns = [{ label: "DATE", x: 15 }, { label: "ACCOUNT / INVOICE", x: 39 }, { label: "ACTIVITY", x: 92 }, { label: "STATUS", x: 195, align: "right" as const }]; tableHeader(recoveryColumns);
    for (const activity of data.recovery.activities) {
      if (y + 9 > 279) { nextPage(); tableHeader(recoveryColumns); }
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(51, 65, 85); doc.text(date(activity.occurredAt), 15, y + 5); doc.text(fit(doc, `${activity.caseReference}${activity.invoiceNo ? ` / ${activity.invoiceNo}` : ""}`, 48), 39, y + 5); doc.text(fit(doc, status(activity.label), 75), 92, y + 5); doc.text(fit(doc, status(activity.status), 28), 195, y + 5, { align: "right" }); doc.setDrawColor(226, 232, 240); doc.line(MARGIN, y + 8, PAGE_WIDTH - MARGIN, y + 8); y += 8;
    }
  }

  footer();
  return new Uint8Array(doc.output("arraybuffer"));
}
