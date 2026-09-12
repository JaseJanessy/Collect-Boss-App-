-- Authoritative financial ledger and atomic balance projection.
-- Apply only after 20260714_public_access_tokens.sql and 20260719_case_lifecycle.sql.
-- This migration never rewrites existing monetary balances: each existing
-- cases.amount_paid value becomes an explicit opening ledger credit.

begin;

alter table public.cases
  add column if not exists original_principal_minor bigint,
  add column if not exists contractual_due_minor bigint,
  add column if not exists approved_payment_minor bigint,
  add column if not exists outstanding_minor bigint,
  add column if not exists overpayment_minor bigint,
  add column if not exists financial_version integer not null default 0;

do $$
begin
  if exists (select 1 from public.cases where amount_owed <= 0 or amount_paid < 0 or amount_paid > amount_owed) then
    raise exception 'Financial migration requires non-negative legacy amounts with amount_paid <= amount_owed';
  end if;
  if exists (select 1 from public.payments where amount <= 0) then
    raise exception 'Financial migration requires every legacy payment amount to be positive';
  end if;
end;
$$;

update public.cases
set original_principal_minor = round(amount_owed * 100)::bigint,
    contractual_due_minor = round(amount_owed * 100)::bigint,
    approved_payment_minor = round(amount_paid * 100)::bigint,
    outstanding_minor = round((amount_owed - amount_paid) * 100)::bigint,
    overpayment_minor = 0
where original_principal_minor is null;

alter table public.cases
  alter column original_principal_minor set not null,
  alter column contractual_due_minor set not null,
  alter column approved_payment_minor set not null,
  alter column outstanding_minor set not null,
  alter column overpayment_minor set not null;

alter table public.cases
  drop constraint if exists cases_financial_nonnegative_check,
  add constraint cases_financial_nonnegative_check check (
    original_principal_minor >= 0 and contractual_due_minor >= 0 and
    approved_payment_minor >= 0 and outstanding_minor >= 0 and overpayment_minor >= 0
  );

create or replace function public.initialize_case_financial_fields()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare principal_minor bigint;
begin
  if new.amount_owed <= 0 then raise exception 'Original principal must be positive'; end if;
  if new.amount_paid <> 0 then raise exception 'New cases must not set amount_paid directly'; end if;
  principal_minor := round(new.amount_owed * 100)::bigint;
  new.original_principal_minor := principal_minor;
  new.contractual_due_minor := principal_minor;
  new.approved_payment_minor := 0;
  new.outstanding_minor := principal_minor;
  new.overpayment_minor := 0;
  new.financial_version := 0;
  return new;
end;
$$;

drop trigger if exists cases_initialize_financial_fields on public.cases;
create trigger cases_initialize_financial_fields
before insert on public.cases for each row execute function public.initialize_case_financial_fields();

create table if not exists public.case_financial_events (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references public.cases(id) on delete restrict,
  event_type text not null check (event_type in (
    'opening_payment_credit', 'payment_approved', 'payment_reversal',
    'adjustment_debit', 'adjustment_credit'
  )),
  amount_minor bigint not null check (amount_minor > 0),
  source_table text not null,
  source_id uuid not null,
  idempotency_key uuid not null unique default gen_random_uuid(),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (source_table, source_id, event_type)
);

create index if not exists case_financial_events_case_created_idx
  on public.case_financial_events (case_id, created_at, id);

alter table public.case_financial_events enable row level security;

drop policy if exists "case_financial_events_owner_read" on public.case_financial_events;
create policy "case_financial_events_owner_read"
  on public.case_financial_events for select to authenticated
  using (exists (
    select 1 from public.cases c join public.businesses b on b.id = c.business_id
    where c.id = case_financial_events.case_id and b.owner_id = auth.uid()
  ));

