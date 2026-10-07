/**
 * Builds LHDN MyInvois e-Invoice v1.0 documents (UBL 2.1 JSON) from a
 * CollectBoss invoice. Structure follows LHDN's official
 * "1.0-Invoice-Sample.json". Version 1.0 needs no digital signature until
 * LHDN retires it; see docs/MYINVOIS.md.
 */

export const GENERAL_PUBLIC_TIN = "EI00000000010";

/** LHDN state codes (CountrySubentityCode). */
export const MALAYSIAN_STATE_CODES = {
  "01": "Johor", "02": "Kedah", "03": "Kelantan", "04": "Melaka", "05": "Negeri Sembilan",
  "06": "Pahang", "07": "Pulau Pinang", "08": "Perak", "09": "Perlis", "10": "Selangor",
  "11": "Terengganu", "12": "Sabah", "13": "Sarawak", "14": "Wilayah Persekutuan Kuala Lumpur",
  "15": "Wilayah Persekutuan Labuan", "16": "Wilayah Persekutuan Putrajaya", "17": "Not Applicable",
} as const;
export type StateCode = keyof typeof MALAYSIAN_STATE_CODES;

/** Tax types: 01 Sales tax, 02 Service tax, 06 Not applicable (not SST-registered), E Exempt. */
export type TaxType = "01" | "02" | "06" | "E";

export interface EinvoiceAddress {
  line: string;
  city: string;
  postcode: string;
  stateCode: StateCode;
  countryCode: string; // ISO 3166-1 alpha-3, e.g. MYS
}

export interface EinvoiceSupplier {
  name: string;
  tin: string;
  brn: string;
  sst: string | null;
  ttx: string | null;
  msicCode: string;
  activityDescription: string;
  phone: string;
  email: string | null;
  address: EinvoiceAddress;
  taxType: TaxType;
  taxRatePercent: number;
}

export interface EinvoiceBuyer {
  name: string;
  tin: string | null;
  idScheme: "BRN" | "NRIC" | "PASSPORT" | "ARMY" | null;
  idValue: string | null;
  sst: string | null;
  phone: string | null;
  email: string | null;
  address: EinvoiceAddress | null;
}

export interface EinvoiceInvoice {
  codeNumber: string; // Our invoice reference, unique per supplier
  issueDate: string; // YYYY-MM-DD
  issueTimeUtc: string; // HH:MM:SSZ
  currency: string;
  totalMinor: number; // Payable amount, tax inclusive
  description: string;
}

const text = (value: string | number | boolean) => [{ _: value }];
const money = (minor: number, currency: string) => [{ _: Math.round(minor) / 100, currencyID: currency }];
const id = (value: string, schemeID: string) => ({ ID: [{ _: value, schemeID }] });

function addressJson(address: EinvoiceAddress) {
  const lines = address.line.split(/[,\n]/).map((part) => part.trim()).filter(Boolean).slice(0, 3);
  return [{
    CityName: text(address.city),
    PostalZone: text(address.postcode),
    CountrySubentityCode: text(address.stateCode),
    AddressLine: (lines.length ? lines : [address.line]).map((line) => ({ Line: text(line) })),
    Country: [{ IdentificationCode: [{ _: address.countryCode, listID: "ISO3166-1", listAgencyID: "6" }] }],
  }];
}

/** Splits a tax-inclusive total into taxable amount and tax (minor units). */
export function splitTax(totalMinor: number, taxType: TaxType, ratePercent: number) {
  if (taxType === "06" || taxType === "E" || ratePercent <= 0) return { taxableMinor: totalMinor, taxMinor: 0 };
  const taxableMinor = Math.round(totalMinor / (1 + ratePercent / 100));
  return { taxableMinor, taxMinor: totalMinor - taxableMinor };
}

/** Plain-language problems that would make LHDN reject the document. */
export function validateEinvoiceInput(supplier: EinvoiceSupplier, buyer: EinvoiceBuyer, invoice: EinvoiceInvoice): string[] {
  const problems: string[] = [];
  if (!/^(C|IG|D|E|F|FA|PT|TA|TC|TN|TR|TP|J|LE)\d{8,12}$|^EI\d{11}$/.test(supplier.tin)) problems.push("Your business TIN looks incorrect (for example C1234567890).");
  if (!supplier.brn.trim()) problems.push("Add your business registration number (SSM).");
  if (!/^\d{5}$/.test(supplier.msicCode)) problems.push("Add your 5-digit MSIC code.");
  if (!supplier.activityDescription.trim()) problems.push("Add a short description of your business activity.");
  if (!/^\+?\d{8,15}$/.test(supplier.phone.replace(/[\s-]/g, ""))) problems.push("Add your business phone number.");
  if (!supplier.address.line.trim() || !supplier.address.city.trim() || !/^\d{5}$/.test(supplier.address.postcode)) problems.push("Complete your business address (street, city and 5-digit postcode).");
  if (!buyer.name.trim()) problems.push("The customer needs a name.");
  if (!buyer.tin && buyer.idScheme !== "NRIC" && buyer.idScheme !== "PASSPORT") problems.push("Add the customer's TIN, or their IC/passport number for individuals.");
  if (buyer.tin && !buyer.idValue) problems.push("Add the customer's registration number (BRN) or IC number.");
  if (!buyer.address || !buyer.address.city.trim() || !buyer.address.line.trim()) problems.push("Add the customer's address with city.");
  if (!/^[A-Z]{3}$/.test(invoice.currency)) problems.push("The invoice currency is invalid.");
  if (!Number.isSafeInteger(invoice.totalMinor) || invoice.totalMinor <= 0) problems.push("The invoice amount must be more than zero.");
  if (!invoice.codeNumber.trim() || invoice.codeNumber.length > 50) problems.push("The invoice number must be 1–50 characters.");
  return problems;
}

