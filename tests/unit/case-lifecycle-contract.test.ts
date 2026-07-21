import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { casePatchSchema } from "@/lib/validations/case";

const lifecycleSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260719_case_lifecycle.sql"), "utf8");

describe("case lifecycle boundary", () => {
  it("rejects invalid status input before an RPC is attempted", () => {
    expect(casePatchSchema.safeParse({ action: "status", status: "reopened" }).success).toBe(false);
    expect(casePatchSchema.safeParse({ action: "status", status: "payment_promise", promise_due_date: "2026-02-01" }).success).toBe(true);
  });

  it("keeps payment, closure, archive, ownership, and optimistic-lock checks in the authoritative RPC", () => {
    for (const rule of [
      "Case not found",
      "Archived cases cannot transition",
      "Case changed; reload and try again",
      "A case can be paid only when its balance is zero",
      "Only fully paid cases can be closed",
      "create or replace function public.transition_case_status",
    ]) {
      expect(lifecycleSql).toContain(rule);
    }
  });
});
