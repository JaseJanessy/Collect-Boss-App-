-- Y02: Payment Proof + Secure Payment Flow Upgrade.
-- Apply after 20260805_receiving_account_security.sql.
-- This migration is additive and preserves legacy pending_review/approved rows.
-- Rollback considerations:
--   * Stop application writes using the new columns/states first.
--   * Drop the two notification tables and payment_proof_events.
--   * Restore financial_review_public_payment_submission(uuid,text), then drop the
--     new overload. PostgreSQL enum values cannot be removed without recreating
--     the enum, so submitted/under_review/confirmed/more_information_required
--     should remain as harmless values during rollback.

alter type public.public_submission_status add value if not exists 'submitted';
alter type public.public_submission_status add value if not exists 'under_review';
alter type public.public_submission_status add value if not exists 'confirmed';
alter type public.public_submission_status add value if not exists 'more_information_required';

begin;

alter table public.public_payment_submissions
  add column if not exists business_id uuid references public.businesses(id) on delete restrict,
  add column if not exists case_id text references public.cases(id) on delete restrict,
  add column if not exists debtor_id uuid references public.debtors(id) on delete set null,
  add column if not exists receiving_account_id uuid references public.receiving_accounts(id) on delete restrict,
  add column if not exists invoice_reference text,
  add column if not exists debtor_note text,
  add column if not exists rejection_reason text;

update public.public_payment_submissions s
set business_id = c.business_id,
    case_id = c.id,
    debtor_id = c.debtor_id,
    receiving_account_id = t.receiving_account_id,
    invoice_reference = c.invoice_no
from public.public_access_tokens t
join public.cases c on c.id = t.case_id
where t.id = s.public_access_token_id
  and (s.business_id is null or s.case_id is null or s.receiving_account_id is null);

alter table public.public_payment_submissions
  alter column business_id set not null,
  alter column case_id set not null,
  drop constraint if exists public_payment_submissions_debtor_note_check,
  add constraint public_payment_submissions_debtor_note_check check (debtor_note is null or char_length(debtor_note) <= 1000),
  drop constraint if exists public_payment_submissions_rejection_reason_check,
  add constraint public_payment_submissions_rejection_reason_check check (
    status::text not in ('rejected', 'more_information_required')
    or (rejection_reason is not null and char_length(btrim(rejection_reason)) between 3 and 1000)
  );

create index if not exists public_payment_submissions_tenant_queue_idx
  on public.public_payment_submissions (business_id, status, created_at desc);
create index if not exists public_payment_submissions_case_idx
  on public.public_payment_submissions (case_id, created_at desc);

