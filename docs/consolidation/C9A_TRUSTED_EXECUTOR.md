# C9A — Canonical trusted ToolGateway executor

Base commit: `c07c4aab15c250fb6471ee53db530739cd69fe04`.

C9A supplies the concrete trusted execution boundary that C6 deliberately left
unwired. The scope is intentionally narrow and fail-closed.

## Authority sequence

For a supported filesystem effect the boundary requires:

1. a C6 Productization operation claim at epoch 1;
2. a current PostgreSQL task lease and exact operation claim token/epoch;
3. the pinned canonical recovery snapshot at `PRO`;
4. the original frozen PlanContract restored against its independent pin;
5. TrustedKernel capability authorization under that contract;
6. one virtual tick durably reserved by recovery-checkpoint CAS;
7. a second current PostgreSQL claim-fence check immediately before the effect;
8. the filesystem effect itself through TrustedKernel only.

A claim loss after budget reservation leaves the conservative tick consumed and
performs no filesystem mutation.

## Deliberate exclusions

C9A does not authorize shell, Git, Docker, network or provider operations.
There is no adapter.execute fallback and no direct node:fs or child_process
effect in the executor.

The executor is restricted to canonical `PRO` authority scopes. Other canonical
factories require their own explicit effect contracts.

## Kernel hardening

The existing `CapabilityScope.readOnly` direction is corrected:

- a read request may be satisfied by either a read-only or read-write grant;
- a write request may only be satisfied by a read-write grant.

This is a tightening for writes and enables ordinary reads under an RW scope.

## Remaining canonical work

C9A does not itself create the durable canonical orchestrator and does not fill
the six shell-only canonical factory implementations. Those remain subsequent
canonical-runtime work.
