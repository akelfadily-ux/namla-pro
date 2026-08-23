# 25 · Replay, reproducibility, and threat model

## Reproducibility classes

| Class | Examples | Claim allowed |
|---|---|---|
| `DETERMINISTIC` | hashes, schema checks, pure invariants | same inputs/policy ⇒ same result |
| `REPRODUCIBLE_ENVIRONMENT` | tests/builds in pinned toolchain/container | repeatable under captured EnvironmentIdentity |
| `PROBABILISTIC` | LLM review, heuristic semantic analysis | recorded as probabilistic assessment |
| `HUMAN_JUDGMENT` | ambiguous intent resolution | explicit HumanDecisionRecord |

Provider generation is not described as deterministic.

## Threat model

| Threat | Asset | Boundary | Mitigation | Residual risk | Detection | Recovery |
|---|---|---|---|---|---|---|
| prompt/provider injection | authority, artifacts | provider boundary | safe request, untrusted output, structured parsing | semantic manipulation | policy/assessment mismatch | reject/rework |
| secret leakage | credentials | request/env/log boundary | fail-closed secret detection, env allowlist, redaction | unknown secret shapes | containment tests/audit | stop, rotate externally, human |
| authority escalation | real effects | Trusted Kernel | EffectiveAuthority intersection + scoped permits | trusted-code defect | denied-action receipts, audit | fail closed |
| forged permit | authority | permit boundary | non-serializable/scoped validation where implemented | implementation defect | invalid-permit refusal | human |
| path traversal | filesystem | workspace boundary | canonicalization, root policy, protected names | race/platform edge cases | path-policy evidence | fail closed |
| symlink/junction race | filesystem | workspace | revalidation/exclusive primitives where available | incomplete same-user race protection | inspection/verification | human cleanup |
| malicious artifact | source/workspace | artifact mediation | bounded paths/content, verification before use | logic bomb not detected by tests | security/semantic assessment | quarantine/rework |
| dependency confusion | build integrity | package/toolchain | lock identity, no implicit install, pinned environment | upstream compromise | lock/toolchain attestation | human/rebuild |
| compromised provider | candidate integrity | provider | no authority, A/B isolation, independent verification | correlated deception | disagreement/independent tests | rework/alternate provider |
| poisoned evidence claim | correctness | Evidence Plane | Claim != Attestation/Verdict | bad assessment | provenance/type checks | rerun trusted check |
| stale evidence | correctness | Evidence DAG | immutable identities + invalidation frontier | missing dependency edge | consistency audit | conservative rerun |
| correlated A/B failure | correctness | A/B | diversity declarations + independent ProMax tests | shared blind spot | low-diversity / negative tests | critical rework/human |
| peer contamination | independence | A/B boundary | no peer candidate before Son | side-channel/shared provider risk | provenance/audit | discard/rework |
| test manipulation | correctness | verification | independent tests, policy-owned commands | incomplete test oracle | ProMax negative/property checks | rework |
| policy-version drift | correctness | GateContract | version-bind verdicts | migration error | stale policy binding | rerun frontier |
| budget exhaustion | availability | runtime | hierarchical caps | incomplete mission | budget telemetry | HUMAN_REQUIRED |
| repair livelock | availability/cost | NAMLA LOOP | oscillation policy | novel cycles | repeated signature/hash | REPLAN/HUMAN_REQUIRED |
| artifact substitution | integrity | evidence/artifact | ArtifactIdentity/hash binding | hash implementation defect | mismatch attestation | reject |
| approval replay | authority | human/permit | scope + consumption/replay policy | restart durability gaps where known | consumed/duplicate record | human |
| environment drift | validity | verification | EnvironmentIdentity | hidden dependency | environment mismatch | rerun |
| provider privilege inheritance | authority | provider process | fixed flags/env/tool restrictions where implemented | provider/tool changes | provider containment tests | disable/fail closed |
| network uncertainty | confidentiality | provider network | policy-bounded provider path, honest observability claims | not fully egress-observed today | network projection/audit | restrict provider/human |
