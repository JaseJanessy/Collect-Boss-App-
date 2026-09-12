import "server-only";

import { createHash } from "node:crypto";
import { clientAddress, isRateLimited } from "@/lib/api/request-guard";
import { hashPublicToken } from "@/lib/public-access/token";
import { isDeploymentEnvironment } from "@/lib/supabase/client";
import { getServiceClient } from "@/lib/supabase/service-client";

export type PublicRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfter: number; unavailable?: boolean };

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function consume(
  scope: string,
  keyHash: string,
  limit: number,
  windowSeconds: number,
): Promise<PublicRateLimitResult> {
  const service = await getServiceClient();
  if (!service) {
    if (!isDeploymentEnvironment) {
      return isRateLimited(`development:${scope}:${keyHash}`, limit, windowSeconds * 1000)
        ? { allowed: false, retryAfter: windowSeconds }
        : { allowed: true };
    }
    return { allowed: false, retryAfter: 30, unavailable: true };
  }
  const { data, error } = await service.rpc("security_rate_limit_consume", {
    p_scope: scope,
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
    p_block_seconds: windowSeconds,
  });
  if (error || !data) {
    if (!isDeploymentEnvironment) {
      return isRateLimited(`development:${scope}:${keyHash}`, limit, windowSeconds * 1000)
        ? { allowed: false, retryAfter: windowSeconds }
        : { allowed: true };
    }
    return { allowed: false, retryAfter: 30, unavailable: true };
  }
  const result = data as { allowed?: boolean; retry_after?: number };
  return result.allowed === true
    ? { allowed: true }
    : { allowed: false, retryAfter: Math.max(1, Number(result.retry_after) || windowSeconds) };
}

/** Shared, fail-closed abuse control for capability routes. Raw addresses and
 * capability values are never persisted. Both address-wide and token-wide
 * limits apply so varying guessed identifiers cannot bypass the first bound. */
export async function enforcePublicRateLimit(input: {
  headers: Headers;
  rawToken: string;
  action: string;
  limit?: number;
  windowSeconds?: number;
}): Promise<PublicRateLimitResult> {
  const limit = input.limit ?? 20;
  const windowSeconds = input.windowSeconds ?? 60;
  const addressHash = digest(clientAddress(input.headers));
  const addressResult = await consume(`public:${input.action}:address`, addressHash, limit, windowSeconds);
  if (!addressResult.allowed) return addressResult;
  return consume(
    `public:${input.action}:token`,
    digest(`${hashPublicToken(input.rawToken)}:${addressHash}`),
    limit,
    windowSeconds,
  );
}

export function publicRateLimitResponse(result: Exclude<PublicRateLimitResult, { allowed: true }>) {
  return Response.json(
    { error: result.unavailable ? "Public access protection is temporarily unavailable." : "Too many requests. Please try again later." },
    {
      status: result.unavailable ? 503 : 429,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Retry-After": String(result.retryAfter),
      },
    },
  );
}