alter table public.payments
  add column if not exists financial_event_id uuid references public.case_financial_events(id) on delete restrict,
  add column if not exists source_submission_id uuid unique references public.public_payment_submissions(id) on delete restrict,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references auth.users(id) on delete set null,
  add column if not exists reversal_reason text;

create unique index if not exists payments_financial_event_unique
  on public.payments (financial_event_id) where financial_event_id is not null;

alter table public.payments
  drop constraint if exists payments_amount_positive_check,
  add constraint payments_amount_positive_check check (amount > 0),
  drop constraint if exists payments_review_status_check,
  add constraint payments_review_status_check check (review_status in (
    'pending_review', 'approved', 'rejected', 'unmatched', 'reversed'
  ));

-- Preserve legacy balances without assuming legacy payment rows are complete.
insert into public.case_financial_events (
  case_id, event_type, amount_minor, source_table, source_id, note
)
select c.id, 'opening_payment_credit', c.approved_payment_minor, 'financial_engine_migration', gen_random_uuid(),
  'Opening credit copied from cases.amount_paid during financial-engine migration'
from public.cases c
where c.approved_payment_minor > 0
  and not exists (
    select 1 from public.case_financial_events e
    where e.case_id = c.id and e.event_type = 'opening_payment_credit'
      and e.source_table = 'financial_engine_migration'
  );

create or replace function public.financial_assert_case_owner(p_case_id text)
returns public.cases language plpgsql security definer set search_path = public, pg_temp as $$
declare result public.cases;
begin
  select c.* into result
  from public.cases c join public.businesses b on b.id = c.business_id
  where c.id = p_case_id and b.owner_id = auth.uid()
  for update;
  if not found then raise exception 'Case not found'; end if;
  if result.archived_at is not null then raise exception 'Archived cases cannot receive financial events'; end if;
  return result;
end;
$$;

create or replace function public.financial_recalculate_case(p_case_id text)
returns public.cases language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_case public.cases;
  debit_minor bigint := 0;
  credit_minor bigint := 0;
  payment_minor bigint := 0;
  contractual_minor bigint;
  outstanding_value bigint;
  overpayment_value bigint;
  next_status text;
begin
  select * into current_case from public.cases where id = p_case_id for update;
  if not found then raise exception 'Case not found'; end if;

  select
    coalesce(sum(case when event_type = 'adjustment_debit' then amount_minor else 0 end), 0),
    coalesce(sum(case when event_type = 'adjustment_credit' then amount_minor else 0 end), 0),
    coalesce(sum(case when event_type in ('opening_payment_credit', 'payment_approved') then amount_minor when event_type = 'payment_reversal' then -amount_minor else 0 end), 0)
  into debit_minor, credit_minor, payment_minor
  from public.case_financial_events where case_id = p_case_id;

  contractual_minor := current_case.original_principal_minor + debit_minor - credit_minor;
  if contractual_minor < 0 then raise exception 'Adjustment would reduce contractual due below zero'; end if;
  if payment_minor < 0 then raise exception 'Payment reversals exceed approved payment credits'; end if;
  outstanding_value := greatest(contractual_minor - payment_minor, 0);
  overpayment_value := greatest(payment_minor - contractual_minor, 0);
  next_status := case
    when contractual_minor > 0 and outstanding_value = 0 then 'paid'
    when payment_minor > 0 and outstanding_value > 0 then 'partial_paid'
    when current_case.status = 'paid' then 'action_needed'
    else current_case.status
  end;

  perform set_config('collectboss.financial_write', 'on', true);
  perform set_config('collectboss.lifecycle_transition', 'on', true);
  update public.cases
  set contractual_due_minor = contractual_minor,
      approved_payment_minor = payment_minor,
      outstanding_minor = outstanding_value,
      overpayment_minor = overpayment_value,
      amount_owed = contractual_minor::numeric / 100,
      amount_paid = least(payment_minor, contractual_minor)::numeric / 100,
      status = next_status,
      status_version = case when next_status is distinct from current_case.status then status_version + 1 else status_version end,
      financial_version = financial_version + 1,
      updated_at = now()
  where id = p_case_id
  returning * into current_case;
  return current_case;