/** LHDN e-Invoice v1.0 (Invoice type 01) as UBL JSON. */
export function buildMyInvoisInvoice(supplier: EinvoiceSupplier, buyer: EinvoiceBuyer, invoice: EinvoiceInvoice) {
  const currency = invoice.currency;
  const { taxableMinor, taxMinor } = splitTax(invoice.totalMinor, supplier.taxType, supplier.taxRatePercent);
  const taxScheme = [{ ID: [{ _: "OTH", schemeID: "UN/ECE 5153", schemeAgencyID: "6" }] }];
  const taxCategory = [{
    ID: text(supplier.taxType),
    ...(supplier.taxType === "E" ? { TaxExemptionReason: text("Exempted supply") } : {}),
    TaxScheme: taxScheme,
  }];
  const taxSubtotal = [{
    TaxableAmount: money(taxableMinor, currency),
    TaxAmount: money(taxMinor, currency),
    ...(supplier.taxType === "01" || supplier.taxType === "02" ? { Percent: text(supplier.taxRatePercent) } : {}),
    TaxCategory: taxCategory,
  }];
  const buyerTin = buyer.tin ?? GENERAL_PUBLIC_TIN;
  const buyerIdScheme = buyer.idScheme ?? "BRN";

  return {
    _D: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    _A: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    _B: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    Invoice: [{
      ID: text(invoice.codeNumber),
      IssueDate: text(invoice.issueDate),
      IssueTime: text(invoice.issueTimeUtc),
      InvoiceTypeCode: [{ _: "01", listVersionID: "1.0" }],
      DocumentCurrencyCode: text(currency),
      TaxCurrencyCode: text(currency),
      AccountingSupplierParty: [{
        Party: [{
          IndustryClassificationCode: [{ _: supplier.msicCode, name: supplier.activityDescription }],
          PartyIdentification: [
            id(supplier.tin, "TIN"),
            id(supplier.brn, "BRN"),
            id(supplier.sst || "NA", "SST"),
            id(supplier.ttx || "NA", "TTX"),
          ],
          PostalAddress: addressJson(supplier.address),
          PartyLegalEntity: [{ RegistrationName: text(supplier.name) }],
          Contact: [{ Telephone: text(supplier.phone), ElectronicMail: text(supplier.email || "NA") }],
        }],
      }],
      AccountingCustomerParty: [{
        Party: [{
          PostalAddress: addressJson(buyer.address ?? { line: "NA", city: "NA", postcode: "00000", stateCode: "17", countryCode: "MYS" }),
          PartyLegalEntity: [{ RegistrationName: text(buyer.name) }],
          PartyIdentification: [
            id(buyerTin, "TIN"),
            id(buyer.idValue || "NA", buyerIdScheme),
            id(buyer.sst || "NA", "SST"),
          ],
          Contact: [{ Telephone: text(buyer.phone || "NA"), ElectronicMail: text(buyer.email || "NA") }],
        }],
      }],
      TaxTotal: [{ TaxAmount: money(taxMinor, currency), TaxSubtotal: taxSubtotal }],
      LegalMonetaryTotal: [{
        LineExtensionAmount: money(taxableMinor, currency),
        TaxExclusiveAmount: money(taxableMinor, currency),
        TaxInclusiveAmount: money(invoice.totalMinor, currency),
        PayableAmount: money(invoice.totalMinor, currency),
      }],
      InvoiceLine: [{
        ID: text("1"),
        InvoicedQuantity: [{ _: 1, unitCode: "C62" }],
        LineExtensionAmount: money(taxableMinor, currency),
        TaxTotal: [{ TaxAmount: money(taxMinor, currency), TaxSubtotal: taxSubtotal }],
        Item: [{
          // CLASS 022 = "Others" in LHDN's classification code list.
          CommodityClassification: [{ ItemClassificationCode: [{ _: "022", listID: "CLASS" }] }],
          Description: text(invoice.description.slice(0, 300) || invoice.codeNumber),
        }],
        Price: [{ PriceAmount: money(taxableMinor, currency) }],
        ItemPriceExtension: [{ Amount: money(taxableMinor, currency) }],
      }],
    }],
  };
}
