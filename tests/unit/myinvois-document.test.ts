import { describe, expect, it } from "vitest";
import {
  buildMyInvoisInvoice,
  GENERAL_PUBLIC_TIN,
  splitTax,
  validateEinvoiceInput,
  type EinvoiceBuyer,
  type EinvoiceSupplier,
} from "@/lib/einvoice/myinvois-document";

const supplier: EinvoiceSupplier = {
  name: "Syarikat Maju Sdn Bhd", tin: "C1234567890", brn: "202401012345", sst: null, ttx: null,
  msicCode: "46510", activityDescription: "Wholesale of hardware", phone: "+60123456789", email: "accounts@maju.my",
  address: { line: "Lot 66, Jalan Merdeka", city: "Kuala Lumpur", postcode: "50480", stateCode: "14", countryCode: "MYS" },
  taxType: "06", taxRatePercent: 0,
};
const buyer: EinvoiceBuyer = {
  name: "Kedai Bina Sdn Bhd", tin: "C9876543210", idScheme: "BRN", idValue: "201901234567", sst: null,
  phone: "+60198765432", email: null,
  address: { line: "No 3, Jalan SS2", city: "Petaling Jaya", postcode: "47300", stateCode: "10", countryCode: "MYS" },
};
const invoice = { codeNumber: "INV-2026-0001", issueDate: "2026-10-05", issueTimeUtc: "02:30:00Z", currency: "MYR", totalMinor: 150_000, description: "Invoice INV-2026-0001" };

const value = (node: unknown) => (node as Array<{ _: unknown }>)[0]._;

describe("MyInvois e-Invoice v1.0 builder", () => {
  it("produces the UBL JSON shape of LHDN's official v1.0 sample", () => {
    const doc = buildMyInvoisInvoice(supplier, buyer, invoice);
    expect(doc._D).toBe("urn:oasis:names:specification:ubl:schema:xsd:Invoice-2");
    const inv = doc.Invoice[0];
    expect(value(inv.ID)).toBe("INV-2026-0001");
    expect(inv.InvoiceTypeCode).toEqual([{ _: "01", listVersionID: "1.0" }]);
    const party = inv.AccountingSupplierParty[0].Party[0];
    expect(party.PartyIdentification.map((item) => item.ID[0].schemeID)).toEqual(["TIN", "BRN", "SST", "TTX"]);
    expect(party.PostalAddress[0].Country[0].IdentificationCode[0]).toEqual({ _: "MYS", listID: "ISO3166-1", listAgencyID: "6" });
    expect(party.PostalAddress[0].AddressLine.map((line) => value(line.Line))).toEqual(["Lot 66", "Jalan Merdeka"]);
    expect(inv.LegalMonetaryTotal[0].PayableAmount).toEqual([{ _: 1500, currencyID: "MYR" }]);
    expect(inv.InvoiceLine[0].Item[0].CommodityClassification[0].ItemClassificationCode[0]).toEqual({ _: "022", listID: "CLASS" });
    expect(value(inv.TaxTotal[0].TaxSubtotal[0].TaxCategory[0].ID)).toBe("06");
  });

  it("splits tax-inclusive totals for SST-registered businesses", () => {
    expect(splitTax(10_800, "02", 8)).toEqual({ taxableMinor: 10_000, taxMinor: 800 });
    expect(splitTax(10_800, "06", 8)).toEqual({ taxableMinor: 10_800, taxMinor: 0 });
    const doc = buildMyInvoisInvoice({ ...supplier, taxType: "02", taxRatePercent: 8 }, buyer, { ...invoice, totalMinor: 10_800 });
    const total = doc.Invoice[0].LegalMonetaryTotal[0];
    expect(total.TaxExclusiveAmount[0]._).toBe(100);
    expect(total.TaxInclusiveAmount[0]._).toBe(108);
  });

  it("uses the general public TIN for individual buyers without a TIN", () => {
    const doc = buildMyInvoisInvoice(supplier, { ...buyer, tin: null, idScheme: "NRIC", idValue: "900101145566" }, invoice);
    const ids = doc.Invoice[0].AccountingCustomerParty[0].Party[0].PartyIdentification;
    expect(ids[0].ID[0]).toEqual({ _: GENERAL_PUBLIC_TIN, schemeID: "TIN" });
    expect(ids[1].ID[0]).toEqual({ _: "900101145566", schemeID: "NRIC" });
  });

  it("explains missing details in plain words before anything is sent", () => {
    expect(validateEinvoiceInput(supplier, buyer, invoice)).toEqual([]);
    const problems = validateEinvoiceInput({ ...supplier, msicCode: "", tin: "123" }, { ...buyer, tin: null, idScheme: "BRN", address: null }, invoice);
    expect(problems).toContain("Add your 5-digit MSIC code.");
    expect(problems.some((problem) => problem.includes("TIN looks incorrect"))).toBe(true);
    expect(problems.some((problem) => problem.includes("customer's TIN"))).toBe(true);
    expect(problems.some((problem) => problem.includes("customer's address"))).toBe(true);
  });
});