end;
$$;

create or replace function public.financial_create_owner_payment(
  p_case_id text, p_amount_minor bigint, p_payment_method text, p_reference_no text default null,
  p_proof_url text default null, p_notes text default null, p_approve boolean default false
) returns public.payments language plpgsql security definer set search_path = public, pg_temp as $$
declare current_case public.cases; payment_row public.payments; event_id uuid;
begin
  if p_amount_minor <= 0 then raise exception 'Payment amount must be positive'; end if;
  if p_payment_method not in ('duitnow_qr','bank_transfer','cash','cheque','tng_ewallet') then raise exception 'Unsupported payment method'; end if;
  current_case := public.financial_assert_case_owner(p_case_id);
  if current_case.status = 'closed' then raise exception 'Closed cases cannot receive payments'; end if;

  insert into public.payments (case_id, amount, payment_method, reference_no, proof_url, review_status, reviewed_at, reviewed_by, notes)
  values (p_case_id, p_amount_minor::numeric / 100, p_payment_method, nullif(btrim(p_reference_no), ''), p_proof_url,
    case when p_approve then 'approved' else 'pending_review' end,
    case when p_approve then now() else null end, case when p_approve then auth.uid() else null end, nullif(btrim(p_notes), ''))
  returning * into payment_row;

  if p_approve then
    insert into public.case_financial_events (case_id, event_type, amount_minor, source_table, source_id, note, created_by)
    values (p_case_id, 'payment_approved', p_amount_minor, 'payments', payment_row.id, 'Owner-recorded approved payment', auth.uid())
    returning id into event_id;
    update public.payments set financial_event_id = event_id where id = payment_row.id returning * into payment_row;
    perform public.financial_recalculate_case(p_case_id);
  end if;

  insert into public.audit_logs (business_id, case_id, action, actor_type, actor_id, metadata)
  values (current_case.business_id, p_case_id, case when p_approve then 'payment.approved' else 'payment.recorded' end,
    'owner', auth.uid(), jsonb_build_object('payment_id', payment_row.id, 'amount_minor', p_amount_minor));
  return payment_row;
end;
$$;

create or replace function public.financial_review_payment(p_payment_id uuid, p_decision text)
returns public.payments language plpgsql security definer set search_path = public, pg_temp as $$
declare payment_row public.payments; current_case public.cases; event_id uuid;
begin
  if p_decision not in ('approved','rejected','unmatched') then raise exception 'Unsupported payment review decision'; end if;
  select p.* into payment_row from public.payments p where p.id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  current_case := public.financial_assert_case_owner(payment_row.case_id);
  if payment_row.review_status <> 'pending_review' then
    if payment_row.review_status = p_decision then return payment_row; end if;
    raise exception 'Payment has already been reviewed';
  end if;

  update public.payments set review_status = p_decision, reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_payment_id returning * into payment_row;
  if p_decision = 'approved' then
    insert into public.case_financial_events (case_id, event_type, amount_minor, source_table, source_id, note, created_by)
    values (payment_row.case_id, 'payment_approved', round(payment_row.amount * 100)::bigint, 'payments', payment_row.id,
      'Approved payment review', auth.uid()) returning id into event_id;
    update public.payments set financial_event_id = event_id where id = payment_row.id returning * into payment_row;
    perform public.financial_recalculate_case(payment_row.case_id);
  end if;
  insert into public.audit_logs (business_id, case_id, action, actor_type, actor_id, metadata)
  values (current_case.business_id, payment_row.case_id, concat('payment.', p_decision), 'owner', auth.uid(),
    jsonb_build_object('payment_id', payment_row.id));
  return payment_row;
end;
$$;

