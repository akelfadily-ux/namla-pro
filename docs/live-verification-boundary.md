# Live Verification Boundary

Real verification (Build Law §26) runs inside the ONE `child_process` module.

## The single boundary

`nodeProviderProcessDriver.ts` gains `runVerificationCommand`, which spawns a
fixed verification executable from a hard-coded map — `npx.cmd tsc --noEmit`,
`npm.cmd test`, `npm.cmd run build`, `npm.cmd run lint` — with `shell:false`, cwd
exactly the objective workspace, a timeout, bounded output, the same environment
allowlist (credential-shaped names dropped), no `npm install`, no package
download, no Git, no argument built from provider/mission text, and no retry.
`child_process` is still imported in exactly one module.

## The driver

`RealBackedVerificationDriver` (`src/cognitive/liveRealDrivers.ts`) implements the
runner's `VerificationDriver` contract, refuses any command not in the
human-approved allowlist, maps the process exit code to pass/fail, and exposes a
real-execution count. The CLI displays the exact commands before running them.

## Automated tests

Automated verification uses the deterministic `FakeVerificationDriver` (no spawn);
its `VerificationOutcome.realProcessExecutions` is 0. The real driver reports 1
per real spawn — but it is invoked only by the human CLI, never in a demo/test, so
automated real-verification executions stay 0.