create table if not exists public.payment_proof_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.public_payment_submissions(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  from_status text,
  to_status text not null,
  actor_type text not null check (actor_type in ('debtor', 'owner', 'system')),
  actor_id uuid references auth.users(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists payment_proof_events_submission_idx
  on public.payment_proof_events (submission_id, created_at, id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  case_id text references public.cases(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_business_unread_idx
  on public.notifications (business_id, created_at desc) where read_at is null;

create table if not exists public.action_centre_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  case_id text references public.cases(id) on delete cascade,
  type text not null,
  title text not null,
  description text not null,
  href text not null,
  entity_type text,
  entity_id uuid,
  status text not null default 'open' check (status in ('open', 'completed', 'dismissed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (type, entity_id)
);
create index if not exists action_centre_items_business_open_idx
  on public.action_centre_items (business_id, created_at desc) where status = 'open';

alter table public.public_payment_submissions enable row level security;
alter table public.payment_proof_events enable row level security;
alter table public.notifications enable row level security;
alter table public.action_centre_items enable row level security;

drop policy if exists "public_payment_submissions_owner_read" on public.public_payment_submissions;
create policy "public_payment_submissions_owner_read" on public.public_payment_submissions
  for select to authenticated using (exists (
    select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()
  ));
create policy "payment_proof_events_owner_read" on public.payment_proof_events
  for select to authenticated using (exists (
    select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()
  ));
create policy "notifications_owner_read" on public.notifications
  for select to authenticated using (exists (
    select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()
  ));
create policy "notifications_owner_update" on public.notifications
  for update to authenticated using (exists (
    select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()
  )) with check (exists (
    select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()
  ));
create policy "action_centre_items_owner_read" on public.action_centre_items
  for select to authenticated using (exists (
    select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()
  ));
create policy "action_centre_items_owner_update" on public.action_centre_items
  for update to authenticated using (exists (
    select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()
  )) with check (exists (
    select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()
  ));

create or replace function public.validate_public_submission_token()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare access_token public.public_access_tokens%rowtype; current_case public.cases%rowtype;
begin
  select * into access_token from public.public_access_tokens where id = new.public_access_token_id for update;
  if not found or access_token.purpose <> 'payment' or access_token.revoked_at is not null
     or access_token.consumed_at is not null or access_token.expires_at <= now() then
    raise exception 'payment token is not active';
  end if;
  select * into current_case from public.cases where id = access_token.case_id;
  if not found or current_case.status in ('closed', 'paid') or current_case.archived_at is not null
     or current_case.outstanding_minor <= 0 or access_token.receiving_account_id is null then
    raise exception 'payment access is no longer available';
  end if;
  new.business_id := current_case.business_id;
  new.case_id := current_case.id;
  new.debtor_id := current_case.debtor_id;
  new.receiving_account_id := access_token.receiving_account_id;
  new.invoice_reference := current_case.invoice_no;
  if nullif(btrim(new.reference_no), '') is not null then
    perform pg_advisory_xact_lock(hashtextextended(concat(current_case.business_id, ':', current_case.id, ':', lower(btrim(new.reference_no))), 0));
    if exists (
      select 1 from public.public_payment_submissions existing
      where existing.business_id = current_case.business_id
        and existing.case_id = current_case.id
        and lower(btrim(existing.reference_no)) = lower(btrim(new.reference_no))
        and existing.status::text <> 'rejected'
    ) then raise exception 'payment reference has already been submitted'; end if;
  end if;
  new.status := 'submitted'::public.public_submission_status;
  return new;
end;
$$;

create or replace function public.payment_proof_submission_created()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.payment_proof_events (submission_id, business_id, case_id, to_status, actor_type)
  values (new.id, new.business_id, new.case_id, 'submitted', 'debtor');
  insert into public.notifications (business_id, case_id, type, title, message, entity_type, entity_id)
  values (new.business_id, new.case_id, 'payment_proof_submitted', 'New payment proof',
    concat('A debtor submitted payment proof for ', new.invoice_reference, '.'), 'payment_proof', new.id);
  insert into public.action_centre_items (business_id, case_id, type, title, description, href, entity_type, entity_id)
  values (new.business_id, new.case_id, 'review_payment_proof', 'Review payment proof',
    concat('Verify the submitted proof for ', new.invoice_reference, '.'), '/payments', 'payment_proof', new.id)
  on conflict (type, entity_id) do nothing;
  insert into public.audit_logs (business_id, case_id, action, actor_type, metadata)
  values (new.business_id, new.case_id, 'payment_proof.submitted', 'debtor', jsonb_build_object('submission_id', new.id));
  return new;
end;
$$;
drop trigger if exists payment_proof_submission_created_trigger on public.public_payment_submissions;
create trigger payment_proof_submission_created_trigger after insert on public.public_payment_submissions
for each row execute function public.payment_proof_submission_created();

drop function if exists public.financial_review_public_payment_submission(uuid,text);
create or replace function public.financial_review_public_payment_submission(
  p_submission_id uuid, p_decision text, p_reason text default null
) returns public.public_payment_submissions language plpgsql security definer set search_path = public, pg_temp as $$
declare submission public.public_payment_submissions; current_case public.cases; payment_row public.payments; old_status text;
begin
  if p_decision not in ('under_review','confirmed','rejected','more_information_required') then
    raise exception 'Unsupported submission review decision';
  end if;
  if p_decision in ('rejected','more_information_required') and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required';
  end if;
  select s.* into submission from public.public_payment_submissions s where s.id = p_submission_id for update;
  if not found then raise exception 'Submission not found'; end if;
  current_case := public.financial_assert_case_owner(submission.case_id);
  old_status := submission.status::text;

  if old_status in ('confirmed','approved') then
    if p_decision = 'confirmed' then return submission; end if;
    raise exception 'Submission has already been confirmed';
  end if;
  if old_status = 'rejected' then
    if p_decision = 'rejected' then return submission; end if;
    raise exception 'Submission has already been rejected';
  end if;

  if p_decision = 'confirmed' then
    select * into payment_row from public.financial_create_owner_payment(
      submission.case_id, round(submission.amount * 100)::bigint, submission.payment_method,
      submission.reference_no, submission.proof_object_path, submission.debtor_note, true
    );
    update public.payments set source_submission_id = submission.id where id = payment_row.id;
  end if;

  update public.public_payment_submissions
  set status = p_decision::public.public_submission_status,
      reviewed_at = case when p_decision in ('confirmed','rejected') then now() else reviewed_at end,
      reviewed_by = auth.uid(),
      review_notes = nullif(btrim(p_reason), ''),
      rejection_reason = case when p_decision in ('rejected','more_information_required') then btrim(p_reason) else null end
  where id = submission.id returning * into submission;

  insert into public.payment_proof_events (submission_id, business_id, case_id, from_status, to_status, actor_type, actor_id, reason)
  values (submission.id, submission.business_id, submission.case_id, old_status, p_decision, 'owner', auth.uid(), nullif(btrim(p_reason), ''));
  insert into public.audit_logs (business_id, case_id, action, actor_type, actor_id, metadata)
  values (submission.business_id, submission.case_id, concat('payment_proof.', p_decision), 'owner', auth.uid(),
    jsonb_build_object('submission_id', submission.id));
  if p_decision in ('confirmed','rejected') then
    update public.action_centre_items set status = 'completed', completed_at = now()
    where type = 'review_payment_proof' and entity_id = submission.id and business_id = submission.business_id;
  end if;
  return submission;
end;
$$;

revoke execute on function public.validate_public_submission_token() from public, anon, authenticated;
revoke execute on function public.payment_proof_submission_created() from public, anon, authenticated;
revoke execute on function public.financial_review_public_payment_submission(uuid,text,text) from public, anon;
grant execute on function public.financial_review_public_payment_submission(uuid,text,text) to authenticated, service_role;

commit;
