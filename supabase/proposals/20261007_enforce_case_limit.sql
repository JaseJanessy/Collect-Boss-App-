-- PROPOSAL — NOT APPLIED. Review before moving into supabase/migrations/.
--
-- Why: plan case limits are enforced in POST /api/cases, but two database
-- functions also create cases without any limit check:
--   * public.document_intake_submit_workflow  (document draft -> case)
--   * public.pocket_commit_solo_upgrade       (Pocket -> Main upgrade)
-- A BEFORE INSERT trigger makes the limit hold for every write path.
--
-- Decision needed before applying:
--   pocket_commit_solo_upgrade moves a user's existing Pocket debts into Main.
--   If that should be allowed even above the new plan's limit, add
--     perform set_config('collectboss.skip_case_limit', 'on', true);
--   at the start of that function (transaction-local), as handled below.
--
-- "Active case" matches the app: not archived and not closed.
-- A missing entitlements row is treated as the Free plan (10 cases), matching
-- FREE_ENTITLEMENT_MOCK in src/lib/billing/plans.ts.

create or replace function public.enforce_case_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_active integer;
begin
  if coalesce(current_setting('collectboss.skip_case_limit', true), '') = 'on' then
    return new;
  end if;

  select e.case_limit into v_limit
  from public.entitlements e
  where e.business_id = new.business_id;
  v_limit := coalesce(v_limit, 10);

  if v_limit = -1 then
    return new;
  end if;

  -- Serialise concurrent inserts for the same business so two requests
  -- cannot both pass the count check.
  perform pg_advisory_xact_lock(hashtext('case_limit:' || new.business_id::text));

  select count(*) into v_active
  from public.cases c
  where c.business_id = new.business_id
    and c.archived_at is null
    and c.status <> 'closed';

  if v_active >= v_limit then
    raise exception 'PLAN_LIMIT_REACHED: your plan allows % active cases', v_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists cases_enforce_plan_limit on public.cases;
create trigger cases_enforce_plan_limit
  before insert on public.cases
  for each row execute function public.enforce_case_plan_limit();

-- Rollback:
--   drop trigger if exists cases_enforce_plan_limit on public.cases;
--   drop function if exists public.enforce_case_plan_limit();
