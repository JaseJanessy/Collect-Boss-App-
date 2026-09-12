-- CollectBoss Pocket shell: authoritative workspace product ownership.
-- Additive only. Existing businesses without a row remain CollectBoss Main.

create table if not exists public.workspace_product_states (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  product_type text not null check (product_type in ('main', 'pocket')),
  lifecycle_state text not null default 'active'
    check (lifecycle_state in ('active', 'grace_read_only', 'suspended')),
  activated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.workspace_product_state_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  from_product_type text check (from_product_type is null or from_product_type in ('main', 'pocket')),
  to_product_type text not null check (to_product_type in ('main', 'pocket')),
  from_lifecycle_state text check (from_lifecycle_state is null or from_lifecycle_state in ('active', 'grace_read_only', 'suspended')),
  to_lifecycle_state text not null check (to_lifecycle_state in ('active', 'grace_read_only', 'suspended')),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists workspace_product_state_events_business_created_idx
  on public.workspace_product_state_events (business_id, created_at desc);

create or replace function public.capture_workspace_product_state_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.workspace_product_state_events (
      business_id, from_product_type, to_product_type,
      from_lifecycle_state, to_lifecycle_state, actor_id
    ) values (
      new.business_id, null, new.product_type, null, new.lifecycle_state,
      coalesce(new.updated_by, auth.uid())
    );
  elsif old.product_type is distinct from new.product_type
    or old.lifecycle_state is distinct from new.lifecycle_state then
    insert into public.workspace_product_state_events (
      business_id, from_product_type, to_product_type,
      from_lifecycle_state, to_lifecycle_state, actor_id
    ) values (
      new.business_id, old.product_type, new.product_type,
      old.lifecycle_state, new.lifecycle_state,
      coalesce(new.updated_by, auth.uid())
    );
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists workspace_product_state_audit on public.workspace_product_states;
create trigger workspace_product_state_audit
before insert or update on public.workspace_product_states
for each row execute function public.capture_workspace_product_state_event();

alter table public.workspace_product_states enable row level security;
alter table public.workspace_product_state_events enable row level security;

drop policy if exists workspace_product_states_tenant_read on public.workspace_product_states;
create policy workspace_product_states_tenant_read on public.workspace_product_states
for select to authenticated using (public.has_business_permission(business_id, 'case.read'));

drop policy if exists workspace_product_state_events_tenant_read on public.workspace_product_state_events;
create policy workspace_product_state_events_tenant_read on public.workspace_product_state_events
for select to authenticated using (public.has_business_permission(business_id, 'case.read'));

revoke all on public.workspace_product_states, public.workspace_product_state_events from anon;
revoke insert, update, delete on public.workspace_product_states, public.workspace_product_state_events from authenticated;
grant select on public.workspace_product_states, public.workspace_product_state_events to authenticated;
grant all on public.workspace_product_states, public.workspace_product_state_events to service_role;

create or replace function public.my_workspace_context()
returns table (
  business_id uuid,
  workspace_name text,
  product_type text,
  lifecycle_state text,
  plan_slug text,
  subscription_status text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_business_id uuid;
begin
  if auth.uid() is null then
    return;
  end if;
  v_business_id := public.my_business_id();
  if v_business_id is null then
    return;
  end if;
  return query
  select
    b.id,
    b.business_name,
    coalesce(wps.product_type, 'main'),
    coalesce(wps.lifecycle_state, 'active'),
    coalesce(s.plan_slug, e.plan_slug, 'free'),
    s.status
  from public.businesses b
  left join public.workspace_product_states wps on wps.business_id = b.id
  left join public.subscriptions s on s.business_id = b.id
  left join public.entitlements e on e.business_id = b.id
  where b.id = v_business_id;
end $$;

revoke all on function public.my_workspace_context() from public, anon;
grant execute on function public.my_workspace_context() to authenticated, service_role;

-- Rollback (only after Pocket routes and product selection are disabled):
-- drop function if exists public.my_workspace_context();
-- drop trigger if exists workspace_product_state_audit on public.workspace_product_states;
-- drop function if exists public.capture_workspace_product_state_event();
-- drop table if exists public.workspace_product_state_events;
-- drop table if exists public.workspace_product_states;
