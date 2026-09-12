-- R13: OTP-secured debtor payment access.
-- Apply after 20260805_receiving_account_security.sql and
-- 20260806_secure_payment_proof_flow.sql.
-- This migration is additive and preserves existing tokens, requests, proofs,
-- receiving accounts and financial history. It intentionally creates no anon
-- policies: public actions use token-validating server routes and service-role
-- RPCs.
begin;

create table if not exists public.payment_access_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  public_access_token_id uuid not null references public.public_access_tokens(id) on delete restrict,
  channel text not null check (channel in ('email','sms')),
  destination_hash char(64) not null,
  code_hash char(64) not null,
  requester_ip_hash char(64) not null,
  expires_at timestamptz not null,
  resend_available_at timestamptz not null,
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  max_attempts smallint not null default 5 check (max_attempts = 5),
  delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','failed')),
  provider_reference text,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and resend_available_at > created_at)
);
create index if not exists payment_access_otp_token_recent_idx
  on public.payment_access_otp_challenges(public_access_token_id,created_at desc);
create index if not exists payment_access_otp_ip_recent_idx
  on public.payment_access_otp_challenges(requester_ip_hash,created_at desc);

create table if not exists public.payment_access_sessions (
  id uuid primary key default gen_random_uuid(),
  session_hash char(64) not null unique,
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  public_access_token_id uuid not null references public.public_access_tokens(id) on delete restrict,
  otp_challenge_id uuid not null references public.payment_access_otp_challenges(id) on delete restrict,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index if not exists payment_access_sessions_token_active_idx
  on public.payment_access_sessions(public_access_token_id,expires_at)
  where revoked_at is null;

create table if not exists public.payment_access_suspicious_reports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  public_access_token_id uuid not null references public.public_access_tokens(id) on delete restrict,
  category text not null check (category in (
    'unrecognised_debt','creditor_details_wrong','payment_details_suspicious',
    'unexpected_link','other'
  )),
  details text check (details is null or char_length(details)<=1000),
  reporter_ip_hash char(64) not null,
  created_at timestamptz not null default now()
);
create index if not exists payment_access_suspicious_reports_business_idx
  on public.payment_access_suspicious_reports(business_id,created_at desc);

alter table public.public_payment_submissions
  add column if not exists payment_access_session_id uuid
    references public.payment_access_sessions(id) on delete restrict;

alter table public.payment_access_otp_challenges enable row level security;
alter table public.payment_access_sessions enable row level security;
alter table public.payment_access_suspicious_reports enable row level security;
drop policy if exists "payment_access_suspicious_reports_owner_read" on public.payment_access_suspicious_reports;
create policy "payment_access_suspicious_reports_owner_read"
  on public.payment_access_suspicious_reports for select to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id=payment_access_suspicious_reports.business_id and b.owner_id=auth.uid()
  ));
-- Challenge codes and session hashes deliberately have no browser read policy.

