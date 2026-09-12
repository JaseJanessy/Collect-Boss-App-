import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const migration = () => read("supabase/migrations/20260829_action_priority_dashboard.sql");

test("priority projection covers every required operational queue and closes cleared conditions", () => {
  const sql = migration();
  for (const value of [
    "promise.missed", "review_payment_proof", "review_dispute", "missing_evidence",
    "approval_required", "integration_failed", "compliance_alert",
  ]) assert.match(sql, new RegExp(value.replace(".", "\\.")));
  assert.match(sql, /financial_adjustments f[\s\S]*approval_status='pending'/);
  assert.match(sql, /not exists\(select 1 from public\.evidence_files/);
  assert.match(sql, /accounting_connections c[\s\S]*c\.status='error'/);
  assert.match(sql, /verification_state in \('rejected','restricted'\)/);
  assert.match(sql, /set status='completed'/);
});

test("database owns deterministic ranking, timezone-safe due filters and authoritative totals", () => {
  const sql = migration();
  assert.match(sql, /case a\.priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end/);
  assert.match(sql, /order by f\.priority_rank,f\.due_at asc nulls last,f\.created_at,f\.id/);
  assert.match(sql, /timezone\(v_timezone,v\.due_at\)::date/);
  assert.match(sql, /timezone\(v_timezone,now\(\)\)::date/);
  assert.match(sql, /case when f\.case_id is null then f\.amount_minor else f\.outstanding_minor end/);
  assert.match(sql, /count\(distinct case_id\)/);
  assert.match(sql, /offset p_offset limit p_limit/);
});

test("team filters cannot expand the caller's authorised base scope", () => {
  const sql = migration();
  assert.match(sql, /v_business_id uuid:=public\.my_business_id\(\)/);
  assert.match(sql, /v_can_filter_team:=public\.has_business_permission\(v_business_id,'case\.manage'\)/);
  assert.match(sql, /a\.business_id=v_business_id/);
  assert.match(sql, /v_can_filter_team or a\.assignee_id is null or a\.assignee_id=v_user_id/);
  assert.match(sql, /grant execute on function public\.action_centre_dashboard[\s\S]*to authenticated/);
  assert.match(sql, /action_centre_refresh_priority_gaps[\s\S]*to service_role/);
});

test("API validates every filter, uses opaque cursors and fails loudly without the migration", () => {
  const source = read("src/app/api/action-centre/route.ts");
  for (const value of ["owner", "queue", "caseType", "severity", "due", "pageSize", "cursor"]) assert.match(source, new RegExp(`\\"${value}\\"`));
  assert.match(source, /Buffer\.from\(value, "base64url"\)/);
  assert.match(source, /action_centre_dashboard/);
  assert.match(source, /migration is required/);
  assert.match(source, /loadContactGuardEvaluations/);
});

test("dashboard shows five direct-action rows and the full queue supports filters and incremental loading", () => {
  const panel = read("src/components/action-centre/action-centre-panel.tsx");
  const desktop = read("src/components/pages/home-dashboard.tsx");
  const mobile = read("src/components/pages/home-mobile.tsx");
  assert.match(panel, /compact \? 5 : 25/);
  for (const label of ["Team member", "Queue", "Case type", "Severity", "Due date", "Owner", "Age", "Outstanding", "Due"]) assert.match(panel, new RegExp(label));
  assert.match(panel, /Load more priority items/);
  assert.match(panel, /aria-label={`\$\{item\.recommended_action\}: \$\{item\.title\}`}/);
  assert.ok(desktop.indexOf("<ActionCentrePanel compact />") < desktop.indexOf("Ledger position"));
  assert.ok(mobile.indexOf("<ActionCentrePanel compact />") < mobile.indexOf('aria-label="Ledger position"'));
});

test("case overview exposes server-reconciled decision fields and hides unavailable values", () => {
  const server = read("src/lib/cases/priority-summary-server.ts");
  const page = read("src/components/pages/case-detail-page.tsx");
  for (const source of [server, page]) {
    for (const label of ["Verified", "Disputed", "Unverified", "Settled", "Latest", "Promise", "Evidence"]) assert.match(source, new RegExp(label, "i"));
  }
  assert.match(server, /case_recovery_amounts/);
  assert.match(server, /review_status", "approved/);
  assert.match(server, /public_payment_submissions/);
  assert.match(page, /Balance categories are hidden rather than estimated/);
});
