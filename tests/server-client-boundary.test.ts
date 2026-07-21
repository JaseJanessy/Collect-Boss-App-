import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("browser-safe Supabase module cannot create a server session client", () => {
  const browserClient = read("src/lib/supabase/client.ts");
  assert.doesNotMatch(browserClient, /getServerClient/);
  assert.doesNotMatch(browserClient, /next\/headers/);
  assert.doesNotMatch(browserClient, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("privileged client modules are explicitly server-only", () => {
  for (const path of [
    "src/lib/supabase/server-client.ts",
    "src/lib/supabase/service-client.ts",
    "src/lib/stripe/server.ts",
    "src/lib/billing/service.ts",
    "src/lib/public-access/service.ts",
  ]) {
    assert.match(read(path), /import "server-only";/);
  }
});

test("server session consumers import the guarded client factory", () => {
  const consumers = [
    "src/lib/debtors/server.ts",
    "src/lib/db/cases.ts",
    "src/app/api/billing/create-checkout-session/route.ts",
    "src/app/api/cases/[caseId]/payment-plans/route.ts",
  ];
  for (const path of consumers) {
    assert.match(read(path), /from "@\/lib\/supabase\/server-client"/);
  }
});

test("audit fallback never logs arbitrary metadata", () => {
  for (const path of ["src/lib/db/audit-logs.ts", "src/lib/db/audit-logs-client.ts"]) {
    assert.doesNotMatch(read(path), /console\.log\(\s*"\[AUDIT\]"/);
  }
});
