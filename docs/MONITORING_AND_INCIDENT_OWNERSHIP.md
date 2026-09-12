# Monitoring and incident ownership

This file defines required signals and ownership fields. It is not evidence that an external monitor or alert route exists.

## Required monitors

| Signal | Detection | Severity | Primary owner | Secondary owner | Required drill |
| --- | --- | --- | --- | --- | --- |
| Public availability | HTTPS probes for landing and login | High after two consecutive failures | Unassigned | Unassigned | Force staging probe failure and capture alert receipt. |
| API 5xx/error rate | Hosting error-rate monitor with redacted route grouping | High at agreed sustained threshold | Unassigned | Unassigned | Trigger a synthetic staging 503. |
| Database availability | Supabase health, connection, CPU, and backup status | Critical for integrity/backup failure | Unassigned | Unassigned | Restore a current backup to an empty safe project. |
| Tenant/RLS canary | Scheduled two-tenant denial checks | Critical on any unauthorized result | Unassigned | Unassigned | Attempt known cross-tenant reads and writes. |
| Malware scanning | Queue age, configuration failure, quarantine and retry counts | High when clean processing stops | Unassigned | Unassigned | Disable staging scanner and upload a synthetic file. |
| Stripe webhooks | Signature failures, retry/dead-letter count, oldest pending age | High for entitlement drift | Unassigned | Unassigned | Send invalid signature, duplicate, and processing failure. |
| Accounting integrations | Action-required/outage health and dead letters | Medium unless financial corruption is suspected | Unassigned | Unassigned | Revoke sandbox access and run sync. |
| Email delivery | Bounce/complaint/suppression rate and retry/dead-letter count | Medium | Unassigned | Unassigned | Send to provider-approved bounce fixture. |
| Audit integrity | Hash-chain continuity and append-only invariant | Critical on discontinuity | Unassigned | Unassigned | Run continuity check and retain result. |

## Routing and escalation

Before approval, replace every `Unassigned` value with a named operational role and a tested destination. Record alert receipt IDs in the release evidence index. Alert payloads may contain route names, provider event IDs, tenant-safe aggregate counts, and redacted error codes only. They must not contain credentials, capability tokens, full recipients, message bodies, bank details, documents, or webhook payloads.

Critical incidents page the primary and secondary owner immediately and stop promotion. High incidents block release and page during the supported response window. Medium incidents create an owned ticket. Low incidents enter the release backlog.

## First 48 hours

The signed checklist must assign an on-call primary and secondary for each monitoring window: launch to +4 hours, +4 to +12 hours, +12 to +24 hours, and +24 to +48 hours. Each handoff records queue health, webhook failures, database backup status, application errors, and open incidents.
