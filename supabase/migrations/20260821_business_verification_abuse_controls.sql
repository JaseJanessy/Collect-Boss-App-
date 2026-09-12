-- R14: pragmatic business verification and abuse-reporting controls.
-- Apply after 20260820_otp_secure_payment_access.sql.
-- This migration does not assert government or regulatory verification. A
-- business becomes "verified" only through the service-role review function.
begin;

alter table public.businesses
  add column if not exists industry text not null default 'other',
  add column if not exists verification_state text not null default 'unverified',
  add column if not exists verification_submitted_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists verification_public_note text,
  add column if not exists payment_links_restricted_until timestamptz,
  add column if not exists payment_link_restriction_reason text;

alter table public.businesses drop constraint if exists businesses_industry_check;
alter table public.businesses add constraint businesses_industry_check check (industry in (
  'general','professional_services','retail','construction','property',
  'education','healthcare','financial_services','financing_money_lending','other'
));
alter table public.businesses drop constraint if exists businesses_verification_state_check;
alter table public.businesses add constraint businesses_verification_state_check check (
  verification_state in ('unverified','pending','verified','rejected','restricted')
);
alter table public.businesses drop constraint if exists businesses_verification_timestamp_check;
alter table public.businesses add constraint businesses_verification_timestamp_check check (
  (verification_state='verified' and verified_at is not null)
  or (verification_state<>'verified' and verified_at is null)
);

create table if not exists public.business_risk_policies (
  industry text primary key check (industry in (
    'general','professional_services','retail','construction','property',
    'education','healthcare','financial_services','financing_money_lending','other'
  )),
  risk_level text not null check (risk_level in ('standard','elevated','high')),
  requires_additional_review boolean not null default false,
  requires_licence_reference boolean not null default false,
  payment_links_require_verified boolean not null default false,
  abuse_report_threshold integer not null default 3 check (abuse_report_threshold between 1 and 100),
  abuse_report_window_hours integer not null default 24 check (abuse_report_window_hours between 1 and 720),
  restriction_hours integer not null default 24 check (restriction_hours between 1 and 720),
  immediate_illegal_lending_restriction boolean not null default true,
  updated_by text not null default 'migration',
  updated_at timestamptz not null default now()
);

insert into public.business_risk_policies (
  industry,risk_level,requires_additional_review,requires_licence_reference,
  payment_links_require_verified,abuse_report_threshold,abuse_report_window_hours,
  restriction_hours,immediate_illegal_lending_restriction
) values
  ('general','standard',false,false,false,3,24,24,true),
  ('professional_services','standard',false,false,false,3,24,24,true),
  ('retail','standard',false,false,false,3,24,24,true),
  ('construction','standard',false,false,false,3,24,24,true),
  ('property','elevated',false,false,false,3,24,24,true),
  ('education','standard',false,false,false,3,24,24,true),
  ('healthcare','elevated',false,false,false,3,24,24,true),
  ('financial_services','elevated',true,false,true,2,24,48,true),
  ('financing_money_lending','high',true,true,true,1,24,72,true),
  ('other','standard',false,false,false,3,24,24,true)
on conflict (industry) do nothing;

create table if not exists public.business_risk_policy_events (
  id uuid primary key default gen_random_uuid(),
  industry text not null,
  event_type text not null check (event_type in ('created','updated')),
  actor_reference text not null,
  previous_policy jsonb,
  current_policy jsonb not null,
  created_at timestamptz not null default now()
);

create or replace function public.audit_business_risk_policy()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.business_risk_policy_events(
    industry,event_type,actor_reference,previous_policy,current_policy
  ) values(
    new.industry,case when tg_op='INSERT' then 'created' else 'updated' end,
    coalesce(nullif(new.updated_by,''),'unknown'),
    case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new)
  );
  return new;
end $$;
drop trigger if exists business_risk_policy_audit_trigger on public.business_risk_policies;
create trigger business_risk_policy_audit_trigger
after insert or update on public.business_risk_policies
for each row execute function public.audit_business_risk_policy();

create or replace function public.reconcile_risk_policy_payment_links()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.payment_links_require_verified then
    update public.public_access_tokens t set revoked_at=coalesce(t.revoked_at,now())
    where t.purpose='payment' and t.revoked_at is null and t.consumed_at is null
      and exists(
        select 1 from public.cases c join public.businesses b on b.id=c.business_id
        where c.id=t.case_id and b.industry=new.industry and b.verification_state<>'verified'
      );
  end if;
  return new;
