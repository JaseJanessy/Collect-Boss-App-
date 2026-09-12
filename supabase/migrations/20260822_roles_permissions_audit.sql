-- R15: tenant memberships, server-enforced permissions and immutable audit history.
-- Proposed migration: review and apply after 20260821_business_verification_abuse_controls.sql.

create table if not exists public.business_memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  invited_email text,
  role text not null check (role in ('owner','admin','manager','staff','viewer')),
  status text not null default 'invited' check (status in ('invited','active','suspended','revoked')),
  invited_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id is not null or nullif(btrim(invited_email),'') is not null)
);
create unique index if not exists business_memberships_business_user_unique
  on public.business_memberships(business_id,user_id) where user_id is not null;
create unique index if not exists business_memberships_business_email_unique
  on public.business_memberships(business_id,lower(invited_email)) where invited_email is not null and status='invited';
create unique index if not exists business_memberships_active_user_one_tenant
  on public.business_memberships(user_id) where user_id is not null and status='active';
create index if not exists business_memberships_business_role_idx
  on public.business_memberships(business_id,role,status);

insert into public.business_memberships(business_id,user_id,invited_email,role,status,accepted_at)
select b.id,b.owner_id,lower(u.email),'owner','active',now()
from public.businesses b join auth.users u on u.id=b.owner_id
on conflict (business_id,user_id) where user_id is not null do update
set role='owner',status='active',accepted_at=coalesce(public.business_memberships.accepted_at,now()),updated_at=now();

create table if not exists public.business_role_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  manager_can_approve_settlements boolean not null default false,
  manager_can_approve_write_offs boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.business_role_settings(business_id)
select id from public.businesses on conflict (business_id) do nothing;

