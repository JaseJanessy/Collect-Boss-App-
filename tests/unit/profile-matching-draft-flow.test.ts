import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260904_profile_matching_draft_to_case.sql");
const schema = read("supabase/schema.sql");
const rls = read("src/lib/supabase/rls.sql");
const route = read("src/app/api/document-intakes/[intakeId]/workflow/route.ts");
const server = read("src/lib/document-intake/workflow-server.ts");
const mobile = read("mobile/src/components/transaction-routing.tsx");

describe("Prompt 14 atomic workflow contract", () => {
  it("keeps one versioned draft and immutable evidence-to-record outcomes", () => {
    expect(migration).toMatch(/create table if not exists public\.document_intake_workflow_drafts/iu);
    expect(migration).toMatch(/create table if not exists public\.document_intake_outcomes/iu);
    expect(migration).toMatch(/document_intake_record_evidence_links/iu);
    expect(migration).toMatch(/document_intake_outcomes_append_only_guard/iu);
    expect(schema).toContain("document_intake_submit_workflow");
  });

  it("submits atomically, tenant scopes every selected ID, and is idempotent", () => {
    expect(migration).toMatch(/pg_advisory_xact_lock/iu);
    expect(migration).toMatch(/action_scope='submit_workflow'.*idempotency_key=p_idempotency_key/su);
    expect(migration).toMatch(/where id=v_customer_id and business_id=p_business_id/iu);
    expect(migration).toMatch(/where id=v_obligation_id and business_id=p_business_id and customer_id=v_customer_id and currency=v_currency/iu);
    expect(migration).toMatch(/P14_CASE_OBLIGATION_SCOPE_MISMATCH/u);
    expect(route).toContain('requireDocumentPermission(request, "document_intake.submit")');
  });

  it("routes financial changes through the authoritative ledger behavior", () => {
    expect(migration).toMatch(/insert into public\.payments[\s\S]*'pending_review'/u);
    expect(migration).toMatch(/insert into public\.case_financial_events[\s\S]*'payment_reversal'/u);
    expect(migration).toMatch(/perform public\.financial_recalculate_case/u);
    expect(migration).not.toMatch(/update public\.cases set .*outstanding_minor/iu);
  });

  it("does not create a case for a loan and gates collection cases", () => {
    const loanBranch = migration.slice(migration.indexOf("elsif v_route in ('loan_disbursement','collection_case')"), migration.indexOf("select count(*) into v_candidate_count"));
    expect(loanBranch).toContain("insert into public.obligations");
    expect(migration).toMatch(/elsif v_route='collection_case'[\s\S]*P14_CASE_NOT_JUSTIFIED/u);
    expect(migration).toMatch(/v_due>=current_date or v_obligation\.outstanding_minor<=0/u);
  });

  it("makes matching and duplicates review-only and keeps RLS read-only", () => {
    expect(server).toContain("rankProfileMatches");
    expect(server).toContain("findTransactionDuplicates");
    expect(mobile).toContain("Nothing will be merged or deleted");
    expect(mobile).toContain("Use Existing Profile");
    expect(mobile).toContain("Create New Profile");
    expect(rls).toMatch(/grant select on public\.document_intake_workflow_drafts/iu);
    expect(rls).not.toMatch(/grant (insert|update|delete) on public\.document_intake_workflow_drafts to authenticated/iu);
  });

  it("exposes explicit mobile outcomes and Save Draft on every stage", () => {
    expect(mobile.match(/Save Draft/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(mobile).toContain("Create Collection Case");
    expect(mobile).toContain("Record Partial Payment");
    expect(mobile).toContain("Profile:");
    expect(mobile).toContain("Obligation:");
    expect(mobile).toContain("Payment:");
    expect(mobile).toContain("Case:");
  });
});
