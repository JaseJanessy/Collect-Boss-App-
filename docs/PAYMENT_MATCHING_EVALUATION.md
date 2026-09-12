# Payment candidate matching evaluation

This report covers the deterministic weighted-rule matcher introduced by Prompt 16. It is a fixture evaluation, not a claim about production accuracy or customer data.

## Labelled set

The representative synthetic fixtures in `tests/fixtures/payment-matching-labelled.ts` cover:

- an exact invoice/reference/account/party match with a plausible date;
- equal amount and currency with no corroborating identifier;
- an otherwise attractive candidate with a currency conflict;
- a partial party-name match plus a lawfully available matching phone and prior-payment pattern.

The fixture labels are intentionally small and should only guard rule behaviour. Before any threshold is changed for production, expand this set with de-identified, tenant-approved examples and review sampling bias.

## Confidence-band metrics

Run `npm run test:unit -- tests/unit/payment-matching-engine.test.ts` to calculate precision and recall by `high`, `ambiguous`, and `low` band. The test asserts the current labelled high-confidence predictions are correct and reports `null` when a denominator is zero rather than inventing a value.

| Band | Predicted top matches | Correct top matches | Labelled expected targets in band | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| High | 1 | 1 | 1 | 1.00 | 1.00 |
| Ambiguous | 1 | 1 | 1 | 1.00 | 1.00 |
| Low | 2 | 0 | 0 | 0.00 | N/A |

These figures describe only the four synthetic fixtures checked into this repository. They are not production-performance claims.

An unmatched label is not counted as a positive target. Low-scoring alternatives may still be retained for explanation, but a top score below the ambiguous threshold enters the unmatched queue.

## Rule safety

- Amount equals outstanding: +20.
- Currency match: +15.
- Default ambiguous threshold: 45.
- Default high-confidence threshold: 75.

Therefore equal amount and currency alone score 35 and cannot enter an actionable review queue. No score auto-approves a payment. Currency conflicts, finalized existing payments, excess amounts, and dates well before issue are recorded as conflicts. The engine does not classify mismatches as fraud.

## Rollback

Disable the payment-matching routes and accounting-payment normalization first. Revoke the three Prompt 16 service RPC grants. Retain normalized transactions, candidate explanations, review events, allocations, and audit records as read-only evidence. Only after confirming that no payment or ledger record references an allocation should the Prompt 16 tables and functions be dropped in reverse dependency order.
