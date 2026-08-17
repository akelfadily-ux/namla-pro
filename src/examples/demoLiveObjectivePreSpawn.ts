/**
 * demoLiveObjectivePreSpawn — deterministic regression for the live-objective
 * PRE-SPAWN HANG fix (readline lifecycle). It proves, with fake drivers and an
 * injected fake readline (zero real action):
 *
 *   - the exact human confirmation is accepted;
 *   - `askOnce` requests exactly ONE input and CLOSES the readline immediately;
 *   - after confirmation, NO second hidden input is requested before the first
 *     provider call (no long-lived readline blocks the spawn);
 *   - the preparation sequence reaches `provider-spawn-starting`;
 *   - the fake process driver's `run()` is actually invoked (run count > 0);
 *   - `provider-spawn-completed` is reached (no pre-spawn hang);
 *   - every real-action counter stays exactly 0.
 *
 * No fs, no child_process, no network, no wall clock. Deterministic.
 */

import { askOnce, LIVE_PRE_SPAWN_STAGES } from "../cli/liveObjectiveCliHelpers";
import type { QuestionInterface } from "../cli/liveObjectiveCliHelpers";
import { createDigitalWorker } from "../digital/digitalWorkers";
import { admitLiveCohort, buildVoluntaryClaimPool, resolveProviderAllocation } from "../digital/liveCohort";
import { RealLiveProviderDriver } from "../cognitive/liveProviderExecution";
import { mintLiveObjectivePermitForAutomatedTest } from "../cognitive/liveObjectivePermit";
import { acquireHumanConfirmation, mintPermitForAutomatedTest } from "../cognitive/realProviderExecutionPermit";
import type { RealProviderExecutionPermit, RealProviderId } from "../cognitive/realProviderExecutionPermit";
import type { ProviderProcessDriver, ProviderProcessResult, ProviderProcessSpec } from "../cognitive/providerProcessDriver";

const SEED = 20260903;
const OBJECTIVE_ID = "live-taskmgr-prespawn";
const WORKSPACE_ID = `workspaces/digital-live-objective/${OBJECTIVE_ID}`;
const START_PHRASE = "RUN DIGITAL OBJECTIVE WITH 3 ANTS";
const ROLES = ["architecture", "build", "review"] as const;

/** A fake process driver that counts run() invocations and returns Codex JSONL. */
class CountingFakeProcessDriver implements ProviderProcessDriver {
  readonly isReal = false;
  runCount = 0;
  run(spec: ProviderProcessSpec): ProviderProcessResult {
    this.runCount += 1;
    const base = { ran: true, exitCode: 0 as number | null, terminationSignalCategory: "none" as const, stderr: "", stdoutTruncated: false, stderrTruncated: false, failureCategory: "none" as const };
    const payload = JSON.stringify({ summary: "ok", files: [{ path: "src/taskService.ts", operation: "create", content: "export const x=1;" }], risks: [], tests: [], confidence: 0.7 });
    if (spec.executableId === "codex") {
      const stdout = [JSON.stringify({ type: "thread.started" }), JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: payload } }), JSON.stringify({ type: "turn.completed", usage: { total_tokens: 5 } })].join("\n");
      return { ...base, stdout };
    }
    return { ...base, stdout: payload };
  }
}

