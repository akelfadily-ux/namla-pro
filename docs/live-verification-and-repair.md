# Live Verification and Repair

## Allowlisted verification

V3 verification (Build Law §25) allows only hard-coded commands: `npx.cmd tsc
--noEmit`, and — only when the generated package declares them — `npm.cmd test`,
`npm.cmd run build`, and (only when declared and explicitly approved) `npm.cmd run
lint`. Rules: executable + args hard-coded, `shell: false`, cwd exactly the
objective workspace, no `npm install`, no package download, no mission text turned
into arguments, bounded output, timeout, environment filtering, no Git, no retry
loop. The human authorization screen lists the exact commands before execution.
Automated tests use the deterministic fake verification driver (no spawn).

## Repair phase

If real verification fails, the pipeline creates structured failure evidence,
`errorWaste`, `technicalDebt`, and a repair demand caused by the failure. Ants
voluntarily claim the repair. The human must SEPARATELY approve each additional
real repair provider call; at most 2 repair provider calls and at most 2 repair
rounds; no automatic provider retry. A repair proposal is linked to the exact
failure, independently reviewed, workspace-scoped, applied, and re-verified. The
demo shows one detected defect → one approved repair → final verification green,
with `repairCalls: 1`, `repairRounds: 1`, and the failure recycled into reusable
knowledge (`wasteRecycled > 0`).
