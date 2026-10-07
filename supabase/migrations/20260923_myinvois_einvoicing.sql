-- LHDN MyInvois e-Invoicing.
--
-- CollectBoss submits as an LHDN intermediary on behalf of each business
-- (the business authorises CollectBoss in the MyInvois portal). Documents use
-- e-Invoice version 1.0 (UBL JSON), which LHDN still accepts without a
-- digital signature until it announces retirement of 1.0.
--
-- Review before applying. Safe to re-run.

begin;

create table if not exists public.einvoice_profiles (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  enabled boolean not null default false,
  supplier_tin text not null default '',
  supplier_brn text not null default '',
  supplier_sst text,
  supplier_ttx text,
  msic_code text not null default '' check (msic_code = '' or msic_code ~ '^\d{5}$'),
  activity_description text not null default '',
  phone text not null default '',
  email text,
  address_line text not null default '',
  city text not null default '',
  postcode text not null default '' check (postcode = '' or postcode ~ '^\d{5}$'),
  state_code text not null default '14' check (state_code ~ '^(0[1-9]|1[0-7])$'),
  tax_type text not null default '06' check (tax_type in ('01','02','06','E')),
  tax_rate_percent numeric(5,2) not null default 0 check (tax_rate_percent between 0 and 100),
  intermediary_authorised_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_tax_details (
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.debtors(id) on delete cascade,
  tin text,
  id_scheme text check (id_scheme is null or id_scheme in ('BRN','NRIC','PASSPORT','ARMY')),
  id_value text,
  sst_no text,
  address_line text,
  city text,
  postcode text,
  state_code text check (state_code is null or state_code ~ '^(0[1-9]|1[0-7])$'),
  country_code text not null default 'MYS' check (country_code ~ '^[A-Z]{3}$'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (business_id, customer_id)
);

create table if not exists public.einvoice_documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  obligation_id uuid references public.obligations(id) on delete set null,
  customer_id uuid references public.debtors(id) on delete set null,
  environment text not null check (environment in ('preprod','production')),
  code_number text not null,
  document_hash text not null,
  submission_uid text,
  uuid text unique,
  long_id text,
  status text not null default 'submitted' check (status in ('submitted','valid','invalid','cancelled','rejected')),
  errors jsonb not null default '[]'::jsonb,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  validated_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists einvoice_documents_obligation_idx on public.einvoice_documents (business_id, obligation_id, submitted_at desc);
create index if not exists einvoice_documents_pending_idx on public.einvoice_documents (status, submitted_at) where status = 'submitted';
-- Only one live (submitted or valid) e-Invoice per invoice.
create unique index if not exists einvoice_documents_live_uidx
  on public.einvoice_documents (business_id, obligation_id) where status in ('submitted','valid');

alter table public.einvoice_profiles enable row level security;
alter table public.customer_tax_details enable row level security;
alter table public.einvoice_documents enable row level security;
drop policy if exists "einvoice_profiles: tenant read" on public.einvoice_profiles;
create policy "einvoice_profiles: tenant read" on public.einvoice_profiles
  for select to authenticated using (has_business_permission(business_id, 'case.read'));
drop policy if exists "customer_tax_details: tenant read" on public.customer_tax_details;
create policy "customer_tax_details: tenant read" on public.customer_tax_details
  for select to authenticated using (has_business_permission(business_id, 'case.read'));
drop policy if exists "einvoice_documents: tenant read" on public.einvoice_documents;
create policy "einvoice_documents: tenant read" on public.einvoice_documents
  for select to authenticated using (has_business_permission(business_id, 'case.read'));
revoke insert, update, delete on public.einvoice_profiles, public.customer_tax_details, public.einvoice_documents from anon, authenticated;
grant select on public.einvoice_profiles, public.customer_tax_details, public.einvoice_documents to authenticated;
grant all on public.einvoice_profiles, public.customer_tax_details, public.einvoice_documents to service_role;

commit;