create or replace function public.financial_review_public_payment_submission(p_submission_id uuid, p_decision text)
returns public.public_payment_submissions language plpgsql security definer set search_path = public, pg_temp as $$
declare submission public.public_payment_submissions; current_case public.cases; event_id uuid;
begin
  if p_decision not in ('approved','rejected') then raise exception 'Unsupported submission review decision'; end if;
  select s.* into submission from public.public_payment_submissions s where s.id = p_submission_id for update;
  if not found then raise exception 'Submission not found'; end if;
  select c.* into current_case
  from public.public_access_tokens t join public.cases c on c.id = t.case_id
  join public.businesses b on b.id = c.business_id
  where t.id = submission.public_access_token_id and b.owner_id = auth.uid()
  for update;
  if not found then raise exception 'Submission not found'; end if;
  if submission.status <> 'pending_review' then
    if submission.status::text = p_decision then return submission; end if;
    raise exception 'Submission has already been reviewed';
  end if;

  if p_decision = 'approved' then
    insert into public.case_financial_events (case_id, event_type, amount_minor, source_table, source_id, note, created_by)
    values (current_case.id, 'payment_approved', round(submission.amount * 100)::bigint,
      'public_payment_submissions', submission.id, 'Approved public payment proof', auth.uid()) returning id into event_id;
    insert into public.payments (case_id, amount, payment_method, reference_no, proof_url, review_status, reviewed_at, reviewed_by, notes, financial_event_id, source_submission_id)
    values (current_case.id, submission.amount, submission.payment_method, submission.reference_no, submission.proof_object_path,
      'approved', now(), auth.uid(), submission.review_notes, event_id, submission.id);
    perform public.financial_recalculate_case(current_case.id);
  end if;
  update public.public_payment_submissions set status = p_decision::public_submission_status,
    reviewed_at = now(), reviewed_by = auth.uid() where id = submission.id returning * into submission;
  insert into public.audit_logs (business_id, case_id, action, actor_type, actor_id, metadata)
  values (current_case.business_id, current_case.id, concat('payment_proof.', p_decision), 'owner', auth.uid(),
    jsonb_build_object('submission_id', submission.id));
  return submission;
end;
$$;

create or replace function public.financial_reverse_payment(p_payment_id uuid, p_idempotency_key uuid, p_reason text default null)
returns public.cases language plpgsql security definer set search_path = public, pg_temp as $$
declare payment_row public.payments; current_case public.cases;
begin
  select p.* into payment_row from public.payments p where p.id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  current_case := public.financial_assert_case_owner(payment_row.case_id);
  if payment_row.review_status = 'reversed' then return current_case; end if;
  if payment_row.review_status <> 'approved' then raise exception 'Only approved payments can be reversed'; end if;
  insert into public.case_financial_events (case_id, event_type, amount_minor, source_table, source_id, idempotency_key, note, created_by)
  values (payment_row.case_id, 'payment_reversal', round(payment_row.amount * 100)::bigint, 'payment_reversal', p_idempotency_key,
    p_idempotency_key, nullif(btrim(p_reason), ''), auth.uid()) on conflict (idempotency_key) do nothing;
  update public.payments set review_status = 'reversed', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = nullif(btrim(p_reason), '')
  where id = payment_row.id;
  current_case := public.financial_recalculate_case(payment_row.case_id);
  insert into public.audit_logs (business_id, case_id, action, actor_type, actor_id, metadata)
  values (current_case.business_id, current_case.id, 'payment.reversed', 'owner', auth.uid(), jsonb_build_object('payment_id', payment_row.id));
  return current_case;
end;
$$;

