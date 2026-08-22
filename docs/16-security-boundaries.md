# 16 · Security boundaries — current capital to preserve

The exact Rescue Census will verify every path and test owner. Current high-value examples include:

| Current boundary/capital | Representative current path | Target |
|---|---|---|
| outbound provider request safety | `src/cognitive/safeProviderRequest.ts` | Provider Boundary |
| real provider mediation | `src/cognitive/liveProviderExecution.ts`, provider drivers | Provider/Process Boundary |
| container/sandbox verification | `src/cognitive/containerSandboxBackend.ts` and related diagnostics/probes | Verification Sandbox |
| network policy | `src/cognitive/networkPolicy.ts` | Network Policy |
| environment secret bootstrap/redaction | `src/cognitive/environmentSecretBootstrap.ts` + redaction primitives | Secret Boundary |
| workspace/path safety | cognitive workspace/path primitives | Workspace Boundary |
| permits/live authority | cognitive permit modules | Authority/Permit System |
| approval/write boundaries | `src/application/*` | Filesystem Authority |
| receipts | `src/core/receiptLog.ts`, receipt semantics | Audit/Evidence |
| runtime guard | `src/core/safetyGuard.ts` | Hard Security Policy input |

Rule: security code and the tests that prove it migrate together. Security-critical behavior is refactored only with explicit parity/security evidence.
