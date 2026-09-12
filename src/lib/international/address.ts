import { COUNTRY_CAPABILITIES } from "./registry";
import type { StructuredAddress } from "./types";

export function formatAddress(address: StructuredAddress, separator = "\n"): string {
  const capability = COUNTRY_CAPABILITIES[address.countryCode];
  const parts: Record<(typeof capability.addressOrder)[number], string[]> = {
    lines: address.lines.map((line) => line.trim()).filter(Boolean),
    locality: address.locality?.trim() ? [address.locality.trim()] : [],
    administrativeArea: address.administrativeArea?.trim() ? [address.administrativeArea.trim()] : [],
    postalCode: address.postalCode?.trim() ? [address.postalCode.trim()] : [],
    country: [capability.displayName],
  };
  return capability.addressOrder.flatMap((key) => parts[key]).join(separator);
}

export function emptyStructuredAddress(countryCode: StructuredAddress["countryCode"]): StructuredAddress {
  return { lines: [], locality: null, administrativeArea: null, postalCode: null, countryCode };
}
