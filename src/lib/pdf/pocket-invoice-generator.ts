import { jsPDF } from "jspdf";

import { formatCurrencyMinor } from "@/lib/financial/money";
import { formatInvoiceQuantity, POCKET_INVOICE_DISCLAIMER, type PocketInvoiceStatus } from "@/lib/pocket/invoices";

export interface PocketInvoicePdfData {
  invoiceNumber: string | null;
  status: PocketInvoiceStatus;
  businessName: string;
  businessContact: string | null;
  customerName: string;
  customerContact: string | null;
  issueDate: string;
  dueDate: string;
  currency: string;
  items: Array<{ description: string; quantityMilli: number; unitPriceMinor: number; lineTotalMinor: number }>;
  subtotalMinor: number;
  discountMinor: number;
  taxLabel: string | null;
  taxMinor: number;
  totalMinor: number;
  note: string | null;
  paymentInstructions: string | null;
  logoDataUrl?: string | null;
}

const left = 16;
const right = 194;

function clipped(doc: jsPDF, text: string, width: number) {
  if (doc.getTextWidth(text) <= width) return text;
  let value = text;
  while (value && doc.getTextWidth(`${value}...`) > width) value = value.slice(0, -1);
  return `${value}...`;
}

export function generatePocketInvoicePdf(data: PocketInvoicePdfData): Uint8Array {
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
  const money = (value: number) => formatCurrencyMinor(value, data.currency, { explicitCode: true });
  let y = 18;
  let page = 1;
  const footer = () => {
    doc.setDrawColor(226, 232, 240); doc.line(left, 278, right, 278);
    doc.setFont("helvetica", "bold"); doc.setTextColor(153, 27, 27); doc.setFontSize(7.5); doc.text(POCKET_INVOICE_DISCLAIMER, left, 284);
    doc.setFont("helvetica", "normal"); doc.setTextColor(100, 116, 139); doc.text(`Page ${page} | CollectBoss Pocket Simple Invoice`, right, 284, { align: "right" });
  };
  const tableHeader = () => {
    doc.setFillColor(248, 250, 252); doc.rect(left, y, 178, 8, "F");
    doc.setFont("helvetica", "bold"); doc.setTextColor(71, 85, 105); doc.setFontSize(7);
    doc.text("DESCRIPTION", left + 2, y + 5); doc.text("QTY", 123, y + 5, { align: "right" }); doc.text("UNIT PRICE", 157, y + 5, { align: "right" }); doc.text("AMOUNT", right - 2, y + 5, { align: "right" });
    y += 8;
  };
  const nextPage = (withTableHeader: boolean) => {
    footer(); doc.addPage(); page += 1; y = 18;
    doc.setFont("helvetica", "bold"); doc.setTextColor(9, 47, 42); doc.setFontSize(12);
    doc.text(`${data.invoiceNumber ?? "Draft invoice"} - continued`, left, y); y += 9;
    if (withTableHeader) tableHeader();
  };

  doc.setFont("helvetica", "bold"); doc.setTextColor(9, 47, 42); doc.setFontSize(19);
  if (data.logoDataUrl) {
    try { doc.addImage(data.logoDataUrl, data.logoDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG", left, 10, 18, 18, undefined, "FAST"); } catch { /* The business name remains the safe fallback. */ }
  }
  doc.text(clipped(doc, data.businessName, data.logoDataUrl ? 91 : 112), data.logoDataUrl ? left + 23 : left, y);
  doc.setFontSize(16); doc.text(data.status === "draft" ? "DRAFT INVOICE" : "INVOICE", right, y, { align: "right" });
  y += 7;
  doc.setFont("helvetica", "normal"); doc.setTextColor(71, 85, 105); doc.setFontSize(8.5);
  for (const line of doc.splitTextToSize(data.businessContact || "", 100).slice(0, 3)) { doc.text(line, data.logoDataUrl ? left + 23 : left, y); y += 4; }
  const numberY = 27;
  doc.text(`Number: ${data.invoiceNumber ?? "Assigned only when issued"}`, right, numberY, { align: "right" });
  doc.text(`Issue date: ${data.issueDate}`, right, numberY + 5, { align: "right" });
  doc.text(`Due date: ${data.dueDate}`, right, numberY + 10, { align: "right" });
  y = Math.max(y + 7, 47);

  doc.setDrawColor(209, 250, 229); doc.setFillColor(236, 253, 245); doc.roundedRect(left, y, 178, 26, 2, 2, "F");
  doc.setFont("helvetica", "bold"); doc.setTextColor(6, 78, 59); doc.setFontSize(7); doc.text("BILL TO", left + 5, y + 7);
  doc.setFontSize(10); doc.text(clipped(doc, data.customerName, 160), left + 5, y + 14);
  doc.setFont("helvetica", "normal"); doc.setTextColor(71, 85, 105); doc.setFontSize(8); doc.text(clipped(doc, data.customerContact || "No contact details provided", 160), left + 5, y + 20);
  y += 34;

  tableHeader();
  for (const item of data.items) {
    if (y > 245) nextPage(true);
    doc.setFont("helvetica", "normal"); doc.setTextColor(30, 41, 59); doc.setFontSize(8);
    doc.text(clipped(doc, item.description, 91), left + 2, y + 6);
    doc.text(formatInvoiceQuantity(item.quantityMilli), 123, y + 6, { align: "right" });
    doc.text(money(item.unitPriceMinor), 157, y + 6, { align: "right" });
    doc.setFont("helvetica", "bold"); doc.text(money(item.lineTotalMinor), right - 2, y + 6, { align: "right" });
    doc.setDrawColor(226, 232, 240); doc.line(left, y + 9, right, y + 9); y += 10;
  }
  y += 4;
  if (y > 205) nextPage(false);
  const totalRow = (label: string, value: number, strong = false) => {
    doc.setFont("helvetica", strong ? "bold" : "normal"); doc.setTextColor(strong ? 9 : 71, strong ? 47 : 85, strong ? 42 : 105); doc.setFontSize(strong ? 11 : 8.5);
    doc.text(label, 137, y, { align: "right" }); doc.text(money(value), right - 2, y, { align: "right" }); y += strong ? 8 : 6;
  };
  totalRow("Subtotal", data.subtotalMinor);
  if (data.discountMinor) totalRow("Discount", -data.discountMinor);
  if (data.taxMinor) totalRow(data.taxLabel || "Tax", data.taxMinor);
  totalRow("Total", data.totalMinor, true);

  if (data.paymentInstructions) {
    y += 4; doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(9, 47, 42); doc.text("PAYMENT INSTRUCTIONS", left, y); y += 5;
    doc.setFont("helvetica", "normal"); doc.setTextColor(71, 85, 105);
    for (const line of doc.splitTextToSize(data.paymentInstructions, 178).slice(0, 6)) { doc.text(line, left, y); y += 4; }
  }
  if (data.note) {
    y += 3; doc.setFont("helvetica", "bold"); doc.setTextColor(9, 47, 42); doc.text("NOTE", left, y); y += 5;
    doc.setFont("helvetica", "normal"); doc.setTextColor(71, 85, 105);
    for (const line of doc.splitTextToSize(data.note, 178).slice(0, 6)) { doc.text(line, left, y); y += 4; }
  }
  footer();
  return new Uint8Array(doc.output("arraybuffer"));
}
