import { z } from "zod";

import { parseCurrencyToMinor } from "@/lib/financial/money";

export const POCKET_INVOICE_DISCLAIMER = "NOT AN OFFICIAL E-INVOICE SERVICE";
export const POCKET_INVOICE_HARD_LIMIT = 60;

const optionalText = (maximum: number) => z.string().trim().max(maximum).nullable().optional();

export const pocketInvoiceItemInputSchema = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.string().trim().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/u),
  unitPrice: z.string().trim().min(1).max(40),
}).strict();

export const pocketInvoiceDraftInputSchema = z.object({
  customerId: z.string().uuid(),
  issueDate: z.string().date(),
  dueDate: z.string().date(),
  businessName: z.string().trim().min(1).max(160),
  businessContact: optionalText(500),
  customerName: z.string().trim().min(1).max(160),
  customerContact: optionalText(500),
  discount: z.string().trim().max(40).optional().default("0"),
  taxLabel: optionalText(80),
  tax: z.string().trim().max(40).optional().default("0"),
  note: optionalText(1_000),
  paymentInstructions: optionalText(1_000),
  items: z.array(pocketInvoiceItemInputSchema).min(1).max(100),
}).strict().refine((value) => value.dueDate >= value.issueDate, {
  path: ["dueDate"], message: "Due date cannot be before issue date.",
}).refine((value) => Boolean(value.taxLabel?.trim()) === (value.tax !== "0" && value.tax !== "0.00" && value.tax !== ""), {
  path: ["taxLabel"], message: "Add both a tax label and a fixed tax amount, or leave both blank.",
});

export type PocketInvoiceDraftInput = z.infer<typeof pocketInvoiceDraftInputSchema>;
export type PocketInvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "cancelled";

export interface PocketInvoiceCalculatedItem {
  position: number;
  description: string;
  quantityMilli: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface PocketInvoiceTotals {
  items: PocketInvoiceCalculatedItem[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

function parseQuantityMilli(value: string) {
  const [whole, fraction = ""] = value.split(".");
  const quantity = BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0") || "0");
  if (quantity <= 0n || quantity > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Quantity must be greater than zero.");
  return quantity;
}

function safeNumber(value: bigint) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error("Invoice amount is too large.");
  return Number(value);
}

export function calculatePocketInvoice(input: PocketInvoiceDraftInput, currency: string): PocketInvoiceTotals {
  const items = input.items.map((item, index) => {
    const quantityMilli = parseQuantityMilli(item.quantity);
    const unitPriceMinor = parseCurrencyToMinor(item.unitPrice, currency, { allowZero: true });
    const lineTotalMinor = (quantityMilli * unitPriceMinor + 500n) / 1_000n;
    return {
      position: index + 1,
      description: item.description.trim(),
      quantityMilli: safeNumber(quantityMilli),
      unitPriceMinor: safeNumber(unitPriceMinor),
      lineTotalMinor: safeNumber(lineTotalMinor),
    };
  });
  const subtotal = items.reduce((sum, item) => sum + BigInt(item.lineTotalMinor), 0n);
  const discount = parseCurrencyToMinor(input.discount || "0", currency, { allowZero: true });
  const tax = parseCurrencyToMinor(input.tax || "0", currency, { allowZero: true });
  if (discount > subtotal) throw new Error("Discount cannot be greater than the subtotal.");
  const total = subtotal - discount + tax;
  if (total <= 0n) throw new Error("Invoice total must be greater than zero.");
  return {
    items,
    subtotalMinor: safeNumber(subtotal),
    discountMinor: safeNumber(discount),
    taxMinor: safeNumber(tax),
    totalMinor: safeNumber(total),
  };
}

export function formatInvoiceQuantity(quantityMilli: number) {
  const whole = Math.trunc(quantityMilli / 1_000);
  const fraction = String(quantityMilli % 1_000).padStart(3, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function pocketInvoiceDisplayStatus(status: PocketInvoiceStatus, linkedPaidMinor: number | null, linkedOutstandingMinor: number | null): PocketInvoiceStatus {
  if (status === "draft" || status === "cancelled") return status;
  if (linkedOutstandingMinor === 0) return "paid";
  if ((linkedPaidMinor ?? 0) > 0) return "partially_paid";
  return "issued";
}

export function invoiceWhatsAppMessage(invoiceNumber: string, total: string, businessName: string) {
  return `Invoice ${invoiceNumber} from ${businessName} is ready. Total: ${total}. The PDF will be shared from your device after you confirm.`;
}

