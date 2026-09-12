import { COUNTRY_CAPABILITIES } from "./registry";
import type { SupportedCountryCode } from "./types";

export interface NormalizedPhone {
  displayValue: string;
  e164: string | null;
}

/** Conservative E.164 normalization. The original display value is always preserved. */
export function normalizeInternationalPhone(value: string | null | undefined, countryCode: SupportedCountryCode): NormalizedPhone {
  const displayValue = value?.trim() ?? "";
  if (!displayValue) return { displayValue, e164: null };
  const withoutExtension = displayValue.replace(/(?:ext\.?|x)\s*\d+$/i, "").trim();
  const hasPlus = withoutExtension.startsWith("+");
  let digits = withoutExtension.replace(/\D/g, "");
  if (!hasPlus) {
    digits = digits.replace(/^0+/, "");
    digits = `${COUNTRY_CAPABILITIES[countryCode].callingCode}${digits}`;
  }
  return /^\d{8,15}$/.test(digits) ? { displayValue, e164: `+${digits}` } : { displayValue, e164: null };
}