create or replace function public.payment_access_issue_otp(
  p_token_id uuid,p_business_id uuid,p_case_id text,p_channel text,
  p_destination_hash text,p_code_hash text,p_ip_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_token public.public_access_tokens; v_case public.cases;
  v_latest public.payment_access_otp_challenges; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('payment-otp:'||p_token_id::text,0));
  select * into v_token from public.public_access_tokens where id=p_token_id for update;
  select * into v_case from public.cases where id=p_case_id and business_id=p_business_id;
  if not found or v_token.id is null or v_token.case_id<>p_case_id or v_token.purpose<>'payment'
    or v_token.revoked_at is not null or v_token.consumed_at is not null
    or v_token.expires_at<=now() or v_token.receiving_account_id is null
    or v_case.status in ('closed','paid') or v_case.archived_at is not null
    or v_case.payment_lock_mode='manual'
    or not exists(select 1 from public.receiving_accounts ra
      where ra.id=v_token.receiving_account_id and ra.business_id=p_business_id
        and ra.is_active and ra.verification_status='verified') then
    return jsonb_build_object('status','unavailable');
  end if;
  if p_channel not in ('email','sms') or p_destination_hash!~'^[0-9a-f]{64}$'
    or p_code_hash!~'^[0-9a-f]{64}$' or p_ip_hash!~'^[0-9a-f]{64}$' then
    raise exception 'invalid OTP issue input';
  end if;
  if (select count(*) from public.payment_access_otp_challenges
      where public_access_token_id=p_token_id and created_at>now()-interval '10 minutes')>=5
    or (select count(*) from public.payment_access_otp_challenges
      where requester_ip_hash=p_ip_hash and created_at>now()-interval '1 hour')>=20 then
    return jsonb_build_object('status','rate_limited');
  end if;
  select * into v_latest from public.payment_access_otp_challenges
    where public_access_token_id=p_token_id and consumed_at is null
      and invalidated_at is null and delivery_status<>'failed'
    order by created_at desc limit 1;
  if found and v_latest.resend_available_at>now() then
    return jsonb_build_object('status','cooldown','retry_after',
      greatest(1,ceil(extract(epoch from v_latest.resend_available_at-now()))::integer));
  end if;
  update public.payment_access_otp_challenges set invalidated_at=now()
    where public_access_token_id=p_token_id and consumed_at is null and invalidated_at is null;
  insert into public.payment_access_otp_challenges(
    business_id,case_id,public_access_token_id,channel,destination_hash,
    code_hash,requester_ip_hash,expires_at,resend_available_at
  ) values(
    p_business_id,p_case_id,p_token_id,p_channel,p_destination_hash,
    p_code_hash,p_ip_hash,now()+interval '7 minutes',now()+interval '60 seconds'
  ) returning id into v_id;
  insert into public.payment_access_events(case_id,receiving_account_id,public_access_token_id,action,actor_type,metadata)
    values(p_case_id,v_token.receiving_account_id,p_token_id,'payment_access.otp_requested','debtor',
      jsonb_build_object('channel',p_channel,'challenge_id',v_id));
  return jsonb_build_object('status','issued','challenge_id',v_id,
    'expires_in',420,'resend_after',60);
end $$;

