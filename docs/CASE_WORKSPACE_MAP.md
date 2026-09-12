# CollectBoss case workspace ownership map

This map is authoritative for Phase B case-centric navigation. Existing APIs and domain services remain the source of truth; the workspace only changes where those capabilities are surfaced.

| Workspace section | Authoritative capabilities | Existing routes retained | Permission gate |
| --- | --- | --- | --- |
| Overview | debtor identity, current balance/status summary, owner/priority, next action, receivable coverage, notes | `/cases/[id]` | `case.read`; edits require `case.manage` |
| Financials | record payment, payment history, payment access lock, adjustments, settlement and closure | `/payments`, `/payments/record/[caseId]`, `/payments/access/[caseId]` | `payment.approve`; mutations keep their finer API permissions |
| Communications | call, WhatsApp and email activity, contact preferences and frequency guardrails | `/reminders/[caseId]` | `communication.manage` |
| Resolution | promises to pay, payment plans and disputes | `/legal/[caseId]/plan` and tokenised public dispute/negotiation routes | `promise.manage` or `dispute.resolve` |
| Evidence | evidence completeness, upload and evidence export | `/evidence/[caseId]`, `/evidence/[caseId]/checklist`, `/evidence/[caseId]/pack` | `case.manage` |
| Legal | payment notices, acknowledgement, small-claim readiness and professional handoff | `/legal/[caseId]/demand`, `/legal/[caseId]/acknowledge`, `/legal/[caseId]/smallclaim`, `/legal/[caseId]/lawyer` | `case.manage` |
| Activity | unified immutable case timeline | legacy `?tab=timeline` deep links | `case.read` |

Shareable workspace URLs use `/cases/[id]?section=<section>`. The Overview omits the query parameter. Historical `?tab=payments`, `?tab=documents`, and `?tab=timeline` URLs resolve to Financials, Legal, and Activity respectively.

Global payment review, Action Centre queues, customer/debtor lists, reports, statements, billing, settings, and audit administration remain organisation-wide and are not merged into one case.

No database migration is required. Rollback removes the workspace query mapping and restores the previous four-tab presentation; all standalone routes remain functional throughout.
