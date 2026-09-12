-- R17: Multiple invoices, ongoing accounts and advisory credit limits.
-- Additive and backward compatible: existing accounts remain one-off accounts.
begin;

alter table public.businesses
  add column if not exists credit_limit_enforcement_enabled boolean not null default false;

alter table public.customer_accounts
  add column if not exists account_mode text not null default 'one_off',
  add column if not exists credit_limit_minor bigint,
  add column if not exists credit_warning_threshold_percent numeric(5,2) not null default 80;

alter table public.customer_accounts
  drop constraint if exists customer_accounts_mode_check,
  add constraint customer_accounts_mode_check
    check (account_mode in ('one_off', 'ongoing')),
  drop constraint if exists customer_accounts_credit_limit_check,
  add constraint customer_accounts_credit_limit_check
    check (credit_limit_minor is null or credit_limit_minor > 0),
  drop constraint if exists customer_accounts_credit_warning_threshold_check,
  add constraint customer_accounts_credit_warning_threshold_check
    check (credit_warning_threshold_percent > 0 and credit_warning_threshold_percent <= 100);

create index if not exists customer_accounts_mode_idx
  on public.customer_accounts (business_id, account_mode)
  where archived_at is null;

create or replace function public.receivables_enforce_credit_limit_workflow()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  configured_limit bigint;
  enforcement_enabled boolean;
  existing_exposure bigint;
  new_exposure bigint;
  old_exposure bigint := 0;
begin
  if new.account_id is null then return new; end if;

  select a.credit_limit_minor, b.credit_limit_enforcement_enabled
    into configured_limit, enforcement_enabled
  from public.customer_accounts a
  join public.businesses b on b.id = a.business_id
  where a.id = new.account_id
    and a.business_id = new.business_id
    and a.customer_id = new.customer_id
  for update of a;

  if not coalesce(enforcement_enabled, false) or configured_limit is null then
    return new;
  end if;

  new_exposure := case
    when new.archived_at is not null or new.status in ('void', 'written_off') then 0
    else greatest(new.original_amount_minor + new.adjustments_minor - new.paid_minor, 0)
  end;

  if tg_op = 'UPDATE' and old.account_id = new.account_id then
    old_exposure := case
      when old.archived_at is not null or old.status in ('void', 'written_off') then 0
      else greatest(old.original_amount_minor + old.adjustments_minor - old.paid_minor, 0)
    end;
    -- Never block a payment, credit, void or archive that reduces exposure.
    if new_exposure <= old_exposure then return new; end if;
  end if;

  select coalesce(sum(o.outstanding_minor), 0)::bigint
    into existing_exposure
  from public.obligations o
  where o.account_id = new.account_id
    and o.id <> new.id
    and o.archived_at is null
    and o.status not in ('void', 'written_off');

  if existing_exposure + new_exposure > configured_limit then
    raise exception 'Credit limit enforcement blocked this invoice: projected exposure % exceeds limit %',
      existing_exposure + new_exposure, configured_limit
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists obligations_enforce_credit_limit_workflow on public.obligations;
create trigger obligations_enforce_credit_limit_workflow
after insert or update of account_id, original_amount_minor, adjustments_minor, paid_minor, status, archived_at
on public.obligations
for each row execute function public.receivables_enforce_credit_limit_workflow();

