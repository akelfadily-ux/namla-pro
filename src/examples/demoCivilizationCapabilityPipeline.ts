/**
 * demoCivilizationCapabilityPipeline — the Phase-1 regression for the repaired
 * live software-building pipeline (Sovereign Federation V3). The first real run
 * admitted a security-review/architecture/security-review cohort, produced zero
 * artifacts, and still ran verification. This proves, with fakes only:
 *
 *   A. a capability-complete cohort (architecture + implementation + independent
 *      review) forms from volunteers, build output creates artifact proposals,
 *      artifacts are reviewed before application, self-review stays 0;
 *   B. a review-only volunteer pool is REJECTED with `cohort-capability-gap`;
 *   C. file-less build output → `missing-artifact-array` → ZERO artifacts →
 *      verification BLOCKED (`no-build-artifacts` incident, not a vacuous run) →
 *      one separately confirmed repair by an implementation-capable ant produces
 *      artifacts → reviewed → applied → final verification green;
 *   D. safety-violation codes/stages/categories are visible as safe scalars;
 *   E. every real-action counter stays 0.
 *
 * Async by nature; standalone (not in the sync golden harness). No fs, no
 * child_process, no network, no wall clock.
 */

import { admitCivilizationCohort, buildSettlementWorkers, runCivilizationLiveSession } from "../civilization/civilizationLiveRunner";
import { buildCivLiveReport } from "../civilization/civilizationLiveReport";
import { admitLiveCohort, buildLiveClaimPool, capabilityFamilyOfRole, selectRepairMember, IMPLEMENTATION_ROLES } from "../civilization/civLiveCohort";
import type { LiveRole } from "../civilization/civLiveCohort";
import { FakeMcpExecutionDriver } from "../civilization/civLiveMcp";
import { mintCivilizationPermitForAutomatedTest } from "../cognitive/civilizationLivePermit";
import type { CivilizationLivePermit, CivilizationLiveScope } from "../cognitive/civilizationLivePermit";
import { RealLiveProviderDriver } from "../cognitive/liveProviderExecution";
import { mintPermitForAutomatedTest } from "../cognitive/realProviderExecutionPermit";
import type { RealProviderExecutionPermit, RealProviderId } from "../cognitive/realProviderExecutionPermit";
import { FakeVerificationDriver } from "../digital/digitalVerification";
import { InMemoryWorkspaceDriver } from "../digital/digitalWorkspace";
import type { ProviderProcessDriver, ProviderProcessResult, ProviderProcessSpec } from "../cognitive/providerProcessDriver";

const SEED = 20260905;
const OBJECTIVE_ID = "civ-projman";
const RUN_ID = `run-${OBJECTIVE_ID}`;
const WORKSPACE_ID = `workspaces/namla-civilization/${RUN_ID}`;
const ALLOWED_TOOLS = ["repo-inspection", "bounded-file-read", "code-search", "project-analysis", "typecheck", "tests", "documentation", "knowledge-retrieval", "workspace-file-create", "build"];

/** Fake process driver; `emptyBuild` makes build/repair output file-less until repair. */
class PipelineFakeProcessDriver implements ProviderProcessDriver {
  readonly isReal = false;
  runs = 0;
  constructor(private readonly opts: { emptyBuildInitial?: boolean }) {}
  run(spec: ProviderProcessSpec): ProviderProcessResult {
    this.runs += 1;
    const base = { ran: true, exitCode: 0 as number | null, terminationSignalCategory: "none" as const, stderr: "", stdoutTruncated: false, stderrTruncated: false, failureCategory: "none" as const };
    const isCodex = spec.executableId === "codex";
    const promptText = isCodex ? spec.argumentList[spec.argumentList.length - 1] ?? "" : spec.stdinData;
    const role = (promptText.match(/^role:([a-z-]+)/) ?? [])[1] ?? "build";
    const isRepair = promptText.includes("repair:yes");
    const buildFiles = [{ path: "src/projectService.ts", operation: "create" as const, content: "export class ProjectService { list() { return []; } }" }, { path: "README.md", operation: "create" as const, content: "# Project Manager" }];
    const files = role === "architecture" ? [{ path: "ARCHITECTURE.md", operation: "create" as const, content: "# Architecture" }] : role === "review" ? [] : this.opts.emptyBuildInitial && !isRepair ? [] : buildFiles;
    const payload = JSON.stringify({ summary: `role ${role}`, assumptions: [], files, risks: role === "review" ? ["review finding"] : [], tests: role === "review" ? ["list test"] : [], confidence: 0.7 });
    if (isCodex) return { ...base, stdout: [JSON.stringify({ type: "thread.started" }), JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: payload } }), JSON.stringify({ type: "turn.completed", usage: { total_tokens: 8 } })].join("\n") };
    return { ...base, stdout: payload };
  }
}

