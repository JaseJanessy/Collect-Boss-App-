import type { StatementRange } from "./calculations.ts";
import { formatCalendarDate, formatDate as formatRegionalDate } from "../international/formatting.ts";
import { LEGACY_MALAYSIA_REGION } from "../international/registry.ts";
import type { RegionSettings } from "../international/types.ts";

export type StatementPeriod = "current_month" | "3m" | "6m" | "12m" | "this_year" | "last_year" | "custom";

export class StatementPeriodError extends Error {}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function subtractCalendarMonthsUtc(value: Date, months: number): Date {
  const monthIndex = value.getUTCMonth() - months;
  const year = value.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(value.getUTCDate(), lastDay)));
}

function parseCivilDate(value: string | null, label: string): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new StatementPeriodError(`Enter a valid custom ${label} date.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new StatementPeriodError(`Enter a valid custom ${label} date.`);
  return parsed;
}

export function resolveStatementRange(
  period: string | null,
  now = new Date(),
  customFrom: string | null = null,
  customTo: string | null = null,
  region: RegionSettings = LEGACY_MALAYSIA_REGION,
): StatementRange {
  const current = new Date(now);
  let from: Date;
  let toExclusive: Date;

  if (period === "3m" || period === "6m" || period === "12m") {
    from = startOfUtcDay(subtractCalendarMonthsUtc(current, Number(period.slice(0, -1))));
    toExclusive = new Date(current);
  } else if (period === "current_month") {
    from = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
    toExclusive = new Date(current);
  } else if (period === "this_year") {
    from = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
    toExclusive = new Date(current);
  } else if (period === "last_year") {
    from = new Date(Date.UTC(current.getUTCFullYear() - 1, 0, 1));
    toExclusive = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  } else if (period === "custom") {
    from = parseCivilDate(customFrom, "start");
    const inclusiveEnd = parseCivilDate(customTo, "end");
    toExclusive = new Date(inclusiveEnd.getTime() + 86_400_000);
    if (from > inclusiveEnd) throw new StatementPeriodError("Custom start date must not be after the end date.");
    if (toExclusive.getTime() - from.getTime() > 3660 * 86_400_000) throw new StatementPeriodError("Custom statement periods cannot exceed 10 years.");
  } else {
    throw new StatementPeriodError("Choose a supported statement period.");
  }

  const displayEnd = new Date(Math.min(toExclusive.getTime() - 1, current.getTime()));
  return { from, toExclusive, label: `${formatCalendarDate(from.toISOString().slice(0, 10), region)} - ${formatRegionalDate(displayEnd, region)}` };
}
