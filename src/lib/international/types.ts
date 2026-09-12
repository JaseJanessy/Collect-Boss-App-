export const supportedCountryCodes = ["MY", "SG", "GB", "AU", "US"] as const;
export type SupportedCountryCode = typeof supportedCountryCodes[number];

export const dateFormatPreferences = ["locale", "day-month-year", "month-day-year", "year-month-day"] as const;
export type DateFormatPreference = typeof dateFormatPreferences[number];

export const numberFormatPreferences = ["locale", "comma-decimal", "dot-decimal"] as const;
export type NumberFormatPreference = typeof numberFormatPreferences[number];

export interface RegionSettings {
  countryCode: SupportedCountryCode;
  locale: string;
  timezone: string;
  defaultCurrency: string;
  dateFormat: DateFormatPreference;
  numberFormat: NumberFormatPreference;
  languageCode: string;
}

export interface StructuredAddress {
  lines: string[];
  locality: string | null;
  administrativeArea: string | null;
  postalCode: string | null;
  countryCode: SupportedCountryCode;
}

export interface BusinessRegistrationIdentifier {
  type: string;
  value: string;
  label: string | null;
  issuingCountry: SupportedCountryCode;
}

export interface CountryCapabilities {
  countryCode: SupportedCountryCode;
  displayName: string;
  defaultLocale: string;
  supportedLocales: readonly string[];
  defaultTimezone: string;
  supportedTimezones: readonly string[];
  defaultCurrency: string;
  defaultLanguageCode: string;
  callingCode: string;
  addressOrder: readonly ("lines" | "locality" | "administrativeArea" | "postalCode" | "country")[];
  businessIdentifierTypes: readonly { type: string; label: string }[];
  paymentCapabilityKeys: readonly string[];
  contactPolicyHintKeys: readonly string[];
  legalHandoffWordingKey: string;
}

export interface RegionSettingsRecord {
  country_code?: unknown;
  locale?: unknown;
  timezone?: unknown;
  default_currency?: unknown;
  date_format?: unknown;
  number_format?: unknown;
  language_code?: unknown;
}

export interface RegionConfigurationDto {
  settings: RegionSettings;
  address: StructuredAddress;
  phoneDisplay: string | null;
  phoneE164: string | null;
  registrationIdentifiers: BusinessRegistrationIdentifier[];
  defaultsSource: string;
  defaultsDeterminedAt: string;
  canManage: boolean;
}