end $$;
drop trigger if exists business_risk_policy_payment_link_reconcile_trigger
  on public.business_risk_policies;
create trigger business_risk_policy_payment_link_reconcile_trigger
after insert or update of payment_links_require_verified on public.business_risk_policies
for each row execute function public.reconcile_risk_policy_payment_links();

create table if not exists public.business_verification_reviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  status text not null default 'submitted' check (
    status in ('submitted','under_review','verified','rejected','restricted')
  ),
  industry_snapshot text not null,
  risk_level text not null check (risk_level in ('standard','elevated','high')),
  requires_additional_review boolean not null,
  registration_document_reference text,
  licence_document_reference text,
  owner_note text,
  public_decision_reason text,
  internal_review_note text,
  submitted_by uuid references auth.users(id) on delete set null,
  reviewer_reference text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (registration_document_reference is null or char_length(registration_document_reference)<=500),
  check (licence_document_reference is null or char_length(licence_document_reference)<=500),
  check (owner_note is null or char_length(owner_note)<=1000),
  check (public_decision_reason is null or char_length(public_decision_reason)<=1000),
  check (internal_review_note is null or char_length(internal_review_note)<=2000)
);
create index if not exists business_verification_reviews_business_idx
  on public.business_verification_reviews(business_id,created_at desc);

create table if not exists public.business_verification_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  review_id uuid references public.business_verification_reviews(id) on delete restrict,
  from_state text,
  to_state text not null,
  actor_type text not null check (actor_type in ('owner','platform','system')),
  actor_reference text,
  public_reason text,
  internal_note text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);
create index if not exists business_verification_events_business_idx
  on public.business_verification_events(business_id,created_at desc);

alter table public.payment_access_suspicious_reports
  add column if not exists tenant_review_status text not null default 'pending',
  add column if not exists tenant_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists tenant_reviewed_at timestamptz,
  add column if not exists platform_review_required boolean not null default false,
  add column if not exists restriction_applied_until timestamptz;
alter table public.payment_access_suspicious_reports
  drop constraint if exists payment_access_suspicious_reports_category_check;
alter table public.payment_access_suspicious_reports
  add constraint payment_access_suspicious_reports_category_check check (category in (
    'do_not_recognise_business','do_not_recognise_amount','wrong_payment_details',
    'suspicious_payment_request','suspected_illegal_lending','other',
    'unrecognised_debt','creditor_details_wrong','payment_details_suspicious','unexpected_link'
  ));
alter table public.payment_access_suspicious_reports
  drop constraint if exists payment_access_suspicious_reports_tenant_review_status_check;
alter table public.payment_access_suspicious_reports
  add constraint payment_access_suspicious_reports_tenant_review_status_check check (
    tenant_review_status in ('pending','acknowledged','resolved')
  );

create table if not exists public.payment_access_report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.payment_access_suspicious_reports(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  event_type text not null check (
    event_type in ('submitted','tenant_acknowledged','tenant_resolved',
      'platform_review_opened','platform_confirmed','platform_dismissed','restriction_applied','restriction_released')
  ),
  audience text not null check (audience in ('tenant','platform')),
  actor_type text not null check (actor_type in ('debtor','owner','platform','system')),
  actor_reference text,
  note text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);
create index if not exists payment_access_report_events_report_idx
  on public.payment_access_report_events(report_id,created_at,id);

