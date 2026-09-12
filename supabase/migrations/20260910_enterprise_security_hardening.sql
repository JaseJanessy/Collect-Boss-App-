-- Prompt 21: enterprise tenant, capability, audit, rate-limit, and storage hardening.
-- Proposal only: review in staging before applying to a hosted Supabase project.
--
-- Rollback (deploy the previous application first):
-- begin;
-- drop trigger if exists audit_logs_hash_chain_insert on public.audit_logs;
-- drop function if exists public.audit_logs_append_hash();
-- alter table public.audit_logs drop column if exists event_hash,
--   drop column if exists previous_event_hash, drop column if exists hash_version;
-- drop function if exists public.security_rate_limit_consume(text,text,integer,integer,integer);
-- drop table if exists public.security_rate_limit_buckets;
-- drop trigger if exists public_access_tokens_tenant_scope on public.public_access_tokens;
-- drop function if exists public.enforce_public_access_token_tenant_scope();
-- drop function if exists public.public_rotate_access_token(uuid,text,uuid,timestamptz);
-- alter table public.public_access_tokens drop column if exists business_id;
-- -- Recreate the two direct storage read policies from 20260803 if rollback
-- -- requires legacy signed URLs. Bucket privacy should not be rolled back.
-- commit;

begin;

create extension if not exists pgcrypto;

-- Persist the capability's tenant instead of deriving it independently in every
-- privileged query. The trigger also protects older application versions that
-- omit business_id during a rolling deployment.
alter table public.public_access_tokens
  add column if not exists business_id uuid references public.businesses(id) on delete restrict;

update public.public_access_tokens token
set business_id = case_row.business_id
from public.cases case_row
where case_row.id = token.case_id and token.business_id is null;

do $$
begin
  if exists(select 1 from public.public_access_tokens where business_id is null) then
    raise exception 'Cannot harden public access tokens: an orphaned case reference exists';
  end if;
end $$;

alter table public.public_access_tokens alter column business_id set not null;
create index if not exists public_access_tokens_business_active_idx
  on public.public_access_tokens(business_id,expires_at)
  where revoked_at is null and consumed_at is null;

create or replace function public.enforce_public_access_token_tenant_scope()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_case_business uuid;
begin
  if tg_op='UPDATE' and (new.case_id<>old.case_id or new.business_id<>old.business_id
      or new.purpose<>old.purpose or new.payment_plan_id is distinct from old.payment_plan_id
      or new.receiving_account_id is distinct from old.receiving_account_id) then
    raise exception 'Public capability scope is immutable';
  end if;
  select business_id into v_case_business from public.cases where id=new.case_id;
  if v_case_business is null then raise exception 'Public capability case is unavailable'; end if;
  new.business_id:=coalesce(new.business_id,v_case_business);
  if new.business_id<>v_case_business then raise exception 'Public capability tenant mismatch'; end if;
  if new.payment_plan_id is not null and not exists(
    select 1 from public.payment_plans plan where plan.id=new.payment_plan_id and plan.case_id=new.case_id
  ) then raise exception 'Public capability payment-plan mismatch'; end if;
  if new.receiving_account_id is not null and not exists(
    select 1 from public.receiving_accounts account
    where account.id=new.receiving_account_id and account.business_id=new.business_id
  ) then raise exception 'Public capability receiving-account mismatch'; end if;
  if new.payment_access_request_id is not null and not exists(
    select 1 from public.payment_access_requests request_row
    where request_row.id=new.payment_access_request_id and request_row.case_id=new.case_id
  ) then raise exception 'Public capability access-request mismatch'; end if;
  return new;
end $$;

drop trigger if exists public_access_tokens_tenant_scope on public.public_access_tokens;
create trigger public_access_tokens_tenant_scope
before insert or update on public.public_access_tokens
for each row execute function public.enforce_public_access_token_tenant_scope();

