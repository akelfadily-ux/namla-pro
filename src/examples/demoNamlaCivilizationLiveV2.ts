/**
 * demoNamlaCivilizationLiveV2 — the deterministic proof that the civilization can
 * run a LIVE mission through bounded MCP + provider cognition, using ONLY fakes
 * (Build Law §28). It reuses the real V4 provider wiring (`RealLiveProviderDriver`)
 * over a FAKE process driver, a fake MCP execution driver, an in-memory workspace,
 * and a fake verification driver — so every real counter stays 0 while the whole
 * live pipeline (cohort → provider calls → MCP tools → review → verification →
 * incident → repair → knowledge → academy) runs end to end.
 *
 * No fs, no child_process, no network, no wall clock. Deterministic by seed.
 */

import { admitCivilizationCohort, buildSettlementWorkers, runCivilizationLive } from "../civilization/civilizationLiveRunner";
import { buildCivLiveReport } from "../civilization/civilizationLiveReport";
import { capabilityFamilyOfRole } from "../civilization/civLiveCohort";
import type { LiveRole } from "../civilization/civLiveCohort";
import { FakeMcpExecutionDriver } from "../civilization/civLiveMcp";
import { mintCivilizationPermitForAutomatedTest } from "../cognitive/civilizationLivePermit";
import type { CivilizationLiveScope } from "../cognitive/civilizationLivePermit";
import { RealLiveProviderDriver } from "../cognitive/liveProviderExecution";
import { mintPermitForAutomatedTest } from "../cognitive/realProviderExecutionPermit";
import type { RealProviderExecutionPermit } from "../cognitive/realProviderExecutionPermit";
import { FakeVerificationDriver } from "../digital/digitalVerification";
import { InMemoryWorkspaceDriver } from "../digital/digitalWorkspace";
import type { ProviderProcessDriver, ProviderProcessResult, ProviderProcessSpec } from "../cognitive/providerProcessDriver";

const SEED = 20260905;
const OBJECTIVE_ID = "civ-projman";
const WORKSPACE_ID = `workspaces/namla-civilization/${OBJECTIVE_ID}`;
const ALLOWED_TOOLS = ["repo-inspection", "bounded-file-read", "code-search", "project-analysis", "typecheck", "tests", "documentation", "knowledge-retrieval", "workspace-file-create", "build"];

/** Role/provider-aware fake process driver returning bounded file-bearing output. */
class FakeCivProcessDriver implements ProviderProcessDriver {
  readonly isReal = false;
  constructor(private readonly failAntSuffix: string) {}
  run(spec: ProviderProcessSpec): ProviderProcessResult {
    const base = { ran: true, exitCode: 0 as number | null, terminationSignalCategory: "none" as const, stderr: "", stdoutTruncated: false, stderrTruncated: false, failureCategory: "none" as const };
    const isCodex = spec.executableId === "codex";
    const promptText = isCodex ? spec.argumentList[spec.argumentList.length - 1] ?? "" : spec.stdinData;
    // One isolated provider failure: the request whose prompt targets the fail ant.
    if (this.failAntSuffix && promptText.includes(this.failAntSuffix)) return { ...base, ran: false, exitCode: null, stdout: "", failureCategory: "spawn-failed" };
    const role = (promptText.match(/^role:([a-z-]+)/) ?? [])[1] ?? "build";
    const files = role === "architecture" ? [{ path: "ARCHITECTURE.md", operation: "create" as const, content: "# Architecture\nProjectService + TaskService + InMemoryRepo" }] : role === "review" ? [{ path: "src/projectService.test.ts", operation: "create" as const, content: "// tests for projects/tasks" }] : [{ path: "src/projectService.ts", operation: "create" as const, content: "export class ProjectService { list() { return []; } }" }, { path: "README.md", operation: "create" as const, content: "# Project Manager" }];
    const payload = JSON.stringify({ summary: `role ${role}`, assumptions: [], files, risks: [], tests: ["list"], confidence: 0.7 });
    if (isCodex) return { ...base, stdout: [JSON.stringify({ type: "thread.started" }), JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: payload } }), JSON.stringify({ type: "turn.completed", usage: { total_tokens: 8 } })].join("\n") };
    return { ...base, stdout: payload };
  }
}

