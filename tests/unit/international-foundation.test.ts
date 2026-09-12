import { describe, expect, it } from "vitest";
import { formatAddress } from "@/lib/international/address";
import { formatCalendarDate, formatCurrency, formatDateTime } from "@/lib/international/formatting";
import { COUNTRY_CAPABILITIES, defaultsForCountry, resolveRegionSettings } from "@/lib/international/registry";
import { normalizeInternationalPhone } from "@/lib/international/phone";

describe("international locale foundation", () => {
  it.each([
    ["MY", "MYR", "Asia/Kuala_Lumpur"], ["SG", "SGD", "Asia/Singapore"],
    ["GB", "GBP", "Europe/London"], ["AU", "AUD", "Australia/Sydney"],
    ["US", "USD", "America/New_York"],
  ] as const)("resolves %s defaults", (country, currency, timezone) => {
    const settings = defaultsForCountry(country);
    expect(settings.defaultCurrency).toBe(currency);
    expect(settings.timezone).toBe(timezone);
    expect(COUNTRY_CAPABILITIES[country].countryCode).toBe(country);
  });

  it("keeps the legacy Malaysia configuration when region columns are absent", () => {
    expect(resolveRegionSettings({})).toEqual({
      countryCode: "MY", locale: "en-MY", timezone: "Asia/Kuala_Lumpur", defaultCurrency: "MYR",
      dateFormat: "locale", numberFormat: "locale", languageCode: "en",
    });
  });

  it("changes presentation without changing the supplied amount", () => {
    const amount = 1234.56;
    expect(formatCurrency(amount, defaultsForCountry("MY"))).toContain("1,234.56");
    expect(formatCurrency(amount, defaultsForCountry("GB"))).toContain("1,234.56");
    expect(amount).toBe(1234.56);
  });

  it("uses the tenant timezone for timestamps and does not shift civil dates", () => {
    const singapore = defaultsForCountry("SG");
    const newYork = defaultsForCountry("US");
    const instant = "2026-01-01T01:00:00.000Z";
    expect(formatDateTime(instant, singapore)).not.toBe(formatDateTime(instant, newYork));
    expect(formatCalendarDate("2026-01-01", singapore)).toContain("2026");
    expect(formatCalendarDate("2026-01-01", newYork)).toContain("2026");
  });

  it("formats country-shaped addresses without Malaysia-only requirements", () => {
    expect(formatAddress({ lines: ["10 Downing Street"], locality: "London", administrativeArea: null, postalCode: "SW1A 2AA", countryCode: "GB" }))
      .toBe("10 Downing Street\nLondon\nSW1A 2AA\nUnited Kingdom");
    expect(formatAddress({ lines: ["1 Market Street"], locality: "San Francisco", administrativeArea: "CA", postalCode: "94105", countryCode: "US" }))
      .toContain("CA");
  });

  it("preserves phone display values while producing E.164 when safe", () => {
    expect(normalizeInternationalPhone("012-345 6789", "MY")).toEqual({ displayValue: "012-345 6789", e164: "+60123456789" });
    expect(normalizeInternationalPhone("not a phone", "GB")).toEqual({ displayValue: "not a phone", e164: null });
  });
});
