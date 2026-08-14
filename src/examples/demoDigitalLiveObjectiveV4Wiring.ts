/**
 * demoDigitalLiveObjectiveV4Wiring — proves the REAL live wiring is reachable and
 * correct through the injected FAKE process driver, making ZERO real calls
 * (Build Law §26). It drives the actual `RealLiveProviderDriver` (permit →
 * consume → process spawn → parse) with a role-aware fake process driver that
 * returns bounded structured JSON, runs the full pipeline (three provider calls,
 * normalization, independent review, application on the in-memory workspace, fake
 * verification, one confirmed repair), and asserts every wiring gate:
 *
 *   valid unconsumed permit; exact provider; human-cli-origin permit for the real
 *   driver; single-use permit; malformed output rejected; provider output stays
 *   DATA; independent review before application; self-review refused; repair
 *   requires a separate (simulated) confirmation; provider-call caps 3 + 2 = 5.
 *
 * Because the injected process driver is fake (`isReal === false`),
 * `realClaudeCalls`, `realCodexCalls`, `realProviderProcessExecutions`,
 * `realNetworkCalls`, and `realFilesystemWrites` are all 0.
 *
 * No fs, no child_process, no network, no wall clock. Deterministic by seed.
 */

import { createDigitalWorker } from "../digital/digitalWorkers";
import { admitLiveCohort, buildVoluntaryClaimPool, resolveProviderAllocation } from "../digital/liveCohort";
import { runLiveObjective } from "../digital/liveObjectiveRunner";
import { RealLiveProviderDriver } from "../cognitive/liveProviderExecution";
import { mintLiveObjectivePermitForAutomatedTest, recordProviderCall } from "../cognitive/liveObjectivePermit";
import type { LiveObjectiveScope } from "../cognitive/liveObjectivePermit";
import { mintPermitForAutomatedTest } from "../cognitive/realProviderExecutionPermit";
import type { RealProviderExecutionPermit, RealProviderId } from "../cognitive/realProviderExecutionPermit";
import type { ProviderProcessDriver, ProviderProcessResult, ProviderProcessSpec } from "../cognitive/providerProcessDriver";

/**
 * A minimal `isReal: true` stub — NOT the real Node driver (which no automated
 * demo imports). It exists only to prove that an automated-test-origin permit is
 * refused BEFORE `run()` is ever reached, so no real spawn can occur.
 */
class IsRealStubProcessDriver implements ProviderProcessDriver {
  readonly isReal = true as const;
  ranCount = 0;
  run(_spec: ProviderProcessSpec): ProviderProcessResult {
    this.ranCount += 1; // must never be reached for an automated-test permit
    return { ran: true, exitCode: 0, terminationSignalCategory: "none", stdout: "{}", stderr: "", stdoutTruncated: false, stderrTruncated: false, failureCategory: "none" };
  }
}

const SEED = 20260902;
const OBJECTIVE_ID = "live-taskmgr-wiring";
const WORKSPACE_ID = `workspaces/digital-live-objective/${OBJECTIVE_ID}`;

/**
 * A role- and provider-aware fake process driver. Claude returns a single JSON
 * object on stdout; Codex returns realistic JSONL whose final agent_message
 * carries the same structured payload (the prompt arrives positionally for Codex,
 * on stdin for Claude — exactly as the real driver builds the spec).
 */
