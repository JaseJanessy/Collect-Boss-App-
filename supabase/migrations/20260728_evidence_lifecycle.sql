-- Prompt 33: private evidence metadata, archive retention, and storage policies.
-- Local proposal only. Apply after 20260727_reminder_communication_history.sql.

begin;

alter table public.evidence_files
  add column if not exists object_path text,
  add column if not exists description text,
  add column if not exists document_date date,
  add column if not exists is_internal boolean not null default true,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists retention_until date,
  add column if not exists content_sha256 char(64);

update public.evidence_files
  set object_path = coalesce(object_path, file_url)
  where object_path is null;

create index if not exists evidence_files_case_active_uploaded_idx
  on public.evidence_files(case_id, uploaded_at desc)
  where archived_at is null;

create unique index if not exists evidence_files_case_active_sha_uidx
  on public.evidence_files(case_id, content_sha256)
  where archived_at is null and content_sha256 is not null;

drop policy if exists "evidence_files: owner update" on public.evidence_files;
create policy "evidence_files: owner update"
  on public.evidence_files for update
  using (public.owns_case(case_id))
  with check (public.owns_case(case_id));

insert into storage.buckets (id, name, public)
values ('evidence-files', 'evidence-files', false)
on conflict (id) do update set public = false;

drop policy if exists "evidence_files_owner_select" on storage.objects;
create policy "evidence_files_owner_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'evidence-files'
    and exists (
      select 1
      from public.cases c
      join public.businesses b on b.id = c.business_id
      where b.owner_id = auth.uid()
        and c.business_id::text = (storage.foldername(name))[1]
        and c.id::text = (storage.foldername(name))[2]
    )
  );

commit;

-- Retention is archive-first: no object or metadata delete is performed by this migration.
-- Rollback: drop the new indexes/policy/columns only after preserving audit and retention records.
