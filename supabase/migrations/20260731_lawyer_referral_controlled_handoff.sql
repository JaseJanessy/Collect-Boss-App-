begin;

alter table public.lawyer_referrals
  add column if not exists consent_version text,
  add column if not exists consented_at timestamptz,
  add column if not exists consent_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists data_package_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists data_package_created_at timestamptz,
  add column if not exists shared_at timestamptz,
  add column if not exists handoff_channel text,
  add column if not exists provider_reference text,
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawal_reason text,
  add column if not exists idempotency_key uuid unique,
  add column if not exists last_handoff_error text;

alter table public.lawyer_referrals
  drop constraint if exists lawyer_referrals_status_check,
  drop constraint if exists lawyer_referrals_consent_check,
  drop constraint if exists lawyer_referrals_withdrawal_check,
  add constraint lawyer_referrals_status_check check (
    referral_status in (
      'draft', 'ready_for_review', 'handoff_pending', 'handoff_failed',
      'submitted', 'under_review', 'lawyer_contacted', 'accepted',
      'declined', 'withdrawn', 'closed'
    )
  ),
  add constraint lawyer_referrals_consent_check check (
    referral_status = 'draft'
    or (consent_version is not null and consented_at is not null and consent_snapshot <> '{}'::jsonb)
  ) not valid,
  add constraint lawyer_referrals_withdrawal_check check (
    referral_status <> 'withdrawn' or withdrawn_at is not null
  );

create table if not exists public.lawyer_referral_events (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.lawyer_referrals(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  event_type text not null check (event_type in ('created', 'data_package_created', 'handoff_attempted', 'handoff_failed', 'submitted', 'withdrawn', 'provider_status_recorded')),
  actor_type text not null check (actor_type in ('owner', 'system')),
  actor_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.lawyer_referral_events enable row level security;

drop policy if exists "owners can manage own referrals" on public.lawyer_referrals;
drop policy if exists "lawyer_referrals_owner_read" on public.lawyer_referrals;
create policy "lawyer_referrals_owner_read"
on public.lawyer_referrals for select to authenticated
using (exists (select 1 from public.businesses b where b.id = lawyer_referrals.business_id and b.owner_id = auth.uid()));

drop policy if exists "lawyer_referral_events_owner_read" on public.lawyer_referral_events;
create policy "lawyer_referral_events_owner_read"
on public.lawyer_referral_events for select to authenticated
using (exists (select 1 from public.businesses b where b.id = lawyer_referral_events.business_id and b.owner_id = auth.uid()));

create index if not exists lawyer_referrals_case_open_idx
  on public.lawyer_referrals(case_id, created_at desc)
  where referral_status not in ('withdrawn', 'closed', 'declined');

create index if not exists lawyer_referral_events_referral_idx
  on public.lawyer_referral_events(referral_id, created_at asc);

commit;