create or replace function public.financial_reconcile_case(p_case_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_case public.cases;
  expected_due bigint;
  expected_payment bigint;
  expected_outstanding bigint;
  expected_overpayment bigint;
begin
  current_case := public.financial_assert_case_owner(p_case_id);
  select current_case.original_principal_minor + coalesce(sum(case when event_type = 'adjustment_debit' then amount_minor when event_type = 'adjustment_credit' then -amount_minor else 0 end), 0),
    coalesce(sum(case when event_type in ('opening_payment_credit','payment_approved') then amount_minor when event_type = 'payment_reversal' then -amount_minor else 0 end), 0)
  into expected_due, expected_payment
  from public.case_financial_events where case_id = p_case_id;
  expected_outstanding := greatest(expected_due - expected_payment, 0);
  expected_overpayment := greatest(expected_payment - expected_due, 0);
  return jsonb_build_object(
    'contractual_due_minor', expected_due,
    'approved_payment_minor', expected_payment,
    'outstanding_minor', expected_outstanding,
    'overpayment_minor', expected_overpayment,
    'stored_contractual_due_minor', current_case.contractual_due_minor,
    'stored_approved_payment_minor', current_case.approved_payment_minor,
    'stored_outstanding_minor', current_case.outstanding_minor,
    'stored_overpayment_minor', current_case.overpayment_minor,
    'drift_detected', expected_due <> current_case.contractual_due_minor or
      expected_payment <> current_case.approved_payment_minor or
      expected_outstanding <> current_case.outstanding_minor or
      expected_overpayment <> current_case.overpayment_minor
  );
end;
$$;

create or replace function public.prevent_direct_case_financial_update()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_setting('collectboss.financial_write', true) is distinct from 'on' and (
    new.amount_owed is distinct from old.amount_owed or new.amount_paid is distinct from old.amount_paid or
    new.original_principal_minor is distinct from old.original_principal_minor or
    new.contractual_due_minor is distinct from old.contractual_due_minor or
    new.approved_payment_minor is distinct from old.approved_payment_minor or
    new.outstanding_minor is distinct from old.outstanding_minor or new.overpayment_minor is distinct from old.overpayment_minor
  ) then raise exception 'Use the financial ledger service'; end if;
  return new;
end;
$$;

drop trigger if exists cases_prevent_direct_financial_update on public.cases;
create trigger cases_prevent_direct_financial_update before update of amount_owed, amount_paid, original_principal_minor,
  contractual_due_minor, approved_payment_minor, outstanding_minor, overpayment_minor on public.cases
  for each row execute function public.prevent_direct_case_financial_update();

-- Browser clients can read payment history, but all writes pass through the
-- security-definer functions above where auth.uid() is verified and rows lock.
drop policy if exists "owners can manage own payments" on public.payments;
drop policy if exists "payments: owner insert" on public.payments;
drop policy if exists "payments: owner update" on public.payments;
drop policy if exists "payments: owner read" on public.payments;
create policy "payments_owner_read" on public.payments for select to authenticated using (
  exists (select 1 from public.cases c join public.businesses b on b.id = c.business_id where c.id = payments.case_id and b.owner_id = auth.uid())
);

revoke all on function public.financial_create_owner_payment(text,bigint,text,text,text,text,boolean) from public;
revoke all on function public.financial_review_payment(uuid,text) from public;
revoke all on function public.financial_review_public_payment_submission(uuid,text) from public;
revoke all on function public.financial_reverse_payment(uuid,uuid,text) from public;
revoke all on function public.financial_reconcile_case(text) from public;
grant execute on function public.financial_create_owner_payment(text,bigint,text,text,text,text,boolean) to authenticated;
grant execute on function public.financial_review_payment(uuid,text) to authenticated;
grant execute on function public.financial_review_public_payment_submission(uuid,text) to authenticated;
grant execute on function public.financial_reverse_payment(uuid,uuid,text) to authenticated;
grant execute on function public.financial_reconcile_case(text) to authenticated;

commit;

-- Rollback: stop financial writes and deploy the prior compatible readers
-- before revoking the new RPC grants. Preserve ledger events, payment rows and
-- minor-unit projections as financial evidence. Never drop or recompute posted
-- records to imitate an older balance; use a verified database restore if a
-- forward-compatible application rollback is impossible.
