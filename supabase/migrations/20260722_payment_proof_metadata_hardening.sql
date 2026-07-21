-- Phase 4 public payment-proof metadata hardening.
-- Apply after 20260714_public_access_tokens.sql through 20260721_payment_access_lock_enforcement.sql.
-- Rollback: begin; alter table public.public_payment_submissions drop constraint if exists public_payment_submissions_proof_metadata_check, drop column if exists proof_sha256, drop column if exists proof_size_bytes, drop column if exists proof_content_type, drop column if exists payment_date; commit;
begin;

alter table public.public_payment_submissions
  add column if not exists payment_date date not null default current_date,
  add column if not exists proof_content_type text,
  add column if not exists proof_size_bytes integer,
  add column if not exists proof_sha256 text;

alter table public.public_payment_submissions
  drop constraint if exists public_payment_submissions_proof_metadata_check,
  add constraint public_payment_submissions_proof_metadata_check check (
    (proof_object_path is null and proof_content_type is null and proof_size_bytes is null and proof_sha256 is null)
    or
    (proof_object_path is not null
      and proof_content_type in ('application/pdf', 'image/jpeg', 'image/png')
      and proof_size_bytes > 0 and proof_size_bytes <= 10485760
      and proof_sha256 ~ '^[0-9a-f]{64}$')
  ),
  add constraint public_payment_submissions_payment_date_check check (payment_date <= current_date and payment_date >= current_date - interval '10 years');

create index if not exists public_payment_submissions_proof_sha_idx
  on public.public_payment_submissions(proof_sha256) where proof_sha256 is not null;
commit;
