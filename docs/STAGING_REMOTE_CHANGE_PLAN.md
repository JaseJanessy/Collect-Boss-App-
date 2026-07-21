# Prompt 49 staging remote-change plan

## Current status: blocked before remote action

No staging environment is configured in this checkout: there is no `.env.local`, no Supabase CLI connection, no Vercel project metadata, no Stripe CLI, and no verified staging URL. No remote command, SQL, fixture, backup, or webhook operation has been attempted.

## Required evidence before execution

1. A named **staging** Supabase project reference and a read-only verification that identifies it as non-production.
2. Confirmation of a current staging backup/snapshot and its timestamp before any schema or fixture change.
3. A staging deployment URL with `NEXT_PUBLIC_APP_ENV=staging`; configure values in the deployment platform rather than chat or source files.
4. A Stripe **test-mode** account and a staging webhook endpoint. No live keys, live prices, live charges, or customer data are permitted.
5. Explicit approval of the exact migration SQL after the target schema, migration history, buckets, and policies have been read from staging.

## SQL control gate

**Proposed remote SQL statements: none.** The repository contains candidate migration files, but their contents have not been proposed for this target, approved for execution, or applied remotely. Before applying anything, record each exact statement, compatible current schema evidence, data risk, and rollback SQL in this document or a reviewed follow-up.

Candidate deployment order, subject to the control gate above:

1. `supabase/schema.sql`
2. `20260714_public_access_tokens.sql` through `20260803_storage_object_policy_hardening.sql`, in filename order
3. `supabase/billing.sql`

Do not substitute the removed `src/lib/supabase/schema.sql`; [SUPABASE_SCHEMA_SOURCE_OF_TRUTH.md](SUPABASE_SCHEMA_SOURCE_OF_TRUTH.md) identifies `supabase/schema.sql` as canonical.

## Planned staging sequence

1. Verify staging identity, schema version, bucket names, RLS status, and migration history without writing data.
2. Confirm snapshot/backup and a restore owner before any write.
3. Compare the verified schema with the approved migration sequence and present the exact SQL plus rollback plan.
4. Apply only approved, compatible migrations; re-read resulting tables, functions, policies, indexes, and buckets.
5. Create two synthetic owner accounts, two businesses, synthetic cases, and synthetic Stripe test customers only.
6. Run every case in [STAGING_69_CASE_MATRIX.md](STAGING_69_CASE_MATRIX.md), recording timestamp, evidence link, actor, and outcome.
7. Stop after the first complete run; group defects by category. Repair one category per cycle, rerun affected cases, then run full regression.
8. Delete synthetic app data, revoke generated public tokens, remove temporary evidence/proofs, and retain only approved audit evidence.

## Rollback and cleanup

- Schema or policy failure: stop writes and restore the confirmed staging snapshot; do not improvise down-migrations.
- Fixture failure: delete only documented synthetic records and objects by their recorded IDs/paths.
- Webhook failure: disable the staging endpoint and rotate its test signing secret in Stripe Dashboard.
- Never use a production project, production URL, live Stripe mode, or real debtor/customer data.
