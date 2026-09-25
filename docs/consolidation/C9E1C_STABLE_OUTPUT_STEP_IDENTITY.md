# C9E1C — Stable durable output step identity

Base commit: `d008b82b641672bf393c3287549d274d95b02824`.

C9E1B stabilized canonical factory completion identity per mission/factory/
checkpoint/cursor step.

C9E1C applies the same exactly-once rule to heterogeneous factory output.

## Rule

The durable output operation key now depends only on the stable canonical
completion operation key.

It no longer depends on `outputFingerprint`.

The durable operation input fingerprint still covers the exact
`CanonicalFactoryCompletion`, including `outputFingerprint`.

Therefore two different outputs for the same canonical step target the same
durable output operation key but produce different input fingerprints. The
execution-authority ledger fails closed instead of permitting parallel durable
outputs for one canonical step.

Protocol:

`canonical.factory-output.v2`

No PostgreSQL schema or migration change is required.

The next step is C9E1D: real EER execution that writes both the v2 output and
v2 completion records under one fenced canonical EER task authority.
