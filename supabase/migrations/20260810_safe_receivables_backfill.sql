-- Production-safe compatibility backfill for the receivables foundation.
-- Apply after 20260809_receivables_foundation.sql.
--
-- This migration is deliberately non-destructive:
-- * legacy customer, case, payment and related rows are never rewritten;
-- * cases without a customer remain valid standalone legacy cases;
-- * General Accounts carry no balance and are not attached to cases;
-- * pre/post snapshots prove that legacy counts and financial totals did not move.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '15min';

select pg_advisory_xact_lock(hashtext('collectboss:20260810_safe_receivables_backfill'));

create table if not exists public.receivables_migration_verifications (
  migration_key text not null,
  business_id uuid not null references public.businesses(id) on delete restrict,
  pre_snapshot jsonb not null,
  post_snapshot jsonb,
  verification jsonb,
  verified boolean not null default false,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (migration_key, business_id),
  constraint receivables_migration_snapshot_objects_check check (
    jsonb_typeof(pre_snapshot) = 'object'
    and (post_snapshot is null or jsonb_typeof(post_snapshot) = 'object')
    and (verification is null or jsonb_typeof(verification) = 'object')
  )
);

alter table public.receivables_migration_verifications enable row level security;

drop policy if exists "receivables_migration_verifications: owner read"
  on public.receivables_migration_verifications;
create policy "receivables_migration_verifications: owner read"
  on public.receivables_migration_verifications for select to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = auth.uid()
  ));

create or replace function public.receivables_capture_legacy_snapshot(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'customers', (select count(*) from public.debtors d where d.business_id = p_business_id),
      'cases', (select count(*) from public.cases c where c.business_id = p_business_id),
      'payments', (
        select count(*) from public.payments p
        join public.cases c on c.id = p.case_id
        where c.business_id = p_business_id
      ),
      'payment_plans', (
        select count(*) from public.payment_plans pp
        join public.cases c on c.id = pp.case_id
        where c.business_id = p_business_id
      ),
      'reminders', (
        select count(*) from public.reminders r
        join public.cases c on c.id = r.case_id
        where c.business_id = p_business_id
      ),
      'evidence', (
        select count(*) from public.evidence_files e
        join public.cases c on c.id = e.case_id
        where c.business_id = p_business_id
      ),
      'legal_documents', (
        select count(*) from public.legal_documents ld
        join public.cases c on c.id = ld.case_id
        where c.business_id = p_business_id
      ),
      'lawyer_handoffs', (
        select count(*) from public.lawyer_referrals lr
        where lr.business_id = p_business_id
      ),
      'payment_proofs', (
        select count(*) from public.public_payment_submissions pps
        where pps.business_id = p_business_id
      ),
      -- Statements are generated from these case/ledger rows; no statement row
      -- is persisted or re-keyed by this migration.
      'statement_financial_events', (
        select count(*) from public.case_financial_events cfe
        join public.cases c on c.id = cfe.case_id
        where c.business_id = p_business_id
      )
    ),
    'financials', jsonb_build_object(
      'case_original_principal_minor', coalesce((
        select sum(c.original_principal_minor) from public.cases c
        where c.business_id = p_business_id
      ), 0),
      'case_contractual_due_minor', coalesce((
        select sum(c.contractual_due_minor) from public.cases c
        where c.business_id = p_business_id
      ), 0),
      'case_approved_payment_minor', coalesce((
        select sum(c.approved_payment_minor) from public.cases c
        where c.business_id = p_business_id
      ), 0),
      'case_outstanding_minor', coalesce((
        select sum(c.outstanding_minor) from public.cases c
        where c.business_id = p_business_id
      ), 0),
      'case_overpayment_minor', coalesce((
        select sum(c.overpayment_minor) from public.cases c
        where c.business_id = p_business_id
      ), 0),
      'payment_rows_minor', coalesce((
        select sum(round(p.amount * 100)::bigint)
        from public.payments p
        join public.cases c on c.id = p.case_id
        where c.business_id = p_business_id
      ), 0),
      'approved_payment_rows_minor', coalesce((
        select sum(round(p.amount * 100)::bigint)
        from public.payments p
        join public.cases c on c.id = p.case_id
        where c.business_id = p_business_id and p.review_status = 'approved'
      ), 0)
    ),
    'relationships', jsonb_build_object(
      'case_customer_map', (
        select md5(coalesce(string_agg(
          c.id || ':' || coalesce(c.debtor_id::text, '<null>'),
          ',' order by c.id
        ), ''))
        from public.cases c
        where c.business_id = p_business_id
      ),
      'payment_case_map', (
        select md5(coalesce(string_agg(p.id::text || ':' || p.case_id, ',' order by p.id), ''))
        from public.payments p
        join public.cases c on c.id = p.case_id
        where c.business_id = p_business_id
      ),
      'plan_case_map', (
        select md5(coalesce(string_agg(pp.id::text || ':' || pp.case_id, ',' order by pp.id), ''))
        from public.payment_plans pp
        join public.cases c on c.id = pp.case_id
        where c.business_id = p_business_id
      ),
      'reminder_case_map', (
        select md5(coalesce(string_agg(r.id::text || ':' || r.case_id, ',' order by r.id), ''))
        from public.reminders r
        join public.cases c on c.id = r.case_id
        where c.business_id = p_business_id
      ),
      'evidence_case_map', (
        select md5(coalesce(string_agg(e.id::text || ':' || e.case_id, ',' order by e.id), ''))
        from public.evidence_files e
        join public.cases c on c.id = e.case_id
        where c.business_id = p_business_id
      ),
      'statement_source_case_map', (
        select md5(coalesce(string_agg(cfe.id::text || ':' || cfe.case_id, ',' order by cfe.id), ''))
        from public.case_financial_events cfe
        join public.cases c on c.id = cfe.case_id
        where c.business_id = p_business_id
      ),
      'lawyer_handoff_case_map', (
        select md5(coalesce(string_agg(lr.id::text || ':' || lr.case_id, ',' order by lr.id), ''))
        from public.lawyer_referrals lr
        where lr.business_id = p_business_id
      )
    ),
    'scenarios', jsonb_build_object(
      'partial_payment_cases', (
        select count(*) from public.cases c
        where c.business_id = p_business_id
          and c.approved_payment_minor > 0 and c.outstanding_minor > 0
      ),
      'closed_cases', (
        select count(*) from public.cases c
        where c.business_id = p_business_id and c.status = 'closed'
      ),
      'zero_balance_cases', (
        select count(*) from public.cases c
        where c.business_id = p_business_id and c.outstanding_minor = 0
      ),
      'cases_with_plans', (
        select count(distinct pp.case_id)
        from public.payment_plans pp
        join public.cases c on c.id = pp.case_id
        where c.business_id = p_business_id
      ),
      'incomplete_customer_links', (
        select count(*) from public.cases c
        where c.business_id = p_business_id and c.debtor_id is null
      )
    )
  );
