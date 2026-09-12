# CollectBoss Product Glossary

This glossary is authoritative for product copy, support material, email templates, reports, the public portal, mobile, validation messages, and tests. Stored enum values and database column names remain implementation details and are not renamed by this standard.

| Concept | Approved label | Meaning and usage |
| --- | --- | --- |
| debtor | Debtor | The person or organisation that owes an amount being recovered. Use **Customer** only in relationship/account-management screens. |
| customer | Customer | The creditor's commercial relationship record. A customer becomes a debtor in a recovery or legal context. |
| case | Case | A controlled recovery workflow for one debtor and its selected receivables. |
| receivable | Receivable | An amount owed, whether invoiced or arising from another obligation. |
| invoice | Invoice | A billed receivable identified by an invoice reference. Do not call every receivable an invoice. |
| payment proof | Payment Proof | Evidence supporting a claimed payment. It is not a confirmed payment or receipt. |
| receipt | Receipt | A record issued after payment confirmation and application. |
| promise-to-pay | Promise to Pay | One commitment to pay a stated amount by a stated date. UI copy omits hyphens. |
| payment plan | Payment Plan | An agreed schedule of multiple instalments. It is not a Promise to Pay. |
| dispute | Dispute | A recorded challenge to all or part of a receivable, with review and resolution history. |
| settlement | Settlement | An approved resolution combining cash received, if any, with a separately recorded balance adjustment. |
| closure | Case Closure | The controlled end of recovery work with a reason. It does not erase history. |
| formal demand | Formal Demand | A formal payment demand produced from the case record. It is not legal advice or a court filing. |
| legal handoff | Legal Handoff | A controlled transfer of case information to an authorised legal professional for independent review. |

## Audience-specific labels

- **Customer** is allowed for CRM-style relationship, account, and debtor-directory screens where no recovery action is being described.
- **Debtor** is required in cases, recovery communications, disputes, evidence, formal-demand and legal-handoff contexts.
- Public payment pages may use **you** and **your payment** for plain language, while underlying records remain Debtor, Payment Proof, and Payment.
- **Payment Notice** may describe a non-formal reminder. It must not replace **Formal Demand** when the formal-demand workflow or artifact is meant.

The executable labels and transition metadata live in `src/lib/domain/terminology.ts` and `src/lib/domain/workflows.ts`.