create or replace view public.account_receivable_totals
with (security_invoker = true)
as
with account_balances as (
  select
    a.business_id,
    a.customer_id,
    a.id as account_id,
    a.account_mode,
    a.credit_limit_minor,
    a.credit_warning_threshold_percent,
    coalesce(sum(o.contractual_due_minor) filter (
      where o.archived_at is null and o.status not in ('void', 'written_off')
    ), 0)::bigint + coalesce((
      select sum(c.contractual_due_minor)::bigint
      from public.cases c
      where c.account_id = a.id
        and c.archived_at is null
        and c.case_scope = 'account_balance'
        and not exists (
          select 1 from public.recovery_case_obligations rco where rco.case_id = c.id
        )
        and not exists (
          select 1 from public.obligations active_obligation
          where active_obligation.account_id = a.id
            and active_obligation.archived_at is null
            and active_obligation.status not in ('void', 'written_off')
        )
    ), 0) as contractual_due_minor,
    coalesce(sum(o.paid_minor) filter (
      where o.archived_at is null and o.status not in ('void', 'written_off')
    ), 0)::bigint + coalesce((
      select sum(c.approved_payment_minor)::bigint
      from public.cases c
      where c.account_id = a.id
        and c.archived_at is null
        and c.case_scope = 'account_balance'
        and not exists (
          select 1 from public.recovery_case_obligations rco where rco.case_id = c.id
        )
        and not exists (
          select 1 from public.obligations active_obligation
          where active_obligation.account_id = a.id
            and active_obligation.archived_at is null
            and active_obligation.status not in ('void', 'written_off')
        )
    ), 0) as paid_minor,
    coalesce(sum(o.outstanding_minor) filter (
      where o.archived_at is null and o.status not in ('void', 'written_off')
    ), 0)::bigint + coalesce((
      select sum(c.outstanding_minor)::bigint
      from public.cases c
      where c.account_id = a.id
        and c.archived_at is null
        and c.case_scope = 'account_balance'
        and not exists (
          select 1 from public.recovery_case_obligations rco where rco.case_id = c.id
        )
        and not exists (
          select 1 from public.obligations active_obligation
          where active_obligation.account_id = a.id
            and active_obligation.archived_at is null
            and active_obligation.status not in ('void', 'written_off')
        )
    ), 0) as outstanding_minor,
    count(o.id) filter (
      where o.archived_at is null
        and o.obligation_type = 'invoice'
        and o.status not in ('void', 'written_off', 'paid')
        and o.outstanding_minor > 0
    )::integer as open_invoice_count,
    max(coalesce(o.issue_date, o.created_at::date)) filter (
      where o.archived_at is null and o.obligation_type = 'invoice'
    ) as latest_invoice_date
  from public.customer_accounts a
  left join public.obligations o on o.account_id = a.id
  where a.archived_at is null
  group by
    a.business_id, a.customer_id, a.id, a.account_mode,
    a.credit_limit_minor, a.credit_warning_threshold_percent
)
select
  business_id,
  customer_id,
  account_id,
  contractual_due_minor,
  paid_minor,
  outstanding_minor,
  account_mode,
  credit_limit_minor,
  credit_warning_threshold_percent,
  open_invoice_count,
  latest_invoice_date,
  outstanding_minor as current_exposure_minor,
  case
    when credit_limit_minor is null then null
    else credit_limit_minor - outstanding_minor
  end as available_credit_minor,
  case
    when credit_limit_minor is null then null
    else round((outstanding_minor::numeric * 100) / credit_limit_minor, 2)
  end as utilization_percentage,
  case
    when credit_limit_minor is null then 'no_limit'
    when outstanding_minor > credit_limit_minor then 'over_limit'
    when outstanding_minor = credit_limit_minor then 'limit_reached'
    when (outstanding_minor::numeric * 100) / credit_limit_minor
      >= credit_warning_threshold_percent then 'approaching_limit'
    else 'within_limit'
  end as credit_warning
from account_balances;

comment on column public.customer_accounts.account_mode is
  'one_off for finite work; ongoing for accounts whose live balance rolls forward from current obligations.';
comment on column public.customer_accounts.credit_warning_threshold_percent is
  'Transparent advisory threshold. Enforcement occurs only when the owning business explicitly enables it.';
comment on column public.businesses.credit_limit_enforcement_enabled is
  'When false (default), credit-limit warnings are advisory. When true, exposure-increasing obligation writes above the limit are rejected.';

