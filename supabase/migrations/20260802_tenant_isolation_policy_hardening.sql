-- Approved Prompt 40 remediation: replace broad owner policies with explicit
-- read/insert/update permissions. No application table receives a client delete
-- policy here; records are retained or archived instead.
begin;

-- businesses
drop policy if exists "owners can manage own business" on public.businesses;
drop policy if exists "businesses: owner read" on public.businesses;
drop policy if exists "businesses: owner select" on public.businesses;
drop policy if exists "businesses: owner insert" on public.businesses;
drop policy if exists "businesses: owner update" on public.businesses;
create policy "businesses: owner read" on public.businesses
  for select to authenticated using (owner_id = auth.uid());
create policy "businesses: owner insert" on public.businesses
  for insert to authenticated with check (owner_id = auth.uid());
create policy "businesses: owner update" on public.businesses
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- debtors
drop policy if exists "debtors_owner_manage" on public.debtors;
drop policy if exists "debtors: owner read" on public.debtors;
drop policy if exists "debtors: owner insert" on public.debtors;
drop policy if exists "debtors: owner update" on public.debtors;
create policy "debtors: owner read" on public.debtors
  for select to authenticated using (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()));
create policy "debtors: owner insert" on public.debtors
  for insert to authenticated with check (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()));
create policy "debtors: owner update" on public.debtors
  for update to authenticated using (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())) with check (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()));

-- cases
drop policy if exists "cases_owner_manage" on public.cases;
drop policy if exists "owners can manage own cases" on public.cases;
drop policy if exists "cases_owner_read" on public.cases;
drop policy if exists "cases_owner_insert" on public.cases;
drop policy if exists "cases_owner_update" on public.cases;
drop policy if exists "cases: owner read" on public.cases;
drop policy if exists "cases: owner insert" on public.cases;
drop policy if exists "cases: owner update" on public.cases;
create policy "cases: owner read" on public.cases
  for select to authenticated using (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()));
create policy "cases: owner insert" on public.cases
  for insert to authenticated with check (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()));
create policy "cases: owner update" on public.cases
  for update to authenticated using (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())) with check (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()));

-- evidence metadata is tenant-owned through its case and is retained by archive.
drop policy if exists "owners can manage own evidence" on public.evidence_files;
drop policy if exists "evidence: owner read" on public.evidence_files;
drop policy if exists "evidence: owner select" on public.evidence_files;
drop policy if exists "evidence: owner insert" on public.evidence_files;
drop policy if exists "evidence: owner update" on public.evidence_files;
create policy "evidence: owner read" on public.evidence_files
  for select to authenticated using (
    exists (select 1 from public.cases c join public.businesses b on b.id = c.business_id where c.id = case_id and b.owner_id = auth.uid())
  );
create policy "evidence: owner insert" on public.evidence_files
  for insert to authenticated with check (
    exists (select 1 from public.cases c join public.businesses b on b.id = c.business_id where c.id = case_id and b.owner_id = auth.uid())
  );
create policy "evidence: owner update" on public.evidence_files
  for update to authenticated using (
    exists (select 1 from public.cases c join public.businesses b on b.id = c.business_id where c.id = case_id and b.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.cases c join public.businesses b on b.id = c.business_id where c.id = case_id and b.owner_id = auth.uid())
  );

-- reminders
drop policy if exists "owners can manage own reminders" on public.reminders;
drop policy if exists "reminders: owner read" on public.reminders;
drop policy if exists "reminders: owner insert" on public.reminders;
drop policy if exists "reminders: owner update" on public.reminders;
create policy "reminders: owner read" on public.reminders
  for select to authenticated using (
    exists (select 1 from public.cases c join public.businesses b on b.id = c.business_id where c.id = case_id and b.owner_id = auth.uid())
  );
create policy "reminders: owner insert" on public.reminders
  for insert to authenticated with check (
    exists (select 1 from public.cases c join public.businesses b on b.id = c.business_id where c.id = case_id and b.owner_id = auth.uid())
  );
create policy "reminders: owner update" on public.reminders
  for update to authenticated using (
    exists (select 1 from public.cases c join public.businesses b on b.id = c.business_id where c.id = case_id and b.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.cases c join public.businesses b on b.id = c.business_id where c.id = case_id and b.owner_id = auth.uid())
  );

-- Public payment access requests may be created only by server-side token flows;
-- owners can read and decide requests for their own cases.
drop policy if exists "owners can manage own access requests" on public.payment_access_requests;
drop policy if exists "payment access requests: owner read" on public.payment_access_requests;
drop policy if exists "payment access requests: owner update" on public.payment_access_requests;
create policy "payment access requests: owner read" on public.payment_access_requests
  for select to authenticated using (
    exists (select 1 from public.cases c join public.businesses b on b.id = c.business_id where c.id = case_id and b.owner_id = auth.uid())
  );
create policy "payment access requests: owner update" on public.payment_access_requests
  for update to authenticated using (
    exists (select 1 from public.cases c join public.businesses b on b.id = c.business_id where c.id = case_id and b.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.cases c join public.businesses b on b.id = c.business_id where c.id = case_id and b.owner_id = auth.uid())
  );

commit;

-- Rollback requires the exact pre-deployment policy catalog. Deliberately do not
-- restore broad FOR ALL policies, which would reintroduce the issue remediated here.