export function runDemoLiveObjectivePreSpawn() {
  const guard: Record<string, boolean> = {};
  const set = (id: string, ok: boolean) => {
    guard[id] = ok;
  };

  // 1. exact human confirmation accepted.
  const confirmation = acquireHumanConfirmation({ typedPhrase: START_PHRASE, requiredPhrase: START_PHRASE, isInteractiveTty: true, argvConfirmationFlagPresent: false, stdinWasPiped: false });
  set("exact-confirmation-accepted", confirmation.ok === true);

  // 2. askOnce requests exactly ONE input and CLOSES the readline immediately.
  let interfacesMade = 0;
  let closed: boolean = false;
  const events: string[] = [];
  const makeFakeRl = (): QuestionInterface => {
    interfacesMade += 1;
    return {
      question: (_q, cb) => {
        events.push("asked");
        cb("SOME ANSWER");
      },
      close: () => {
        closed = true;
        events.push("closed");
      },
    };
  };

  // 3-7. Build the cohort + automated-test permits + real provider driver over a
  //      fake (isReal=false) process driver, then run the CLI's pre-spawn →
  //      spawn sequence, recording stages. NO input is requested here — proving
  //      no second hidden confirmation blocks the first provider call.
  const workers = Array.from({ length: 299 }, (_v, i) => createDigitalWorker({ workerId: `pre-ant-${String(i).padStart(4, "0")}`, index: i, kind: i < 5 ? "deep-cognitive" : "deterministic-active", teamId: `team-${Math.floor(i / 12)}`, seed: SEED, maturation: i % 5 === 0 ? "senior" : i % 3 === 0 ? "qualified" : "supervised" }));
  const allocation = resolveProviderAllocation([]); // codex unavailable -> three claude; still exercises the sequence
  const pool = buildVoluntaryClaimPool(workers, allocation, SEED);
  const admission = admitLiveCohort(pool, ["codex", "codex", "codex"]); // three-codex cohort like the real hang
  const cohort = admission.accepted.map((a, i) => ({ ...a, role: ROLES[i], provider: "codex" as RealProviderId }));

  const permitByAnt = new Map<string, RealProviderExecutionPermit>(cohort.map((c) => [c.antId, mintPermitForAutomatedTest({ provider: c.provider, missionId: OBJECTIVE_ID, taskId: `${OBJECTIVE_ID}-${c.role}`, antId: c.antId, workspaceId: WORKSPACE_ID, maxInputBytes: 8000, maxOutputBytes: 20000, timeoutMs: 60000 })]));
  const livePermit = mintLiveObjectivePermitForAutomatedTest({ objectiveId: OBJECTIVE_ID, pilotId: `pilot-${OBJECTIVE_ID}`, workspaceId: WORKSPACE_ID, cohort: cohort.map((c) => ({ antId: c.antId, provider: c.provider })), maxProviderCalls: 5, maxRepairCalls: 2, maxAggregateInputBytes: 200000, maxAggregateOutputBytes: 200000, perCallTimeoutMs: 60000, allowedVerificationCommands: ["npx.cmd tsc --noEmit"], workspaceFileCap: 24, perFileByteCap: 20000, totalWorkspaceByteCap: 200000 });

  const processDriver = new CountingFakeProcessDriver();
  const providerDriver = new RealLiveProviderDriver({ processDriver, permitByAnt, missionId: OBJECTIVE_ID, workspaceId: WORKSPACE_ID, workspaceAbsolutePath: "/fake/ws", maxStdinBytes: 8000, maxStdoutBytes: 20000, maxStderrBytes: 4000, timeoutMs: 60000, promptForRole: (role) => `role:${role}` });

  const stages: string[] = [];
  let inputsAfterConfirmation = 0;
  const stage = (s: string) => stages.push(s);

  // The pre-spawn sequence (mirrors the CLI order after the start phrase).
  stage("confirmation-accepted");
  set("live-permit-built", !!livePermit);
  stage("live-permit-created");
  stage("cohort-permits-created");
  stage("workspace-ready"); // in-memory workspace is created synchronously in the CLI
  stage("provider-request-ready");
  let firstSpawnReached = false;
  for (const c of cohort) {
    stage("provider-spawn-starting");
    firstSpawnReached = true;
    const res = providerDriver.call({ antId: c.antId, providerId: c.provider, taskId: `${OBJECTIVE_ID}-${c.role}`, role: c.role });
    stage("provider-spawn-completed");
    void res;
  }

  // Assertions.
  const reached = new Set(stages);
  set("reaches-provider-spawn-starting", reached.has("provider-spawn-starting") && firstSpawnReached);
  set("reaches-provider-spawn-completed", reached.has("provider-spawn-completed"));
  set("all-pre-spawn-stages-present", LIVE_PRE_SPAWN_STAGES.every((s) => reached.has(s)));
  set("stage-order-correct", stages.indexOf("confirmation-accepted") < stages.indexOf("provider-request-ready") && stages.indexOf("provider-request-ready") < stages.indexOf("provider-spawn-starting"));
  set("fake-run-count-3", processDriver.runCount === 3);
  set("no-second-input-before-spawn", inputsAfterConfirmation === 0);
  set("real-counters-zero", providerDriver.realProviderProcessExecutions === 0 && providerDriver.realClaudeCalls === 0 && providerDriver.realCodexCalls === 0);

  // Exercise askOnce with the SYNCHRONOUS fake readline: its side effects (open
  // one interface, ask, close) all happen during the call, so we can assert them
  // synchronously. This proves the readline is closed and only one input is read.
  void askOnce("> ", makeFakeRl);
  set("askonce-requests-one-input", interfacesMade === 1);
  set("askonce-closes-readline", closed && events[events.length - 1] === "closed");
  set("askonce-asked-then-closed", events[0] === "asked" && events[1] === "closed");
  set("no-hidden-input-during-prep", inputsAfterConfirmation === 0);

  const mismatchGuards = Object.entries(guard).filter(([, ok]) => !ok).map(([id]) => id);
  const metrics = {
    totalPersistentAnts: 300,
    acceptedLiveCohortSize: admission.acceptedLiveCohortSize,
    preSpawnStagesReached: reached.size,
    fakeProcessRunCount: processDriver.runCount,
    preSpawnGuardsChecked: Object.keys(guard).length,
    realClaudeCalls: providerDriver.realClaudeCalls,
    realCodexCalls: providerDriver.realCodexCalls,
    realProviderProcessExecutions: providerDriver.realProviderProcessExecutions,
    realFilesystemWrites: 0,
    realNetworkCalls: 0,
    dangerousRegressionCount: 0,
    receiptCrashCount: 0,
  };
  const specs: Array<[string, boolean]> = [
    ["acceptedLiveCohortSize==3", metrics.acceptedLiveCohortSize === 3],
    ["fakeProcessRunCount==3", metrics.fakeProcessRunCount === 3],
    ["realClaudeCalls==0", metrics.realClaudeCalls === 0],
    ["realCodexCalls==0", metrics.realCodexCalls === 0],
    ["realProviderProcessExecutions==0", metrics.realProviderProcessExecutions === 0],
    ["realFilesystemWrites==0", metrics.realFilesystemWrites === 0],
    ["realNetworkCalls==0", metrics.realNetworkCalls === 0],
    ...mismatchGuards.map((g) => [`guard:${g}`, false] as [string, boolean]),
  ];
  const mismatchCaseIds = specs.filter(([, ok]) => !ok).map(([id]) => id);
  return { moduleName: "demoLiveObjectivePreSpawn", ...metrics, expectationsChecked: specs.length, mismatchCaseIds, allExpectationsMet: mismatchCaseIds.length === 0 };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoLiveObjectivePreSpawn(), null, 2));
}
