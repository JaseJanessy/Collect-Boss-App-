-- Prompt 22: production integrations, durable recovery, health truth, and suppression.
-- Additive and reversible. Review and run in staging before production.
begin;

create extension if not exists pgcrypto;

create table if not exists public.integration_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  provider text not null check (provider in ('stripe','resend','xero','quickbooks')),
  job_type text not null check (job_type in ('stripe_event_replay','email_delivery','accounting_sync','accounting_webhook')),
  resource_id text not null,
  deduplication_key char(64) not null unique check (deduplication_key ~ '^[0-9a-f]{64}$'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  status text not null default 'pending'
    check (status in ('pending','processing','retry_scheduled','succeeded','dead_letter','cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 100),
  max_attempts integer not null default 8 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_by uuid references auth.users(id) on delete set null,
  last_replayed_by uuid references auth.users(id) on delete set null,
  last_replayed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(resource_id) between 1 and 500),
  check (last_error_message is null or char_length(last_error_message)<=1000),
  check (business_id is not null or provider='stripe')
);
create index if not exists integration_jobs_ready_idx
  on public.integration_jobs(next_attempt_at,created_at)
  where status in ('pending','retry_scheduled');
create index if not exists integration_jobs_tenant_idx
  on public.integration_jobs(business_id,status,created_at desc) where business_id is not null;

create table if not exists public.integration_health (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null check (provider in ('stripe','resend','xero','quickbooks')),
  status text not null default 'unknown'
    check (status in ('unknown','healthy','degraded','action_required','outage','disconnected')),
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures>=0),
  error_code text,
  actionable_message text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  updated_at timestamptz not null default now(),
  unique (business_id,provider),
  check (actionable_message is null or char_length(actionable_message)<=500)
);

create table if not exists public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  recipient_hash char(64) not null check (recipient_hash ~ '^[0-9a-f]{64}$'),
  masked_recipient text not null,
  reason text not null check (reason in ('bounce','complaint','provider_suppression','manual','invalid')),
  source_event_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by uuid references auth.users(id) on delete set null,
  unique (business_id,recipient_hash)
);
create index if not exists email_suppressions_active_idx
  on public.email_suppressions(business_id,recipient_hash) where active;

alter table public.billing_events
  add column if not exists status text not null default 'pending',
  add column if not exists attempts integer not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists event_created_at timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_message text;
alter table public.billing_events drop constraint if exists billing_events_status_check;
alter table public.billing_events add constraint billing_events_status_check
  check (status in ('pending','processing','retry_scheduled','succeeded','dead_letter'));
alter table public.billing_events drop constraint if exists billing_events_attempts_check;
alter table public.billing_events add constraint billing_events_attempts_check check (attempts between 0 and 100);
update public.billing_events set status=case when processed then 'succeeded' else 'pending' end,
  processed_at=case when processed then coalesce(processed_at,created_at) else null end;

alter table public.accounting_webhook_events
  add column if not exists business_id uuid references public.businesses(id) on delete cascade,
  add column if not exists connection_id uuid references public.accounting_connections(id) on delete cascade,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists last_attempt_at timestamptz,
  add column if not exists dead_lettered_at timestamptz;
alter table public.accounting_webhook_events drop constraint if exists accounting_webhook_events_status_check;
update public.accounting_webhook_events set status='retry_scheduled',next_attempt_at=now() where status='failed';
alter table public.accounting_webhook_events add constraint accounting_webhook_events_status_check
  check (status in ('pending','processing','retry_scheduled','processed','dead_letter'));
create index if not exists accounting_webhook_events_retry_idx
  on public.accounting_webhook_events(next_attempt_at,received_at)
  where status in ('pending','retry_scheduled');

alter table public.email_webhook_events
  add column if not exists status text not null default 'processing',
  add column if not exists attempts integer not null default 1,
  add column if not exists last_error_code text,
  add column if not exists last_error_message text,
  add column if not exists event_created_at timestamptz;
alter table public.email_webhook_events drop constraint if exists email_webhook_events_status_check;
alter table public.email_webhook_events add constraint email_webhook_events_status_check
  check (status in ('processing','processed','ignored','retry_scheduled','dead_letter'));

alter table public.accounting_payment_operation_outbox drop constraint if exists accounting_payment_operation_outbox_status_check;
alter table public.accounting_payment_operation_outbox add constraint accounting_payment_operation_outbox_status_check
  check (status in ('pending','processing','synced','failed','configuration_required','dead_letter'));

alter table public.integration_jobs enable row level security;
alter table public.integration_health enable row level security;
alter table public.email_suppressions enable row level security;

drop policy if exists integration_jobs_tenant_read on public.integration_jobs;
create policy integration_jobs_tenant_read on public.integration_jobs for select to authenticated using (
  business_id is not null and public.has_business_permission(business_id,'settings.sensitive.manage')
);
drop policy if exists integration_health_tenant_read on public.integration_health;
create policy integration_health_tenant_read on public.integration_health for select to authenticated using (
  public.has_business_permission(business_id,'settings.sensitive.manage')
);
drop policy if exists email_suppressions_tenant_read on public.email_suppressions;
create policy email_suppressions_tenant_read on public.email_suppressions for select to authenticated using (
  public.has_business_permission(business_id,'communication.manage')
);

