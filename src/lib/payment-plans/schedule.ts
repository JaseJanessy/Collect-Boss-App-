export type PaymentPlanFrequency = "weekly" | "monthly" | "custom";

export interface InstallmentPreview {
  sequence: number;
  dueDate: string;
  amountMinor: bigint;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string): { year: number; month: number; day: number } {
  if (!ISO_DATE.test(value)) throw new Error("Use a valid YYYY-MM-DD due date.");
  const [year, month, day] = value.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error("Use a valid YYYY-MM-DD due date.");
  }
  return { year, month, day };
}

function formatDate(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addMonthsClamped(value: string, offset: number): string {
  const { year, month, day } = parseDate(value);
  const zeroIndexed = year * 12 + month - 1 + offset;
  const targetYear = Math.floor(zeroIndexed / 12);
  const targetMonth = (zeroIndexed % 12) + 1;
  return formatDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

function addDays(value: string, offset: number): string {
  const { year, month, day } = parseDate(value);
  const next = new Date(Date.UTC(year, month - 1, day + offset));
  return formatDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/** Preview only. The database function independently derives the authoritative schedule. */
export function buildInstallmentPreview(input: {
  totalMinor: bigint;
  count: number;
  firstDueDate: string;
  frequency: PaymentPlanFrequency;
  customDueDates?: string[];
}): InstallmentPreview[] {
  if (input.totalMinor <= 0n) throw new Error("Plan total must be positive.");
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 24) throw new Error("Choose between 1 and 24 instalments.");
  parseDate(input.firstDueDate);

  const customDates = input.customDueDates?.map((value) => value.trim()).filter(Boolean) ?? [];
  let dueDates: string[];
  if (input.frequency === "custom") {
    if (customDates.length !== input.count) throw new Error("Provide one custom due date for every instalment.");
    dueDates = customDates;
    dueDates.forEach(parseDate);
    if (dueDates[0] !== input.firstDueDate || dueDates.some((date, index) => index > 0 && date <= dueDates[index - 1])) {
      throw new Error("Custom due dates must begin with the first due date and be strictly increasing.");
    }
  } else {
    dueDates = Array.from({ length: input.count }, (_, index) =>
      input.frequency === "weekly" ? addDays(input.firstDueDate, index * 7) : addMonthsClamped(input.firstDueDate, index),
    );
  }

  const base = input.totalMinor / BigInt(input.count);
  const remainder = input.totalMinor % BigInt(input.count);
  return dueDates.map((dueDate, index) => ({
    sequence: index + 1,
    dueDate,
    amountMinor: base + (index === input.count - 1 ? remainder : 0n),
  }));
}

export function minorToMyrNumber(value: bigint): number {
  return Number(value) / 100;
}
