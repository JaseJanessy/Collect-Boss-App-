begin;

do $$
begin
  if exists (select 1 from public.cases where status not in ('action_needed','payment_promise','partial_paid','paid','overdue','formal_demand_ready')) then
    raise exception 'Cannot migrate unknown legacy case status values';
  end if;
end;
$$;

alter table public.cases
  add column if not exists promise_due_date date,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references auth.users(id) on delete set null,
  add column if not exists close_reason text,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archive_reason text,
  add column if not exists status_version integer not null default 1;

alter table public.cases drop constraint if exists cases_status_check;
alter table public.cases drop constraint if exists cases_promise_due_date_check;
alter table public.cases drop constraint if exists cases_closed_fields_check;
alter table public.cases add constraint cases_status_check check (status in ('action_needed','payment_promise','partial_paid','paid','overdue','formal_demand_ready','closed'));
alter table public.cases add constraint cases_promise_due_date_check check (status <> 'payment_promise' or promise_due_date is not null);
alter table public.cases add constraint cases_closed_fields_check check (status <> 'closed' or (closed_at is not null and closed_by is not null));

create table public.case_status_history (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references public.cases(id) on delete cascade,
  from_status text, to_status text not null, transition_reason text,
  actor_id uuid references auth.users(id) on delete set null,
  actor_type text not null check (actor_type in ('owner','system')),
  created_at timestamptz not null default now()
);
create index idx_case_status_history_case_created on public.case_status_history (case_id, created_at desc);
alter table public.case_status_history enable row level security;
create policy "case_status_history_owner_read" on public.case_status_history for select to authenticated using (exists (select 1 from public.cases c join public.businesses b on b.id=c.business_id where c.id=case_status_history.case_id and b.owner_id=auth.uid()));

drop policy if exists "owners can manage own cases" on public.cases;
create policy "cases_owner_read" on public.cases for select to authenticated using (exists (select 1 from public.businesses b where b.id=cases.business_id and b.owner_id=auth.uid()));
create policy "cases_owner_insert" on public.cases for insert to authenticated with check (exists (select 1 from public.businesses b where b.id=cases.business_id and b.owner_id=auth.uid()));
create policy "cases_owner_update" on public.cases for update to authenticated using (exists (select 1 from public.businesses b where b.id=cases.business_id and b.owner_id=auth.uid())) with check (exists (select 1 from public.businesses b where b.id=cases.business_id and b.owner_id=auth.uid()));

create or replace function public.prevent_direct_case_lifecycle_update() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_setting('collectboss.lifecycle_transition', true) is distinct from 'on' and (new.status is distinct from old.status or new.promise_due_date is distinct from old.promise_due_date or new.closed_at is distinct from old.closed_at or new.closed_by is distinct from old.closed_by or new.close_reason is distinct from old.close_reason or new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by or new.archive_reason is distinct from old.archive_reason or new.status_version is distinct from old.status_version) then raise exception 'Use the case lifecycle transition service'; end if;
  return new;
end;
$$;

