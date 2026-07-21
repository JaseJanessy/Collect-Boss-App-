# Supabase schema source of truth

`supabase/schema.sql` is the canonical base schema. Apply reviewed files in
`supabase/migrations/` after it, then `supabase/billing.sql`. The former
`src/lib/supabase/schema.sql` was a stale documentation copy and is not a
deployment input.

The canonical schema intentionally uses client-generated text case IDs such as
`CB-2026-...`. `src/lib/db/cases-client.ts` generates those IDs before insert,
so replacing them with UUIDs would break existing links and every case foreign
key. No case-ID conversion is included or implied by this cleanup.

## Conflict matrix

| Table or concern | Canonical definition | Removed duplicate definition | Foreign key, index, or policy conflict | Migration risk and resolution |
| --- | --- | --- | --- | --- |
| `cases.id` | `text` primary key, app supplies `CB-...` ID | UUID primary key with generated default | Every dependent `case_id` is text vs UUID | Critical. Keep text; public-access migration preflights text IDs and uses text FKs. No cast or data rewrite. |
| Case dependents | `evidence_files`, `reminders`, `payment_access_requests`, `payments`, `legal_documents`, `payment_plans`, `audit_logs`, `lawyer_referrals` use text `case_id` FKs | All use UUID `case_id` FKs | Incompatible FK types and case indexes | Critical. Keep the canonical text FK chain. A UUID deployment needs a separate data migration. |
| `cases` status fields | `status`, `payment_lock_mode` are text; `days_overdue` is stored integer | Enum types; generated `days_overdue`; update trigger | Duplicate enum/index behavior | High. Keep canonical values because application types include states not represented by duplicate enums. |
| `evidence_files` | `file_size_bytes integer`; `evidence_type text` required | `bigint`; enum default `other` | Same case FK conflict | Medium. Keep canonical columns; no existing-data conversion is needed. |
| `reminders` | Text channel/status, default status `draft` | Enums, default `pending`, extra sent-at index | Same case FK conflict | Medium. Keep canonical behavior used by the app. |
| `payment_access_requests` | Text status/access type | Restricted enums | Duplicate omitted app states such as `expired` and `sent_manually` | High. Keep canonical text fields; remove legacy anonymous insert policy in the reviewed migration. |
| `receiving_accounts` | Owner policy and ordinary business index | Partial unique primary-account index and granular policies | Index/policy definitions diverge | Medium. The unique-primary rule is not silently merged; add it only through a separately reviewed migration if required. |
| `payments` | Text payment/review fields | Enum fields; extra created-at index | Duplicate enum omits app review state `unmatched`; policies conflict | High. Keep canonical text fields; public writes are server-only and legacy anonymous insert is removed. |
| `legal_documents` | Text document type/status | Enum types and type index | Same case FK conflict | Medium. Keep canonical text fields. |
| `payment_plans` | Text status and text case FK | Enum status and UUID case FK | Duplicate exposed anonymous select/update policies | Critical. Keep canonical text FK; remove anonymous policies because acknowledgement is token-validated server-side. |
| `audit_logs` | Text case FK; `actor_type text`; `actor_id uuid` | UUID case FK; enum actor type; `actor_id text` | Policy/index definitions diverge | High. Keep canonical audit shape; owner inserts are scoped and token routes append server-side. |
| `lawyer_referrals` | Present with text case FK and owner policy | Absent | Missing table/index/policy in duplicate | High. Canonical only. |
| Extensions and RLS | `uuid-ossp`, inline owner RLS | `pgcrypto`, separate RLS reference file | Conflicting deployment order and ownership predicates | High. The RLS reference now uses text case IDs but is not a deployment input; base schema plus reviewed migrations is the only deployment path. |

## Public access migration

`supabase/migrations/20260714_public_access_tokens.sql` is a reviewed,
unexecuted migration. It preflights the canonical text case ID and text payment
method before creating token/submission tables. It creates no anonymous table
or storage policies, and it removes obsolete anonymous policies because public
writes go through token-validated server handlers using the server-only client.

Do not run this migration against a database whose `cases.id` is UUID without a
separate, reviewed data migration and backup plan. No remote migration is
executed by this repository change.
