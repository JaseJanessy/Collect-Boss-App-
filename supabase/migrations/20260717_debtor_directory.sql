-- Tenant-scoped debtor directory. Apply after the canonical schema and
-- 20260716_account_profile.sql. Existing case snapshot fields remain intact.

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'businesses'
  ) or not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'cases'
  ) then
    raise exception 'Expected public.businesses and public.cases tables';
  end if;
end
$$;

create table if not exists public.debtors (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  debtor_type       text not null,
  individual_name   text,
  business_name     text,
  contact_name      text,
  registration_no   text,
  phone             text,
  email             text,
  address           text,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint debtors_type_check check (debtor_type in ('individual', 'business')),
  constraint debtors_identity_check check (
    (debtor_type = 'individual' and nullif(btrim(individual_name), '') is not null)
    or
    (debtor_type = 'business' and nullif(btrim(business_name), '') is not null)
  )
);

alter table public.cases
  add column if not exists debtor_id uuid references public.debtors(id) on delete restrict,
  add column if not exists debtor_type text;

update public.cases
set debtor_type = case
  when nullif(btrim(debtor_company), '') is not null
    or nullif(btrim(debtor_reg_no), '') is not null
    then 'business'
  else 'individual'
end
where debtor_type is null;

alter table public.cases
  drop constraint if exists cases_debtor_type_check;
alter table public.cases
  add constraint cases_debtor_type_check
  check (debtor_type in ('individual', 'business')) not valid;
alter table public.cases
  validate constraint cases_debtor_type_check;
alter table public.cases
  alter column debtor_type set not null;

alter table public.cases
  drop constraint if exists cases_business_debtor_company_check;
alter table public.cases
  add constraint cases_business_debtor_company_check
  check (
    debtor_type <> 'business'
    or nullif(btrim(debtor_company), '') is not null
  ) not valid;
alter table public.cases
  validate constraint cases_business_debtor_company_check;

create or replace function public.validate_case_debtor_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.debtor_id is not null and not exists (
    select 1
    from public.debtors d
    where d.id = new.debtor_id
      and d.business_id = new.business_id
  ) then
    raise exception 'case debtor must belong to the case business';
  end if;

  return new;
end;
$$;

drop trigger if exists cases_debtor_tenant_guard on public.cases;
create trigger cases_debtor_tenant_guard
before insert or update of business_id, debtor_id on public.cases
for each row execute function public.validate_case_debtor_tenant();

alter table public.debtors enable row level security;

drop policy if exists "debtors_owner_manage" on public.debtors;
create policy "debtors_owner_manage"
on public.debtors for all to authenticated
using (
  exists (
    select 1 from public.businesses b
    where b.id = debtors.business_id and b.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.businesses b
    where b.id = debtors.business_id and b.owner_id = auth.uid()
  )
);

create index if not exists idx_debtors_business_active
  on public.debtors (business_id, archived_at);
create index if not exists idx_debtors_business_lookup
  on public.debtors (
    business_id,
    debtor_type,
    lower(btrim(coalesce(individual_name, ''))),
    lower(btrim(coalesce(business_name, '')))
  );
create index if not exists idx_cases_debtor_id
  on public.cases (debtor_id);

commit;

-- Rollback (run only after removing application support for debtor_id):
-- begin;
-- drop index if exists public.idx_cases_debtor_id;
-- drop index if exists public.idx_debtors_business_lookup;
-- drop index if exists public.idx_debtors_business_active;
-- drop trigger if exists cases_debtor_tenant_guard on public.cases;
-- drop function if exists public.validate_case_debtor_tenant();
-- alter table public.cases drop constraint if exists cases_business_debtor_company_check;
-- alter table public.cases drop constraint if exists cases_debtor_type_check;
-- alter table public.cases drop column if exists debtor_type;
-- alter table public.cases drop column if exists debtor_id;
-- drop policy if exists debtors_owner_manage on public.debtors;
-- drop table if exists public.debtors;
-- commit;