function scope(cohort: readonly { antId: string; districtId: string; provider: RealProviderId; role: string }[]): CivilizationLiveScope {
  return { civilizationRunId: RUN_ID, objectiveId: OBJECTIVE_ID, workspaceId: WORKSPACE_ID, allowedProviders: ["claude", "codex"], allowedMcpToolIds: ALLOWED_TOOLS, cohort, maxCohortSize: 5, maxProviderCalls: 8, maxRepairCalls: 3, maxAggregateInputBytes: 200000, maxAggregateOutputBytes: 200000, maxMcpCalls: 50, maxVerificationCalls: 10, tokenBudget: 400, computeBudget: 300, monetaryBudget: 100, perCallTimeoutMs: 60000, workspaceFileCap: 32, perFileByteCap: 20000, totalWorkspaceByteCap: 200000 };
}

async function runScenario(emptyBuildInitial: boolean, defectPresent: boolean) {
  const workers = buildSettlementWorkers(SEED, 299);
  const providers: RealProviderId[] = ["codex", "codex", "claude"];
  const admission = admitCivilizationCohort(workers, providers, 3, SEED);
  const accepted = admission.accepted;
  const permit = mintCivilizationPermitForAutomatedTest(scope(accepted)) as CivilizationLivePermit;
  const processDriver = new PipelineFakeProcessDriver({ emptyBuildInitial });
  // Fresh permit per call (repair permits are freshly minted by the CLI in real runs).
  const permitByAnt = { get: (antId: string): RealProviderExecutionPermit | undefined => { const c = accepted.find((x) => x.antId === antId); return c ? mintPermitForAutomatedTest({ provider: c.provider, missionId: OBJECTIVE_ID, taskId: `${OBJECTIVE_ID}-${c.antId}`, antId: c.antId, workspaceId: WORKSPACE_ID, maxInputBytes: 8000, maxOutputBytes: 20000, timeoutMs: 60000 }) : undefined; } } as ReadonlyMap<string, RealProviderExecutionPermit>;
  let repairPrompt = false;
  const providerDriver = new RealLiveProviderDriver({ processDriver, permitByAnt, missionId: OBJECTIVE_ID, workspaceId: WORKSPACE_ID, workspaceAbsolutePath: "/fake/civ/ws", maxStdinBytes: 8000, maxStdoutBytes: 20000, maxStderrBytes: 4000, timeoutMs: 60000, promptForRole: (role, antId) => `role:${role};ant:${antId}${repairPrompt ? ";repair:yes" : ""}` });
  const mcpExecutor = new FakeMcpExecutionDriver({ failToolId: "code-search", seed: SEED });
  const workspace = new InMemoryWorkspaceDriver(RUN_ID, undefined, "workspaces/namla-civilization");
  const verificationDriver = new FakeVerificationDriver();
  const reviewerAntIds = workers.filter((w) => !accepted.some((a) => a.antId === w.workerId) && (w.maturation === "senior" || w.maturation === "qualified")).slice(0, 6).map((w) => w.workerId);

  let repairAsked = 0;
  let repairReasonNoArtifacts = false;
  const stages: string[] = [];
  const run = await runCivilizationLiveSession(
    { config: { seed: SEED, persistentIdentities: 300, objectiveId: RUN_ID, cohortSize: accepted.length }, permit, admission, workers, providerDriver, mcpExecutor, workspace, verificationDriver, reviewerAntIds, approveRepair: false, defectPresent },
    {
      log: (stage, meta) => {
        stages.push(stage);
        if (stage === "repair-confirmation-requested" && meta && meta.reason === "no-build-artifacts") repairReasonNoArtifacts = true;
      },
      confirmRepair: async () => {
        repairAsked += 1;
        repairPrompt = true; // subsequent (repair) prompt carries the repair marker
        return true;
      },
    }
  );
  const report = buildCivLiveReport(run, permit);
  return { admission, run, report, repairAsked, repairReasonNoArtifacts, stages, repairMember: selectRepairMember(accepted) };
}

