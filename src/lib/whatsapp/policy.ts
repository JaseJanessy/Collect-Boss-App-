/** Pure WhatsApp reminder rules shared by the worker, API and tests. */

export const ALLOWED_DAY_OFFSETS = [-7, -3, -1, 0, 1, 3, 7, 14, 21, 30] as const;
export const DEFAULT_DAY_OFFSETS = [-3, 0, 3, 7, 14] as const;
export const SEND_WINDOW = { startHour: 9, endHour: 20 } as const; // Malaysia time, end exclusive
export const STOP_WORDS = ["stop", "berhenti", "henti", "unsubscribe", "stop reminders"] as const;

export function isWithinSendWindow(now: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Kuala_Lumpur" }).format(now));
  return hour >= SEND_WINDOW.startHour && hour < SEND_WINDOW.endHour;
}

export function isStopMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[^\p{L}\s]/gu, "").replace(/\s+/g, " ");
  return (STOP_WORDS as readonly string[]).includes(normalized);
}

export function offsetLabel(offset: number): string {
  if (offset === 0) return "On the due date";
  const days = Math.abs(offset);
  return `${days} ${days === 1 ? "day" : "days"} ${offset < 0 ? "before" : "after"}`;
}

export interface SkipInputs {
  optedOut: boolean;
  preferences: { email_only?: boolean; wrong_number?: boolean; invalid_contact?: boolean } | null;
  outstandingMinor: number | null;
  obligationStatus: string | null;
}

/** Why a queued reminder must not be sent, or null when it may go out. */
export function reminderSkipReason(input: SkipInputs): string | null {
  if (input.optedOut) return "customer_opted_out";
  if (input.preferences?.wrong_number) return "wrong_number";
  if (input.preferences?.invalid_contact) return "invalid_contact";
  if (input.preferences?.email_only) return "email_only";
  if (input.outstandingMinor === null || input.outstandingMinor <= 0) return "nothing_outstanding";
  if (input.obligationStatus && !["open", "overdue", "partial"].includes(input.obligationStatus)) return "not_collectable";
  return null;
}
