# MCP Nervous System — Live Execution

`src/civilization/mcpNervousSystem.ts` is the settlement's shared tool-permission
and tool-call substrate (V1). V2 adds an **injectable execution driver** so the
same nervous system can either simulate a tool deterministically (V1) or route to
a bounded real executor (V2), with no change to V1 behavior.

## The seam

`callTool(...)` gained an optional trailing `executor?: McpExecutionDriver`:

```
interface McpExecutionDriver {
  readonly kind: string;
  readonly isReal: boolean;
  execute(input: McpExecutionInput): McpExecutionResult;
}
```

- **No executor** (V1) → the deterministic simulation runs exactly as before. The V1 golden is unchanged (`allExpectationsMet`, `mcpCalls: 1812`).
- **Executor present** (V2, non-provider-cognition tools) → `executor.execute(...)` decides ok/fail; `realMcpExecutions` increments **only if** `executor.isReal`.
- The provider-cognition path is never routed through an executor — provider calls go through the V4 provider driver.

New counters: `realMcpExecutions`, `toolHealthUpdateCount`, `providerHealthUpdateCount`.

## Drivers (`src/civilization/civLiveMcp.ts`)

- `FakeMcpExecutionDriver({ failToolId, seed })` — `isReal: false`. Produces one isolated tool failure plus a small residual failure rate; used by every automated test, so `realMcpExecutions` stays 0.
- `RealMcpExecutionDriver` — `isReal: true`, **human-only**. File tools (`workspace-file-create`, `documentation`) route to the authorized `writeLiveObjectiveFile` workspace boundary; verification tools (`typecheck`/`tests`/`build`) route to the single authorized `runVerificationCommand` (`shell:false`, allowlisted). All other tools return a validated no-side-effect result.

The real driver is never constructed during verification; the fake driver keeps
all `real*` counters at 0.
