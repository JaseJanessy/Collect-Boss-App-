# UX Development Standard

Use the approved vocabulary in [PRODUCT_GLOSSARY.md](./PRODUCT_GLOSSARY.md). Do not derive customer-facing labels by replacing underscores in stored values when central status metadata exists.

## Actions

Only one visually primary action should appear in an action group. Secondary and Cancel actions use neutral styling. Approval actions use the primary hierarchy only when approval is the page's intended next step. Escalation uses warning styling. Destructive actions use the destructive variant and state the consequence before execution.

Button labels use a verb and object when context is not already explicit: **Record Payment**, **Record Settlement**, **Close Case**, **Archive Customer**. Use **Cancel** to leave a form and specific labels such as **Cancel Promise to Pay** for domain transitions.

## Workflow feedback

Core workflows must expose:

- a labelled loading state that does not imply success;
- an empty state explaining what is absent and, when authorised, the next action;
- an explicit success result after a mutation;
- a warning before consequential but reversible actions;
- a structured error that preserves user input and explains the next safe step.

Irreversible or materially consequential actions require a confirmation naming both the action and effect. API transition enforcement remains authoritative; hiding a button is not an access or workflow control.

## State transitions

`src/lib/domain/workflows.ts` is the client/API vocabulary and transition contract. Database RPCs remain the transactional source of truth for balance, ownership, concurrency, audit logging, and other conditional invariants. Stored values are never changed only to alter presentation copy.