create or replace function public.transition_case_status(p_case_id text,p_to_status text,p_reason text default null,p_promise_due_date date default null,p_expected_version integer default null) returns public.cases language plpgsql security definer set search_path = public, pg_temp as $$
declare current_case public.cases; previous_status text;
begin
  select c.* into current_case from public.cases c join public.businesses b on b.id=c.business_id where c.id=p_case_id and b.owner_id=auth.uid() for update;
  if not found then raise exception 'Case not found'; end if;
  if current_case.archived_at is not null then raise exception 'Archived cases cannot transition'; end if;
  if p_expected_version is not null and p_expected_version <> current_case.status_version then raise exception 'Case changed; reload and try again'; end if;
  if p_to_status not in ('action_needed','payment_promise','partial_paid','paid','overdue','formal_demand_ready','closed') then raise exception 'Unsupported case status'; end if;
  previous_status:=current_case.status;
  if previous_status='closed' then raise exception 'Closed cases cannot transition'; end if;
  if p_to_status='paid' and current_case.balance<>0 then raise exception 'A case can be paid only when its balance is zero'; end if;
  if p_to_status='partial_paid' and not (current_case.amount_paid>0 and current_case.balance>0) then raise exception 'Partial payment requires a positive paid amount and balance'; end if;
  if p_to_status='payment_promise' and p_promise_due_date is null then raise exception 'A payment promise requires a promised due date'; end if;
  if p_to_status='formal_demand_ready' and current_case.balance<=0 then raise exception 'A paid case cannot be escalated to formal demand'; end if;
  if p_to_status='closed' then if previous_status<>'paid' or current_case.balance<>0 then raise exception 'Only fully paid cases can be closed'; end if; if exists (select 1 from public.payment_plans p where p.case_id=current_case.id and p.status='active') then raise exception 'Close the active payment plan before closing the case'; end if; elsif previous_status='paid' then raise exception 'Paid cases require a controlled payment reversal before reopening'; end if;
  perform set_config('collectboss.lifecycle_transition','on',true);
  update public.cases set status=p_to_status,promise_due_date=case when p_to_status='payment_promise' then p_promise_due_date else null end,closed_at=case when p_to_status='closed' then now() else null end,closed_by=case when p_to_status='closed' then auth.uid() else null end,close_reason=case when p_to_status='closed' then nullif(btrim(p_reason),'') else null end,status_version=status_version+1,updated_at=now() where id=current_case.id returning * into current_case;
  insert into public.case_status_history(case_id,from_status,to_status,transition_reason,actor_id,actor_type) values(current_case.id,previous_status,p_to_status,nullif(btrim(p_reason),''),auth.uid(),'owner');
  perform set_config('collectboss.lifecycle_transition','off',true); return current_case;
end;
$$;

create or replace function public.archive_closed_case(p_case_id text,p_reason text,p_expected_version integer default null) returns public.cases language plpgsql security definer set search_path = public, pg_temp as $$
declare current_case public.cases;
begin
  select c.* into current_case from public.cases c join public.businesses b on b.id=c.business_id where c.id=p_case_id and b.owner_id=auth.uid() for update;
  if not found then raise exception 'Case not found'; end if;
  if current_case.status<>'closed' or current_case.closed_at is null then raise exception 'Only closed cases can be archived'; end if;
  if current_case.archived_at is not null then return current_case; end if;
  if p_expected_version is not null and p_expected_version<>current_case.status_version then raise exception 'Case changed; reload and try again'; end if;
  perform set_config('collectboss.lifecycle_transition','on',true);
  update public.cases set archived_at=now(),archived_by=auth.uid(),archive_reason=nullif(btrim(p_reason),''),status_version=status_version+1,updated_at=now() where id=current_case.id returning * into current_case;
  insert into public.case_status_history(case_id,from_status,to_status,transition_reason,actor_id,actor_type) values(current_case.id,'closed','closed',concat('archived: ',nullif(btrim(p_reason),'')),auth.uid(),'owner');
  perform set_config('collectboss.lifecycle_transition','off',true); return current_case;
end;
$$;

create or replace function public.advance_overdue_cases() returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare affected_count integer;
begin
  perform set_config('collectboss.lifecycle_transition','on',true);
  with transitioned as (update public.cases set status='overdue',status_version=status_version+1,updated_at=now() where archived_at is null and status in ('action_needed','payment_promise','partial_paid') and balance>0 and due_date<current_date returning id,status)
  insert into public.case_status_history(case_id,from_status,to_status,transition_reason,actor_type) select id,null,'overdue','automatic overdue transition','system' from transitioned;
  get diagnostics affected_count=row_count; perform set_config('collectboss.lifecycle_transition','off',true); return affected_count;
end;
$$;
create trigger cases_prevent_direct_lifecycle_update before update of status,promise_due_date,closed_at,closed_by,close_reason,archived_at,archived_by,archive_reason,status_version on public.cases for each row execute function public.prevent_direct_case_lifecycle_update();
revoke all on function public.transition_case_status(text,text,text,date,integer) from public;
grant execute on function public.transition_case_status(text,text,text,date,integer) to authenticated;
revoke all on function public.archive_closed_case(text,text,integer) from public;
grant execute on function public.archive_closed_case(text,text,integer) to authenticated;
commit;
