# Receipt Status Model (AH2 Step 4G)

What each `ReceiptStatus` value means, canonically. The machine-readable
registry is
[`src/core/receiptStatusSemantics.ts`](../src/core/receiptStatusSemantics.ts)
(typed over the full union, so coverage is compiler-enforced); this
document is its prose. A receipt's **status** describes the operation's
lifecycle outcome; the **reason codes and structured details** describe
the concrete event. Never encode the event in the status or the lifecycle
in the reason code.

## The five statuses

| Status | Category | Terminal | Meaning |
|---|---|---|---|
| `approved` | admission | no | A request, plan, or gate was accepted — admitted for present or future work. **Not** completion. Use for: mission accepted, task assigned, run started, plan ordered. Never for: a finished operation. |
| `completed` | success | yes | The modeled operation or bookkeeping process finished. Use for: inspection done, proposal created, exchange finished, narration produced, step processed. Never for: mere acceptance. |
| `refused` | policy-rejection | yes | Rejected **before** the requested operation was admitted or processed — the gate said no at the door. Use for: mission/read/proposal/exchange/plan requests rejected by a gate, invariant check, or deny list. Never for: stopping an admitted flow. |
| `blocked` | boundary-stop | yes | An **admitted**, planned, or active flow could not continue — safety rule, dependency, budget, or runtime boundary. Use for: planned task caught by the safety gate, budget halt, no eligible ant, dependency block. Never for: pre-admission rejection. |
| `failed` | internal-error | yes | An internal error or invalid state. **Structurally modeled; no current runtime path emits it** (errors throw instead of receipting). Never a synonym for policy refusal. |

## The two distinctions that matter most

**refused vs blocked** is the admission boundary: if the thing never got
in, it was refused; if it got in and then could not continue, it was
blocked. Example pair: a mission whose text fails the gate is `refused`
(nothing was admitted); a generated task whose text fails the planning
gate is `blocked` (the plan had admitted it).

**approved vs completed** is the lifecycle: `approved` opens work,
`completed` closes it. A run's start receipt is `approved`; its end
receipt is `completed`.

## Documented ambiguous-but-acceptable sites (left unchanged)

- `ProposalQueue.enqueue` success uses `completed`: the receipt records
  the enqueue *operation*, which finished; the proposal's own pending
  state lives in `ProposalStatus`, not in the receipt.
- `demoSafetyBlock`'s illustrative receipt uses `blocked` with
  SafetyGuard's own "blocked at level FORBIDDEN" vocabulary — a Phase 0
  teaching artifact, noted rather than churned.
- `ProposalReviewer`'s refused verdict receipts use `refused` even though
  checks ran: the reviewer refuses to *certify*, which is a policy
  rejection of the request for certification.

## Related boundaries

Receipt identity is instance-scoped per Step 4F (each `ReceiptLog` owns
its sequence; linked ids require a shared log). `AntFacadeTrace` has its
own `status` vocabulary (completed/refused/skipped) and is **not** part of
this model — traces are not receipts.
