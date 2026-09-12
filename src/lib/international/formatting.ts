import type { RegionSettings } from "./types.ts";
import { formatCurrencyMinor } from "../financial/money.ts";

function dateLocale(settings: RegionSettings): string {
  if (settings.dateFormat === "day-month-year") return "en-GB";
  if (settings.dateFormat === "month-day-year") return "en-US";
  if (settings.dateFormat === "year-month-day") return "sv-SE";
  return settings.locale;
}

function numberLocale(settings: RegionSettings): string {
  if (settings.numberFormat === "comma-decimal") return "de-DE";
  if (settings.numberFormat === "dot-decimal") return "en-US";
  return settings.locale;
}

function asDate(value: Date | string | number): Date {
  const result = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(result.getTime())) throw new Error("Unable to format an invalid date.");
  return result;
}

export function formatNumber(value: number, settings: RegionSettings, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(numberLocale(settings), options).format(value);
}

/** Formats a major-unit value for presentation. Financial storage remains unchanged. */
export function formatCurrency(value: number, settings: RegionSettings, currency = settings.defaultCurrency, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(numberLocale(settings), { style: "currency", currency, ...options }).format(value);
}

export function formatMinorCurrency(value: number | bigint, settings: RegionSettings, currency = settings.defaultCurrency): string {
  return formatCurrencyMinor(value, currency, { locale: numberLocale(settings) });
}

export function formatDate(value: Date | string | number, settings: RegionSettings, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(dateLocale(settings), {
    dateStyle: "medium",
    timeZone: settings.timezone,
    ...options,
  }).format(asDate(value));
}

export function formatDateTime(value: Date | string | number, settings: RegionSettings, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(dateLocale(settings), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: settings.timezone,
    ...options,
  }).format(asDate(value));
}

/** Formats a civil YYYY-MM-DD value without shifting it across timezones. */
export function formatCalendarDate(value: string, settings: RegionSettings, options: Intl.DateTimeFormatOptions = {}): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Unable to format an invalid calendar date.");
  return new Intl.DateTimeFormat(dateLocale(settings), { dateStyle: "medium", timeZone: "UTC", ...options })
    .format(new Date(`${value}T00:00:00.000Z`));
}

export function formatMonth(value: string, settings: RegionSettings): string {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error("Unable to format an invalid calendar month.");
  return new Intl.DateTimeFormat(dateLocale(settings), { month: "short", timeZone: "UTC" })
    .format(new Date(`${value}-01T00:00:00.000Z`));
}
