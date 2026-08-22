# 06 · Failure and recovery

## Failure classes

| Class | Example | Next action |
|---|---|---|
| A · isolated/fixable | local compile error, bounded formatting defect | bounded Fixer |
| B · complex/cross-cutting | architectural mismatch, multiple criteria broken | independent A+B rework |
| C · authority/security | missing permit, policy denial, secret/path violation | fail closed / HUMAN_REQUIRED |
| D · plan conflict | implementation requires changing frozen requirement | REPLAN / explicit authority |

## Recovery invariant

A repair does not resume blindly from the gate that failed. It creates a new ArtifactIdentity, appends invalidation/supersession evidence, computes the **minimal stale verification frontier**, and reruns only the gates whose proof is no longer valid.

## A/B rework privacy

Both colonies may receive common failure codes, failed criterion IDs, safe common diagnostics, and their own previous evidence. Neither receives the peer candidate, reasoning, or peer-specific evidence before Son.