$$;

revoke all on function public.receivables_capture_legacy_snapshot(uuid) from public;
revoke all on function public.receivables_capture_legacy_snapshot(uuid) from authenticated;

-- Capture immutable pre-migration metrics once. Verified tenants are skipped
-- on rerun; newly created tenants receive their own first-run snapshot.
insert into public.receivables_migration_verifications (
  migration_key, business_id, pre_snapshot
)
select
  '20260810_safe_receivables_backfill',
  b.id,
  public.receivables_capture_legacy_snapshot(b.id)
from public.businesses b
on conflict (migration_key, business_id) do nothing;

-- R01 adds this legacy-facing tenant FK as NOT VALID: new writes are enforced
-- immediately, while existing rows are checked here only after the snapshot.
-- Null debtor_id values are valid and remain standalone; a cross-tenant debtor
-- link aborts safely instead of being silently reassigned.
alter table public.cases validate constraint cases_customer_tenant_fk;

-- A compatibility General Account is created only for an active customer that
-- has a legacy case and no active account. It has no financial columns and is
-- intentionally not assigned to the case, so case balances and scope stay
-- byte-for-byte unchanged.
insert into public.customer_accounts (
  business_id,
  customer_id,
  account_type,
  account_number,
  display_name,
  currency,
  metadata,
  custom_fields
)
select
  d.business_id,
  d.id,
  'general',
  null,
  'General Account',
  'MYR',
  jsonb_build_object(
    'migration_key', '20260810_safe_receivables_backfill',
    'source', 'legacy_case_compatibility'
  ),
  '{}'::jsonb
from public.debtors d
join public.receivables_migration_verifications mv
  on mv.business_id = d.business_id
  and mv.migration_key = '20260810_safe_receivables_backfill'
  and not mv.verified
where d.archived_at is null
  and exists (
    select 1 from public.cases c
    where c.business_id = d.business_id
      and c.debtor_id = d.id
      and c.created_at <= mv.started_at
  )
  and not exists (
    select 1 from public.customer_accounts a
    where a.business_id = d.business_id
      and a.customer_id = d.id
      and a.archived_at is null
  );

create unique index if not exists customer_accounts_legacy_general_unique
  on public.customer_accounts (business_id, customer_id)
  where metadata ->> 'migration_key' = '20260810_safe_receivables_backfill';

