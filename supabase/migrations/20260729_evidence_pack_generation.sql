-- Prompt 34 proposal. Do not run against a Supabase project without approval.
-- Adds a durable idempotency key for server-created evidence-pack records.
alter table public.legal_documents
  add column if not exists generation_key uuid;

create unique index if not exists legal_documents_evidence_pack_generation_key_uidx
  on public.legal_documents (case_id, generation_key)
  where document_type = 'evidence_pack' and generation_key is not null;

-- Rollback:
-- drop index if exists public.legal_documents_evidence_pack_generation_key_uidx;
-- alter table public.legal_documents drop column if exists generation_key;