create or replace function public.integration_claim_jobs(p_limit integer default 25)
returns setof public.integration_jobs
language plpgsql security definer set search_path=public,pg_temp
as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required'; end if;
  return query
  with candidates as (
    select j.id from public.integration_jobs j
    where (j.status in ('pending','retry_scheduled') and j.next_attempt_at<=now())
       or (j.status='processing' and j.lease_expires_at<now())
    order by j.next_attempt_at,j.created_at
    for update skip locked limit greatest(1,least(coalesce(p_limit,25),100))
  )
  update public.integration_jobs j set
    status='processing', attempts=j.attempts+1,
    lease_expires_at=now()+interval '5 minutes', updated_at=now()
  from candidates c where j.id=c.id returning j.*;
end $$;

create or replace function public.integration_finish_job(
  p_job_id uuid, p_succeeded boolean, p_error_code text default null, p_error_message text default null
) returns public.integration_jobs
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_job public.integration_jobs;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required'; end if;
  select * into v_job from public.integration_jobs where id=p_job_id for update;
  if not found or v_job.status<>'processing' then raise exception 'job is not processing'; end if;
  update public.integration_jobs set
    status=case when p_succeeded then 'succeeded' when attempts>=max_attempts then 'dead_letter' else 'retry_scheduled' end,
    next_attempt_at=case when p_succeeded or attempts>=max_attempts then next_attempt_at
      else now()+least(interval '24 hours',interval '1 minute'*power(2,least(attempts,10))) end,
    lease_expires_at=null,
    last_error_code=case when p_succeeded then null else left(coalesce(p_error_code,'INTEGRATION_FAILURE'),100) end,
    last_error_message=case when p_succeeded then null else left(coalesce(p_error_message,'Integration operation failed.'),1000) end,
    completed_at=case when p_succeeded or attempts>=max_attempts then now() else null end,
    updated_at=now()
  where id=p_job_id returning * into v_job;
  return v_job;
end $$;

create or replace function public.integration_replay_job(
  p_job_id uuid, p_business_id uuid, p_actor_id uuid
) returns public.integration_jobs
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_job public.integration_jobs;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required'; end if;
  update public.integration_jobs set status='pending',attempts=0,next_attempt_at=now(),lease_expires_at=null,
    last_error_code=null,last_error_message=null,completed_at=null,last_replayed_by=p_actor_id,
    last_replayed_at=now(),updated_at=now()
  where id=p_job_id and business_id=p_business_id and status in ('retry_scheduled','dead_letter')
  returning * into v_job;
  if not found then raise exception 'replayable job not found'; end if;
  return v_job;
end $$;

create or replace function public.billing_claim_event(
  p_stripe_event_id text, p_event_type text, p_event_created_at timestamptz default null
) returns text
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_inserted integer;
  v_processed boolean;
  v_status text;
  v_attempts integer;
  v_next_attempt_at timestamptz;
  v_event_type text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required'; end if;
  insert into public.billing_events(
    stripe_event_id,event_type,processed,status,attempts,next_attempt_at,event_created_at,metadata
  ) values (
    p_stripe_event_id,p_event_type,false,'processing',1,now()+interval '5 minutes',p_event_created_at,
    jsonb_build_object('received_at',now(),'stripe_event_created_at',p_event_created_at)
  ) on conflict(stripe_event_id) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=1 then return 'new'; end if;

  select processed,status,attempts,next_attempt_at,event_type
    into v_processed,v_status,v_attempts,v_next_attempt_at,v_event_type
  from public.billing_events where stripe_event_id=p_stripe_event_id for update;
  if not found then raise exception 'billing event claim disappeared'; end if;
  if v_event_type<>p_event_type then raise exception 'billing event type mismatch'; end if;
  if v_processed or v_status in ('succeeded','dead_letter') then return 'done'; end if;
  if v_status in ('processing','retry_scheduled') and v_next_attempt_at>now() then return 'busy'; end if;
  update public.billing_events set status='processing',attempts=v_attempts+1,
    next_attempt_at=now()+interval '5 minutes',last_error_code=null,last_error_message=null
  where stripe_event_id=p_stripe_event_id;
  return 'retry';
end $$;

