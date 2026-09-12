# International V1 Release Report

Date: 1 August 2026  
Gate: I05 Invisible-Complexity UX Guardrail + International Release Gate  
Status: code-complete; final environment-specific production verification remains required.

## Release decision

International V1 is designed for controlled configuration and presentation in Malaysia, Singapore, the United Kingdom, Australia, and the United States. This release does not represent legal certification or country-specific regulatory approval. It adds no new primary navigation and does not authorize country-specific payment or legal Phase 2 work.

The everyday workflow remains Today, Cases, Customers, Reports, and Settings. Currency is attached to financial records, region configuration is under Settings, email is launched from communication/follow-up actions, and accounting providers remain under Settings > Accounting Integrations.

## Supported configuration

| Country | Country code | Supported locale configuration | Default currency | Default timezone |
| --- | --- | --- | --- | --- |
| Malaysia | MY | en-MY, ms-MY | MYR | Asia/Kuala_Lumpur |
| Singapore | SG | en-SG, zh-SG, ms-SG, ta-SG | SGD | Asia/Singapore |
| United Kingdom | GB | en-GB, cy-GB | GBP | Europe/London |
| Australia | AU | en-AU | AUD | Australia/Sydney; selectable Australian zones are available |
| United States | US | en-US, es-US | USD | America/New_York; selectable continental, Alaska, and Hawaii zones are available |

These locales currently control currency, number, date, time, address, and phone presentation. The product interface itself remains English; translated product copy is deferred.

Financial records retain their stored values and ISO currency. No foreign-exchange conversion exists. Mixed-currency dashboards, reports, customer totals, and Action Centre summaries remain separated by currency. Compatibility defaults preserve existing Malaysia rows as MYR/en-MY/Asia/Kuala_Lumpur.

## Actual connector capabilities

Xero and QuickBooks Online use one normalized, read-only accounting adapter contract. Current capabilities are OAuth connection, preview, incremental polling, provider-event ingestion, retryable/idempotent synchronization, and imports for contacts/customers, invoices, payments, and allocated credit notes/credit memos. Imported payment and credit effects reuse the existing financial ledger and receivables reconciliation path.

The accounting system remains the source of truth. CollectBoss does not write changes back to Xero or QuickBooks. Normal successful sync state is shown only in Settings. Provider errors are actionable connection/sync errors; they do not alter money totals. Disconnect removes local OAuth credentials while preserving imported history and mappings.

Live provider certification, marketplace listing, and production-tenant OAuth smoke tests are not asserted by this report.

## Email capabilities

Email Communications 2.0 provides verified sender identity configuration, approved templates, tenant/case currency and region-aware template rendering, To/CC/BCC validation, customer-address retention, evidence attachments, contact-frequency/preference guardrails, immediate sending, scheduled follow-ups, provider delivery events, bounce/unsubscribe controls, inbound reply routing, durable activity history, and Timeline visibility.

The implemented provider path is Resend. A verified sender identity, `RESEND_API_KEY`, and signed webhook configuration are required before live delivery. A provider acceptance response is not represented as customer delivery unless the corresponding lifecycle event is received.

## Environment variables

Production core: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_ENV`, and `CRON_SECRET`.

Stripe subscription billing: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_BOSS`, `STRIPE_PRICE_PRO`, and `STRIPE_WEBHOOK_SECRET`.

Accounting: `ACCOUNTING_TOKEN_ENCRYPTION_KEY`, `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_WEBHOOK_KEY`, `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN`, and `QUICKBOOKS_ENVIRONMENT`.

Email and communication: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `REMINDER_EMAIL_FROM`, `PAYMENT_OTP_FROM_EMAIL`, and, when SMS OTP is enabled, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`. `PAYMENT_ACCESS_OTP_PEPPER` protects payment-access OTP material. `LEGAL_HANDOFF_WEBHOOK_SECRET` is required only when the professional handoff webhook is enabled.

Production must leave `NEXT_PUBLIC_ENABLE_MOCK_DATA` and `ENABLE_MOCK_DATA` disabled. Missing production prerequisites must fail visibly; production mock fallback is not supported.

## Webhook and scheduled endpoints

- Stripe: `/api/stripe/webhook`
- Resend delivery/inbound events: `/api/webhooks/resend`
- Accounting provider events: `/api/integrations/accounting/webhooks/xero` and `/api/integrations/accounting/webhooks/quickbooks`
- Xero OAuth callback: `/api/integrations/accounting/xero/callback`
- QuickBooks OAuth callback: `/api/integrations/accounting/quickbooks/callback`
- Domain scheduler: `/api/cron/domain-events`
- Accounting reconciliation polling: `/api/cron/accounting-sync`
- Scheduled email follow-ups: `/api/cron/email-followups`

Webhook secrets and signatures are server-side only. Cron endpoints require the configured bearer secret.

## Migrations and schema

International V1 depends on:

1. `20260826_accounting_integration_framework.sql`
2. `20260826_i01_international_locale_foundation.sql`
3. `20260827_i02_multi_currency_financial_presentation.sql`
4. `20260828_i03_email_communications_2.sql`

No I05 schema migration was added. The consolidated `supabase/schema.sql` and `src/lib/supabase/rls.sql` remain the schema/RLS sources of truth alongside the ordered migrations.

## Rollback notes

UI and adapter changes can be rolled back without rewriting stored financial values. Once a non-MYR record exists, currency columns and historical currency values must not be removed or coerced to MYR. A safe I02 rollback disables new non-MYR writes and restores compatible readers; it does not combine currencies or assume two decimal places.

Accounting disconnect is the supported credential rollback and preserves imported history. Email delivery can be disabled by removing sender readiness and scheduled delivery configuration while retaining communication audit records. Database rollback after real connector/email/foreign-currency use requires a data-preserving migration plan; destructive reversal is not approved.

## Verification coverage

Automated coverage includes locale/currency profiles for MY, SG, GB, AU, and US; exact minor-unit arithmetic; per-currency financial reconciliation; wrong-currency event rejection; accounting retry/idempotency contracts; Email 2.0 provider-event and idempotency controls; tenant-local scheduler boundaries; navigation consolidation; tenant-scoped RLS contracts; and production build/type/lint gates.

Final command results and runtime device checks are recorded in the task completion report. Contract-level RLS verification is not a substitute for a live two-tenant production/staging exercise.

## Known limitations and deferred work

- Country/locale settings format presentation but do not provide translated UI copy.
- No FX rates, conversion, consolidated base-currency reporting, or cross-currency settlement exists.
- No country-specific legal rules, payment rails, tax logic, collections advice, or compliance engine is enabled.
- Existing Malaysia-specific legal documents and DuitNow-oriented receiving-account flows remain Malaysia capabilities; they are not presented as valid substitutes for other countries.
- Xero/QuickBooks are read-only and require live sandbox/production credentials for end-to-end provider verification.
- Email requires verified DNS/sender setup and provider webhooks for authoritative delivery state.
- Formal certification claims (including GDPR, ISO 27001, and SOC 2 certification) are intentionally absent.
- Live Supabase tenant-isolation, provider OAuth/webhook, email delivery, and complete device/browser matrices must be executed in the target staging environment before production promotion.

## Deferred Phase 2

Translated interface copy, country-specific payment rails, legal templates/rules, tax behavior, compliance attestations, FX conversion, base-currency reporting, accounting write-back, and additional providers remain deferred until a real target-country/customer requirement is approved.
