import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(path), "utf8");

describe("Pocket receipt API boundary", () => {
  it("repeats security-critical upload validation and reuses private intake storage", () => {
    const route = source("src/app/api/pocket/receipts/route.ts");
    const server = source("src/lib/document-intake/server.ts");
    expect(route).toMatch(/requirePocketBillingAccess\("document_intake\.create"\)/u);
    expect(route).toMatch(/storeOriginalEvidence/u);
    expect(server).toMatch(/validateDocumentUpload/u);
    expect(server).toMatch(/upsert:\s*false/u);
    expect(server).toMatch(/cacheControl:\s*"private, no-store"/u);
  });

  it("queues extraction only after a clean scan and lets the database charge quota", () => {
    const route = source("src/app/api/pocket/receipts/[intakeId]/route.ts");
    expect(route).toMatch(/scan_status !== "clean"/u);
    expect(route).toMatch(/document_intake_requeue_extraction/u);
    expect(route).not.toMatch(/consume:\s*true/u);
  });

  it("accepts no client-owned amount or customer identity during final posting", () => {
    const route = source("src/app/api/pocket/receipts/[intakeId]/confirm/route.ts");
    const schema = source("src/lib/pocket/receipts.ts");
    expect(route).toMatch(/pocket_confirm_receipt_payment/u);
    expect(schema).toMatch(/expectedOutstandingMinor/u);
    expect(schema).not.toMatch(/businessId|workspaceId|customerId|amountMinor|currency:/u);
  });
});
