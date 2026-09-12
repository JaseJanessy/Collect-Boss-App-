import { z } from "zod";
import { COUNTRY_CAPABILITIES } from "./registry";
import { dateFormatPreferences, numberFormatPreferences, supportedCountryCodes } from "./types";

const countryCode = z.enum(supportedCountryCodes);

export const structuredAddressSchema = z.object({
  lines: z.array(z.string().trim().min(1).max(160)).max(4),
  locality: z.string().trim().max(100).nullable(),
  administrativeArea: z.string().trim().max(100).nullable(),
  postalCode: z.string().trim().max(30).nullable(),
  countryCode,
});

export const businessRegistrationIdentifierSchema = z.object({
  type: z.string().trim().regex(/^[a-z][a-z0-9_]{1,49}$/),
  value: z.string().trim().min(1).max(120),
  label: z.string().trim().max(100).nullable(),
  issuingCountry: countryCode,
});

export const regionSettingsUpdateSchema = z.object({
  countryCode,
  locale: z.string().trim().max(35),
  timezone: z.string().trim().max(64),
  defaultCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  dateFormat: z.enum(dateFormatPreferences),
  numberFormat: z.enum(numberFormatPreferences),
  languageCode: z.string().trim().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/),
  address: structuredAddressSchema,
  phoneDisplay: z.string().trim().max(50).nullable(),
  registrationIdentifiers: z.array(businessRegistrationIdentifierSchema).max(10),
}).superRefine((value, context) => {
  const capability = COUNTRY_CAPABILITIES[value.countryCode];
  if (!capability.supportedLocales.includes(value.locale)) {
    context.addIssue({ code: "custom", path: ["locale"], message: "Choose a locale supported by the selected country." });
  }
  if (!capability.supportedTimezones.includes(value.timezone)) {
    context.addIssue({ code: "custom", path: ["timezone"], message: "Choose a timezone supported by the selected country." });
  }
  if (value.address.countryCode !== value.countryCode) {
    context.addIssue({ code: "custom", path: ["address", "countryCode"], message: "Address country must match the business country." });
  }
});
