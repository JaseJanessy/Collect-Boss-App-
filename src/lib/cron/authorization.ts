import "server-only";

import { timingSafeEqual } from "node:crypto";

export type CronAuthorization = "authorized" | "not_configured" | "unauthorized";

export function authorizeCronRequest(request: Request): CronAuthorization {
  const secret = process.env.CRON_SECRET;
  if (!secret) return "not_configured";

  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== received.length) return "unauthorized";
  return timingSafeEqual(expected, received) ? "authorized" : "unauthorized";
}
