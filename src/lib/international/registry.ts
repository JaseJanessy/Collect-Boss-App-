import {
  dateFormatPreferences,
  numberFormatPreferences,
  type CountryCapabilities,
  type RegionSettings,
  type RegionSettingsRecord,
  type SupportedCountryCode,
} from "./types.ts";

export const COUNTRY_CAPABILITIES: Record<SupportedCountryCode, CountryCapabilities> = {
  MY: {
    countryCode: "MY", displayName: "Malaysia", defaultLocale: "en-MY", supportedLocales: ["en-MY", "ms-MY"],
    defaultTimezone: "Asia/Kuala_Lumpur", supportedTimezones: ["Asia/Kuala_Lumpur"], defaultCurrency: "MYR",
    defaultLanguageCode: "en", callingCode: "60", addressOrder: ["lines", "postalCode", "locality", "administrativeArea", "country"],
    businessIdentifierTypes: [{ type: "business_registration", label: "SSM registration number" }],
    paymentCapabilityKeys: ["bank_transfer", "card"], contactPolicyHintKeys: ["tenant_policy_review_required"],
    legalHandoffWordingKey: "generic_professional_handoff",
  },
  SG: {
    countryCode: "SG", displayName: "Singapore", defaultLocale: "en-SG", supportedLocales: ["en-SG", "zh-SG", "ms-SG", "ta-SG"],
    defaultTimezone: "Asia/Singapore", supportedTimezones: ["Asia/Singapore"], defaultCurrency: "SGD",
    defaultLanguageCode: "en", callingCode: "65", addressOrder: ["lines", "locality", "postalCode", "country"],
    businessIdentifierTypes: [{ type: "business_registration", label: "UEN" }], paymentCapabilityKeys: ["bank_transfer", "card"],
    contactPolicyHintKeys: ["tenant_policy_review_required"], legalHandoffWordingKey: "generic_professional_handoff",
  },
  GB: {
    countryCode: "GB", displayName: "United Kingdom", defaultLocale: "en-GB", supportedLocales: ["en-GB", "cy-GB"],
    defaultTimezone: "Europe/London", supportedTimezones: ["Europe/London"], defaultCurrency: "GBP",
    defaultLanguageCode: "en", callingCode: "44", addressOrder: ["lines", "locality", "administrativeArea", "postalCode", "country"],
    businessIdentifierTypes: [{ type: "business_registration", label: "Companies House number" }], paymentCapabilityKeys: ["bank_transfer", "card"],
    contactPolicyHintKeys: ["tenant_policy_review_required"], legalHandoffWordingKey: "generic_professional_handoff",
  },
  AU: {
    countryCode: "AU", displayName: "Australia", defaultLocale: "en-AU", supportedLocales: ["en-AU"],
    defaultTimezone: "Australia/Sydney", supportedTimezones: ["Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane", "Australia/Adelaide", "Australia/Perth", "Australia/Hobart", "Australia/Darwin"],
    defaultCurrency: "AUD", defaultLanguageCode: "en", callingCode: "61", addressOrder: ["lines", "locality", "administrativeArea", "postalCode", "country"],
    businessIdentifierTypes: [{ type: "business_registration", label: "ABN / ACN" }], paymentCapabilityKeys: ["bank_transfer", "card"],
    contactPolicyHintKeys: ["tenant_policy_review_required"], legalHandoffWordingKey: "generic_professional_handoff",
  },
  US: {
    countryCode: "US", displayName: "United States", defaultLocale: "en-US", supportedLocales: ["en-US", "es-US"],
    defaultTimezone: "America/New_York", supportedTimezones: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"],
    defaultCurrency: "USD", defaultLanguageCode: "en", callingCode: "1", addressOrder: ["lines", "locality", "administrativeArea", "postalCode", "country"],
    businessIdentifierTypes: [{ type: "business_registration", label: "State registration identifier" }], paymentCapabilityKeys: ["bank_transfer", "card"],
    contactPolicyHintKeys: ["tenant_policy_review_required"], legalHandoffWordingKey: "generic_professional_handoff",
  },
};

export const LEGACY_MALAYSIA_REGION: RegionSettings = {
  countryCode: "MY", locale: "en-MY", timezone: "Asia/Kuala_Lumpur", defaultCurrency: "MYR",
  dateFormat: "locale", numberFormat: "locale", languageCode: "en",
};

export function isSupportedCountryCode(value: unknown): value is SupportedCountryCode {
  return typeof value === "string" && Object.hasOwn(COUNTRY_CAPABILITIES, value);
}

function validLocale(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  try { return Intl.getCanonicalLocales(value)[0] ?? fallback; } catch { return fallback; }
}

function validTimezone(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return value; } catch { return fallback; }
}

export function resolveRegionSettings(record?: RegionSettingsRecord | null): RegionSettings {
  const countryCode = isSupportedCountryCode(record?.country_code) ? record.country_code : "MY";
  const capability = COUNTRY_CAPABILITIES[countryCode];
  const currency = typeof record?.default_currency === "string" && /^[A-Z]{3}$/.test(record.default_currency)
    ? record.default_currency : capability.defaultCurrency;
  return {
    countryCode,
    locale: validLocale(record?.locale, capability.defaultLocale),
    timezone: validTimezone(record?.timezone, capability.defaultTimezone),
    defaultCurrency: currency,
    dateFormat: dateFormatPreferences.includes(record?.date_format as RegionSettings["dateFormat"])
      ? record!.date_format as RegionSettings["dateFormat"] : "locale",
    numberFormat: numberFormatPreferences.includes(record?.number_format as RegionSettings["numberFormat"])
      ? record!.number_format as RegionSettings["numberFormat"] : "locale",
    languageCode: typeof record?.language_code === "string" && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(record.language_code)
      ? record.language_code : capability.defaultLanguageCode,
  };
}

export function defaultsForCountry(countryCode: SupportedCountryCode): RegionSettings {
  const capability = COUNTRY_CAPABILITIES[countryCode];
  return {
    countryCode, locale: capability.defaultLocale, timezone: capability.defaultTimezone,
    defaultCurrency: capability.defaultCurrency, dateFormat: "locale", numberFormat: "locale",
    languageCode: capability.defaultLanguageCode,
  };
}