create table if not exists public.platform_abuse_review_queue (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references public.payment_access_suspicious_reports(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  priority text not null check (priority in ('normal','high','critical')),
  status text not null default 'open' check (status in ('open','in_review','confirmed','dismissed')),
  reason text not null,
  assigned_reference text,
  outcome_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists platform_abuse_review_queue_open_idx
  on public.platform_abuse_review_queue(priority,created_at)
  where status in ('open','in_review');

alter table public.business_risk_policies enable row level security;
alter table public.business_risk_policy_events enable row level security;
alter table public.business_verification_reviews enable row level security;
alter table public.business_verification_events enable row level security;
alter table public.payment_access_report_events enable row level security;
alter table public.platform_abuse_review_queue enable row level security;
-- Platform policies, internal notes and platform queue deliberately have no
-- browser policies. Owners receive explicitly selected safe fields via routes.
drop policy if exists "payment_access_report_events_owner_read" on public.payment_access_report_events;
create policy "payment_access_report_events_owner_read"
  on public.payment_access_report_events for select to authenticated
  using (
    audience='tenant' and exists(
      select 1 from public.businesses b
      where b.id=payment_access_report_events.business_id and b.owner_id=auth.uid()
    )
  );

create or replace function public.business_profile_verification_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner_write boolean; v_material_change boolean; v_trusted_transition text;
begin
  v_owner_write:=auth.uid() is not null and auth.uid()=new.owner_id;
  v_trusted_transition:=current_setting('collectboss.verification_transition',true);
  if tg_op='INSERT' then
    if v_owner_write then
      new.verification_state:='unverified'; new.verification_submitted_at:=null;
      new.verified_at:=null; new.verification_public_note:=null;
      new.payment_links_restricted_until:=null; new.payment_link_restriction_reason:=null;
    end if;
    return new;
  end if;
  if v_trusted_transition='submit' then return new; end if;
  if not v_owner_write then return new; end if;
  v_material_change:=
    new.legal_name is distinct from old.legal_name
    or new.business_name is distinct from old.business_name
    or new.registration_no is distinct from old.registration_no
    or new.industry is distinct from old.industry;
  new.payment_links_restricted_until:=old.payment_links_restricted_until;
  new.payment_link_restriction_reason:=old.payment_link_restriction_reason;
  new.verification_public_note:=old.verification_public_note;
  new.verification_submitted_at:=old.verification_submitted_at;
  if old.verification_state in ('rejected','restricted') then
    new.verification_state:=old.verification_state; new.verified_at:=null;
  elsif v_material_change and old.verification_state='verified' then
    new.verification_state:='unverified'; new.verified_at:=null;
    new.verification_submitted_at:=null;
    new.verification_public_note:='Business identity changed. Submit a new CollectBoss review.';
  else
    new.verification_state:=old.verification_state; new.verified_at:=old.verified_at;
  end if;
  return new;
end $$;
drop trigger if exists business_profile_verification_guard_trigger on public.businesses;
create trigger business_profile_verification_guard_trigger
before insert or update on public.businesses
for each row execute function public.business_profile_verification_guard();

create or replace function public.business_payment_link_access(p_business_id uuid)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_business public.businesses; v_policy public.business_risk_policies;
begin
  select * into v_business from public.businesses where id=p_business_id;
  if not found then return jsonb_build_object('allowed',false,'reason','business_not_found'); end if;
  select * into v_policy from public.business_risk_policies where industry=v_business.industry;
  if v_business.verification_state in ('rejected','restricted') then
    return jsonb_build_object('allowed',false,'reason','business_restricted',
      'verification_state',v_business.verification_state);
  end if;
  if v_business.payment_links_restricted_until is not null
    and v_business.payment_links_restricted_until>now() then
    return jsonb_build_object('allowed',false,'reason','temporary_abuse_restriction',
      'restricted_until',v_business.payment_links_restricted_until);
  end if;
  if coalesce(v_policy.payment_links_require_verified,false)
    and v_business.verification_state<>'verified' then
    return jsonb_build_object('allowed',false,'reason','additional_review_required',
      'verification_state',v_business.verification_state);
  end if;
  return jsonb_build_object('allowed',true,'reason','allowed',
    'verification_state',v_business.verification_state,
    'risk_level',coalesce(v_policy.risk_level,'standard'));
end $$;

create or replace function public.reconcile_business_payment_link_access()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_access jsonb;
begin
  v_access:=public.business_payment_link_access(new.id);
  if not coalesce((v_access->>'allowed')::boolean,false) then
    update public.public_access_tokens set revoked_at=coalesce(revoked_at,now())
    where purpose='payment'
      and case_id in(select id from public.cases where business_id=new.id)
      and revoked_at is null and consumed_at is null;
  end if;
  return new;
end $$;
drop trigger if exists business_payment_link_reconcile_trigger on public.businesses;
create trigger business_payment_link_reconcile_trigger
after insert or update of industry,verification_state,payment_links_restricted_until
on public.businesses for each row
execute function public.reconcile_business_payment_link_access();

create or replace function public.business_verification_submit(
  p_registration_document_reference text default null,
  p_licence_document_reference text default null,
  p_owner_note text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_business public.businesses; v_policy public.business_risk_policies;
  v_review_id uuid; v_old_state text;
begin
  select * into v_business from public.businesses where owner_id=auth.uid() for update;
  if not found then raise exception 'Business not found'; end if;
  if v_business.verification_state='restricted' then
    raise exception 'Business is restricted pending platform review'; end if;
  if v_business.verification_state='pending' and exists(
    select 1 from public.business_verification_reviews r
    where r.business_id=v_business.id and r.status in ('submitted','under_review')
  ) then raise exception 'Verification review is already pending'; end if;
  select * into v_policy from public.business_risk_policies where industry=v_business.industry;
  if v_business.account_type='business' and nullif(btrim(v_business.registration_no),'') is null
    then raise exception 'Registration identifier is required'; end if;
  if coalesce(v_policy.requires_licence_reference,false)
    and nullif(btrim(coalesce(p_licence_document_reference,'')),'') is null
    then raise exception 'Licence reference is required for this industry'; end if;
  if char_length(coalesce(p_registration_document_reference,''))>500
    or char_length(coalesce(p_licence_document_reference,''))>500
    or char_length(coalesce(p_owner_note,''))>1000 then raise exception 'Verification input is too long'; end if;
  v_old_state:=v_business.verification_state;
  insert into public.business_verification_reviews(
    business_id,industry_snapshot,risk_level,requires_additional_review,
    registration_document_reference,licence_document_reference,owner_note,submitted_by
  ) values(
    v_business.id,v_business.industry,coalesce(v_policy.risk_level,'standard'),
    coalesce(v_policy.requires_additional_review,false),
    nullif(btrim(p_registration_document_reference),''),
    nullif(btrim(p_licence_document_reference),''),
    nullif(btrim(p_owner_note),''),auth.uid()
  ) returning id into v_review_id;
  perform set_config('collectboss.verification_transition','submit',true);
  update public.businesses set verification_state='pending',
    verification_submitted_at=now(),verified_at=null,
    verification_public_note='Verification review submitted.'
  where id=v_business.id;
  insert into public.business_verification_events(
    business_id,review_id,from_state,to_state,actor_type,actor_reference,public_reason,metadata
  ) values(v_business.id,v_review_id,v_old_state,'pending','owner',auth.uid()::text,
    'Verification review submitted.',
    jsonb_build_object('industry',v_business.industry,'risk_level',coalesce(v_policy.risk_level,'standard')));
  if coalesce(v_policy.payment_links_require_verified,false) then
    update public.public_access_tokens set revoked_at=coalesce(revoked_at,now())
    where purpose='payment' and case_id in(select id from public.cases where business_id=v_business.id)
      and revoked_at is null and consumed_at is null;
  end if;
  return jsonb_build_object('review_id',v_review_id,'state','pending',
    'requires_additional_review',coalesce(v_policy.requires_additional_review,false));
end $$;

create or replace function public.business_verification_decide(
  p_review_id uuid,p_decision text,p_reviewer_reference text,
  p_public_reason text,p_internal_note text default null,
  p_restricted_until timestamptz default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_review public.business_verification_reviews; v_business public.businesses;
  v_policy public.business_risk_policies; v_old_state text;
begin
  if p_decision not in ('verified','rejected','restricted')
    or char_length(btrim(coalesce(p_reviewer_reference,'')))<3
    or char_length(btrim(coalesce(p_public_reason,'')))<3 then
    raise exception 'Invalid verification decision'; end if;
  select * into v_review from public.business_verification_reviews where id=p_review_id for update;
  if not found or v_review.status in ('verified','rejected','restricted')
    then raise exception 'Verification review is not open'; end if;
  select * into v_business from public.businesses where id=v_review.business_id for update;
  select * into v_policy from public.business_risk_policies where industry=v_review.industry_snapshot;
  if p_decision='verified' and coalesce(v_policy.requires_licence_reference,false)
    and nullif(btrim(coalesce(v_review.licence_document_reference,'')),'') is null
    then raise exception 'Required licence review evidence is missing'; end if;
  v_old_state:=v_business.verification_state;
  update public.business_verification_reviews set status=p_decision,
    reviewer_reference=btrim(p_reviewer_reference),public_decision_reason=btrim(p_public_reason),
    internal_review_note=nullif(btrim(p_internal_note),''),reviewed_at=now()
  where id=p_review_id;
  update public.businesses set verification_state=p_decision,
    verified_at=case when p_decision='verified' then now() else null end,
    verification_public_note=btrim(p_public_reason),
    payment_links_restricted_until=case when p_decision='restricted'
      then coalesce(p_restricted_until,now()+interval '72 hours')
      else payment_links_restricted_until end,
    payment_link_restriction_reason=case when p_decision='restricted'
      then 'platform_verification_restriction' else payment_link_restriction_reason end
  where id=v_business.id;
  if p_decision in ('rejected','restricted') then
    update public.public_access_tokens set revoked_at=coalesce(revoked_at,now())
    where purpose='payment' and case_id in(select id from public.cases where business_id=v_business.id)
      and revoked_at is null and consumed_at is null;
  end if;
  insert into public.business_verification_events(
    business_id,review_id,from_state,to_state,actor_type,actor_reference,
    public_reason,internal_note,metadata
  ) values(v_business.id,p_review_id,v_old_state,p_decision,'platform',
    btrim(p_reviewer_reference),btrim(p_public_reason),nullif(btrim(p_internal_note),''),
    jsonb_build_object('risk_level',v_review.risk_level));
  return jsonb_build_object('business_id',v_business.id,'state',p_decision);
end $$;

create or replace function public.enforce_public_payment_token_business_controls()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_business_id uuid; v_access jsonb;
begin
  if new.purpose<>'payment' or new.revoked_at is not null or new.consumed_at is not null then return new; end if;
  select business_id into v_business_id from public.cases where id=new.case_id;
  if not found then raise exception 'Payment-link case not found'; end if;
  v_access:=public.business_payment_link_access(v_business_id);
  if not coalesce((v_access->>'allowed')::boolean,false) then
    raise exception 'Payment links are unavailable: %',coalesce(v_access->>'reason','restricted');
  end if;
  return new;
end $$;
drop trigger if exists public_payment_token_business_controls_trigger on public.public_access_tokens;
create trigger public_payment_token_business_controls_trigger
before insert or update of case_id,purpose,revoked_at,consumed_at on public.public_access_tokens
for each row execute function public.enforce_public_payment_token_business_controls();

create or replace function public.payment_access_report_suspicious(
  p_token_id uuid,p_business_id uuid,p_case_id text,p_category text,
  p_details text,p_ip_hash text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_business public.businesses; v_policy public.business_risk_policies;
  v_recent integer; v_platform boolean; v_restrict boolean; v_until timestamptz;
begin
  if p_category not in (
    'do_not_recognise_business','do_not_recognise_amount','wrong_payment_details',
    'suspicious_payment_request','suspected_illegal_lending','other'
  ) or char_length(coalesce(p_details,''))>1000 or p_ip_hash!~'^[0-9a-f]{64}$'
    or not exists(select 1 from public.public_access_tokens t
      where t.id=p_token_id and t.case_id=p_case_id and t.purpose='payment'
        and t.revoked_at is null and t.expires_at>now())
    or not exists(select 1 from public.cases c where c.id=p_case_id and c.business_id=p_business_id)
    then raise exception 'invalid suspicious request report'; end if;
  select * into v_business from public.businesses where id=p_business_id for update;
  select * into v_policy from public.business_risk_policies where industry=v_business.industry;
  select count(*)::integer into v_recent from public.payment_access_suspicious_reports r
    where r.business_id=p_business_id
      and r.created_at>now()-make_interval(hours=>coalesce(v_policy.abuse_report_window_hours,24));
  v_recent:=v_recent+1;
  v_platform:=p_category='suspected_illegal_lending'
    or v_recent>=coalesce(v_policy.abuse_report_threshold,3)
    or coalesce(v_policy.risk_level,'standard')='high';
  v_restrict:=(p_category='suspected_illegal_lending'
      and coalesce(v_policy.immediate_illegal_lending_restriction,true))
    or v_recent>=coalesce(v_policy.abuse_report_threshold,3);
  if v_restrict then v_until:=now()+make_interval(hours=>coalesce(v_policy.restriction_hours,24)); end if;
  insert into public.payment_access_suspicious_reports(
    business_id,case_id,public_access_token_id,category,details,reporter_ip_hash,
    platform_review_required,restriction_applied_until
  ) values(
    p_business_id,p_case_id,p_token_id,p_category,nullif(btrim(p_details),''),p_ip_hash,
    v_platform,v_until
  ) returning id into v_id;
  insert into public.payment_access_report_events(
    report_id,business_id,event_type,audience,actor_type,metadata
  ) values(v_id,p_business_id,'submitted','tenant','debtor',
    jsonb_build_object('category',p_category));
  insert into public.notifications(
    business_id,case_id,type,event_type,title,message,entity_type,entity_id,
    severity,action_url,dedupe_key
  ) values(
    p_business_id,p_case_id,'payment_access.suspicious_reported',
    'payment_access.suspicious_reported','Payment-link safety report',
    'A debtor reported a concern about a payment request.','payment_access_report',v_id,
    case when v_platform then 'high' else 'medium' end,'/settings#trust-safety',
    'payment-access-report:'||v_id::text
  ) on conflict(business_id,dedupe_key) do nothing;
  insert into public.action_centre_items(
    business_id,case_id,type,title,description,href,entity_type,entity_id,status,
    reason,amount_minor,priority,recommended_action,dedupe_key
  ) values(
    p_business_id,p_case_id,'review_payment_access_report','Review payment-link safety report',
    'Review the debtor report and verify the case and receiving details.',
    '/settings#trust-safety','payment_access_report',v_id,'open',
    'A debtor reported a payment-link concern.',0,
    case when v_platform then 'high' else 'medium' end,
    'Review the report and pause contact if the request may be incorrect.',
    'payment-access-report:'||v_id::text
  ) on conflict(business_id,dedupe_key) do nothing;
  if v_platform then
    insert into public.platform_abuse_review_queue(
      report_id,business_id,case_id,priority,reason
    ) values(
      v_id,p_business_id,p_case_id,
      case when p_category='suspected_illegal_lending' then 'critical' else 'high' end,
      case when p_category='suspected_illegal_lending'
        then 'Suspected illegal lending report' else 'Risk-policy report threshold reached' end
    ) on conflict(report_id) do nothing;
    insert into public.payment_access_report_events(
      report_id,business_id,event_type,audience,actor_type,metadata
    ) values(v_id,p_business_id,'platform_review_opened','platform','system',
      jsonb_build_object('category',p_category,'recent_reports',v_recent));
  end if;
  if v_restrict then
    update public.businesses set
      payment_links_restricted_until=greatest(coalesce(payment_links_restricted_until,v_until),v_until),
      payment_link_restriction_reason='automated_abuse_report_policy'
    where id=p_business_id;
    update public.public_access_tokens set revoked_at=coalesce(revoked_at,now())
    where purpose='payment' and case_id in(select id from public.cases where business_id=p_business_id)
      and revoked_at is null and consumed_at is null;
    insert into public.payment_access_report_events(
      report_id,business_id,event_type,audience,actor_type,metadata
    ) values(v_id,p_business_id,'restriction_applied','tenant','system',
      jsonb_build_object('restricted_until',v_until,'policy','risk_based'));
  end if;
  insert into public.payment_access_events(case_id,public_access_token_id,action,actor_type,metadata)
    values(p_case_id,p_token_id,'payment_access.suspicious_reported','debtor',
      jsonb_build_object('category',p_category,'report_id',v_id,'platform_review',v_platform));
  return v_id;
end $$;

create or replace function public.payment_access_report_tenant_review(
  p_report_id uuid,p_action text,p_note text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_report public.payment_access_suspicious_reports; v_business public.businesses;
  v_status text; v_action_id uuid; v_action_status text;
begin
  if p_action not in ('acknowledged','resolved') or char_length(coalesce(p_note,''))>1000
    then raise exception 'Invalid report review action'; end if;
  select r.* into v_report from public.payment_access_suspicious_reports r
    join public.businesses b on b.id=r.business_id and b.owner_id=auth.uid()
    where r.id=p_report_id for update;
  if not found then raise exception 'Report not found'; end if;
  v_status:=p_action;
  update public.payment_access_suspicious_reports set tenant_review_status=v_status,
    tenant_reviewed_by=auth.uid(),tenant_reviewed_at=now() where id=p_report_id;
  insert into public.payment_access_report_events(
    report_id,business_id,event_type,audience,actor_type,actor_reference,note
  ) values(p_report_id,v_report.business_id,'tenant_'||p_action,'tenant','owner',
    auth.uid()::text,nullif(btrim(p_note),''));
  if p_action='resolved' then
    select id,status into v_action_id,v_action_status from public.action_centre_items
    where business_id=v_report.business_id and entity_type='payment_access_report'
      and entity_id=p_report_id and status in ('open','in_progress','snoozed') for update;
    if found then
      update public.action_centre_items set
        status='completed',completed_at=now(),snoozed_until=null where id=v_action_id;
      insert into public.action_centre_item_events(
        action_item_id,business_id,case_id,actor_type,actor_id,event_type,
        from_status,to_status,metadata
      ) values(v_action_id,v_report.business_id,v_report.case_id,'owner',auth.uid(),
        'completed',v_action_status,'completed',jsonb_build_object('report_id',p_report_id));
    end if;
  end if;
  return jsonb_build_object('report_id',p_report_id,'tenant_review_status',v_status);
end $$;

create or replace function public.payment_access_report_platform_review(
  p_report_id uuid,p_decision text,p_reviewer_reference text,p_note text,
  p_restricted_until timestamptz default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_report public.payment_access_suspicious_reports; v_event text;
begin
  if p_decision not in ('confirmed','dismissed','restricted')
    or char_length(btrim(coalesce(p_reviewer_reference,'')))<3
    or char_length(btrim(coalesce(p_note,'')))<3 then raise exception 'Invalid platform review'; end if;
  select * into v_report from public.payment_access_suspicious_reports where id=p_report_id for update;
  if not found then raise exception 'Report not found'; end if;
  v_event:=case when p_decision='dismissed' then 'platform_dismissed' else 'platform_confirmed' end;
  update public.platform_abuse_review_queue set
    status=case when p_decision='dismissed' then 'dismissed' else 'confirmed' end,
    assigned_reference=btrim(p_reviewer_reference),outcome_note=btrim(p_note),
    reviewed_at=now(),updated_at=now() where report_id=p_report_id;
  if p_decision='restricted' then
    update public.businesses set verification_state='restricted',verified_at=null,
      verification_public_note='Payment-link access restricted after safety review.',
      payment_links_restricted_until=coalesce(p_restricted_until,now()+interval '72 hours'),
      payment_link_restriction_reason='platform_abuse_review'
    where id=v_report.business_id;
    update public.public_access_tokens set revoked_at=coalesce(revoked_at,now())
    where purpose='payment' and case_id in(select id from public.cases where business_id=v_report.business_id)
      and revoked_at is null and consumed_at is null;
  end if;
  insert into public.payment_access_report_events(
    report_id,business_id,event_type,audience,actor_type,actor_reference,note,metadata
  ) values(p_report_id,v_report.business_id,v_event,'platform','platform',
    btrim(p_reviewer_reference),btrim(p_note),jsonb_build_object('decision',p_decision));
  return jsonb_build_object('report_id',p_report_id,'decision',p_decision);
end $$;

revoke all on function public.business_payment_link_access(uuid) from public,anon,authenticated;
revoke all on function public.business_verification_submit(text,text,text) from public,anon;
revoke all on function public.business_verification_decide(uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.payment_access_report_suspicious(uuid,uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.payment_access_report_tenant_review(uuid,text,text) from public,anon;
revoke all on function public.payment_access_report_platform_review(uuid,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.audit_business_risk_policy() from public,anon,authenticated;
revoke all on function public.reconcile_risk_policy_payment_links() from public,anon,authenticated;
revoke all on function public.business_profile_verification_guard() from public,anon,authenticated;
revoke all on function public.reconcile_business_payment_link_access() from public,anon,authenticated;
revoke all on function public.enforce_public_payment_token_business_controls() from public,anon,authenticated;
grant execute on function public.business_payment_link_access(uuid) to service_role;
grant execute on function public.business_verification_submit(text,text,text) to authenticated;
grant execute on function public.business_verification_decide(uuid,text,text,text,text,timestamptz) to service_role;
grant execute on function public.payment_access_report_suspicious(uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.payment_access_report_tenant_review(uuid,text,text) to authenticated;
grant execute on function public.payment_access_report_platform_review(uuid,text,text,text,timestamptz) to service_role;

commit;

-- Rollback:
-- 1. Deploy the previous application and restore the R13 suspicious-report RPC.
-- 2. Revoke active platform decisions only through an audited operational
--    decision; do not silently delete abuse or verification audit history.
-- 3. Drop R14 triggers/RPCs/policies/tables, restore the R13 category
--    constraint, and remove the added report/business columns if retention and
--    legal requirements allow it.