create or replace function public.receivables_create_recovery_case(
  p_customer_id uuid,
  p_target text,
  p_account_id uuid,
  p_obligation_id uuid default null,
  p_payment_lock_mode text default 'approval'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_account public.customer_accounts;
  selected_customer public.debtors;
  selected_ids uuid[];
  selected_count integer;
  selected_due bigint;
  selected_paid bigint;
  selected_outstanding bigint;
  selected_due_date date;
  selected_reference text;
  selected_scope text;
  created_case_id text;
begin
  if p_target not in ('invoice', 'account') then raise exception 'Unsupported chase target'; end if;
  if p_payment_lock_mode not in ('immediate', 'approval', 'manual') then
    raise exception 'Unsupported payment lock mode';
  end if;
  if p_target = 'invoice' and p_obligation_id is null then
    raise exception 'Select an invoice to chase';
  end if;
  if p_target = 'account' and p_obligation_id is not null then
    raise exception 'Account chasing selects all open invoices';
  end if;

  select a.* into selected_account
  from public.customer_accounts a
  where a.id = p_account_id and a.customer_id = p_customer_id and a.archived_at is null;
  if not found or not public.has_business_permission(selected_account.business_id, 'case.manage') then
    raise exception 'Account is unavailable';
  end if;

  select d.* into selected_customer
  from public.debtors d
  where d.id = p_customer_id
    and d.business_id = selected_account.business_id
    and d.archived_at is null;
  if not found then raise exception 'Customer is unavailable'; end if;

  select
    array_agg(o.id order by o.due_date, o.created_at, o.id),
    count(*)::integer,
    coalesce(sum(o.contractual_due_minor), 0)::bigint,
    coalesce(sum(o.paid_minor), 0)::bigint,
    coalesce(sum(o.outstanding_minor), 0)::bigint,
    min(o.due_date),
    case when count(*) = 1 then min(o.reference) else null end
  into selected_ids, selected_count, selected_due, selected_paid,
    selected_outstanding, selected_due_date, selected_reference
  from public.obligations o
  where o.business_id = selected_account.business_id
    and o.customer_id = p_customer_id
    and o.account_id = p_account_id
    and o.archived_at is null
    and o.status not in ('void', 'written_off', 'paid')
    and o.outstanding_minor > 0
    and (p_target = 'account' or o.id = p_obligation_id);

  if selected_count = 0 then raise exception 'No open invoice is available to chase'; end if;
  if p_target = 'invoice' and selected_count <> 1 then raise exception 'Invoice is unavailable'; end if;
  if exists (
    select 1 from public.recovery_case_obligations rco
    where rco.obligation_id = any(selected_ids)
  ) then
    raise exception 'One or more invoices are already assigned to a recovery case';
  end if;

  selected_scope := case when selected_count = 1 then 'single_obligation' else 'multiple_obligations' end;
  created_case_id := 'CB-' || extract(year from current_date)::integer::text || '-'
    || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);

  insert into public.cases (
    id, business_id, debtor_id, debtor_type, debtor_name, debtor_phone,
    debtor_email, debtor_company, debtor_reg_no, debtor_location,
    amount_owed, amount_paid, due_date, invoice_no, status,
    payment_lock_mode, notes
  ) values (
    created_case_id, selected_account.business_id, selected_customer.id,
    selected_customer.debtor_type,
    case when selected_customer.debtor_type = 'business'
      then selected_customer.business_name else selected_customer.individual_name end,
    selected_customer.phone, selected_customer.email,
    case when selected_customer.debtor_type = 'business'
      then selected_customer.business_name else null end,
    selected_customer.registration_no, selected_customer.address,
    selected_due::numeric / 100, 0, selected_due_date, selected_reference,
    'action_needed', p_payment_lock_mode,
    case when p_target = 'account'
      then 'Recovery case for current account balance (' || selected_count || ' open invoices).'
      else 'Recovery case for invoice ' || selected_reference || '.' end
  );

  if selected_paid > 0 then
    insert into public.case_financial_events (
      case_id, event_type, amount_minor, source_table, source_id, note, created_by
    ) values (
      created_case_id, 'opening_payment_credit', selected_paid,
      'receivables_chase', gen_random_uuid(),
      'Opening credit copied from selected invoice ledger balances.', auth.uid()
    );
    perform public.financial_recalculate_case(created_case_id);
  end if;

  insert into public.recovery_case_obligations (
    case_id, obligation_id, business_id, linked_by
  )
  select created_case_id, obligation_id, selected_account.business_id, auth.uid()
  from unnest(selected_ids) obligation_id;

  update public.cases
  set account_id = p_account_id, case_scope = selected_scope, updated_at = now()
  where id = created_case_id;
  perform public.receivables_sync_case_obligations(created_case_id);

  return jsonb_build_object(
    'case_id', created_case_id,
    'scope', selected_scope,
    'linked_obligation_count', selected_count,
    'contractual_due_minor', selected_due,
    'approved_payment_minor', selected_paid,
    'outstanding_minor', selected_outstanding
  );
end;
$$;

revoke all on function public.receivables_create_recovery_case(uuid,text,uuid,uuid,text) from public;
grant execute on function public.receivables_create_recovery_case(uuid,text,uuid,uuid,text) to authenticated;

commit;

-- Rollback considerations:
-- 1. Disable credit-limit enforcement, then drop obligations_enforce_credit_limit_workflow
--    and receivables_enforce_credit_limit_workflow(). Drop
--    receivables_create_recovery_case(uuid,text,uuid,uuid,text).
-- 2. Restore the R01 account_receivable_totals view before dropping the new
--    customer_accounts columns and businesses.credit_limit_enforcement_enabled.
-- 3. Dropping these columns removes account classification and credit policy
--    configuration only. Obligations, cases, payments and existing balances remain.