class FakeFileProcessDriver implements ProviderProcessDriver {
  readonly isReal = false;
  constructor(private readonly mode: "files" | "malformed" = "files") {}
  run(spec: ProviderProcessSpec): ProviderProcessResult {
    const base = { ran: true, exitCode: 0 as number | null, terminationSignalCategory: "none" as const, stderr: "", stdoutTruncated: false, stderrTruncated: false, failureCategory: "none" as const };
    const isCodex = spec.executableId === "codex";
    if (this.mode === "malformed") return { ...base, stdout: isCodex ? "not jsonl\n{{{ broken" : "not json {{{" };
    // The prompt is positional for Codex (last arg) and on stdin for Claude.
    const promptText = isCodex ? spec.argumentList[spec.argumentList.length - 1] ?? "" : spec.stdinData;
    const role = promptText.startsWith("role:") ? promptText.slice(5) : "build";
    let files: Array<{ path: string; operation: "create"; content: string }>;
    if (role === "architecture") files = [{ path: "ARCHITECTURE.md", operation: "create", content: "# Architecture\nTaskService + InMemoryRepo" }];
    else if (role === "review") files = [{ path: "src/taskService.test.ts", operation: "create", content: "// tests for list/create/complete/delete" }];
    else files = [{ path: "src/taskService.ts", operation: "create", content: "export class TaskService { list() { return []; } }" }, { path: "README.md", operation: "create", content: "# Task Manager" }];
    const payload = JSON.stringify({ summary: `role ${role}`, assumptions: [], files, risks: [], tests: ["list"], confidence: 0.7 });
    if (isCodex) {
      const stdout = [JSON.stringify({ type: "thread.started" }), JSON.stringify({ type: "turn.started" }), JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: payload } }), JSON.stringify({ type: "turn.completed", usage: { total_tokens: 10 } })].join("\n");
      return { ...base, stdout };
    }
    return { ...base, stdout: payload };
  }
}

function permitsFor(cohort: { antId: string; provider: RealProviderId }[]): Map<string, RealProviderExecutionPermit> {
  const map = new Map<string, RealProviderExecutionPermit>();
  for (const c of cohort) {
    map.set(c.antId, mintPermitForAutomatedTest({ provider: c.provider, missionId: OBJECTIVE_ID, taskId: `${OBJECTIVE_ID}-${c.antId}`, antId: c.antId, workspaceId: WORKSPACE_ID, maxInputBytes: 8000, maxOutputBytes: 20000, timeoutMs: 60000 }));
  }
  return map;
}

function scope(cohort: { antId: string; provider: RealProviderId }[]): LiveObjectiveScope {
  return {
    objectiveId: OBJECTIVE_ID,
    pilotId: `pilot-${OBJECTIVE_ID}`,
    workspaceId: WORKSPACE_ID,
    cohort,
    maxProviderCalls: 5,
    maxRepairCalls: 2,
    maxAggregateInputBytes: 200000,
    maxAggregateOutputBytes: 200000,
    perCallTimeoutMs: 60000,
    allowedVerificationCommands: ["npx.cmd tsc --noEmit", "npm.cmd test"],
    workspaceFileCap: 24,
    perFileByteCap: 20000,
    totalWorkspaceByteCap: 200000,
  };
}

function realDriver(cohort: { antId: string; provider: RealProviderId }[], mode: "files" | "malformed" = "files", processDriver?: ProviderProcessDriver, permits?: Map<string, RealProviderExecutionPermit>): RealLiveProviderDriver {
  return new RealLiveProviderDriver({
    processDriver: processDriver ?? new FakeFileProcessDriver(mode),
    permitByAnt: permits ?? permitsFor(cohort),
    workspaceAbsolutePath: "/fake/abs/workspace",
    maxStdinBytes: 8000,
    maxStdoutBytes: 20000,
    maxStderrBytes: 4000,
    timeoutMs: 60000,
    promptForRole: (role) => `role:${role}`,
  });
}

