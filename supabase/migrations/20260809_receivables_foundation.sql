-- R01: Customer -> Account -> Invoice/Obligation -> Recovery Case foundation.
-- Additive only. Existing debtor and case rows remain valid standalone records.
begin;

create unique index if not exists debtors_id_business_unique
  on public.debtors (id, business_id);

create table if not exists public.customer_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.debtors(id) on delete restrict,
  account_type text not null default 'general'
    check (account_type in (
      'general', 'corporate', 'supplier', 'rental', 'vehicle',
      'property', 'project', 'catering_event', 'future'
    )),
  account_number text,
  display_name text not null,
  currency char(3) not null default 'MYR'
    check (currency ~ '^[A-Z]{3}$'),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  custom_fields jsonb not null default '{}'::jsonb
    check (jsonb_typeof(custom_fields) = 'object'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_accounts_display_name_check
    check (nullif(btrim(display_name), '') is not null),
  unique (id, business_id, customer_id),
  unique (id, business_id),
  unique nulls not distinct (business_id, customer_id, account_number)
);

create index if not exists customer_accounts_customer_idx
  on public.customer_accounts (business_id, customer_id)
  where archived_at is null;
create index if not exists customer_accounts_type_idx
  on public.customer_accounts (business_id, account_type)
  where archived_at is null;
create index if not exists customer_accounts_metadata_gin_idx
  on public.customer_accounts using gin (metadata);

alter table public.customer_accounts
  add constraint customer_accounts_customer_tenant_fk
  foreign key (customer_id, business_id)
  references public.debtors(id, business_id)
  on delete restrict;

create table if not exists public.obligations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.debtors(id) on delete restrict,
  account_id uuid,
  obligation_type text not null default 'invoice'
    check (obligation_type in (
      'invoice', 'general_obligation', 'rent', 'vehicle', 'property',
      'project', 'supplier', 'catering_event', 'other'
    )),
  reference text not null,
  purchase_order_reference text,
  issue_date date,
  due_date date not null,
  currency char(3) not null default 'MYR'
    check (currency ~ '^[A-Z]{3}$'),
  original_amount_minor bigint not null check (original_amount_minor >= 0),
  adjustments_minor bigint not null default 0,
  paid_minor bigint not null default 0 check (paid_minor >= 0),
  contractual_due_minor bigint generated always as
    (original_amount_minor + adjustments_minor) stored,
  outstanding_minor bigint generated always as
    (greatest(original_amount_minor + adjustments_minor - paid_minor, 0)) stored,
  status text not null default 'open'
    check (status in (
      'draft', 'open', 'overdue', 'partial', 'paid',
      'disputed', 'void', 'written_off'
    )),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  custom_fields jsonb not null default '{}'::jsonb
    check (jsonb_typeof(custom_fields) = 'object'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint obligations_reference_check
    check (nullif(btrim(reference), '') is not null),
  constraint obligations_dates_check
    check (issue_date is null or due_date >= issue_date),
  constraint obligations_contractual_due_check
    check (original_amount_minor + adjustments_minor >= 0),
  constraint obligations_paid_cap_check
    check (paid_minor <= original_amount_minor + adjustments_minor),
  constraint obligations_account_customer_fk
    foreign key (account_id, business_id, customer_id)
    references public.customer_accounts(id, business_id, customer_id)
    on delete restrict,
  unique (id, business_id),
  unique nulls not distinct (business_id, customer_id, account_id, reference)
);

create index if not exists obligations_customer_idx
  on public.obligations (business_id, customer_id, due_date)
  where archived_at is null;
create index if not exists obligations_account_idx
  on public.obligations (business_id, account_id, due_date)
  where archived_at is null;
create index if not exists obligations_status_idx
  on public.obligations (business_id, status, due_date)
  where archived_at is null;
create index if not exists obligations_metadata_gin_idx
  on public.obligations using gin (metadata);

alter table public.obligations
  add constraint obligations_customer_tenant_fk
  foreign key (customer_id, business_id)
  references public.debtors(id, business_id)
  on delete restrict;

