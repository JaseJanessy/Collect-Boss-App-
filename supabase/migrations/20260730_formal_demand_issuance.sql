-- Prompt 35 proposal. Do not run against a Supabase project without approval.
alter table public.legal_documents
  add column if not exists document_number text,
  add column if not exists template_version smallint not null default 1 check (template_version > 0),
  add column if not exists issued_at timestamptz,
  add column if not exists issued_by uuid references auth.users(id) on delete set null,
  add column if not exists snapshot jsonb;

create unique index if not exists legal_documents_document_number_uidx
  on public.legal_documents (document_number)
  where document_number is not null;

drop policy if exists "owners can manage own legal documents" on public.legal_documents;
drop policy if exists "legal_documents: owner read" on public.legal_documents;
drop policy if exists "legal_documents: owner insert" on public.legal_documents;
drop policy if exists "legal_documents: owner update" on public.legal_documents;
drop policy if exists "legal_documents: owner update drafts" on public.legal_documents;

create policy "legal_documents: owner read" on public.legal_documents
  for select to authenticated using (owns_case(case_id));
create policy "legal_documents: owner insert" on public.legal_documents
  for insert to authenticated with check (owns_case(case_id));
create policy "legal_documents: owner update drafts" on public.legal_documents
  for update to authenticated
  using (owns_case(case_id) and (document_type not in ('demand_standard', 'demand_firm', 'demand_final') or issued_at is null))
  with check (owns_case(case_id) and (document_type not in ('demand_standard', 'demand_firm', 'demand_final') or (issued_at is null and status = 'draft')));

-- Rollback:
-- drop policy if exists "legal_documents: owner update drafts" on public.legal_documents;
-- create policy "legal_documents: owner update" on public.legal_documents for update to authenticated using (owns_case(case_id));
-- drop index if exists public.legal_documents_document_number_uidx;
-- alter table public.legal_documents drop column if exists snapshot, drop column if exists issued_by,
--   drop column if exists issued_at, drop column if exists template_version, drop column if exists document_number;
