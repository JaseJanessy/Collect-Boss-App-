-- Close direct RPC access to SECURITY DEFINER and trigger-only functions.
-- Supabase may grant API roles EXECUTE on newly-created functions, so this
-- migration revokes those grants explicitly and restores only reviewed calls.

begin;

alter function public.provision_free_tier() set search_path = public, pg_temp;
alter function public.set_updated_at() set search_path = public, pg_temp;

revoke execute on all functions in schema public from public, anon, authenticated, service_role;

-- Owner-scoped RPCs used by signed-in CollectBoss clients.
grant execute on function public.transition_case_status(text,text,text,date,integer) to authenticated, service_role;
grant execute on function public.archive_closed_case(text,text,integer) to authenticated, service_role;
grant execute on function public.financial_create_owner_payment(text,bigint,text,text,text,text,boolean) to authenticated, service_role;
grant execute on function public.financial_review_payment(uuid,text) to authenticated, service_role;
grant execute on function public.financial_review_public_payment_submission(uuid,text) to authenticated, service_role;
grant execute on function public.financial_reverse_payment(uuid,uuid,text) to authenticated, service_role;
grant execute on function public.financial_reconcile_case(text) to authenticated, service_role;
grant execute on function public.payment_plan_create_proposal(text,text,date,integer,jsonb,text) to authenticated, service_role;
grant execute on function public.owns_case(text) to authenticated;

-- Server-only operations. These keys must never be shipped to a browser or app.
grant execute on function public.payment_plan_detect_missed(date) to service_role;
grant execute on function public.payment_plan_record_response(uuid,text,text,text,text,text,jsonb) to service_role;
grant execute on function public.public_rotate_access_token(uuid,text,uuid,timestamptz) to service_role;

commit;
