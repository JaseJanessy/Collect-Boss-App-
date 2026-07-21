/** Exact MYR minor-unit helpers. Never use floating point for financial writes. */
export type MinorUnits = bigint;

const MONEY = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

export function parseMyrToMinor(value: string): MinorUnits {
  const normalized = value.trim();
  const match = MONEY.exec(normalized);
  if (!match) throw new Error("Amount must be a positive MYR value with at most two decimal places.");

  const [whole] = normalized.split(".", 1);
  const fraction = (match[1] ?? "").padEnd(2, "0");
  const minor = BigInt(whole) * 100n + BigInt(fraction || "0");
  if (minor <= 0n) throw new Error("Amount must be greater than RM 0.00.");
  return minor;
}

export function minorToMyRDecimal(minor: MinorUnits): string {
  if (minor < 0n) throw new Error("Currency amount cannot be negative.");
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
}

/** Converts a database numeric value without using binary floating point. */
export function databaseAmountToMinor(value: string | number | null | undefined): MinorUnits {
  if (value === null || value === undefined) return 0n;
  const text = typeof value === "number" ? value.toFixed(2) : value;
  const normalized = text.trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error("Invalid database currency amount.");
  const negative = normalized.startsWith("-");
  const [whole, decimal = ""] = (negative ? normalized.slice(1) : normalized).split(".");
  const result = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0"));
  return negative ? -result : result;
}
