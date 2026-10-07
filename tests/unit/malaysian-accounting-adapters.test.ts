import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("Bukku adapter", () => {
  it("maps customers and skips supplier-only contacts", async () => {
    const { mapBukkuContact } = await import("@/lib/accounting/providers/bukku");
    expect(mapBukkuContact({ id: 7, legal_name: "Alpha Company Sdn Bhd", other_name: "Alpha", reg_no: "1151520-P", email: "a@alpha.my", phone_no: "60123456789", contact_code: "C-A0001", types: ["customer"] }))
      .toMatchObject({ externalId: "7", name: "Alpha Company Sdn Bhd", registrationNumber: "1151520-P", accountNumber: "C-A0001", status: "active" });
    expect(mapBukkuContact({ id: 8, legal_name: "Supplier", types: ["supplier"] })).toBeNull();
  });

  it("uses the invoice balance and latest term date", async () => {
    const { mapBukkuInvoice } = await import("@/lib/accounting/providers/bukku");
    const invoice = mapBukkuInvoice({
      id: 1, number: "IV-00231", contact_id: 7, date: "2026-09-01", currency_code: "MYR", amount: 2000, balance: 500, status: "ready",
      term_items: [{ date: "2026-09-15", amount: 1000 }, { date: "2026-10-01", amount: 1000 }],
    });
    expect(invoice).toMatchObject({ reference: "IV-00231", totalMinor: 200_000, outstandingMinor: 50_000, paidMinor: 150_000, dueDate: "2026-10-01", status: "open" });
    expect(mapBukkuInvoice({ id: 2, contact_id: 7, amount: 100, balance: 0, status: "ready", date: "2026-09-01" })?.status).toBe("paid");
    expect(mapBukkuInvoice({ id: 3, contact_id: 7, amount: 100, status: "void", date: "2026-09-01" })?.status).toBe("void");
  });
});

describe("AutoCount adapter", () => {
  it("maps debtors whichever casing the API returns", async () => {
    const { mapAutoCountDebtor } = await import("@/lib/accounting/providers/autocount");
    expect(mapAutoCountDebtor({ AccNo: "300-0001", CompanyName: "Customer A", Phone1: "03-1234 5678", EmailAddress: "a@cust.my", IsActive: true }))
      .toMatchObject({ externalId: "300-0001", name: "Customer A", phone: "03-1234 5678", email: "a@cust.my", status: "active" });
    expect(mapAutoCountDebtor({ accNo: "300-0002", companyName: "B", isActive: false })?.status).toBe("archived");
  });

  it("maps invoice listing masters with outstanding amounts", async () => {
    const { mapAutoCountInvoice } = await import("@/lib/accounting/providers/autocount");
    const invoice = mapAutoCountInvoice({ master: {
      docKey: 121, docNo: "I-000001", docDate: "2023-03-06T00:00:00", dueDate: "2023-04-05T00:00:00", debtorCode: "300-D002",
      currencyCode: "MYR", cancelled: false, netTotal: 472.5, finalTotal: 472.5, outstandingAmount: 72.5, lastModified: "2023-03-08T14:20:22.6243419",
    } });
    expect(invoice).toMatchObject({ externalId: "121", contactExternalId: "300-D002", reference: "I-000001", dueDate: "2023-04-05", totalMinor: 47_250, outstandingMinor: 7_250, status: "open" });
  });

  it("keeps credentials complete and rejects partial keys", async () => {
    const { parseAutoCountCredentials } = await import("@/lib/accounting/providers/autocount");
    expect(parseAutoCountCredentials(JSON.stringify({ keyId: "k1", apiKey: "secret" }))).toEqual({ keyId: "k1", apiKey: "secret" });
    expect(() => parseAutoCountCredentials("{}")).toThrow();
  });
});

describe("provider migration", () => {
  it("adds providers without dropping existing ones such as stripe and resend", () => {
    const sql = readFileSync("supabase/migrations/20260924_malaysian_accounting_providers.sql", "utf8");
    expect(sql).toMatch(/replace\(r\.def, '''quickbooks''::text', '''quickbooks''::text, ''bukku''::text, ''autocount''::text'\)/);
    const schema = readFileSync("supabase/schema.sql", "utf8");
    expect(schema).toMatch(/provider in\('stripe','resend','xero','quickbooks','bukku','autocount'\)/);
  });
});
