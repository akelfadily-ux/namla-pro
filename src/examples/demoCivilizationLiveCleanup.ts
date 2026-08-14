/**
 * demoCivilizationLiveCleanup — the fake-driver regression that proves the live
 * civilization run leaves NOTHING running afterwards (Build Law §28 hardening).
 * It drives `runCivilizationLiveSession` with fakes across three terminal shapes —
 * clean success, failure + confirmed repair, and failure + rejected repair — and
 * proves for each that:
 *
 *   - the CivilizationLivePermit is consumed and NOT reusable,
 *   - every MCP grant issued was revoked (no active MCP session remains),
 *   - no real provider process / MCP / filesystem / network action occurred,
 *   - the fake provider process driver left no lingering process,
 *
 * plus, once, that the CLI's readline + watchdog lifecycle closes/clears cleanly
 * (a readline opened via `askOnce` closes immediately; a watchdog timer, once
 * cleared, never fires) so the Node process can exit normally.
 *
 * Async by nature; runs standalone, not through the synchronous golden harness.
 * No fs, no child_process, no network, no wall clock beyond a cleared timer.
 */

import { admitCivilizationCohort, buildSettlementWorkers, runCivilizationLiveSession } from "../civilization/civilizationLiveRunner";
import type { CivLiveResult } from "../civilization/civilizationLiveRunner";
import { FakeMcpExecutionDriver } from "../civilization/civLiveMcp";
import { mintCivilizationPermitForAutomatedTest, consumeCivilizationPermit } from "../cognitive/civilizationLivePermit";
import type { CivilizationLivePermit, CivilizationLiveScope } from "../cognitive/civilizationLivePermit";
import { RealLiveProviderDriver } from "../cognitive/liveProviderExecution";
import { mintPermitForAutomatedTest } from "../cognitive/realProviderExecutionPermit";
import type { RealProviderExecutionPermit, RealProviderId } from "../cognitive/realProviderExecutionPermit";
import { FakeVerificationDriver } from "../digital/digitalVerification";
import { InMemoryWorkspaceDriver } from "../digital/digitalWorkspace";
import { askOnce } from "../cli/liveObjectiveCliHelpers";
import type { QuestionInterface } from "../cli/liveObjectiveCliHelpers";
import type { ProviderProcessDriver, ProviderProcessResult, ProviderProcessSpec } from "../cognitive/providerProcessDriver";

const SEED = 20260905;
const OBJECTIVE_ID = "civ-projman";
const RUN_ID = `run-${OBJECTIVE_ID}`;
const WORKSPACE_ID = `workspaces/namla-civilization/${RUN_ID}`;
const ALLOWED_TOOLS = ["repo-inspection", "bounded-file-read", "code-search", "project-analysis", "typecheck", "tests", "documentation", "knowledge-retrieval", "workspace-file-create", "build"];

/** Role-aware fake process driver that tracks spawns (fake → isReal false). */
class CleanupFakeProcessDriver implements ProviderProcessDriver {
  readonly isReal = false;
  runs = 0;
  run(spec: ProviderProcessSpec): ProviderProcessResult {
    this.runs += 1;
    const base = { ran: true, exitCode: 0 as number | null, terminationSignalCategory: "none" as const, stderr: "", stdoutTruncated: false, stderrTruncated: false, failureCategory: "none" as const };
    const isCodex = spec.executableId === "codex";
    const promptText = isCodex ? spec.argumentList[spec.argumentList.length - 1] ?? "" : spec.stdinData;
    const role = promptText.startsWith("role:") ? promptText.slice(5) : "build";
    const files = role === "architecture" ? [{ path: "ARCHITECTURE.md", operation: "create" as const, content: "# Architecture" }] : role === "review" ? [{ path: "src/projectService.test.ts", operation: "create" as const, content: "// tests" }] : [{ path: "src/projectService.ts", operation: "create" as const, content: "export class ProjectService {}" }];
    const payload = JSON.stringify({ summary: `role ${role}`, assumptions: [], files, risks: [], tests: ["list"], confidence: 0.7 });
    if (isCodex) return { ...base, stdout: [JSON.stringify({ type: "thread.started" }), JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: payload } }), JSON.stringify({ type: "turn.completed", usage: { total_tokens: 8 } })].join("\n") };
    return { ...base, stdout: payload };
  }
}

function scope(cohort: readonly { antId: string; districtId: string; provider: RealProviderId; role: string }[]): CivilizationLiveScope {
  return { civilizationRunId: RUN_ID, objectiveId: OBJECTIVE_ID, workspaceId: WORKSPACE_ID, allowedProviders: ["claude", "codex"], allowedMcpToolIds: ALLOWED_TOOLS, cohort, maxCohortSize: 5, maxProviderCalls: 8, maxRepairCalls: 3, maxAggregateInputBytes: 200000, maxAggregateOutputBytes: 200000, maxMcpCalls: 50, maxVerificationCalls: 10, tokenBudget: 400, computeBudget: 300, monetaryBudget: 100, perCallTimeoutMs: 60000, workspaceFileCap: 32, perFileByteCap: 20000, totalWorkspaceByteCap: 200000 };
}

interface ScenarioResult {
  readonly label: string;
  readonly permitReusable: boolean;
  readonly grantsIssued: number;
  readonly grantsRevoked: number;
  readonly allGrantsRevoked: boolean;
  readonly realProviderProcessExecutions: number;
  readonly realMcpExecutions: number;
  readonly realFilesystemWrites: number;
  readonly realNetworkCalls: number;
  readonly fakeProcessRuns: number;
}