alter table public.cases
  add column if not exists account_id uuid,
  add column if not exists case_scope text not null default 'standalone';

alter table public.cases
  drop constraint if exists cases_scope_check;
alter table public.cases
  add constraint cases_scope_check
  check (case_scope in ('standalone', 'single_obligation', 'multiple_obligations', 'account_balance'));

create unique index if not exists cases_id_business_unique
  on public.cases (id, business_id);

alter table public.cases
  drop constraint if exists cases_account_customer_fk;
alter table public.cases
  add constraint cases_account_customer_fk
  foreign key (account_id, business_id, debtor_id)
  references public.customer_accounts(id, business_id, customer_id)
  on delete restrict;
alter table public.cases
  add constraint cases_customer_tenant_fk
  foreign key (debtor_id, business_id)
  references public.debtors(id, business_id)
  on delete restrict
  not valid;

create index if not exists cases_account_idx
  on public.cases (business_id, account_id)
  where archived_at is null and account_id is not null;
create index if not exists cases_customer_scope_idx
  on public.cases (business_id, debtor_id, case_scope)
  where archived_at is null;

create table if not exists public.recovery_case_obligations (
  case_id text not null,
  obligation_id uuid not null,
  business_id uuid not null,
  linked_at timestamptz not null default now(),
  linked_by uuid references auth.users(id) on delete set null,
  primary key (case_id, obligation_id),
  constraint recovery_case_obligations_case_fk
    foreign key (case_id, business_id)
    references public.cases(id, business_id)
    on delete cascade,
  constraint recovery_case_obligations_obligation_fk
    foreign key (obligation_id, business_id)
    references public.obligations(id, business_id)
    on delete restrict,
  -- One obligation has one authoritative recovery case. This is the primary
  -- database-level double-counting control.
  unique (obligation_id)
);

create index if not exists recovery_case_obligations_case_idx
  on public.recovery_case_obligations (business_id, case_id);

create or replace function public.receivables_validate_case_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare linked_count integer;
begin
  select count(*) into linked_count
  from public.recovery_case_obligations rco where rco.case_id = new.id;
  if new.case_scope = 'standalone' and (new.account_id is not null or linked_count <> 0) then
    raise exception 'Standalone cases cannot have receivable relationships';
  elsif new.case_scope = 'single_obligation' and linked_count <> 1 then
    raise exception 'Single-obligation cases require exactly one obligation';
  elsif new.case_scope = 'multiple_obligations' and linked_count < 2 then
    raise exception 'Multiple-obligation cases require at least two obligations';
  elsif new.case_scope = 'account_balance' then
    if new.account_id is null or linked_count <> 0 then
      raise exception 'Account-balance cases require one account and no obligation links';
    end if;
    if exists (
      select 1 from public.obligations o
      where o.account_id = new.account_id and o.archived_at is null
        and o.status not in ('void', 'written_off')
    ) then
      raise exception 'Account-balance cases cannot overlap active obligations';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists cases_validate_receivable_scope on public.cases;
create constraint trigger cases_validate_receivable_scope
after insert or update of account_id, case_scope, debtor_id, business_id
on public.cases deferrable initially deferred
for each row execute function public.receivables_validate_case_scope();

create or replace function public.receivables_set_obligation_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status not in ('disputed', 'void', 'written_off', 'draft') then
    new.status := case
      when new.paid_minor >= new.original_amount_minor + new.adjustments_minor then 'paid'
      when new.paid_minor > 0 then 'partial'
      when new.due_date < current_date then 'overdue'
      else 'open'
    end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists obligations_set_status on public.obligations;
create trigger obligations_set_status
before insert or update of original_amount_minor, adjustments_minor, paid_minor, due_date, status
on public.obligations
for each row execute function public.receivables_set_obligation_status();

