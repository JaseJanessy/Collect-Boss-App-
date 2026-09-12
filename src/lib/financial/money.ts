/** Exact currency helpers. Financial writes must use integer minor units. */
export type MinorUnits = bigint;
export type CurrencyCode = string;

export interface CurrencyMetadata {
  code: CurrencyCode;
  locale: string;
  minorUnit: number;
}

const ISO_CODE = /^[A-Z]{3}$/;
const LOCALES: Record<string, string> = {
  AED: "en-AE",
  AUD: "en-AU",
  CAD: "en-CA",
  EUR: "en-IE",
  GBP: "en-GB",
  MYR: "en-MY",
  NZD: "en-NZ",
  SGD: "en-SG",
  USD: "en-US",
};

const PRESENTATION_LABELS: Record<string, { label: string; space: boolean }> = {
  MYR: { label: "RM", space: true },
  SGD: { label: "S$", space: false },
  USD: { label: "US$", space: false },
  GBP: { label: "GBP", space: true },
  AUD: { label: "AUD", space: true },
};

// Intl supplies the generic path. These ISO 4217 overrides cover currencies
// whose minor units are commonly mishandled by two-decimal assumptions.
const MINOR_UNIT_OVERRIDES: Record<string, number> = {
  BHD: 3,
  CLF: 4,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  IQD: 3,
  ISK: 0,
  JOD: 3,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  PYG: 0,
  RWF: 0,
  TND: 3,
  UGX: 0,
  UYI: 0,
  UYW: 4,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
};

export function normalizeCurrencyCode(value: string): CurrencyCode {
  const code = value.trim().toUpperCase();
  if (!ISO_CODE.test(code)) throw new Error("Currency must be a three-letter ISO code.");
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code }).format(0);
  } catch {
    throw new Error(`Unsupported ISO currency code: ${code}.`);
  }
  return code;
}

export function getCurrencyMetadata(currency: string, locale?: string): CurrencyMetadata {
  const code = normalizeCurrencyCode(currency);
  const resolvedLocale = locale?.trim() || LOCALES[code] || "en";
  const resolved = new Intl.NumberFormat(resolvedLocale, {
    style: "currency",
    currency: code,
  }).resolvedOptions();
  return {
    code,
    locale: resolvedLocale,
    minorUnit: MINOR_UNIT_OVERRIDES[code] ?? resolved.maximumFractionDigits,
  };
}

export function minorToDecimalString(minor: MinorUnits, currency: string): string {
  const { minorUnit } = getCurrencyMetadata(currency);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  if (minorUnit === 0) return `${negative ? "-" : ""}${absolute}`;
  const scale = 10n ** BigInt(minorUnit);
  return `${negative ? "-" : ""}${absolute / scale}.${(absolute % scale).toString().padStart(minorUnit, "0")}`;
}

export function parseCurrencyToMinor(
  value: string,
  currency: string,
  options: { allowZero?: boolean; allowNegative?: boolean } = {},
): MinorUnits {
  const { code, minorUnit } = getCurrencyMetadata(currency);
  const normalized = value.trim();
  const match = /^(?<sign>-)?(?<whole>0|[1-9]\d*)(?:\.(?<fraction>\d+))?$/.exec(normalized);
  if (!match?.groups) throw new Error(`Enter a valid ${code} amount.`);
  const fraction = match.groups.fraction ?? "";
  if (fraction.length > minorUnit) {
    throw new Error(`${code} supports at most ${minorUnit} decimal place${minorUnit === 1 ? "" : "s"}.`);
  }
  if (match.groups.sign && !options.allowNegative) throw new Error("Amount cannot be negative.");
  const scale = 10n ** BigInt(minorUnit);
  const absolute = BigInt(match.groups.whole) * scale + BigInt(fraction.padEnd(minorUnit, "0") || "0");
  const result = match.groups.sign ? -absolute : absolute;
  if (result === 0n && !options.allowZero) throw new Error("Amount must be greater than zero.");
  return result;
}

export function minorToMajorNumber(minor: MinorUnits | number, currency: string): number {
  const value = typeof minor === "bigint" ? minor : BigInt(minor);
  const parsed = Number(minorToDecimalString(value, currency));
  if (!Number.isFinite(parsed)) throw new Error("Currency amount is too large to present.");
  return parsed;
}

export function formatCurrencyMinor(
  minor: MinorUnits | number,
  currency: string,
  options: { locale?: string; explicitCode?: boolean } = {},
): string {
  const metadata = getCurrencyMetadata(currency, options.locale);
  const value = minorToMajorNumber(minor, metadata.code);
  const presentation = !options.explicitCode ? PRESENTATION_LABELS[metadata.code] : undefined;
  if (presentation) {
    const formattedNumber = new Intl.NumberFormat(metadata.locale, {
      style: "decimal",
      minimumFractionDigits: metadata.minorUnit,
      maximumFractionDigits: metadata.minorUnit,
    }).format(value);
    return `${presentation.label}${presentation.space ? "\u00a0" : ""}${formattedNumber}`;
  }
  const formatted = new Intl.NumberFormat(metadata.locale, {
    style: "currency",
    currency: metadata.code,
    currencyDisplay: options.explicitCode ? "code" : "symbol",
    minimumFractionDigits: metadata.minorUnit,
    maximumFractionDigits: metadata.minorUnit,
  }).format(value);
  return options.explicitCode && !formatted.includes(metadata.code)
    ? `${metadata.code} ${formatted}`
    : formatted;
}

export function databaseAmountToMinor(
  value: string | number | null | undefined,
  currency = "MYR",
): MinorUnits {
  if (value === null || value === undefined) return 0n;
  return parseCurrencyToMinor(String(value), currency, { allowZero: true, allowNegative: true });
}

/** Backward-compatible Malaysia adapters. */
export function parseMyrToMinor(value: string): MinorUnits {
  return parseCurrencyToMinor(value, "MYR");
}

export function minorToMyRDecimal(minor: MinorUnits): string {
  if (minor < 0n) throw new Error("Currency amount cannot be negative.");
  return minorToDecimalString(minor, "MYR");
}
