-- Professional Legal Handoff lifecycle and secure document requests.
-- Apply after 20260806_secure_payment_proof_flow.sql.

begin;

alter table public.lawyer_referrals
  drop constraint if exists lawyer_referrals_status_check,
  add constraint lawyer_referrals_status_check check (referral_status in (
    'draft', 'ready_for_review', 'handoff_pending', 'handoff_failed',
    'submitted', 'under_review', 'additional_documents_requested',
    'lawyer_contacted', 'accepted', 'declined', 'withdrawn', 'closed'
  ));

alter table public.lawyer_referral_events
  add column if not exists idempotency_key uuid;
create unique index if not exists lawyer_referral_events_idempotency_idx
  on public.lawyer_referral_events(idempotency_key) where idempotency_key is not null;
alter table public.lawyer_referral_events
  drop constraint if exists lawyer_referral_events_event_type_check,
  drop constraint if exists lawyer_referral_events_actor_type_check,
  add constraint lawyer_referral_events_event_type_check check (event_type in (
    'created', 'data_package_created', 'handoff_attempted', 'handoff_failed',
    'submitted', 'withdrawn', 'provider_status_recorded',
    'documents_requested', 'documents_provided', 'professional_message'
  )),
  add constraint lawyer_referral_events_actor_type_check check (actor_type in ('owner', 'system', 'professional'));

create table if not exists public.legal_handoff_document_requests (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.lawyer_referrals(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  professional_name text not null check (char_length(professional_name) between 1 and 160),
  professional_firm text not null check (char_length(professional_firm) between 1 and 200),
  request_message text not null check (char_length(request_message) between 1 and 2000),
  requested_documents jsonb not null default '[]'::jsonb check (jsonb_typeof(requested_documents) = 'array'),
  provider_request_id text not null,
  status text not null default 'open' check (status in ('open', 'fulfilled', 'cancelled')),
  response_note text,
  fulfilled_at timestamptz,
  fulfilled_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (referral_id, provider_request_id)
);

create table if not exists public.legal_handoff_document_request_evidence (
  request_id uuid not null references public.legal_handoff_document_requests(id) on delete restrict,
  evidence_id uuid not null references public.evidence_files(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (request_id, evidence_id)
);

create index if not exists legal_handoff_requests_referral_idx
  on public.legal_handoff_document_requests(referral_id, created_at desc);
create index if not exists legal_handoff_request_evidence_case_idx
  on public.legal_handoff_document_request_evidence(case_id, created_at);

alter table public.legal_handoff_document_requests enable row level security;
alter table public.legal_handoff_document_request_evidence enable row level security;
create policy "legal_handoff_document_requests_owner_read"
  on public.legal_handoff_document_requests for select to authenticated
  using (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()));
create policy "legal_handoff_document_request_evidence_owner_read"
  on public.legal_handoff_document_request_evidence for select to authenticated
  using (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()));