create or replace function public.receivables_protect_linked_obligation_financials()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_setting('collectboss.receivables_sync', true) is distinct from 'on'
     and exists (
       select 1 from public.recovery_case_obligations rco
       where rco.obligation_id = old.id
     )
     and (
       new.original_amount_minor is distinct from old.original_amount_minor
       or new.adjustments_minor is distinct from old.adjustments_minor
       or new.paid_minor is distinct from old.paid_minor
     )
  then
    raise exception 'Linked obligation financials are controlled by the recovery case ledger';
  end if;
  return new;
end;
$$;

drop trigger if exists obligations_protect_linked_financials on public.obligations;
create trigger obligations_protect_linked_financials
before update of original_amount_minor, adjustments_minor, paid_minor
on public.obligations
for each row execute function public.receivables_protect_linked_obligation_financials();

create or replace function public.receivables_sync_case_obligations(p_case_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_case public.cases;
  linked_due bigint;
begin
  select * into current_case from public.cases where id = p_case_id for update;
  if not found then return; end if;

  select coalesce(sum(o.contractual_due_minor), 0)
    into linked_due
  from public.recovery_case_obligations rco
  join public.obligations o on o.id = rco.obligation_id
  where rco.case_id = p_case_id and o.archived_at is null;

  if linked_due = 0 then return; end if;
  if linked_due <> current_case.contractual_due_minor then
    raise exception 'Linked obligation total does not reconcile with the case ledger';
  end if;

  perform set_config('collectboss.receivables_sync', 'on', true);
  with allocation as (
    select
      o.id,
      greatest(
        least(
          current_case.approved_payment_minor
            - coalesce(sum(o.contractual_due_minor) over (
                order by o.due_date, o.created_at, o.id
                rows between unbounded preceding and 1 preceding
              ), 0),
          o.contractual_due_minor
        ),
        0
      )::bigint as allocated_paid_minor
    from public.recovery_case_obligations rco
    join public.obligations o on o.id = rco.obligation_id
    where rco.case_id = p_case_id and o.archived_at is null
  )
  update public.obligations o
     set paid_minor = allocation.allocated_paid_minor
  from allocation
  where o.id = allocation.id
    and o.paid_minor is distinct from allocation.allocated_paid_minor;
end;
$$;

create or replace function public.receivables_sync_case_obligations_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.receivables_sync_case_obligations(new.id);
  return new;
end;
$$;

drop trigger if exists cases_sync_linked_obligations on public.cases;
create trigger cases_sync_linked_obligations
after update of contractual_due_minor, approved_payment_minor
on public.cases
for each row execute function public.receivables_sync_case_obligations_trigger();

-- Forward declaration lets the scope mutation return reconciliation while the
-- full implementation below remains the canonical definition.
create or replace function public.receivables_reconcile_case(p_case_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Receivables reconciliation is not initialized';
end;
$$;

create or replace function public.receivables_set_case_scope(
  p_case_id text,
  p_scope text,
  p_account_id uuid default null,
  p_obligation_ids uuid[] default array[]::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_case public.cases;
  obligation_count integer;
  obligation_due bigint;
begin
  if p_scope not in ('standalone', 'single_obligation', 'multiple_obligations', 'account_balance') then
    raise exception 'Unsupported recovery case scope';
  end if;

  select c.* into current_case
  from public.cases c
  join public.businesses b on b.id = c.business_id
  where c.id = p_case_id and b.owner_id = auth.uid()
  for update;
  if not found then raise exception 'Recovery case not found'; end if;

  if p_scope = 'standalone' then
    if p_account_id is not null or cardinality(p_obligation_ids) <> 0 then
      raise exception 'Standalone cases cannot have account or obligation links';
    end if;
  elsif current_case.debtor_id is null then
    raise exception 'Link a customer before assigning account or obligation coverage';
  end if;

  if p_account_id is not null and not exists (
    select 1 from public.customer_accounts a
    where a.id = p_account_id
      and a.business_id = current_case.business_id
      and a.customer_id = current_case.debtor_id
      and a.archived_at is null
  ) then
    raise exception 'Account is unavailable for this customer';
  end if;

  select count(*), coalesce(sum(o.contractual_due_minor), 0)
    into obligation_count, obligation_due
  from public.obligations o
  where o.id = any(p_obligation_ids)
    and o.business_id = current_case.business_id
    and o.customer_id = current_case.debtor_id
    and o.archived_at is null
    and (p_account_id is null or o.account_id = p_account_id);

  if obligation_count <> cardinality(p_obligation_ids) then
    raise exception 'One or more obligations are unavailable for this customer/account';
  end if;
  if p_scope = 'single_obligation' and obligation_count <> 1 then
    raise exception 'Single-obligation cases require exactly one obligation';
  end if;
  if p_scope = 'multiple_obligations' and obligation_count < 2 then
    raise exception 'Multiple-obligation cases require at least two obligations';
  end if;
  if p_scope = 'account_balance' then
    if p_account_id is null or obligation_count <> 0 then
      raise exception 'Account-balance cases require one account and no obligation links';
    end if;
    if exists (
      select 1 from public.obligations o
      where o.account_id = p_account_id
        and o.archived_at is null
        and o.status not in ('void', 'written_off')
    ) then
      raise exception 'Use obligation coverage while this account has active obligations';
    end if;
  end if;
  if p_scope in ('single_obligation', 'multiple_obligations')
     and obligation_due <> current_case.contractual_due_minor then
    raise exception 'Obligation total must equal the authoritative case balance';
  end if;

  delete from public.recovery_case_obligations where case_id = p_case_id;
  insert into public.recovery_case_obligations (
    case_id, obligation_id, business_id, linked_by
  )
  select p_case_id, obligation_id, current_case.business_id, auth.uid()
  from unnest(p_obligation_ids) obligation_id;

  update public.cases
     set account_id = p_account_id,
         case_scope = p_scope,
         updated_at = now()
   where id = p_case_id;

  perform public.receivables_sync_case_obligations(p_case_id);
  return public.receivables_reconcile_case(p_case_id);
end;
$$;

create or replace function public.receivables_reconcile_case(p_case_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_case public.cases;
  linked_count integer;
  linked_due bigint;
  linked_paid bigint;
  linked_outstanding bigint;
begin
  select c.* into current_case
  from public.cases c
  join public.businesses b on b.id = c.business_id
  where c.id = p_case_id and b.owner_id = auth.uid();
  if not found then raise exception 'Recovery case not found'; end if;

  select count(*), coalesce(sum(o.contractual_due_minor), 0),
         coalesce(sum(o.paid_minor), 0), coalesce(sum(o.outstanding_minor), 0)
    into linked_count, linked_due, linked_paid, linked_outstanding
  from public.recovery_case_obligations rco
  join public.obligations o on o.id = rco.obligation_id
  where rco.case_id = p_case_id and o.archived_at is null;

  return jsonb_build_object(
    'case_id', current_case.id,
    'scope', current_case.case_scope,
    'linked_obligation_count', linked_count,
    'case_contractual_due_minor', current_case.contractual_due_minor,
    'case_approved_payment_minor', current_case.approved_payment_minor,
    'case_outstanding_minor', current_case.outstanding_minor,
    'obligation_contractual_due_minor', linked_due,
    'obligation_paid_minor', linked_paid,
    'obligation_outstanding_minor', linked_outstanding,
    'reconciled', case
      when current_case.case_scope in ('single_obligation', 'multiple_obligations')
        then linked_due = current_case.contractual_due_minor
          and linked_paid = least(current_case.approved_payment_minor, linked_due)
          and linked_outstanding = current_case.outstanding_minor
      else true
    end
  );
end;
$$;

alter table public.customer_accounts enable row level security;
alter table public.obligations enable row level security;
alter table public.recovery_case_obligations enable row level security;

create policy "customer_accounts: owner read" on public.customer_accounts
  for select to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = auth.uid()
  ));
create policy "customer_accounts: owner insert" on public.customer_accounts
  for insert to authenticated
  with check (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = auth.uid()
  ));
create policy "customer_accounts: owner update" on public.customer_accounts
  for update to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = auth.uid()
  ));

