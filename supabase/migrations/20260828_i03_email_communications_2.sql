begin;

-- I03 Email Communications 2.0 extends the R10 activity ledger. Email remains
-- a channel on communication_activities; these columns hold provider-backed
-- facts and never infer delivery, opens, replies, promises, or disputes.
alter table public.communication_activities
  add column if not exists provider text,
  add column if not exists provider_message_id text,
  add column if not exists thread_reference text,
  add column if not exists sender text,
  add column if not exists recipients jsonb not null default '{}'::jsonb,
  add column if not exists subject text,
  add column if not exists body_text text,
  add column if not exists sent_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists replied_at timestamptz,
  add column if not exists failure_reason text,
  add column if not exists review_required boolean not null default false;

alter table public.communication_activities
  drop constraint if exists communication_activities_recipients_object_check,
  add constraint communication_activities_recipients_object_check
    check (jsonb_typeof(recipients) = 'object'),
  drop constraint if exists communication_activities_email_provider_fields_check,
  add constraint communication_activities_email_provider_fields_check check (
    channel = 'email' or (
      provider is null and provider_message_id is null and thread_reference is null
      and sender is null and subject is null and body_text is null
      and sent_at is null and delivered_at is null and opened_at is null
      and replied_at is null and failure_reason is null and review_required = false
      and recipients = '{}'::jsonb
    )
  );

create unique index if not exists communication_activities_provider_message_uidx
  on public.communication_activities(business_id,provider,provider_message_id)
  where provider is not null and provider_message_id is not null;
create index if not exists communication_activities_email_thread_idx
  on public.communication_activities(business_id,thread_reference,started_at desc)
  where channel='email' and thread_reference is not null;

alter table public.contact_preferences
  add column if not exists do_not_email boolean not null default false,
  add column if not exists email_invalid boolean not null default false,
  add column if not exists email_unsubscribed boolean not null default false,
  add column if not exists last_email_bounced_at timestamptz;

alter table public.domain_events
  drop constraint if exists domain_events_event_type_check,
  add constraint domain_events_event_type_check check (event_type in (
    'FOLLOW_UP_DUE','INVOICE_OVERDUE','PROMISE_DUE','PROMISE_MISSED',
    'PLAN_INSTALLMENT_DUE','PLAN_INSTALLMENT_MISSED','DISPUTE_REVIEW_DUE',
    'PAYMENT_PROOF_REVIEW_REQUIRED','DISPUTE_SUBMITTED','PAYMENT_RECEIVED',
    'EMAIL_REPLY_RECEIVED'
  ));

create table if not exists public.email_sender_identities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  provider text not null check (provider in ('resend')),
  from_email text not null,
  from_name text not null,
  reply_domain text,
  signature_text text not null default '',
  verification_status text not null default 'pending'
    check (verification_status in ('pending','verified','failed')),
  verified_at timestamptz,
  last_verification_error text,
  configured_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (position('@' in from_email) > 1),
  check (char_length(btrim(from_name)) between 1 and 120),
  check (char_length(signature_text) <= 4000)
);

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  subject_template text not null,
  body_template text not null,
  is_active boolean not null default true,
  is_system_default boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,name),
  check (char_length(btrim(name)) between 1 and 100),
  check (char_length(subject_template) between 1 and 300),
  check (char_length(body_template) between 1 and 20000)
);

insert into public.email_templates (
  business_id,name,subject_template,body_template,is_system_default
)
select b.id,t.name,t.subject_template,t.body_template,true
from public.businesses b
cross join (values
  ('Friendly payment reminder',
   'Payment reminder: {{invoice_number}}',
   E'Hello {{customer_name}},\n\nThis is a friendly reminder that invoice {{invoice_number}} was due on {{due_date}}. The outstanding amount is {{outstanding_amount}}.\n\nYou can review payment options here: {{payment_link}}\n\nIf payment has already been arranged, please reply to let us know.\n\n{{business_signature}}'),
  ('Formal payment follow-up',
   'Payment follow-up: {{invoice_number}}',
   E'Dear {{customer_name}},\n\nOur records show an outstanding balance of {{outstanding_amount}} for invoice {{invoice_number}}, due {{due_date}}.\n\nPlease review the account and payment options at {{payment_link}}, or reply if you need us to review the account with you.\n\n{{business_signature}}'),
  ('Final pre-escalation reminder',
   'Action requested: overdue invoice {{invoice_number}}',
   E'Dear {{customer_name}},\n\nWe are following up again regarding invoice {{invoice_number}}. The outstanding amount is {{outstanding_amount}}, originally due on {{due_date}}.\n\nPlease make payment or reply to discuss the account. Payment options: {{payment_link}}\n\n{{business_signature}}')
) as t(name,subject_template,body_template)
on conflict (business_id,name) do nothing;