create or replace function public.billing_apply_subscription_state(
  p_business_id uuid,p_customer_id text,p_subscription_id text,p_price_id text,p_plan_slug text,p_status text,
  p_period_start timestamptz,p_period_end timestamptz,p_cancel_at_period_end boolean
) returns void
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_effective_slug text; v_plan record;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required'; end if;
  if not exists(select 1 from public.businesses where id=p_business_id) then raise exception 'billing business not found'; end if;
  if p_status not in('active','trialing','past_due','canceled','incomplete','incomplete_expired','unpaid','paused') then raise exception 'invalid subscription status'; end if;
  v_effective_slug:=case when p_status in('active','trialing') then p_plan_slug else 'free' end;
  select * into v_plan from public.plans where slug=v_effective_slug;
  if not found then raise exception 'billing plan not found'; end if;
  insert into public.subscriptions(business_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,plan_slug,status,current_period_start,current_period_end,cancel_at_period_end)
  values(p_business_id,p_customer_id,p_subscription_id,p_price_id,p_plan_slug,p_status,p_period_start,p_period_end,p_cancel_at_period_end)
  on conflict(business_id) do update set stripe_customer_id=excluded.stripe_customer_id,stripe_subscription_id=excluded.stripe_subscription_id,
    stripe_price_id=excluded.stripe_price_id,plan_slug=excluded.plan_slug,status=excluded.status,current_period_start=excluded.current_period_start,
    current_period_end=excluded.current_period_end,cancel_at_period_end=excluded.cancel_at_period_end,updated_at=now();
  insert into public.entitlements(business_id,plan_slug,case_limit,evidence_pack_limit,team_member_limit,payment_lock_enabled,formal_demand_enabled,lawyer_referral_enabled,reports_enabled)
  values(p_business_id,v_effective_slug,v_plan.case_limit,v_plan.evidence_pack_limit,v_plan.team_member_limit,v_plan.payment_lock_enabled,v_plan.formal_demand_enabled,v_plan.lawyer_referral_enabled,v_plan.reports_enabled)
  on conflict(business_id) do update set plan_slug=excluded.plan_slug,case_limit=excluded.case_limit,evidence_pack_limit=excluded.evidence_pack_limit,
    team_member_limit=excluded.team_member_limit,payment_lock_enabled=excluded.payment_lock_enabled,formal_demand_enabled=excluded.formal_demand_enabled,
    lawyer_referral_enabled=excluded.lawyer_referral_enabled,reports_enabled=excluded.reports_enabled,updated_at=now();
end $$;

revoke all on public.integration_jobs,public.integration_health,public.email_suppressions from anon;
revoke insert,update,delete on public.integration_jobs,public.integration_health,public.email_suppressions from authenticated;
grant select on public.integration_jobs,public.integration_health,public.email_suppressions to authenticated;
grant all on public.integration_jobs,public.integration_health,public.email_suppressions to service_role;
revoke all on function public.integration_claim_jobs(integer) from public,anon,authenticated;
revoke all on function public.integration_finish_job(uuid,boolean,text,text) from public,anon,authenticated;
revoke all on function public.integration_replay_job(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.billing_claim_event(text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.integration_claim_jobs(integer) to service_role;
grant execute on function public.integration_finish_job(uuid,boolean,text,text) to service_role;
grant execute on function public.integration_replay_job(uuid,uuid,uuid) to service_role;
grant execute on function public.billing_claim_event(text,text,timestamptz) to service_role;
revoke all on function public.billing_apply_subscription_state(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.billing_apply_subscription_state(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean) to service_role;

commit;

-- Rollback (after disabling integration workers and replay routes):
-- begin;
-- drop function if exists public.integration_replay_job(uuid,uuid,uuid);
-- drop function if exists public.integration_finish_job(uuid,boolean,text,text);
-- drop function if exists public.integration_claim_jobs(integer);
-- drop function if exists public.billing_claim_event(text,text,timestamptz);
-- drop function if exists public.billing_apply_subscription_state(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean);
-- drop table if exists public.email_suppressions;
-- drop table if exists public.integration_health;
-- drop table if exists public.integration_jobs;
-- update public.accounting_payment_operation_outbox set status='failed' where status='dead_letter';
-- alter table public.accounting_payment_operation_outbox drop constraint if exists accounting_payment_operation_outbox_status_check;
-- alter table public.accounting_payment_operation_outbox add constraint accounting_payment_operation_outbox_status_check
--   check (status in ('pending','processing','synced','failed','configuration_required'));
-- alter table public.email_webhook_events drop column if exists status,drop column if exists attempts,
--   drop column if exists last_error_code,drop column if exists last_error_message,drop column if exists event_created_at;
-- update public.accounting_webhook_events set status='failed' where status in ('retry_scheduled','dead_letter');
-- alter table public.accounting_webhook_events drop constraint if exists accounting_webhook_events_status_check;
-- alter table public.accounting_webhook_events add constraint accounting_webhook_events_status_check
--   check (status in ('pending','processed','failed'));
-- alter table public.accounting_webhook_events drop column if exists business_id,drop column if exists connection_id,
--   drop column if exists next_attempt_at,drop column if exists last_attempt_at,drop column if exists dead_lettered_at;
-- alter table public.billing_events drop column if exists status,drop column if exists attempts,
--   drop column if exists next_attempt_at,drop column if exists event_created_at,drop column if exists processed_at,
--   drop column if exists last_error_code,drop column if exists last_error_message;
-- commit;
