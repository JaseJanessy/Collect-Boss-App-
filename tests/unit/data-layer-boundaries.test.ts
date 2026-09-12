import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("data-layer boundaries", () => {
  it("keeps the customer UI behind its client service", () => {
    const ui = source("src/components/pages/debtors-page.tsx");
    expect(ui).toContain("customerService");
    expect(ui).not.toMatch(/\bfetch\s*\(/u);
    expect(ui).not.toMatch(/\.from\s*\(/u);
  });

  it("keeps customer route handlers behind the server service", () => {
    for (const path of [
      "src/app/api/debtors/route.ts",
      "src/app/api/debtors/[debtorId]/route.ts",
    ]) {
      const route = source(path);
      expect(route).toContain("@/lib/customers/server-service");
      expect(route).not.toMatch(/\.from\s*\(/u);
    }
  });

  it("keeps customer database queries in the repository", () => {
    const repository = source("src/lib/customers/repository.ts");
    expect(repository).toContain("TenantDatabaseProvider");
    expect(repository).toMatch(/\.from\s*\(/u);
  });

  it("uses one Pocket JSON transport instead of component-local API clients", () => {
    for (const path of [
      "src/components/pocket/pocket-ledger.tsx",
      "src/components/pocket/pocket-payments.tsx",
      "src/components/pocket/pocket-invoices.tsx",
      "src/components/pocket/pocket-receipts.tsx",
      "src/components/pocket/pocket-reminders.tsx",
    ]) {
      const component = source(path);
      expect(component).toContain("createJsonService");
      expect(component).not.toMatch(/\bfetch\s*\(/u);
      expect(component).not.toMatch(/async function (?:api|json)\b/u);
    }
  });

  it("keeps shared browser services behind the canonical HTTP transport", () => {
    for (const path of [
      "src/lib/action-centre/client.ts",
      "src/lib/notifications/client.ts",
      "src/lib/payment-proofs/client.ts",
      "src/lib/reports/client-service.ts",
    ]) {
      const clientService = source(path);
      expect(clientService).toContain("@/lib/data/http-service");
      expect(clientService).not.toMatch(/\bfetch\s*\(/u);
    }
  });

  it("connects dashboard and report UI through the report client service", () => {
    const dashboardHook = source("src/hooks/use-report-summary.ts");
    const reportsPage = source("src/components/pages/reports-page.tsx");
    expect(dashboardHook).toContain("loadDashboardSummary");
    expect(reportsPage).toContain("loadReportsSummary");
    expect(dashboardHook).not.toMatch(/\bfetch\s*\(/u);
    expect(reportsPage).not.toMatch(/\bfetch\s*\(/u);
  });
});