create table if not exists public.scheduled_email_followups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  case_id text not null references public.cases(id) on delete restrict,
  customer_id uuid references public.debtors(id) on delete set null,
  related_action_id uuid references public.action_centre_items(id) on delete set null,
  idempotency_key uuid not null,
  due_at timestamptz not null,
  timezone text not null,
  to_recipients jsonb not null,
  cc_recipients jsonb not null default '[]'::jsonb,
  bcc_recipients jsonb not null default '[]'::jsonb,
  subject text not null,
  body_text text not null,
  attachment_ids jsonb not null default '[]'::jsonb,
  override_reason text,
  status text not null default 'pending'
    check (status in ('pending','processing','sent','failed','cancelled')),
  attempts integer not null default 0,
  last_error text,
  communication_activity_id uuid references public.communication_activities(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (business_id,idempotency_key),
  check (jsonb_typeof(to_recipients)='array' and jsonb_array_length(to_recipients)>0),
  check (jsonb_typeof(cc_recipients)='array'),
  check (jsonb_typeof(bcc_recipients)='array'),
  check (jsonb_typeof(attachment_ids)='array'),
  check (override_reason is null or char_length(btrim(override_reason)) between 3 and 500)
);
create index if not exists scheduled_email_followups_due_idx
  on public.scheduled_email_followups(due_at,id)
  where status in ('pending','processing');

create table if not exists public.email_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  provider_message_id text,
  communication_activity_id uuid references public.communication_activities(id) on delete set null,
  payload jsonb not null,
  processed_at timestamptz not null default now(),
  unique (provider,provider_event_id),
  check (jsonb_typeof(payload)='object')
);

create table if not exists public.email_inbound_reviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null,
  provider_message_id text not null,
  sender text not null,
  recipients jsonb not null,
  subject text,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','linked','dismissed')),
  communication_activity_id uuid references public.communication_activities(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  unique (provider,provider_message_id),
  check (jsonb_typeof(recipients)='object')
);

alter table public.email_sender_identities enable row level security;
alter table public.email_templates enable row level security;
alter table public.scheduled_email_followups enable row level security;
alter table public.email_webhook_events enable row level security;
alter table public.email_inbound_reviews enable row level security;

create policy "email_sender_identities_owner_read" on public.email_sender_identities
  for select to authenticated using (public.has_business_permission(business_id,'communication.manage'));
create policy "email_templates_owner_read" on public.email_templates
  for select to authenticated using (public.has_business_permission(business_id,'communication.manage'));
create policy "scheduled_email_followups_owner_read" on public.scheduled_email_followups
  for select to authenticated using (public.has_business_permission(business_id,'communication.manage'));
create policy "email_inbound_reviews_owner_read" on public.email_inbound_reviews
  for select to authenticated using (public.has_business_permission(business_id,'communication.manage'));

revoke all on public.email_sender_identities,public.email_templates,
  public.scheduled_email_followups,public.email_webhook_events,public.email_inbound_reviews from anon;
grant select on public.email_sender_identities,public.email_templates,
  public.scheduled_email_followups,public.email_inbound_reviews to authenticated;
grant all on public.email_sender_identities,public.email_templates,
  public.scheduled_email_followups,public.email_webhook_events,public.email_inbound_reviews to service_role;

-- Webhook receipts deliberately have no authenticated read policy: they may
-- contain provider envelope metadata and are used only by trusted server code.

commit;

-- Rollback: disable email sending/webhooks first, preserve communication rows
-- for audit, then drop the four email configuration/queue tables. New activity
-- columns and preference flags are additive and should be retained or exported.