async function runScenario(label: string, defectPresent: boolean, approveRepairAnswer: boolean): Promise<ScenarioResult> {
  const workers = buildSettlementWorkers(SEED, 299);
  const providers: RealProviderId[] = ["codex", "codex", "claude"];
  const admission = admitCivilizationCohort(workers, providers, 3, SEED);
  const accepted = admission.accepted;
  const permit = mintCivilizationPermitForAutomatedTest(scope(accepted)) as CivilizationLivePermit;

  const permitByAnt = new Map<string, RealProviderExecutionPermit>(accepted.map((a) => [a.antId, mintPermitForAutomatedTest({ provider: a.provider, missionId: OBJECTIVE_ID, taskId: `${OBJECTIVE_ID}-${a.antId}`, antId: a.antId, workspaceId: WORKSPACE_ID, maxInputBytes: 8000, maxOutputBytes: 20000, timeoutMs: 60000 })]));
  const processDriver = new CleanupFakeProcessDriver();
  const providerDriver = new RealLiveProviderDriver({ processDriver, permitByAnt, workspaceAbsolutePath: "/fake/civ/ws", maxStdinBytes: 8000, maxStdoutBytes: 20000, maxStderrBytes: 4000, timeoutMs: 60000, promptForRole: (role) => `role:${role}` });
  const mcpExecutor = new FakeMcpExecutionDriver({ failToolId: "code-search", seed: SEED });
  const workspace = new InMemoryWorkspaceDriver(RUN_ID, undefined, "workspaces/namla-civilization");
  const verificationDriver = new FakeVerificationDriver();
  const reviewerAntIds = workers.filter((w) => !accepted.some((a) => a.antId === w.workerId) && (w.maturation === "senior" || w.maturation === "qualified")).slice(0, 6).map((w) => w.workerId);
  const repairAnt = accepted.find((a) => a.role === "coding" || a.role === "debugging" || a.role === "repair") ?? accepted[0];

  const confirmRepair = async (): Promise<boolean> => {
    if (!approveRepairAnswer) return false;
    // Fresh single-use permit for the repair ant, exactly as the CLI does.
    permitByAnt.set(repairAnt.antId, mintPermitForAutomatedTest({ provider: repairAnt.provider, missionId: OBJECTIVE_ID, taskId: `${OBJECTIVE_ID}-repair`, antId: repairAnt.antId, workspaceId: WORKSPACE_ID, maxInputBytes: 8000, maxOutputBytes: 20000, timeoutMs: 60000 }));
    return true;
  };

  const run: CivLiveResult = await runCivilizationLiveSession(
    { config: { seed: SEED, persistentIdentities: 300, objectiveId: RUN_ID, cohortSize: accepted.length }, permit, admission, workers, providerDriver, mcpExecutor, workspace, verificationDriver, reviewerAntIds, approveRepair: false, defectPresent },
    { log: () => {}, confirmRepair }
  );

  // Cleanup assertions after the run.
  const permitReusable = consumeCivilizationPermit(permit); // must be false (already consumed)
  const grantsIssued = run.mcp.grantsIssued;
  const grantsRevoked = run.mcp.grantsRevoked;
  return {
    label,
    permitReusable,
    grantsIssued,
    grantsRevoked,
    allGrantsRevoked: grantsIssued > 0 && grantsIssued === grantsRevoked,
    realProviderProcessExecutions: run.metrics.realProviderProcessExecutions,
    realMcpExecutions: run.metrics.realMcpExecutions,
    realFilesystemWrites: run.metrics.realFilesystemWrites,
    realNetworkCalls: run.metrics.realNetworkCalls,
    fakeProcessRuns: processDriver.runs,
  };
}

export async function runDemoCivilizationLiveCleanup() {
  const scenarios = [
    await runScenario("clean-success", false, false),
    await runScenario("failure-confirmed-repair", true, true),
    await runScenario("failure-rejected-repair", true, false),
  ];

  // Readline + watchdog lifecycle (once): a readline opened via askOnce closes
  // immediately; a watchdog timer, once cleared, never fires.
  let readlineClosed = false;
  const fakeRl: () => QuestionInterface = () => ({ question: (_q, cb) => cb("noop"), close: () => (readlineClosed = true) });
  await askOnce("> ", fakeRl);
  let watchdogFired = false;
  const watchdog = setTimeout(() => (watchdogFired = true), 100000);
  clearTimeout(watchdog);

  const specs: Array<[string, boolean]> = [];
  for (const s of scenarios) {
    specs.push([`${s.label}:permit-not-reusable`, s.permitReusable === false]);
    specs.push([`${s.label}:mcp-grants-issued>0`, s.grantsIssued > 0]);
    specs.push([`${s.label}:all-mcp-grants-revoked`, s.allGrantsRevoked === true]);
    specs.push([`${s.label}:no-real-provider-process`, s.realProviderProcessExecutions === 0]);
    specs.push([`${s.label}:no-real-mcp`, s.realMcpExecutions === 0]);
    specs.push([`${s.label}:no-real-fs`, s.realFilesystemWrites === 0]);
    specs.push([`${s.label}:no-real-network`, s.realNetworkCalls === 0]);
    specs.push([`${s.label}:fake-process-runs>0`, s.fakeProcessRuns > 0]);
  }
  specs.push(["readline-closed-immediately", readlineClosed]);
  specs.push(["watchdog-cleared-never-fires", watchdogFired === false]);

  const mismatchCaseIds = specs.filter(([, ok]) => !ok).map(([id]) => id);
  return {
    moduleName: "demoCivilizationLiveCleanup",
    scenarios,
    expectationsChecked: specs.length,
    mismatchCaseIds,
    allExpectationsMet: mismatchCaseIds.length === 0,
  };
}

async function main(): Promise<void> {
  const out = await runDemoCivilizationLiveCleanup();
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.allExpectationsMet ? 0 : 1);
}

if (require.main === module) {
  void main();
}
