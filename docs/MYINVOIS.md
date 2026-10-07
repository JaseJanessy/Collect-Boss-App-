# LHDN MyInvois e-Invoicing

CollectBoss submits e-Invoices to LHDN **as an intermediary** on behalf of
each business.

- Documents use **e-Invoice v1.0 (UBL 2.1 JSON)**. LHDN still accepts v1.0
  **without a digital signature** until it formally retires that version. The
  builder in `src/lib/einvoice/myinvois-document.ts` follows LHDN's official
  `1.0-Invoice-Sample.json`.
- The flow, from a customer's invoice:
  1. **Send e-Invoice** submits the document.
  2. The hourly job polls LHDN until it is validated or rejected.
  3. Once validated, the LHDN validation link is shown.
  4. A validated e-Invoice can be cancelled within 72 hours.

## Platform setup (one time, for CollectBoss)

1. Register CollectBoss as an **ERP / intermediary system** in the MyInvois
   portal. Get a client ID and secret, first for the sandbox (`preprod`) and
   later for production.
2. Set the server-only environment variables:

   | Variable | Value |
   |---|---|
   | `MYINVOIS_CLIENT_ID` | Intermediary client ID |
   | `MYINVOIS_CLIENT_SECRET` | Intermediary client secret |
   | `MYINVOIS_ENVIRONMENT` | `preprod` (default) or `production` |

3. Apply `supabase/migrations/20260923_myinvois_einvoicing.sql`.

## Business setup (each business, in Settings → e-Invoice)

1. In the MyInvois portal, the business adds CollectBoss as its
   **intermediary** and grants permission to submit documents.
2. In CollectBoss, the business enters:
   - its TIN, SSM number, MSIC code and business activity,
   - its address, state and phone,
   - its tax type: not SST-registered, service tax or sales tax (with rate).

   Then it ticks the intermediary confirmation and turns e-Invoicing on.
3. For each customer, it fills in **e-Invoice details**: TIN, or IC/passport
   for individuals, and an address with city and state.

## How amounts are mapped

- One invoice line, quantity 1, classification `022` (Others).
- The CollectBoss invoice amount is treated as **tax-inclusive**. For service
  or sales tax, the taxable amount and tax are split from the total at the
  configured rate. Not-registered businesses use tax type `06` with zero tax.
- Individuals without a TIN use LHDN's general TIN `EI00000000010`, together
  with their IC or passport number.
- Issue date and time are set at submission, because LHDN requires them to be
  within 72 hours of submitting.

## Limits and what's next

- When LHDN announces the retirement of v1.0, add v1.1 signing (XAdES with
  each business's digital certificate) in `myinvois-client.ts` before
  submission.
- Credit notes, debit notes and consolidated B2C e-Invoices are not built yet.
- The submit API allows 100 requests per minute and 300 KB per document.
  CollectBoss sends one document per request.
