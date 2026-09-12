import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const route = (path: string) => readFileSync(resolve(path), "utf8");

describe("payment operations API integration contracts", () => {
it("privileged payment mutations require permission, validation and idempotency", () => {
  for (const path of [
    "src/app/api/payment-operations/receipts/route.ts",
    "src/app/api/payment-operations/receipts/[receiptId]/allocations/route.ts",
    "src/app/api/payment-operations/allocations/[allocationId]/reverse/route.ts",
    "src/app/api/payment-operations/receipts/[receiptId]/refund/route.ts",
    "src/app/api/payment-operations/receipts/[receiptId]/reverse/route.ts",
  ]) {
    const source = route(path);
    expect(source).toMatch(/requireTenantPermission\("payment\.approve"\)/u);
    expect(source).toMatch(/idempotencyKey\(request\)/u);
    expect(source).toMatch(/safeParse/u);
    expect(source).toMatch(/paymentDatabaseError/u);
  }
});

it("large reallocation decision uses the dedicated owner/admin permission", () => {
  const source = route("src/app/api/payment-operations/approval-requests/[requestId]/decision/route.ts");
  expect(source).toMatch(/requireTenantPermission\("payment\.reallocation\.approve"\)/u);
});

it("reconciliation and outbox status are private no-store reports", () => {
  const reconciliation = route("src/app/api/payment-operations/reconciliation/route.ts");
  const outbox = route("src/app/api/payment-operations/accounting-outbox/route.ts");
  const helper = route("src/lib/payment-operations/api.ts");
  expect(reconciliation).toMatch(/requireTenantPermission\("report\.read"\)/u);
  expect(outbox).toMatch(/requireTenantPermission\("report\.read"\)/u);
  expect(helper).toMatch(/private, no-store/u);
});
});
