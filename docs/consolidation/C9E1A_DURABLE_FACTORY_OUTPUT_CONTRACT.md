# C9E1A — Durable canonical factory-output contract

Base commit: `1c38cb6cd2b00d1c67425cf82b0c54f132b42381`.

C9D proved durable canonical completion/proof verification and real PostgreSQL
restart/replay. The next missing runtime capability is durable heterogeneous
factory output: PLAN cannot consume EER unless the exact EER result survives
restart independently of in-memory objects.

C9E1A defines that output contract before adding a writer.

## Model

Completion and output are separate durable operation records.

- `canonical.factory-completion.v2` remains the C9D/C9B authority token.
- `canonical.factory-output.v2` stores the heterogeneous factory output.
- The output operation key is deterministic from the canonical completion step identity and does not vary with output content.
- The output operation is bound to the same canonical factory task id and
  authority scope.
- Its operation input fingerprint is computed from the exact completion.
- The durable output is accepted only when its domain-separated SHA-256 equals
  `completion.outputFingerprint`.

No new PostgreSQL table or migration is required; the existing fenced operation
ledger remains authoritative.

C9E1B will use this contract to execute the real EER factory, persist its output
and completion, and return only a completion that C9D can independently verify.
