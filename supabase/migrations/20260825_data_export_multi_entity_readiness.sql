-- R18: controlled data export support and additive multi-business/entity readiness.
-- Review after 20260824_bulk_operations_search_import_merge.sql.
-- This migration does not create, backfill or re-parent any existing tenant data.
-- Existing business_id columns remain the authoritative financial ownership key.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (nullif(btrim(name),'') is not null),
  registration_no text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_business_relationships (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete cascade,
  relationship_type text not null default 'primary'
    check (relationship_type in ('primary','subsidiary','affiliate','franchise','managed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id,business_id),
  unique (business_id)
);

create table if not exists public.business_entities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  organization_id uuid,
  parent_entity_id uuid,
  entity_type text not null default 'branch'
    check (entity_type in ('legal_entity','branch','division','location','other')),
  name text not null check (nullif(btrim(name),'') is not null),
  code text,
  legal_name text,
  registration_no text,
  address text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,business_id),
  unique nulls not distinct (business_id,code),
  check (parent_entity_id is null or parent_entity_id<>id),
  constraint business_entities_parent_tenant_fk
    foreign key (parent_entity_id,business_id)
    references public.business_entities(id,business_id) on delete restrict,
  constraint business_entities_organization_business_fk
    foreign key (organization_id,business_id)
    references public.organization_business_relationships(organization_id,business_id)
    on delete restrict
);

alter table public.customer_accounts add column if not exists business_entity_id uuid;
alter table public.obligations add column if not exists business_entity_id uuid;
alter table public.cases add column if not exists business_entity_id uuid;
alter table public.receiving_accounts add column if not exists business_entity_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='customer_accounts_business_entity_tenant_fk') then
    alter table public.customer_accounts add constraint customer_accounts_business_entity_tenant_fk
      foreign key (business_entity_id,business_id)
      references public.business_entities(id,business_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname='obligations_business_entity_tenant_fk') then
    alter table public.obligations add constraint obligations_business_entity_tenant_fk
      foreign key (business_entity_id,business_id)
      references public.business_entities(id,business_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname='cases_business_entity_tenant_fk') then
    alter table public.cases add constraint cases_business_entity_tenant_fk
      foreign key (business_entity_id,business_id)
      references public.business_entities(id,business_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname='receiving_accounts_business_entity_tenant_fk') then
    alter table public.receiving_accounts add constraint receiving_accounts_business_entity_tenant_fk
      foreign key (business_entity_id,business_id)
      references public.business_entities(id,business_id) on delete restrict;
  end if;
end $$;

create index if not exists organization_business_relationships_business_idx
  on public.organization_business_relationships(business_id,organization_id);
create index if not exists business_entities_business_parent_idx
  on public.business_entities(business_id,parent_entity_id,entity_type) where is_active;
create index if not exists customer_accounts_business_entity_idx
  on public.customer_accounts(business_id,business_entity_id) where business_entity_id is not null;
create index if not exists obligations_business_entity_idx
  on public.obligations(business_id,business_entity_id,status) where business_entity_id is not null;
create index if not exists cases_business_entity_idx
  on public.cases(business_id,business_entity_id,status) where business_entity_id is not null;
create index if not exists receiving_accounts_business_entity_idx
  on public.receiving_accounts(business_id,business_entity_id) where business_entity_id is not null;

alter table public.organizations enable row level security;
alter table public.organization_business_relationships enable row level security;
alter table public.business_entities enable row level security;

drop policy if exists "organizations_member_read" on public.organizations;
create policy "organizations_member_read" on public.organizations for select to authenticated
  using(exists(
    select 1 from public.organization_business_relationships relationship
    where relationship.organization_id=organizations.id
      and public.has_business_permission(relationship.business_id,'case.read')
  ));
drop policy if exists "organization_business_relationships_member_read"
  on public.organization_business_relationships;
create policy "organization_business_relationships_member_read"
  on public.organization_business_relationships for select to authenticated
  using(public.has_business_permission(business_id,'case.read'));
drop policy if exists "business_entities_member_read" on public.business_entities;
create policy "business_entities_member_read" on public.business_entities for select to authenticated
  using(public.has_business_permission(business_id,'case.read'));
-- Organization/entity creation and relationship mutation are server-only.
-- Existing account/invoice/case policies continue to govern their nullable
-- entity assignment, and the composite keys prevent cross-tenant assignment.

revoke all on public.organizations,public.organization_business_relationships,public.business_entities from anon;
grant select on public.organizations,public.organization_business_relationships,public.business_entities to authenticated;
grant all on public.organizations,public.organization_business_relationships,public.business_entities to service_role;

-- Rollback: disable export and organization/entity mutation endpoints before
-- deploying the prior application. Preserve tenant mappings, export audit
-- evidence and nullable entity assignments. Empty additive association objects
-- may be removed after dependency checks; never re-parent or delete financial
-- records as part of rollback.