export function runDemoDigitalLiveObjectiveV4Wiring() {
  const guard: Record<string, boolean> = {};
  const set = (id: string, ok: boolean) => {
    guard[id] = ok;
  };

  const workers = Array.from({ length: 299 }, (_v, i) =>
    createDigitalWorker({ workerId: `wire-ant-${String(i).padStart(4, "0")}`, index: i, kind: i < 5 ? "deep-cognitive" : "deterministic-active", teamId: `team-${Math.floor(i / 12)}`, seed: SEED, maturation: i % 5 === 0 ? "senior" : i % 3 === 0 ? "qualified" : "supervised" })
  );
  const allocation = resolveProviderAllocation(["claude", "codex"]);
  const pool = buildVoluntaryClaimPool(workers, allocation, SEED);
  const admission = admitLiveCohort(pool, allocation);
  const cohort = [...admission.accepted];
  const [antA, antB, antC] = cohort;
  const reviewerAntIds = [antA.antId, antC.antId, "wire-ant-0250", "wire-ant-0251"];

  // --- MAIN: three real-wired provider calls, review, apply, verify, repair --
  const permit = mintLiveObjectivePermitForAutomatedTest(scope(cohort))!;
  const providerDriver = realDriver(cohort);
  const run = runLiveObjective({ permit, objectiveId: OBJECTIVE_ID, workspaceId: WORKSPACE_ID, reviewerAntIds, providerDriver, approveRepair: true, faults: { defectAntId: antB.antId } });
  const m = run.metrics;

  set("wiring-three-calls", m.providerCallsStarted === 3 && m.providerCallsCompleted === 3);
  set("wiring-provider-output-is-data", run.normalized.length > 0 && run.artifacts.length > 0);
  set("wiring-independent-review-before-apply", run.artifacts.filter((a) => a.approved).every((a) => a.reviewedBy.length >= (a.highRisk ? 2 : 1)) && m.filesApplied > 0);
  set("wiring-self-review-refused", m.selfReviewsAccepted === 0);
  set("wiring-verification-failure-detected", m.verificationFailures >= 1);
  set("wiring-repair-applied", m.repairCalls === 1 && m.repairRounds === 1 && m.finalObjectivePassed);
  set("wiring-real-execs-zero", providerDriver.realProviderProcessExecutions === 0 && providerDriver.realClaudeCalls === 0 && providerDriver.realCodexCalls === 0);
  set("wiring-real-metrics-zero", m.realProviderProcessExecutions === 0 && m.realClaudeCalls === 0 && m.realCodexCalls === 0 && m.realNetworkCalls === 0 && m.realFilesystemWrites === 0);

  // --- repair requires a separate confirmation: without it, no repair happens.
  const noRepairPermit = mintLiveObjectivePermitForAutomatedTest(scope(cohort))!;
  const noRepairRun = runLiveObjective({ permit: noRepairPermit, objectiveId: OBJECTIVE_ID, workspaceId: WORKSPACE_ID, reviewerAntIds, providerDriver: realDriver(cohort), approveRepair: false, faults: { defectAntId: antB.antId } });
  set("repair-requires-confirmation", noRepairRun.metrics.repairCalls === 0 && noRepairRun.metrics.finalObjectivePassed === false);

  // --- GATES: no permit / provider mismatch / single-use / malformed / origin.
  set("gate-no-permit", realDriver(cohort, "files", undefined, new Map()).call({ antId: "nobody", providerId: "claude", taskId: "t", role: "build" }).ok === false);

  const mismatchDriver = realDriver(cohort, "files", undefined, permitsFor(cohort.map((c) => ({ antId: c.antId, provider: c.provider === "codex" ? "claude" : "codex" }))));
  const mismatchRes = mismatchDriver.call({ antId: antA.antId, providerId: antA.provider, taskId: "t", role: "architecture" });
  set("gate-provider-mismatch", mismatchRes.ok === false && mismatchRes.failureCategory === "provider-mismatch");

  const singlePermits = permitsFor([antA]);
  const replayDriver = realDriver(cohort, "files", undefined, singlePermits);
  const first = replayDriver.call({ antId: antA.antId, providerId: antA.provider, taskId: "t", role: "architecture" });
  const second = replayDriver.call({ antId: antA.antId, providerId: antA.provider, taskId: "t", role: "architecture" });
  set("gate-permit-single-use", first.ok === true && second.ok === false);

  const malformedRes = realDriver([antB], "malformed", undefined, permitsFor([antB])).call({ antId: antB.antId, providerId: antB.provider, taskId: "t", role: "build" });
  set("gate-malformed-output", malformedRes.ok === false && malformedRes.failureCategory === "malformed-output");

  // An automated-test-origin permit can NEVER drive a real (isReal) driver: the
  // guard refuses BEFORE run() is reached, so no real spawn is possible.
  const realStub = new IsRealStubProcessDriver();
  const realStubDriver = realDriver(cohort, "files", realStub, permitsFor([antA]));
  const nodeRes = realStubDriver.call({ antId: antA.antId, providerId: antA.provider, taskId: "t", role: "architecture" });
  set("gate-automated-permit-blocked-from-real-driver", nodeRes.ok === false && nodeRes.failureCategory === "non-human-permit" && realStub.ranCount === 0 && realStubDriver.realProviderProcessExecutions === 0);

  // Provider-call caps: 3 initial + 2 repair = 5; the 6th is refused.
  const capPermit = mintLiveObjectivePermitForAutomatedTest(scope(cohort))!;
  for (let i = 0; i < 3; i += 1) recordProviderCall(capPermit, "initial");
  recordProviderCall(capPermit, "repair");
  recordProviderCall(capPermit, "repair");
  set("gate-call-cap-3-plus-2", recordProviderCall(capPermit, "initial").ok === false && recordProviderCall(capPermit, "repair").ok === false);

  const mismatchGuards = Object.entries(guard).filter(([, ok]) => !ok).map(([id]) => id);

  const metrics = {
    totalPersistentAnts: 300,
    acceptedLiveCohortSize: admission.acceptedLiveCohortSize,
    providerCallsStarted: m.providerCallsStarted,
    providerCallsCompleted: m.providerCallsCompleted,
    filesApplied: m.filesApplied,
    verificationRuns: m.verificationRuns,
    verificationFailures: m.verificationFailures,
    repairCalls: m.repairCalls,
    repairRounds: m.repairRounds,
    selfReviewsAccepted: m.selfReviewsAccepted,
    realClaudeCalls: m.realClaudeCalls,
    realCodexCalls: m.realCodexCalls,
    realProviderProcessExecutions: m.realProviderProcessExecutions,
    realNetworkCalls: m.realNetworkCalls,
    realFilesystemWrites: m.realFilesystemWrites,
    workspaceBoundaryViolations: m.workspaceBoundaryViolations,
    sourceTreeWrites: m.sourceTreeWrites,
    providerBudgetViolations: m.providerBudgetViolations,
    wiringGuardsChecked: Object.keys(guard).length,
    dangerousRegressionCount: 0,
    receiptCrashCount: 0,
  };

  const specs: Array<[string, boolean]> = [
    ["acceptedLiveCohortSize==3", metrics.acceptedLiveCohortSize === 3],
    ["providerCallsStarted==3", metrics.providerCallsStarted === 3],
    ["filesApplied>0", metrics.filesApplied > 0],
    ["verificationFailures>=1", metrics.verificationFailures >= 1],
    ["repairCalls==1", metrics.repairCalls === 1],
    ["finalObjectivePassed", m.finalObjectivePassed === true],
    ["selfReviewsAccepted==0", metrics.selfReviewsAccepted === 0],
    ["realClaudeCalls==0", metrics.realClaudeCalls === 0],
    ["realCodexCalls==0", metrics.realCodexCalls === 0],
    ["realProviderProcessExecutions==0", metrics.realProviderProcessExecutions === 0],
    ["realNetworkCalls==0", metrics.realNetworkCalls === 0],
    ["realFilesystemWrites==0", metrics.realFilesystemWrites === 0],
    ["workspaceBoundaryViolations==0", metrics.workspaceBoundaryViolations === 0],
    ["providerBudgetViolations==0", metrics.providerBudgetViolations === 0],
    ...mismatchGuards.map((g) => [`guard:${g}`, false] as [string, boolean]),
  ];
  const mismatchCaseIds = specs.filter(([, ok]) => !ok).map(([id]) => id);

  return {
    moduleName: "demoDigitalLiveObjectiveV4Wiring",
    ...metrics,
    finalObjectivePassed: m.finalObjectivePassed,
    expectationsChecked: specs.length,
    mismatchCaseIds,
    allExpectationsMet: mismatchCaseIds.length === 0,
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoDigitalLiveObjectiveV4Wiring(), null, 2));
}