create or replace function public.legal_handoff_record_professional_update(
  p_referral_id uuid,
  p_idempotency_key uuid,
  p_status text,
  p_professional_name text,
  p_professional_firm text,
  p_message text default null,
  p_requested_documents jsonb default '[]'::jsonb,
  p_provider_reference text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_referral public.lawyer_referrals;
  v_event_id uuid;
  v_request_id uuid;
  v_existing_event uuid;
  v_allowed boolean := false;
  v_event_type text;
begin
  select id into v_existing_event from public.lawyer_referral_events where idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('replayed', true, 'event_id', v_existing_event); end if;
  if p_status not in ('submitted', 'under_review', 'additional_documents_requested', 'accepted', 'closed') then
    raise exception 'Unsupported professional handoff status';
  end if;
  if nullif(btrim(p_professional_name), '') is null or nullif(btrim(p_professional_firm), '') is null
     or char_length(p_professional_name) > 160 or char_length(p_professional_firm) > 200
     or char_length(coalesce(p_message, '')) > 2000 or char_length(coalesce(p_provider_reference, '')) > 200 then
    raise exception 'Professional update fields are invalid';
  end if;
  if jsonb_typeof(p_requested_documents) <> 'array' or jsonb_array_length(p_requested_documents) > 30 then
    raise exception 'Requested documents must be a JSON array of at most 30 items';
  end if;
  if p_status = 'additional_documents_requested' and (jsonb_array_length(p_requested_documents) = 0 or nullif(btrim(p_message), '') is null) then
    raise exception 'A document request requires requested items and a message';
  end if;

  select * into v_referral from public.lawyer_referrals where id = p_referral_id for update;
  if not found then raise exception 'Professional legal handoff not found'; end if;
  v_allowed := case
    when v_referral.referral_status in ('ready_for_review', 'handoff_pending', 'handoff_failed') then p_status in ('submitted', 'under_review', 'additional_documents_requested', 'closed')
    when v_referral.referral_status = 'submitted' then p_status in ('submitted', 'under_review', 'additional_documents_requested', 'accepted', 'closed')
    when v_referral.referral_status = 'under_review' then p_status in ('under_review', 'additional_documents_requested', 'accepted', 'closed')
    when v_referral.referral_status = 'additional_documents_requested' then p_status in ('additional_documents_requested', 'under_review', 'accepted', 'closed')
    when v_referral.referral_status = 'lawyer_contacted' then p_status in ('under_review', 'additional_documents_requested', 'accepted', 'closed')
    when v_referral.referral_status = 'accepted' then p_status in ('accepted', 'closed')
    else false
  end;
  if not v_allowed then raise exception 'Professional handoff status transition is not allowed'; end if;

  v_event_type := case when p_status = 'additional_documents_requested' then 'documents_requested'
    when nullif(btrim(p_message), '') is not null and p_status = v_referral.referral_status then 'professional_message'
    else 'provider_status_recorded' end;
  insert into public.lawyer_referral_events(
    referral_id, case_id, business_id, event_type, actor_type, metadata, idempotency_key
  ) values (
    v_referral.id, v_referral.case_id, v_referral.business_id, v_event_type, 'professional',
    jsonb_build_object(
      'from_status', v_referral.referral_status, 'to_status', p_status,
      'professional_name', btrim(p_professional_name), 'professional_firm', btrim(p_professional_firm),
      'message', nullif(btrim(p_message), ''), 'provider_reference', nullif(btrim(p_provider_reference), '')
    ), p_idempotency_key
  ) on conflict (idempotency_key) where idempotency_key is not null do nothing returning id into v_event_id;
  if v_event_id is null then
    select id into v_existing_event from public.lawyer_referral_events where idempotency_key = p_idempotency_key;
    return jsonb_build_object('replayed', true, 'event_id', v_existing_event);
  end if;

  update public.lawyer_referrals set
    referral_status = p_status,
    partner_name = btrim(p_professional_name),
    partner_firm = btrim(p_professional_firm),
    provider_reference = coalesce(nullif(btrim(p_provider_reference), ''), provider_reference),
    shared_at = case when p_status in ('submitted', 'under_review', 'additional_documents_requested', 'accepted', 'closed') then coalesce(shared_at, now()) else shared_at end,
    updated_at = now()
  where id = v_referral.id;

  if p_status = 'additional_documents_requested' then
    insert into public.legal_handoff_document_requests(
      referral_id, case_id, business_id, professional_name, professional_firm,
      request_message, requested_documents, provider_request_id
    ) values (
      v_referral.id, v_referral.case_id, v_referral.business_id,
      btrim(p_professional_name), btrim(p_professional_firm), btrim(p_message),
      p_requested_documents, p_idempotency_key::text
    ) returning id into v_request_id;
    insert into public.action_centre_items(
      business_id, case_id, type, title, description, href, entity_type, entity_id
    ) values (
      v_referral.business_id, v_referral.case_id, 'legal_handoff.documents_requested',
      'External professional requested documents',
      btrim(p_professional_name) || ' of ' || btrim(p_professional_firm) || ' requested additional case documents.',
      '/legal/' || v_referral.case_id || '/lawyer', 'legal_handoff_document_request', v_request_id
    ) on conflict (type, entity_id) do nothing;
  elsif p_status in ('accepted', 'closed') then
    update public.legal_handoff_document_requests set status = 'cancelled', updated_at = now()
      where referral_id = v_referral.id and status = 'open';
    update public.action_centre_items set status = 'completed', completed_at = coalesce(completed_at, now())
      where status = 'open' and entity_type = 'legal_handoff_document_request'
        and entity_id in (select id from public.legal_handoff_document_requests where referral_id = v_referral.id);
  end if;

  insert into public.notifications(business_id, case_id, type, title, message, entity_type, entity_id)
  values (
    v_referral.business_id, v_referral.case_id,
    case when p_status = 'additional_documents_requested' then 'legal_handoff.documents_requested' else 'legal_handoff.status_updated' end,
    case when p_status = 'additional_documents_requested' then 'Documents requested by external professional' else 'Professional legal handoff updated' end,
    btrim(p_professional_name) || ' of ' || btrim(p_professional_firm) || ' updated the handoff to ' || replace(p_status, '_', ' ') || '.',
    case when v_request_id is not null then 'legal_handoff_document_request' else 'lawyer_referral' end,
    coalesce(v_request_id, v_referral.id)
  );
  insert into public.audit_logs(business_id, case_id, action, actor_type, metadata)
  values (
    v_referral.business_id, v_referral.case_id, 'legal_handoff.professional_update', 'system',
    jsonb_build_object('referral_id', v_referral.id, 'event_id', v_event_id, 'request_id', v_request_id,
      'from_status', v_referral.referral_status, 'to_status', p_status,
      'professional_name', btrim(p_professional_name), 'professional_firm', btrim(p_professional_firm))
  );
  return jsonb_build_object('replayed', false, 'event_id', v_event_id, 'request_id', v_request_id, 'status', p_status);
end;
$$;

create or replace function public.legal_handoff_fulfil_document_request(
  p_request_id uuid,
  p_evidence_ids jsonb,
  p_response_note text default null
) returns public.legal_handoff_document_requests language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_request public.legal_handoff_document_requests;
  v_referral public.lawyer_referrals;
  v_evidence_id uuid;
  v_user_id uuid := auth.uid();
  v_count integer := 0;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_evidence_ids) <> 'array' or jsonb_array_length(p_evidence_ids) < 1 or jsonb_array_length(p_evidence_ids) > 30
     or char_length(coalesce(p_response_note, '')) > 1000 then raise exception 'Document response is invalid'; end if;
  select r.* into v_request from public.legal_handoff_document_requests r
  join public.businesses b on b.id = r.business_id
  where r.id = p_request_id and b.owner_id = v_user_id for update of r;
  if not found or v_request.status <> 'open' then raise exception 'Document request is unavailable'; end if;
  select * into v_referral from public.lawyer_referrals where id = v_request.referral_id for update;
  if not found or v_referral.case_id <> v_request.case_id or v_referral.business_id <> v_request.business_id then
    raise exception 'Document request tenant mismatch';
  end if;

  for v_evidence_id in select distinct value::text::uuid from jsonb_array_elements(p_evidence_ids)
  loop
    if not exists (select 1 from public.evidence_files e where e.id = v_evidence_id and e.case_id = v_request.case_id and e.archived_at is null) then
      raise exception 'Selected evidence is unavailable for this handoff';
    end if;
    insert into public.legal_handoff_document_request_evidence(request_id, evidence_id, case_id, business_id, added_by)
    values (v_request.id, v_evidence_id, v_request.case_id, v_request.business_id, v_user_id)
    on conflict do nothing;
    v_count := v_count + 1;
  end loop;
  update public.legal_handoff_document_requests set status = 'fulfilled', response_note = nullif(btrim(p_response_note), ''),
    fulfilled_at = now(), fulfilled_by = v_user_id, updated_at = now() where id = v_request.id returning * into v_request;
  update public.lawyer_referrals set referral_status = 'under_review', updated_at = now()
    where id = v_referral.id and referral_status = 'additional_documents_requested';
  insert into public.lawyer_referral_events(referral_id, case_id, business_id, event_type, actor_type, actor_id, metadata)
  values (v_referral.id, v_request.case_id, v_request.business_id, 'documents_provided', 'owner', v_user_id,
    jsonb_build_object('request_id', v_request.id, 'evidence_count', v_count, 'response_note', nullif(btrim(p_response_note), '')));
  update public.action_centre_items set status = 'completed', completed_at = coalesce(completed_at, now())
    where status = 'open' and entity_type = 'legal_handoff_document_request' and entity_id = v_request.id;
  insert into public.audit_logs(business_id, case_id, action, actor_type, actor_id, metadata)
  values (v_request.business_id, v_request.case_id, 'legal_handoff.documents_provided', 'owner', v_user_id,
    jsonb_build_object('referral_id', v_referral.id, 'request_id', v_request.id, 'evidence_count', v_count));
  return v_request;
end;
$$;

revoke all on function public.legal_handoff_record_professional_update(uuid,uuid,text,text,text,text,jsonb,text) from public;
grant execute on function public.legal_handoff_record_professional_update(uuid,uuid,text,text,text,text,jsonb,text) to service_role;
revoke all on function public.legal_handoff_fulfil_document_request(uuid,jsonb,text) from public;
grant execute on function public.legal_handoff_fulfil_document_request(uuid,jsonb,text) to authenticated;

commit;

-- Rollback considerations: preserve all existing referral rows and audit events.
-- Disable professional-update routes first. Restore the former status/event
-- constraints only after resolving rows using the new status/event values.
-- Document-request tables should normally be retained for audit and legal hold.