create or replace function public.payment_access_mark_otp_delivery(
  p_challenge_id uuid,p_sent boolean,p_provider_reference text default null
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.payment_access_otp_challenges set
    delivery_status=case when p_sent then 'sent' else 'failed' end,
    provider_reference=left(nullif(p_provider_reference,''),200),
    invalidated_at=case when p_sent then invalidated_at else coalesce(invalidated_at,now()) end
  where id=p_challenge_id and delivery_status='pending';
end $$;

create or replace function public.payment_access_verify_otp(
  p_token_id uuid,p_code_hash text,p_session_hash text,p_ip_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_challenge public.payment_access_otp_challenges; v_token public.public_access_tokens;
  v_session_id uuid; v_remaining integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('payment-otp:'||p_token_id::text,0));
  if p_code_hash!~'^[0-9a-f]{64}$' or p_session_hash!~'^[0-9a-f]{64}$'
    or p_ip_hash!~'^[0-9a-f]{64}$' then
    return jsonb_build_object('status','invalid');
  end if;
  select * into v_token from public.public_access_tokens where id=p_token_id for update;
  if not found or v_token.purpose<>'payment' or v_token.revoked_at is not null
    or v_token.consumed_at is not null or v_token.expires_at<=now() then
    return jsonb_build_object('status','invalid');
  end if;
  select * into v_challenge from public.payment_access_otp_challenges
    where public_access_token_id=p_token_id and delivery_status='sent'
      and consumed_at is null and invalidated_at is null
    order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('status','invalid'); end if;
  if v_challenge.expires_at<=now() then
    update public.payment_access_otp_challenges set invalidated_at=now() where id=v_challenge.id;
    return jsonb_build_object('status','expired');
  end if;
  if v_challenge.attempt_count>=v_challenge.max_attempts then
    update public.payment_access_otp_challenges set invalidated_at=coalesce(invalidated_at,now()) where id=v_challenge.id;
    return jsonb_build_object('status','locked');
  end if;
  update public.payment_access_otp_challenges set attempt_count=attempt_count+1 where id=v_challenge.id;
  if v_challenge.code_hash<>p_code_hash then
    v_remaining:=v_challenge.max_attempts-v_challenge.attempt_count-1;
    if v_remaining<=0 then
      update public.payment_access_otp_challenges set invalidated_at=now() where id=v_challenge.id;
      return jsonb_build_object('status','locked','attempts_remaining',0);
    end if;
    return jsonb_build_object('status','invalid','attempts_remaining',v_remaining);
  end if;
  update public.payment_access_otp_challenges set consumed_at=now() where id=v_challenge.id;
  update public.payment_access_sessions set revoked_at=coalesce(revoked_at,now())
    where public_access_token_id=p_token_id and revoked_at is null;
  insert into public.payment_access_sessions(
    session_hash,business_id,case_id,public_access_token_id,otp_challenge_id,expires_at
  ) values(p_session_hash,v_challenge.business_id,v_challenge.case_id,p_token_id,v_challenge.id,now()+interval '15 minutes')
  returning id into v_session_id;
  if v_token.payment_access_request_id is not null then
    update public.payment_access_requests set otp_verified=true
      where id=v_token.payment_access_request_id and case_id=v_challenge.case_id;
  end if;
  insert into public.payment_access_events(case_id,receiving_account_id,public_access_token_id,action,actor_type,metadata)
    values(v_challenge.case_id,v_token.receiving_account_id,p_token_id,'payment_access.otp_verified','debtor',
      jsonb_build_object('channel',v_challenge.channel,'session_id',v_session_id));
  return jsonb_build_object('status','verified','session_id',v_session_id,'expires_in',900);
end $$;

create or replace function public.payment_access_validate_session(
  p_token_id uuid,p_session_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session public.payment_access_sessions; v_token public.public_access_tokens;
  v_case public.cases;
begin
  select * into v_session from public.payment_access_sessions
    where session_hash=p_session_hash and public_access_token_id=p_token_id
      and revoked_at is null and expires_at>now() order by created_at desc limit 1;
  if not found then return jsonb_build_object('valid',false); end if;
  select * into v_token from public.public_access_tokens where id=p_token_id;
  select * into v_case from public.cases where id=v_session.case_id and business_id=v_session.business_id;
  if v_token.id is null or v_token.purpose<>'payment' or v_token.revoked_at is not null
    or v_token.consumed_at is not null or v_token.expires_at<=now()
    or v_case.id is null or v_case.status in ('closed','paid') or v_case.archived_at is not null
    or v_case.payment_lock_mode='manual' or v_token.receiving_account_id is null
    or not exists(select 1 from public.receiving_accounts ra
      where ra.id=v_token.receiving_account_id and ra.business_id=v_session.business_id
        and ra.is_active and ra.verification_status='verified') then
    update public.payment_access_sessions set revoked_at=now() where id=v_session.id;
    return jsonb_build_object('valid',false);
  end if;
  update public.payment_access_sessions set last_used_at=now() where id=v_session.id;
  return jsonb_build_object('valid',true,'session_id',v_session.id,'expires_at',v_session.expires_at);
end $$;

create or replace function public.payment_access_report_suspicious(
  p_token_id uuid,p_business_id uuid,p_case_id text,p_category text,
  p_details text,p_ip_hash text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if p_category not in ('unrecognised_debt','creditor_details_wrong',
    'payment_details_suspicious','unexpected_link','other')
    or char_length(coalesce(p_details,''))>1000 or p_ip_hash!~'^[0-9a-f]{64}$'
    or not exists(select 1 from public.public_access_tokens t
      where t.id=p_token_id and t.case_id=p_case_id and t.purpose='payment'
        and t.revoked_at is null and t.expires_at>now())
    or not exists(select 1 from public.cases c where c.id=p_case_id and c.business_id=p_business_id) then
    raise exception 'invalid suspicious request report';
  end if;
  insert into public.payment_access_suspicious_reports(
    business_id,case_id,public_access_token_id,category,details,reporter_ip_hash
  ) values(p_business_id,p_case_id,p_token_id,p_category,nullif(btrim(p_details),''),p_ip_hash)
  returning id into v_id;
  insert into public.payment_access_events(case_id,public_access_token_id,action,actor_type,metadata)
    values(p_case_id,p_token_id,'payment_access.suspicious_reported','debtor',
      jsonb_build_object('category',p_category,'report_id',v_id));
  return v_id;
end $$;

-- Proof submission is permitted only through an active OTP session.
create or replace function public.validate_public_submission_token()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_token public.public_access_tokens; v_case public.cases;
  v_session public.payment_access_sessions;
begin
  select * into v_token from public.public_access_tokens where id=new.public_access_token_id for update;
  if not found or v_token.purpose<>'payment' or v_token.revoked_at is not null
    or v_token.consumed_at is not null or v_token.expires_at<=now()
    or v_token.receiving_account_id is null then raise exception 'payment token is not active'; end if;
  select * into v_case from public.cases where id=v_token.case_id;
  if not found or v_case.status in ('closed','paid') or v_case.archived_at is not null
    or v_case.outstanding_minor<=0 or v_case.payment_lock_mode='manual'
    then raise exception 'payment access is no longer available'; end if;
  select * into v_session from public.payment_access_sessions
    where id=new.payment_access_session_id and public_access_token_id=v_token.id
      and case_id=v_case.id and revoked_at is null and expires_at>now();
  if not found then raise exception 'verified payment session is required'; end if;
  if v_case.payment_lock_mode='approval' and (
    v_token.payment_access_request_id is null or not exists(
      select 1 from public.payment_access_requests r
      where r.id=v_token.payment_access_request_id and r.case_id=v_case.id
        and r.status='approved' and (r.expires_at is null or r.expires_at>now())
    )) then raise exception 'payment access approval is not active'; end if;
  new.business_id:=v_case.business_id;
  new.case_id:=v_case.id;
  new.debtor_id:=v_case.debtor_id;
  new.receiving_account_id:=v_token.receiving_account_id;
  new.invoice_reference:=v_case.invoice_no;
  if nullif(btrim(new.reference_no),'') is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      concat(v_case.business_id,':',v_case.id,':',lower(btrim(new.reference_no))),0));
    if exists(
      select 1 from public.public_payment_submissions existing
      where existing.business_id=v_case.business_id and existing.case_id=v_case.id
        and lower(btrim(existing.reference_no))=lower(btrim(new.reference_no))
        and existing.status::text<>'rejected'
    ) then raise exception 'payment reference has already been submitted'; end if;
  end if;
  new.status:='submitted'::public.public_submission_status;
  return new;
end $$;

revoke all on function public.payment_access_issue_otp(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.payment_access_mark_otp_delivery(uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.payment_access_verify_otp(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.payment_access_validate_session(uuid,text) from public,anon,authenticated;
revoke all on function public.payment_access_report_suspicious(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.payment_access_issue_otp(uuid,uuid,text,text,text,text,text) to service_role;
grant execute on function public.payment_access_mark_otp_delivery(uuid,boolean,text) to service_role;
grant execute on function public.payment_access_verify_otp(uuid,text,text,text) to service_role;
grant execute on function public.payment_access_validate_session(uuid,text) to service_role;
grant execute on function public.payment_access_report_suspicious(uuid,uuid,text,text,text,text) to service_role;

commit;

-- Rollback:
-- 1. Deploy the previous application and trigger function first.
-- 2. Revoke active OTP sessions. Preserve suspicious reports and access events
--    if audit retention is required.
-- 3. Drop the five R13 RPCs, policy, indexes and three R13 tables, then remove
--    public_payment_submissions.payment_access_session_id.
