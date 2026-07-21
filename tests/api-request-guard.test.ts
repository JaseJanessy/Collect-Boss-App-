import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { clientAddress, isRateLimited, requestHasAllowedOrigin } from "../src/lib/api/request-guard.ts";

test("request origin accepts same-origin browser calls and non-browser callers only", () => {
  assert.equal(requestHasAllowedOrigin("https://app.example.test", "https://app.example.test"), true);
  assert.equal(requestHasAllowedOrigin("https://attacker.example.test", "https://app.example.test"), false);
  assert.equal(requestHasAllowedOrigin(null, "https://app.example.test"), true);
});

test("rate limiter blocks after the configured request count", () => {
  const key = `test:${crypto.randomUUID()}`;
  assert.equal(isRateLimited(key, 2, 60_000, 1_000), false);
  assert.equal(isRateLimited(key, 2, 60_000, 1_001), false);
  assert.equal(isRateLimited(key, 2, 60_000, 1_002), true);
});

test("rate limiter uses the platform address before a forwarded address", () => {
  assert.equal(clientAddress(new Headers({ "x-vercel-forwarded-for": "198.51.100.1", "x-forwarded-for": "203.0.113.2" })), "198.51.100.1");
});

test("proxy applies origin, payload, and rate checks before API authentication", () => {
  const proxy = readFileSync(resolve(process.cwd(), "src/proxy.ts"), "utf8");
  assert.match(proxy, /Request origin is not allowed/);
  assert.match(proxy, /Request payload is too large/);
  assert.match(proxy, /Too many requests/);
  assert.match(proxy, /MAX_UPLOAD_BODY_BYTES/);
});
