# C9E1B — Stable canonical factory-step completion identity

Base commit: `5b5286b92902e3485260c38a3391cf6b317c309e`.

Before adding the first real canonical factory writer, C9E1B hardens the
completion identity so a canonical step cannot mint multiple completion keys
merely because its output changed.

## Stable exactly-once identity

The canonical completion operation key is now derived only from:

- missionId
- factoryId
- checkpointVersion
- cursorStepVersion

The output fingerprint is deliberately NOT part of the operation key.

The durable operation input fingerprint still covers the complete
`CanonicalFactoryCompletion`, including `outputFingerprint`.

Therefore two different outputs for the same canonical step collide on the same
durable operation key but produce different operation-input fingerprints. The
execution-authority ledger then fails closed with an input/binding mismatch
instead of allowing a second completion identity.

## Protocol version

The completion operation protocol is bumped from:

`canonical.factory-completion.v1`

to:

`canonical.factory-completion.v2`

No PostgreSQL table or migration changes are required.

The real PostgreSQL restart/replay test is compiled against this new identity
and must pass again remotely before C9E1C writes real EER results.