export async function runDemoCivilizationCapabilityPipeline() {
  // A: capability-complete happy path with a defect (verification failure → repair).
  const A = await runScenario(false, true);
  // B: review-only pool → capability gap rejection (validity, not assignment).
  const workers = buildSettlementWorkers(SEED, 299);
  const reviewOnlyPool = buildLiveClaimPool(workers, ["codex", "codex", "claude"], SEED).filter((c) => capabilityFamilyOfRole(c.role) === "independent-review");
  const B = admitLiveCohort(reviewOnlyPool, 3, ["codex", "codex", "claude"]);
  // C: file-less initial build output → blocked verification → confirmed repair.
  const C = await runScenario(true, false);

  const mA = A.run.metrics;
  const mC = C.run.metrics;
  const specs: Array<[string, boolean]> = [
    // A — coverage + artifacts + reviews.
    ["A:architecture-coverage", mA.architectureCoverage],
    ["A:implementation-coverage", mA.implementationCoverage],
    ["A:independent-review-coverage", mA.independentReviewCoverage],
    ["A:cohort-from-volunteers-only", A.admission.nonVolunteerAssignments === 0 && A.admission.accepted.every((x) => A.admission.pool.some((p) => p.antId === x.antId))],
    ["A:build-output-creates-artifacts", mA.artifactsCreated > 0],
    ["A:architecture-plan-produced", mA.architecturePlansProduced >= 1],
    ["A:review-findings-produced", mA.reviewFindingsProduced >= 1],
    ["A:reviews-before-application", mA.independentReviews >= mA.artifactsCreated && mA.artifactsCreated > 0],
    ["A:no-self-review", mA.selfReviewsAccepted === 0],
    ["A:verification-ran", mA.verificationRuns >= 2],
    ["A:one-confirmed-repair-succeeds", A.repairAsked === 1 && mA.repairCalls === 1 && mA.finalObjectivePassed],
    ["A:repair-member-build-capable", A.repairMember !== null && IMPLEMENTATION_ROLES.includes(A.repairMember.role as LiveRole)],
    // B — review-only pool rejected.
    ["B:capability-gap-detected", B.capabilityGap === true && B.accepted.length === 0],
    ["B:missing-families-reported", B.missingCapabilities.includes("architecture") && B.missingCapabilities.includes("implementation")],
    // C — empty build output → blocked verification → repaired.
    ["C:missing-artifact-array-flagged", C.run.failureCategories.includes("missing-artifact-array")],
    ["C:verification-blocked-on-empty", mC.verificationBlockedRuns >= 1],
    ["C:no-build-artifacts-incident", C.run.failureCategories.includes("no-build-artifacts") && mC.incidentsCreated >= 1],
    ["C:no-vacuous-first-verification", C.stages.filter((s) => s === "verification-started").length === 1],
    ["C:repair-reason-no-artifacts", C.repairReasonNoArtifacts === true],
    ["C:repair-confirmed-once", C.repairAsked === 1],
    ["C:repair-member-build-capable", C.repairMember !== null && IMPLEMENTATION_ROLES.includes(C.repairMember.role as LiveRole)],
    ["C:repair-created-artifacts", mC.artifactsCreated > 0],
    ["C:final-verification-green", mC.finalObjectivePassed === true],
    // D — safety violation visibility (safe scalars only).
    ["D:violation-codes-visible", Array.isArray(A.report.safetyViolationCodes) && A.report.safetyViolationCodes.length === 0],
    ["D:checks-carry-stage-and-category", A.report.safetyChecks.every((c) => c.stage.length > 0 && c.category.length > 0)],
    ["D:verification-not-vacuous-check-present", A.report.safetyChecks.some((c) => c.id === "verification-not-vacuous" && c.passed)],
    // E — zero real action everywhere.
    ["E:no-real-provider", mA.realProviderProcessExecutions === 0 && mC.realProviderProcessExecutions === 0],
    ["E:no-real-mcp", mA.realMcpExecutions === 0 && mC.realMcpExecutions === 0],
    ["E:no-real-fs-net", mA.realFilesystemWrites === 0 && mC.realFilesystemWrites === 0 && mA.realNetworkCalls === 0 && mC.realNetworkCalls === 0],
    ["E:no-central-assignment", mA.centralTaskAssignments === 0 && mA.queenTaskAssignments === 0 && mA.tamaraDirectAntAssignments === 0 && mA.globalPlannerDecisions === 0],
  ];
  const mismatchCaseIds = specs.filter(([, ok]) => !ok).map(([id]) => id);
  return {
    moduleName: "demoCivilizationCapabilityPipeline",
    scenarioA: { artifacts: mA.artifactsCreated, reviews: mA.independentReviews, plans: mA.architecturePlansProduced, findings: mA.reviewFindingsProduced, finalPassed: mA.finalObjectivePassed },
    scenarioB: { capabilityGap: B.capabilityGap, missing: B.missingCapabilities },
    scenarioC: { blockedRuns: mC.verificationBlockedRuns, categories: C.run.failureCategories, artifacts: mC.artifactsCreated, finalPassed: mC.finalObjectivePassed },
    expectationsChecked: specs.length,
    mismatchCaseIds,
    allExpectationsMet: mismatchCaseIds.length === 0,
  };
}

async function main(): Promise<void> {
  const out = await runDemoCivilizationCapabilityPipeline();
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.allExpectationsMet ? 0 : 1);
}

if (require.main === module) {
  void main();
}