-- Compatibility inspection surface. Existing routes keep reading `cases`;
-- this additive view maps the enhanced domain without changing old URLs or
-- re-keying any case-dependent data.
create or replace view public.legacy_case_receivables_compatibility
with (security_invoker = true)
as
select
  c.id as case_id,
  c.business_id,
  c.debtor_id as customer_id,
  c.account_id,
  coalesce(c.case_scope, 'standalone') as case_scope,
  ga.id as compatible_general_account_id,
  c.original_principal_minor,
  c.contractual_due_minor,
  c.approved_payment_minor,
  c.outstanding_minor,
  c.overpayment_minor,
  (select count(*) from public.payments p where p.case_id = c.id) as payment_count,
  (select count(*) from public.payment_plans pp where pp.case_id = c.id) as payment_plan_count,
  (select count(*) from public.reminders r where r.case_id = c.id) as reminder_count,
  (select count(*) from public.evidence_files e where e.case_id = c.id) as evidence_count,
  (
    (select count(*) from public.legal_documents ld where ld.case_id = c.id)
    + (select count(*) from public.case_financial_events cfe where cfe.case_id = c.id)
  ) as statement_and_document_source_count,
  (select count(*) from public.lawyer_referrals lr where lr.case_id = c.id) as lawyer_handoff_count,
  (select count(*) from public.public_payment_submissions pps where pps.case_id = c.id) as payment_proof_count,
  c.debtor_id is null as incomplete_legacy_customer,
  c.account_id is null and coalesce(c.case_scope, 'standalone') = 'standalone' as legacy_standalone
from public.cases c
left join lateral (
  select a.id
  from public.customer_accounts a
  where a.business_id = c.business_id
    and a.customer_id = c.debtor_id
    and a.archived_at is null
  order by
    (a.metadata ->> 'migration_key' = '20260810_safe_receivables_backfill') desc,
    a.created_at,
    a.id
  limit 1
) ga on true;

-- Capture post-state and require exact equality for every legacy count,
-- financial total and edge-case cohort.
with snapshots as (
  select
    v.migration_key,
    v.business_id,
    public.receivables_capture_legacy_snapshot(v.business_id) as value
  from public.receivables_migration_verifications v
  where v.migration_key = '20260810_safe_receivables_backfill'
    and not v.verified
)
update public.receivables_migration_verifications v
set
  post_snapshot = snapshots.value,
  verification = jsonb_build_object(
    'counts_unchanged', v.pre_snapshot -> 'counts' = snapshots.value -> 'counts',
    'financials_unchanged', v.pre_snapshot -> 'financials' = snapshots.value -> 'financials',
    'relationships_unchanged', v.pre_snapshot -> 'relationships' = snapshots.value -> 'relationships',
    'scenario_cohorts_unchanged', v.pre_snapshot -> 'scenarios' = snapshots.value -> 'scenarios',
    'general_accounts_created', (
      select count(*) from public.customer_accounts a
      where a.business_id = v.business_id
        and a.metadata ->> 'migration_key' = '20260810_safe_receivables_backfill'
    )
  ),
  verified = (
    v.pre_snapshot -> 'counts' = snapshots.value -> 'counts'
    and v.pre_snapshot -> 'financials' = snapshots.value -> 'financials'
    and v.pre_snapshot -> 'relationships' = snapshots.value -> 'relationships'
    and v.pre_snapshot -> 'scenarios' = snapshots.value -> 'scenarios'
  ),
  completed_at = now()
from snapshots
where v.migration_key = snapshots.migration_key
  and v.business_id = snapshots.business_id;

do $$
begin
  if exists (
    select 1
    from public.receivables_migration_verifications
    where migration_key = '20260810_safe_receivables_backfill'
      and not verified
  ) then
    raise exception 'Receivables backfill aborted: legacy counts or financial totals changed';
  end if;
end;
$$;

commit;

-- Verification output after deployment (service role / SQL editor):
-- select business_id, verified, pre_snapshot, post_snapshot, verification
-- from public.receivables_migration_verifications
-- where migration_key = '20260810_safe_receivables_backfill';
--
-- Tenant/RLS verification as an authenticated owner:
-- select * from public.receivables_migration_verifications;
-- select * from public.legacy_case_receivables_compatibility;
-- Both return only rows visible through the owner's business/case policies.
--
-- Rollback considerations:
-- 1. Do not delete any legacy customer, case, payment, plan, reminder, evidence,
--    document or lawyer-handoff row. This migration never changes them.
-- 2. Drop the compatibility view and snapshot function if code no longer uses
--    them. Keep the verification table as deployment evidence where possible.
-- 3. Compatibility General Accounts may be deleted only when their metadata
--    still contains this migration key and no case or obligation references
--    them. Once used, retain them as normal production accounts.
-- 4. The R01 account/case columns remain nullable, so rolling back this
--    backfill does not require reclassifying any financial record.