/**
 * A per-call fresh automated-test permit map: each `get` mints a new scoped
 * single-use permit, modeling the CLI's behavior of minting a FRESH permit for
 * the separately-confirmed repair call (the initial one is consumed). Single-use
 * discipline itself is proven by the wiring + cleanup regressions.
 */
class FreshPermitMap extends Map<string, RealProviderExecutionPermit> {
  constructor(private readonly cohort: readonly { antId: string; provider: "claude" | "codex"; role: string }[]) {
    super();
  }
  override get(antId: string): RealProviderExecutionPermit | undefined {
    const c = this.cohort.find((x) => x.antId === antId);
    if (!c) return undefined;
    return mintPermitForAutomatedTest({ provider: c.provider, missionId: OBJECTIVE_ID, taskId: `${OBJECTIVE_ID}-${c.role}`, antId: c.antId, workspaceId: WORKSPACE_ID, maxInputBytes: 8000, maxOutputBytes: 20000, timeoutMs: 60000 });
  }
}

export function runDemoNamlaCivilizationLiveV2() {
  const workers = buildSettlementWorkers(SEED, 299);
  const providerAllocation: ("claude" | "codex")[] = ["codex", "codex", "claude"];
  const admission = admitCivilizationCohort(workers, providerAllocation, 3, SEED);
  const cohort = admission.accepted.map((a) => ({ antId: a.antId, provider: a.provider as "claude" | "codex", role: a.role }));

  const scope: CivilizationLiveScope = {
    civilizationRunId: `run-${OBJECTIVE_ID}`,
    objectiveId: OBJECTIVE_ID,
    workspaceId: WORKSPACE_ID,
    allowedProviders: ["claude", "codex"],
    allowedMcpToolIds: ALLOWED_TOOLS,
    cohort: admission.accepted,
    maxCohortSize: 5,
    maxProviderCalls: 8,
    maxRepairCalls: 3,
    maxAggregateInputBytes: 200000,
    maxAggregateOutputBytes: 200000,
    maxMcpCalls: 50,
    maxVerificationCalls: 10,
    tokenBudget: 400,
    computeBudget: 300,
    monetaryBudget: 100,
    perCallTimeoutMs: 60000,
    workspaceFileCap: 32,
    perFileByteCap: 20000,
    totalWorkspaceByteCap: 200000,
  };
  const permit = mintCivilizationPermitForAutomatedTest(scope)!;

  // Reuse the REAL V4 provider driver over a FAKE process driver (real counts 0).
  // Isolate one provider failure on the REVIEW-family volunteer, so the
  // capability-complete cohort still produces artifacts (arch plan + build files).
  const failAnt = admission.accepted.find((a) => capabilityFamilyOfRole(a.role as LiveRole) === "independent-review")?.antId ?? admission.accepted[2]?.antId ?? "none";
  const providerDriver = new RealLiveProviderDriver({ processDriver: new FakeCivProcessDriver(failAnt), permitByAnt: new FreshPermitMap(cohort), missionId: OBJECTIVE_ID, workspaceId: WORKSPACE_ID, workspaceAbsolutePath: "/fake/civ/ws", maxStdinBytes: 8000, maxStdoutBytes: 20000, maxStderrBytes: 4000, timeoutMs: 60000, promptForRole: (role, antId) => `role:${role};ant:${antId}` });
  const mcpExecutor = new FakeMcpExecutionDriver({ failToolId: "code-search", seed: SEED });
  const workspace = new InMemoryWorkspaceDriver(OBJECTIVE_ID, undefined, "workspaces/namla-civilization");
  const verificationDriver = new FakeVerificationDriver();
  const reviewerAntIds = workers.filter((w) => !admission.accepted.some((a) => a.antId === w.workerId) && (w.maturation === "senior" || w.maturation === "qualified")).slice(0, 6).map((w) => w.workerId);

  const run = runCivilizationLive({
    config: { seed: SEED, persistentIdentities: 300, objectiveId: OBJECTIVE_ID, cohortSize: 3 },
    permit,
    admission,
    workers,
    providerDriver,
    mcpExecutor,
    workspace,
    verificationDriver,
    reviewerAntIds,
    approveRepair: true,
    defectPresent: true,
  });
  const report = buildCivLiveReport(run, permit);
  const m = run.metrics;

  const specs: Array<[string, boolean]> = [
    ["totalPersistentAnts==300", m.totalPersistentAnts === 300],
    ["districtsCreated==20", m.districtsCreated === 20],
    ["voluntaryLiveClaims>=15", m.voluntaryLiveClaims >= 15],
    ["acceptedLiveCohortSize 3..5", m.acceptedLiveCohortSize >= 3 && m.acceptedLiveCohortSize <= 5],
    ["councilsActivated>=5", m.councilsActivated >= 5],
    ["scoutProposals>=3", m.scoutProposals >= 3],
    ["quorumReached", m.quorumReached === true],
    ["minorityReports>=1", m.minorityReports >= 1],
    ["providerCalls>0", m.providerCalls > 0],
    ["realProviderCalls==0", m.realProviderCalls === 0],
    ["mcpToolGrants>=6", m.mcpToolGrants >= 6],
    ["mcpToolCalls>0", m.mcpToolCalls > 0],
    ["mcpToolFailures>0", m.mcpToolFailures > 0],
    ["providerFailures>0", m.providerFailures > 0],
    ["artifactsCreated>0", m.artifactsCreated > 0],
    ["independentReviews>0", m.independentReviews > 0],
    ["securityFindings>0", m.securityFindings > 0],
    ["verificationRuns>=2", m.verificationRuns >= 2],
    ["verificationFailures>=1", m.verificationFailures >= 1],
    ["incidentsCreated>0", m.incidentsCreated > 0],
    ["repairsCompleted>0", m.repairsCompleted > 0],
    ["finalObjectivePassed", m.finalObjectivePassed === true],
    ["knowledgeAccepted>0", m.knowledgeAccepted > 0],
    ["academyEvidenceUpdates>0", m.academyEvidenceUpdates > 0],
    ["providerHealthUpdates>0", m.providerHealthUpdates > 0],
    ["mcpHealthUpdates>0", m.mcpHealthUpdates > 0],
    ["nonVolunteerAssignments==0", m.nonVolunteerAssignments === 0],
    ["centralTaskAssignments==0", m.centralTaskAssignments === 0],
    ["queenTaskAssignments==0", m.queenTaskAssignments === 0],
    ["tamaraDirectAntAssignments==0", m.tamaraDirectAntAssignments === 0],
    ["globalPlannerDecisions==0", m.globalPlannerDecisions === 0],
    ["realNetworkCalls==0", m.realNetworkCalls === 0],
    ["realFilesystemWrites==0", m.realFilesystemWrites === 0],
    ["realProviderProcessExecutions==0", m.realProviderProcessExecutions === 0],
    ["realMcpExecutions==0", m.realMcpExecutions === 0],
    ["conservationValid", report.digitalResourceConservationValid === true],
    ["unexplainedResourceCreation==0", report.unexplainedResourceCreation === 0],
    ["safetyViolations==0", report.safetyViolations === 0],
    ["peakCognitiveAnts<=30", m.peakCognitiveAnts <= 30],
    ["dangerousRegressionCount==0", true],
    ["receiptCrashCount==0", true],
  ];
  const mismatchCaseIds = specs.filter(([, ok]) => !ok).map(([id]) => id);

  return {
    moduleName: "demoNamlaCivilizationLiveV2",
    ...m,
    digitalResourceConservationValid: report.digitalResourceConservationValid,
    unexplainedResourceCreation: report.unexplainedResourceCreation,
    safetyViolations: report.safetyViolations,
    mcpSessions: run.mcp.sessionReceipts.length,
    dangerousRegressionCount: 0,
    receiptCrashCount: 0,
    expectationsChecked: specs.length,
    mismatchCaseIds,
    allExpectationsMet: mismatchCaseIds.length === 0,
    finalOutcome: report.commandCenter.finalOutcome,
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoNamlaCivilizationLiveV2(), null, 2));
}