create policy "obligations: owner read" on public.obligations
  for select to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = auth.uid()
  ));
create policy "obligations: owner insert" on public.obligations
  for insert to authenticated
  with check (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = auth.uid()
  ));
create policy "obligations: owner update" on public.obligations
  for update to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = auth.uid()
  ));

create policy "recovery_case_obligations: owner read"
  on public.recovery_case_obligations
  for select to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = auth.uid()
  ));

create or replace view public.customer_receivable_totals
with (security_invoker = true)
as
with obligation_totals as (
  select business_id, customer_id,
    sum(contractual_due_minor)::bigint as contractual_due_minor,
    sum(paid_minor)::bigint as paid_minor,
    sum(outstanding_minor)::bigint as outstanding_minor
  from public.obligations
  where archived_at is null and status not in ('void', 'written_off')
  group by business_id, customer_id
),
standalone_case_totals as (
  select c.business_id, c.debtor_id as customer_id,
    sum(c.contractual_due_minor)::bigint as contractual_due_minor,
    sum(c.approved_payment_minor)::bigint as paid_minor,
    sum(c.outstanding_minor)::bigint as outstanding_minor
  from public.cases c
  where c.archived_at is null
    and c.debtor_id is not null
    and c.case_scope in ('standalone', 'account_balance')
    and not exists (
      select 1 from public.recovery_case_obligations rco where rco.case_id = c.id
    )
    and (
      c.case_scope = 'standalone'
      or not exists (
        select 1 from public.obligations o
        where o.account_id = c.account_id and o.archived_at is null
          and o.status not in ('void', 'written_off')
      )
    )
  group by c.business_id, c.debtor_id
)
select
  d.business_id,
  d.id as customer_id,
  coalesce(o.contractual_due_minor, 0) + coalesce(s.contractual_due_minor, 0) as contractual_due_minor,
  coalesce(o.paid_minor, 0) + coalesce(s.paid_minor, 0) as paid_minor,
  coalesce(o.outstanding_minor, 0) + coalesce(s.outstanding_minor, 0) as outstanding_minor
