# Malaysian accounting software

Settings → Integrations supports these providers:

| Software | How it connects | What syncs |
|---|---|---|
| Xero, QuickBooks Online | OAuth sign-in | Contacts, invoices, payments, credit notes |
| **Bukku** | Access token + company subdomain | Customers and sales invoices with live balances (read-only) |
| **AutoCount Cloud Accounting** | Key ID + API Key + account book ID | Debtors and invoices with outstanding amounts (read-only) |
| **SQL Account** | CSV export | Customers and invoices files for Import from Excel/Text |

## Bukku

- **Where the business gets the token:** Bukku → Control Panel → Integrations
  → turn on API Access and copy the access token. The subdomain is the
  `xxx` in `xxx.bukku.my`.
- **API:** `https://api.bukku.my` with headers `Authorization: Bearer <token>`
  and `Company-Subdomain: <subdomain>` (spec at developers.bukku.my).
  `BUKKU_API_BASE_URL` can point at `https://api.staging.bukku.dev` for
  testing.
- **Sync, in two passes:**
  1. Unpaid invoices (`payment_status=OUTSTANDING`). Each one's detail is read
     for `balance` and the due date from `term_items`.
  2. Paid invoices from the last 90 days before the previous sync, so invoices
     that were settled are marked paid.

  Payments and credit notes are already reflected in each invoice's balance.
- **Rate limit:** 600 requests per minute.

## AutoCount Cloud Accounting

- **Where the business gets the keys:** AutoCount Cloud Accounting → Settings
  → API Keys. Create a key with read access, then copy the Key ID and API
  Key. The account book ID is in the AutoCount URL and settings.
- **API:** `https://accounting-api.autocountcloud.com/{accountBookId}/…` with
  headers `Key-ID` and `API-Key`.
- **Sync:**
  - `GET /debtor/listing` reads up to 100 debtors per page.
  - `POST /invoice/listing` reads invoices, filtered by `lastModifiedDate` for
    incremental syncs. It returns `finalTotal`, `outstandingAmount`,
    `dueDate` and `cancelled`.
- Only **AutoCount Cloud Accounting** has this API. Desktop AutoCount
  Accounting 2.x users can use the CSV export.

## SQL Account

SQL Account's REST API 2.0 signs requests with AWS SigV4 keys issued per
database. Its host, signing region and paging rules are only published in
a downloadable Postman collection, so CollectBoss does not guess them.

Until that collection is available, Settings offers two CSV downloads:

- **Customers:** Customer Code, Company Name, Contact Name, Registration No,
  Phone, Email, Address.
- **Invoices:** Doc No, Doc Date, Due Date, Customer Code, Customer Name,
  Currency, Amount, Paid, Outstanding, Status, Description.

Import customers first, then invoices. `Customer Code` links the two files.
All cells are protected against spreadsheet formula injection.

To add a live SQL Account sync later, implement an adapter in
`src/lib/accounting/providers/` using the Postman collection's endpoints.

## Database

Apply `supabase/migrations/20260924_malaysian_accounting_providers.sql`. It
adds `bukku` and `autocount` to every provider allow-list that already
contains `quickbooks`, and keeps existing values such as `stripe` and
`resend`.
