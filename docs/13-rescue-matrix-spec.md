# 13 · Repository Rescue Matrix specification

The first implementation milestone classifies every significant module/file as:

`KEEP · EXTRACT · REWRITE · ARCHIVE · REMOVE`

No classification is assigned by directory name alone.

## RescueRecord

```text
path
current responsibility
imports
imported-by
runtime reachability
test ownership
security relevance
unique capability
duplication candidates
target V2 destination
migration action
replacement proof
retirement gate
```

## Retirement gate

`REMOVE` is permitted only when all required evidence exists:

- dependencies/importers resolved
- replacement exists
- behavior parity proven where required
- required tests PASS
- security regression PASS
- unique capability preserved or explicitly retired
- migration evidence recorded
- human/Build-Law authority permits the deletion operation

Pre-census labels are hypotheses, never deletion verdicts.