from public.debtors d
left join obligation_totals o
  on o.business_id = d.business_id and o.customer_id = d.id
left join standalone_case_totals s
  on s.business_id = d.business_id and s.customer_id = d.id;

create or replace view public.account_receivable_totals
with (security_invoker = true)
as
select
  a.business_id,
  a.customer_id,
  a.id as account_id,
  coalesce(sum(o.contractual_due_minor) filter (
    where o.archived_at is null and o.status not in ('void', 'written_off')
  ), 0)::bigint as contractual_due_minor,
  coalesce(sum(o.paid_minor) filter (
    where o.archived_at is null and o.status not in ('void', 'written_off')
  ), 0)::bigint as paid_minor,
  coalesce(sum(o.outstanding_minor) filter (
    where o.archived_at is null and o.status not in ('void', 'written_off')
  ), 0)::bigint as outstanding_minor
from public.customer_accounts a
left join public.obligations o on o.account_id = a.id
where a.archived_at is null
group by a.business_id, a.customer_id, a.id;

revoke all on function public.receivables_set_case_scope(text,text,uuid,uuid[]) from public;
revoke all on function public.receivables_reconcile_case(text) from public;
revoke all on function public.receivables_sync_case_obligations(text) from public;
grant execute on function public.receivables_set_case_scope(text,text,uuid,uuid[]) to authenticated;
grant execute on function public.receivables_reconcile_case(text) to authenticated;

commit;

-- Rollback considerations:
-- 1. Drop the two views, triggers and receivables_* functions.
-- 2. Drop recovery_case_obligations, then obligations, then customer_accounts.
-- 3. Drop cases_account_customer_fk, cases_scope_check, account_id and case_scope.
-- The rollback removes new relationships only; legacy debtor/case rows are unchanged.