create or replace function public.has_business_permission(p_business_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  with membership as (
    select coalesce(m.role,case when b.owner_id=auth.uid() then 'owner' end) role
    from public.businesses b
    left join public.business_memberships m on m.business_id=b.id and m.user_id=auth.uid() and m.status='active'
    where b.id=p_business_id and (b.owner_id=auth.uid() or m.id is not null)
    limit 1
  ), settings as (
    select * from public.business_role_settings where business_id=p_business_id
  )
  select coalesce((
    select case
      when role in ('owner','admin') then true
      when p_permission='case.read' and role in ('manager','staff','viewer') then true
      when p_permission='case.manage' and role='manager' then true
      when p_permission='payment.approve' and role='manager' then true
      when p_permission='report.read' and role in ('manager','viewer') then true
      when p_permission in ('communication.manage','note.manage','promise.manage') and role in ('manager','staff') then true
      when p_permission='audit.read' and role='manager' then true
      when p_permission='settlement.approve' and role='manager'
        then coalesce((select manager_can_approve_settlements from settings),false)
      when p_permission='write_off.approve' and role='manager'
        then coalesce((select manager_can_approve_write_offs from settings),false)
      else false end
    from membership
  ),false);
$$;
revoke all on function public.has_business_permission(uuid,text) from public;
grant execute on function public.has_business_permission(uuid,text) to authenticated,service_role;

create or replace function public.my_business_id()
returns uuid language sql stable security definer set search_path=public,pg_temp as $$
  select b.id from public.businesses b
  left join public.business_memberships m on m.business_id=b.id and m.user_id=auth.uid() and m.status='active'
  where b.owner_id=auth.uid() or m.id is not null
  order by (b.owner_id=auth.uid()) desc limit 1;
$$;

create or replace function public.owns_case(p_case_id text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.cases c
    where c.id=p_case_id and public.has_business_permission(c.business_id,'case.manage'));
$$;

alter table public.business_memberships enable row level security;
alter table public.business_role_settings enable row level security;
drop policy if exists "business_memberships_self_read" on public.business_memberships;
create policy "business_memberships_self_read" on public.business_memberships for select to authenticated
  using(user_id=auth.uid() or public.has_business_permission(business_id,'users.manage'));
drop policy if exists "business_role_settings_member_read" on public.business_role_settings;
create policy "business_role_settings_member_read" on public.business_role_settings for select to authenticated
  using(public.has_business_permission(business_id,'case.read'));
-- Membership and role-setting writes are server-only. There are intentionally no browser mutation policies.

drop policy if exists "businesses: member read" on public.businesses;
create policy "businesses: member read" on public.businesses for select to authenticated
  using(public.has_business_permission(id,'case.read'));

drop policy if exists "cases_owner_read" on public.cases;
drop policy if exists "cases_owner_insert" on public.cases;
drop policy if exists "cases_owner_update" on public.cases;
create policy "cases_role_read" on public.cases for select to authenticated
  using(public.has_business_permission(business_id,'case.read'));
create policy "cases_role_insert" on public.cases for insert to authenticated
  with check(public.has_business_permission(business_id,'case.manage'));
create policy "cases_role_update" on public.cases for update to authenticated
  using(public.has_business_permission(business_id,'case.manage'))
  with check(public.has_business_permission(business_id,'case.manage'));

drop policy if exists "debtors: owner read" on public.debtors;
drop policy if exists "debtors: owner insert" on public.debtors;
drop policy if exists "debtors: owner update" on public.debtors;
create policy "debtors_role_read" on public.debtors for select to authenticated
  using(public.has_business_permission(business_id,'case.read'));
create policy "debtors_role_insert" on public.debtors for insert to authenticated
  with check(public.has_business_permission(business_id,'case.manage'));
create policy "debtors_role_update" on public.debtors for update to authenticated
  using(public.has_business_permission(business_id,'case.manage'))
  with check(public.has_business_permission(business_id,'case.manage'));

alter table public.audit_logs
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists before_summary jsonb,
  add column if not exists after_summary jsonb,
  add column if not exists actor_role text,
  add column if not exists request_id text,
  add column if not exists session_id text,
  add column if not exists request_metadata jsonb not null default '{}'::jsonb;
create index if not exists audit_logs_entity_idx on public.audit_logs(business_id,entity_type,entity_id,created_at desc);
create index if not exists audit_logs_created_idx on public.audit_logs(business_id,created_at desc);

create or replace function public.audit_logs_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'Audit records are immutable'; end; $$;
drop trigger if exists audit_logs_immutable_guard on public.audit_logs;
create trigger audit_logs_immutable_guard before update or delete on public.audit_logs
for each row execute function public.audit_logs_immutable();

drop policy if exists "owners can append own audit logs" on public.audit_logs;
drop policy if exists "owners can read own audit logs" on public.audit_logs;
drop policy if exists "audit_logs: owner read" on public.audit_logs;
drop policy if exists "audit_logs_role_read" on public.audit_logs;
create policy "audit_logs_role_read" on public.audit_logs for select to authenticated
  using(public.has_business_permission(business_id,'audit.read'));
-- Inserts remain available only to reviewed security-definer functions and service_role.

create or replace function public.accept_my_business_invitation()
returns setof public.business_memberships language plpgsql security definer set search_path=public,pg_temp as $$
declare v_email text:=lower(coalesce(auth.jwt()->>'email','')); v_row public.business_memberships;
begin
  if auth.uid() is null or v_email='' then raise exception 'Authentication required'; end if;
  select * into v_row from public.business_memberships
  where status='invited' and lower(invited_email)=v_email order by created_at limit 1 for update;
  if not found then return; end if;
  if exists(select 1 from public.business_memberships where user_id=auth.uid() and status='active') then
    raise exception 'This user already belongs to a business';
  end if;
  update public.business_memberships set user_id=auth.uid(),status='active',accepted_at=now(),updated_at=now()
  where id=v_row.id returning * into v_row;
  return next v_row;
end; $$;
revoke all on function public.accept_my_business_invitation() from public;
grant execute on function public.accept_my_business_invitation() to authenticated;

revoke all on table public.business_memberships from anon;
revoke all on table public.business_role_settings from anon;
grant select on public.business_memberships,public.business_role_settings to authenticated;
grant all on public.business_memberships,public.business_role_settings to service_role;

-- Rollback: suspend non-owner access and deploy a single-owner-compatible
-- application before changing permission calls. Preserve memberships, invites,
-- role settings and audit history. Keep tenant-aware permission functions/RLS
-- until no deployed code depends on them; never restore broad direct table
-- writes or delete membership evidence during routine rollback.
