-- Prompt 7: minimum mobile push-device persistence and delivery receipts.
-- Proposed migration only; review before applying to a deployed project.

begin;

create table if not exists public.mobile_push_devices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('android','ios')),
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expo_push_token ~ '^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$')
);
create index if not exists mobile_push_devices_delivery_idx
  on public.mobile_push_devices(business_id,user_id) where enabled;

create table if not exists public.mobile_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  device_id uuid not null references public.mobile_push_devices(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','ticket_ok','delivered','retryable_error','failed')),
  ticket_id text,
  attempts integer not null default 0 check (attempts between 0 and 5),
  last_error text,
  sent_at timestamptz,
  receipt_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(notification_id,device_id)
);
create index if not exists mobile_push_deliveries_receipt_idx
  on public.mobile_push_deliveries(sent_at) where status='ticket_ok' and receipt_checked_at is null;
create index if not exists mobile_push_deliveries_retry_idx
  on public.mobile_push_deliveries(updated_at) where status in ('queued','retryable_error') and attempts<5;

alter table public.mobile_push_devices enable row level security;
alter table public.mobile_push_deliveries enable row level security;

drop policy if exists "mobile_push_devices_self_read" on public.mobile_push_devices;
drop policy if exists "mobile_push_devices_self_insert" on public.mobile_push_devices;
drop policy if exists "mobile_push_devices_self_update" on public.mobile_push_devices;
drop policy if exists "mobile_push_devices_self_delete" on public.mobile_push_devices;
create policy "mobile_push_devices_self_read" on public.mobile_push_devices for select to authenticated
  using (user_id=auth.uid() and public.has_business_permission(business_id,'case.read'));
create policy "mobile_push_devices_self_insert" on public.mobile_push_devices for insert to authenticated
  with check (user_id=auth.uid() and public.has_business_permission(business_id,'case.read'));
create policy "mobile_push_devices_self_update" on public.mobile_push_devices for update to authenticated
  using (user_id=auth.uid() and public.has_business_permission(business_id,'case.read'))
  with check (user_id=auth.uid() and public.has_business_permission(business_id,'case.read'));
create policy "mobile_push_devices_self_delete" on public.mobile_push_devices for delete to authenticated
  using (user_id=auth.uid() and public.has_business_permission(business_id,'case.read'));

revoke all on public.mobile_push_devices,public.mobile_push_deliveries from anon;
revoke all on public.mobile_push_deliveries from authenticated;
grant select,insert,update,delete on public.mobile_push_devices to authenticated;
grant all on public.mobile_push_devices,public.mobile_push_deliveries to service_role;

commit;

-- Rollback (after disabling mobile registration and push dispatch):
-- begin;
-- drop table if exists public.mobile_push_deliveries;
-- drop table if exists public.mobile_push_devices;
-- commit;
