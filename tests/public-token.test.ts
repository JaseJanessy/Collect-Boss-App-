import assert from "node:assert/strict";
import test from "node:test";
import { generatePublicToken, hashPublicToken, redactPublicToken } from "../src/lib/public-access/token.ts";

test("public capabilities are URL-safe 256-bit values and only their SHA-256 hash is stable", () => {
  const token = generatePublicToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(hashPublicToken(token), /^[0-9a-f]{64}$/);
  assert.equal(hashPublicToken(token), hashPublicToken(token));
});

test("token redaction never returns capability material", () => {
  const token = generatePublicToken();
  assert.equal(redactPublicToken(token), "[REDACTED_PUBLIC_TOKEN]");
  assert.ok(!redactPublicToken(token).includes(token));
});