create or replace function public.public_rotate_access_token(
  p_token_id uuid,p_replacement_token_hash text,p_actor_id uuid,p_expires_at timestamptz
) returns public.public_access_tokens language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.public_access_tokens; v_new public.public_access_tokens;
begin
  if p_replacement_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid replacement token hash'; end if;
  select token.* into v_old
  from public.public_access_tokens token
  join public.businesses business on business.id=token.business_id
  where token.id=p_token_id and business.owner_id=p_actor_id
  for update of token;
  if not found or v_old.revoked_at is not null or v_old.consumed_at is not null or v_old.expires_at<=now()
    then raise exception 'Public link is not active'; end if;
  if p_expires_at<=now() or p_expires_at>now()+interval '30 days'
    then raise exception 'Invalid public link expiry'; end if;
  insert into public.public_access_tokens(
    token_hash,purpose,business_id,case_id,payment_plan_id,payment_access_request_id,
    receiving_account_id,created_by,expires_at,token_version,rotated_from_id
  ) values(
    p_replacement_token_hash,v_old.purpose,v_old.business_id,v_old.case_id,v_old.payment_plan_id,
    v_old.payment_access_request_id,v_old.receiving_account_id,p_actor_id,p_expires_at,
    v_old.token_version+1,v_old.id
  ) returning * into v_new;
  update public.public_access_tokens
  set revoked_at=now(),rotated_at=now(),revoke_reason='rotated'
  where id=v_old.id and revoked_at is null and consumed_at is null;
  return v_new;
end $$;
revoke all on function public.public_rotate_access_token(uuid,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.public_rotate_access_token(uuid,text,uuid,timestamptz) to service_role;

-- A shared database bucket backs route-level limits across server instances.
-- Only one-way digests are stored; raw IP addresses and capability values are not.
create table if not exists public.security_rate_limit_buckets(
  scope text not null check(char_length(scope) between 1 and 100),
  key_hash char(64) not null check(key_hash ~ '^[0-9a-f]{64}$'),
  window_expires_at timestamptz not null,
  request_count integer not null check(request_count>0),
  blocked_until timestamptz,
  last_seen_at timestamptz not null default now(),
  primary key(scope,key_hash)
);
alter table public.security_rate_limit_buckets enable row level security;
revoke all on table public.security_rate_limit_buckets from public,anon,authenticated;
grant all on table public.security_rate_limit_buckets to service_role;

create or replace function public.security_rate_limit_consume(
  p_scope text,p_key_hash text,p_limit integer,p_window_seconds integer,p_block_seconds integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.security_rate_limit_buckets; v_now timestamptz:=clock_timestamp();
begin
  if char_length(p_scope) not between 1 and 100 or p_key_hash !~ '^[0-9a-f]{64}$'
    or p_limit not between 1 and 10000 or p_window_seconds not between 1 and 86400
    or p_block_seconds not between 1 and 86400 then raise exception 'Invalid rate-limit parameters'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_scope||':'||p_key_hash,0));
  select * into v_row from public.security_rate_limit_buckets
    where scope=p_scope and key_hash=p_key_hash for update;
  if not found or v_row.window_expires_at<=v_now then
    insert into public.security_rate_limit_buckets(scope,key_hash,window_expires_at,request_count,blocked_until,last_seen_at)
    values(p_scope,p_key_hash,v_now+make_interval(secs=>p_window_seconds),1,null,v_now)
    on conflict(scope,key_hash) do update set window_expires_at=excluded.window_expires_at,
      request_count=1,blocked_until=null,last_seen_at=v_now;
    return jsonb_build_object('allowed',true,'remaining',p_limit-1,'retry_after',0);
  end if;
  if v_row.blocked_until is not null and v_row.blocked_until>v_now then
    update public.security_rate_limit_buckets set last_seen_at=v_now where scope=p_scope and key_hash=p_key_hash;
    return jsonb_build_object('allowed',false,'remaining',0,
      'retry_after',greatest(1,ceil(extract(epoch from v_row.blocked_until-v_now))::integer));
  end if;
  if v_row.request_count>=p_limit then
    update public.security_rate_limit_buckets
      set request_count=request_count+1,blocked_until=v_now+make_interval(secs=>p_block_seconds),last_seen_at=v_now
      where scope=p_scope and key_hash=p_key_hash;
    return jsonb_build_object('allowed',false,'remaining',0,'retry_after',p_block_seconds);
  end if;
  update public.security_rate_limit_buckets set request_count=request_count+1,last_seen_at=v_now
    where scope=p_scope and key_hash=p_key_hash returning * into v_row;
  return jsonb_build_object('allowed',true,'remaining',greatest(0,p_limit-v_row.request_count),'retry_after',0);
