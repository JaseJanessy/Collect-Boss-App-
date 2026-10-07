import { z } from "zod";

/** Monthly schedule for an ongoing account, e.g. rent due on the 1st. */
export const recurringChargeSchema = z.object({
  account_id: z.uuid(),
  label: z.string().trim().min(2, "Enter what this charge is for, e.g. Monthly rent.").max(80),
  reference_prefix: z.string().trim().toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{0,23}$/, "Use up to 24 letters, numbers or dashes, e.g. RENT.")
    .optional(),
  obligation_type: z.enum(["invoice", "general_obligation", "rent", "vehicle", "property", "project", "supplier", "catering_event", "other"]).default("invoice"),
  amount: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount such as 1500 or 1500.00."),
  day_of_month: z.coerce.number().int().min(1, "Choose a day from 1 to 28.").max(28, "Choose a day from 1 to 28."),
  due_days: z.coerce.number().int().min(0).max(60).default(0),
  start_date: z.iso.date("Choose a start date."),
  end_date: z.iso.date().nullable().optional(),
}).refine((value) => !value.end_date || value.end_date >= value.start_date, {
  path: ["end_date"],
  message: "The end date must be after the start date.",
});

export type RecurringChargeInput = z.infer<typeof recurringChargeSchema>;

/** First billing date on or after `startDate` that falls on `dayOfMonth` (1–28). */
export function firstRunDate(startDate: string, dayOfMonth: number): string {
  const [year, month, day] = startDate.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, dayOfMonth));
  if (day > dayOfMonth) candidate.setUTCMonth(candidate.getUTCMonth() + 1);
  return candidate.toISOString().slice(0, 10);
}

/** A short reference prefix from the label: "Monthly rent" → "MONTHLY-RENT". */
export function referencePrefixFromLabel(label: string): string {
  const prefix = label.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/, "");
  return /^[A-Z0-9]/.test(prefix) ? prefix : "CHARGE";
}

export function ordinalDay(day: number): string {
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${day}${suffix}`;
}
