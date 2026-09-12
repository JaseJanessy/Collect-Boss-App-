export function localDateAt(instant: Date, timeZone: string) {
  if (Number.isNaN(instant.getTime())) throw new Error("Invalid scheduler instant.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addCivilDays(date: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(days)) {
    throw new Error("Invalid civil-date calculation.");
  }
  const instant = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(instant.getTime())) throw new Error("Invalid civil date.");
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

export function dueEventDate(
  kind: "due" | "overdue" | "missed",
  dueDate: string,
  graceDays = 0,
) {
  if (kind === "due") return dueDate;
  return addCivilDays(dueDate, kind === "missed" ? graceDays + 1 : 1);
}

export function domainEventDeduplicationKey(input: {
  businessId: string;
  eventType: string;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceVersion: string;
}) {
  return [
    input.businessId,
    input.eventType,
    input.sourceEntityType,
    input.sourceEntityId,
    input.sourceVersion,
  ].join(":");
}