end $$;
revoke all on function public.security_rate_limit_consume(text,text,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.security_rate_limit_consume(text,text,integer,integer,integer) to service_role;

-- Existing rows remain immutable and unmodified. New rows form a serialized,
-- tenant-local hash chain so deletion or reordering can be detected externally.
alter table public.audit_logs
  add column if not exists hash_version smallint,
  add column if not exists previous_event_hash char(64),
  add column if not exists event_hash char(64);
alter table public.audit_logs drop constraint if exists audit_logs_hash_shape_check;
alter table public.audit_logs add constraint audit_logs_hash_shape_check check(
  (hash_version is null and previous_event_hash is null and event_hash is null)
  or (hash_version=1 and event_hash ~ '^[0-9a-f]{64}$'
      and (previous_event_hash is null or previous_event_hash ~ '^[0-9a-f]{64}$'))
);
create unique index if not exists audit_logs_event_hash_unique
  on public.audit_logs(business_id,event_hash) where event_hash is not null;

create or replace function public.audit_logs_append_hash()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_previous char(64); v_payload jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('audit:'||new.business_id::text,0));
  select event_hash into v_previous from public.audit_logs
    where business_id=new.business_id and event_hash is not null
    order by created_at desc,id desc limit 1;
  v_payload:=jsonb_build_object(
    'id',new.id,'business_id',new.business_id,'case_id',new.case_id,'action',new.action,
    'actor_type',new.actor_type,'actor_id',new.actor_id,'actor_role',new.actor_role,
    'entity_type',new.entity_type,'entity_id',new.entity_id,'request_id',new.request_id,
    'session_id',new.session_id,'correlation_id',new.correlation_id,
    'idempotency_key',new.idempotency_key,'metadata',coalesce(new.metadata,'{}'::jsonb),
    'before_summary',new.before_summary,'after_summary',new.after_summary,
    'request_metadata',coalesce(new.request_metadata,'{}'::jsonb),'created_at',new.created_at
  );
  new.hash_version:=1;
  new.previous_event_hash:=v_previous;
  new.event_hash:=encode(digest(coalesce(v_previous,'GENESIS')||'|'||v_payload::text,'sha256'),'hex');
  return new;
end $$;
drop trigger if exists audit_logs_hash_chain_insert on public.audit_logs;
create trigger audit_logs_hash_chain_insert before insert on public.audit_logs
for each row execute function public.audit_logs_append_hash();

-- Sensitive assets are served through authorization-checking application routes.
insert into storage.buckets(id,name,public) values
  ('evidence-files','evidence-files',false),
  ('payment-proofs','payment-proofs',false),
  ('receiving-account-qr','receiving-account-qr',false),
  ('dispute-evidence','dispute-evidence',false),
  ('transaction-evidence','transaction-evidence',false)
on conflict(id) do update set public=false;
drop policy if exists "evidence_files_owner_read" on storage.objects;
drop policy if exists "evidence_files_owner_select" on storage.objects;
drop policy if exists "payment_proofs_owner_read" on storage.objects;

commit;
