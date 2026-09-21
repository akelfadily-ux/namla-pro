# C4 - Productization operation input identity

## Scope and disposition

- Input checkpoint: `308c901533058e9f96bc8ecf17976c90326e6502` (C3).
- Input tree: `1741bbccad38a609793b9adb1fc87d87fc55ca6d`.
- Donor commit: `44977cf5e6816388a0838d50e4f7eaea0b133224`.
- Donor path: `src/application/operation-fingerprint.ts`.
- Donor blob: `7d85c9128c9e6f5016fb3a0722c6654b904bfdbc`.
- Decision: ADAPTED_TO_EXISTING_V2_CODEC; not an exact donor copy.
- Canonical dependency: `src/v2/kernel/operationIdentity.ts`.
- Canonical dependency blob: `c9496894b37227b921e6bb6e95651971fa1c66d7`.
- Reviewed future caller: `src/application/tool-gateway.ts`, donor blob
  `c160168c72964cf46f9571786d88bd496f4065aa`. That caller is NOT imported by C4.

## Why the donor implementation is not copied verbatim

The donor sorts ordinary object keys and computes a SHA-256 digest, but the
serialization is not type-preserving over all accepted inputs. For example:

- `1n` and `{ "$type": "bigint", "value": "1" }` have the same representation.
- A Date and an empty plain object both reduce to an empty object.
- `0` and `-0` both become the same JSON number.
- A cyclic array bypasses the active-object check on the array code path.
- Accessors execute during ordinary property reads; symbols, non-enumerable
  properties and several exotic object types can be omitted rather than refused.
- Assigning an own `__proto__` key into a normal output object can lose that field.

These are input-encoding ambiguities, NOT attacks on SHA-256 itself. The retained
V2 codec already provides tagged values and a hash envelope. C4 reuses it rather
than introducing another canonical serializer or changing stored V2 identities.

## Version 2 mapping

`fingerprintOperation({runId, taskId, toolName, value})` keeps the donor call shape.
After input admission and detached capture, it calls `fingerprintOperationIdentity`:

```text
missionId       = runId
authorityScope  = taskId
operationType   = "productization.tool-input.v2"
value           = ["NAMLA_PRODUCTIZATION_TOOL_INPUT", 2, toolName, capturedValue]
```

This is a DATA namespace. Mapping taskId into the codec's authorityScope string
neither proves nor grants an effective runtime authority scope. The gateway and
kernel must independently validate authentic authority, operation ownership,
freshness, input binding, and completion evidence before admitting an effect.

The exported `canonicalize(value, seen?)` also delegates to the V2 codec. It now
returns the parsed tagged JSON value, NOT the donor-v1 object shape. Its optional
active WeakSet is preserved on return or failure, not used as an identity cache.

## Admission boundary

Accepted values: null, booleans, strings, finite numbers, bigint, exact ordinary
Date instances, Uint8Array or Buffer byte content, dense ordinary arrays, and
plain/null-prototype objects with only enumerable own data fields. Byte identity
intentionally treats Buffer and Uint8Array containing the same bytes as equal,
consistent with V2. No Unicode normalization or trimming of identity values occurs.

Proxies, accessor fields, symbols, hidden/extra array fields, sparse arrays,
unsupported object prototypes, invalid/decorated dates, shared/detached byte
storage, cycles, and unsupported primitives are refused with a fixed
ConfigurationError that does not echo caller values or nested exceptions.

The wrapper caps depth at 48, visits at 10,000 nodes, aggregate text/key/bigint
content at 1,048,576 UTF-16 code units, and byte content at 65,536 bytes. These
admission limits do not sandbox arbitrary code or undo allocations made by callers.
The module assumes trusted built-in prototypes and an uncompromised Node realm.
The existing V2 codec and its own bounds remain unchanged.

## Compatibility and recovery gate

Version-2 hashes are NOT donor-v1 hashes. Existing V2 hashes are untouched.
C4 reads or writes no operation records and does not perform a data migration.

Before wiring any persistence or ToolGateway consumer, explicitly pin the
fingerprint algorithm/version for that data set. An existing unversioned or
legacy identity requires a reviewed migration or must remain blocked. Never
silently rehash a stored operation, retry under a new operation ID to evade a
mismatch, or fall back to the old ambiguous hash when deciding whether to replay.
Equal hashes alone do not prove execution, completion, freshness or authorization.

## Verification scope

`productizationOperationFingerprintTests.ts` adds 40 focused checks, including
known vectors, canonical-codec delegation, donor collision regressions, strict
input admission, input preservation, quota boundaries and non-authority behavior.
A fixed vector additionally guards the retained V2 fingerprint format.

The apply script runs typecheck, build, the focused suite and the full existing P0
runner. It verifies 80 existing C1-C3 tests, the 22 existing V2 identity tests and
298 Recovery tests without skips, as well as the unchanged suite inventory.
Actual results belong to the newly produced C4 receipt, not this source document.
No live PostgreSQL, ToolGateway execution, crash replay, scheduler or factory
integration is tested or claimed by C4. Branch closure and main promotion remain
separate human-reviewed steps.
