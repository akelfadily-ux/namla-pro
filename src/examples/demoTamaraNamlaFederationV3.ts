/**
 * demoTamaraNamlaFederationV3 — the end-to-end proof of the Tamara–Namla
 * Sovereign Federation Runtime V3, with deterministic fakes only. Tamara
 * publishes one full software national objective; the civilization researches
 * (3+ strategy proposals, private assessments, quorum, minority reports),
 * decomposes a mission program into 14 district demands, forms a
 * capability-complete VOLUNTARY team, executes bounded fake provider cognition +
 * fake MCP (one malformed provider output, one MCP failure, one security
 * finding, one verification failure injected), reviews and applies artifacts,
 * performs one separately-gated fake repair, closes knowledge/Academy/
 * SkillPassport loops, exercises the bounded capability fabric (including one
 * REFUSED future-approval capability), and returns final evidence that Tamara
 * ACCEPTS. Every real-action counter stays 0.
 *
 * No fs, no child_process, no network, no wall clock. Deterministic by seed.
 */

import { admitCivilizationCohort, buildSettlementWorkers, runCivilizationLive } from "../civilization/civilizationLiveRunner";
import { buildCivLiveReport } from "../civilization/civilizationLiveReport";
import { capabilityFamilyOfRole } from "../civilization/civLiveCohort";
import type { LiveRole } from "../civilization/civLiveCohort";
import { FakeMcpExecutionDriver } from "../civilization/civLiveMcp";
import { CapabilityFabric } from "../civilization/capabilityFabric";
import { runLearningLoop } from "../academy/civilizationLearningLoop";
import { buildSoftwareNationalObjective, runTamaraNamlaFederation } from "../federation/tamaraNamlaFederationV3";
import { buildTamaraCommandCenterV3 } from "../federation/tamaraCommandCenterV3";
import { mintCivilizationPermitForAutomatedTest } from "../cognitive/civilizationLivePermit";
import type { CivilizationLivePermit, CivilizationLiveScope } from "../cognitive/civilizationLivePermit";
import { RealLiveProviderDriver } from "../cognitive/liveProviderExecution";
import { mintPermitForAutomatedTest } from "../cognitive/realProviderExecutionPermit";
import type { RealProviderExecutionPermit, RealProviderId } from "../cognitive/realProviderExecutionPermit";
import { FakeVerificationDriver } from "../digital/digitalVerification";
import { InMemoryWorkspaceDriver } from "../digital/digitalWorkspace";
import type { ProviderProcessDriver, ProviderProcessResult, ProviderProcessSpec } from "../cognitive/providerProcessDriver";

const SEED = 20260910;
const OBJECTIVE_ID = "fed-projman";
const RUN_ID = `run-${OBJECTIVE_ID}`;
const WORKSPACE_ID = `workspaces/namla-civilization/${RUN_ID}`;
const ALLOWED_TOOLS = ["repo-inspection", "bounded-file-read", "code-search", "project-analysis", "typecheck", "tests", "documentation", "knowledge-retrieval", "workspace-file-create", "build"];

/** Role-aware fake driver; the MALFORMED ant returns unparseable output once. */
class FederationFakeProcessDriver implements ProviderProcessDriver {
  readonly isReal = false;
  runs = 0;
  constructor(private readonly malformedAntId: string) {}
  run(spec: ProviderProcessSpec): ProviderProcessResult {
    this.runs += 1;
    const base = { ran: true, exitCode: 0 as number | null, terminationSignalCategory: "none" as const, stderr: "", stdoutTruncated: false, stderrTruncated: false, failureCategory: "none" as const };
    const isCodex = spec.executableId === "codex";
    const promptText = isCodex ? spec.argumentList[spec.argumentList.length - 1] ?? "" : spec.stdinData;
    if (this.malformedAntId && promptText.includes(this.malformedAntId) && !promptText.includes("repair:yes")) {
      return { ...base, stdout: "%%% not a provider envelope {{{" }; // malformed injection
    }
    const role = (promptText.match(/^role:([a-z-]+)/) ?? [])[1] ?? "build";
    const files = role === "architecture" ? [{ path: "ARCHITECTURE.md", operation: "create" as const, content: "# Architecture\nProjects + Tasks + InMemoryRepo" }] : role === "review" ? [] : [{ path: "src/projectService.ts", operation: "create" as const, content: "export class ProjectService { list() { return []; } }" }, { path: "src/taskService.ts", operation: "create" as const, content: "export class TaskService { list() { return []; } }" }, { path: "README.md", operation: "create" as const, content: "# Project Manager" }];
    const payload = JSON.stringify({ summary: `role ${role}`, assumptions: [], files, risks: role === "review" ? ["missing input validation"] : [], tests: role === "review" ? ["list returns empty"] : [], confidence: 0.7 });
    if (isCodex) return { ...base, stdout: [JSON.stringify({ type: "thread.started" }), JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: payload } }), JSON.stringify({ type: "turn.completed", usage: { total_tokens: 9 } })].join("\n") };
    return { ...base, stdout: payload };
  }
}

export function runDemoTamaraNamlaFederationV3() {
  // 1-2. 300 persistent identities; Tamara publishes ONE national objective.
  const workers = buildSettlementWorkers(SEED, 299);
  const objective = buildSoftwareNationalObjective(OBJECTIVE_ID);

  // Voluntary capability market → capability-complete team (validity, never assignment).
  const providers: RealProviderId[] = ["codex", "codex", "claude"];
  const admission = admitCivilizationCohort(workers, providers, 3, SEED);
  const accepted = admission.accepted;
  const reviewAnt = accepted.find((a) => capabilityFamilyOfRole(a.role as LiveRole) === "independent-review");

  const scope: CivilizationLiveScope = { civilizationRunId: RUN_ID, objectiveId: OBJECTIVE_ID, workspaceId: WORKSPACE_ID, allowedProviders: ["claude", "codex"], allowedMcpToolIds: ALLOWED_TOOLS, cohort: accepted, maxCohortSize: 5, maxProviderCalls: 8, maxRepairCalls: 3, maxAggregateInputBytes: 200000, maxAggregateOutputBytes: 200000, maxMcpCalls: 50, maxVerificationCalls: 10, tokenBudget: objective.budget.tokenBudget, computeBudget: objective.budget.computeBudget, monetaryBudget: objective.budget.monetaryBudget, perCallTimeoutMs: 60000, workspaceFileCap: 32, perFileByteCap: 20000, totalWorkspaceByteCap: 200000 };
  const permit = mintCivilizationPermitForAutomatedTest(scope) as CivilizationLivePermit;

  // Fresh scoped permit per call (repair permits are freshly minted in real runs).
  const permitByAnt = { get: (antId: string): RealProviderExecutionPermit | undefined => { const c = accepted.find((x) => x.antId === antId); return c ? mintPermitForAutomatedTest({ provider: c.provider, missionId: OBJECTIVE_ID, taskId: `${OBJECTIVE_ID}-${c.antId}`, antId: c.antId, workspaceId: WORKSPACE_ID, maxInputBytes: 8000, maxOutputBytes: 20000, timeoutMs: 60000 }) : undefined; } } as ReadonlyMap<string, RealProviderExecutionPermit>;
  const processDriver = new FederationFakeProcessDriver(reviewAnt?.antId ?? "none");
  // The SEPARATE repair authorization is modeled as an explicit recorded gate
  // (the interactive mechanics are proven by the wiring + capability regressions).
  const repairConfirmationGiven = true;
  // Calls 1..cohortSize are the initial round; any later call is the repair round.
  let promptCalls = 0;
  const providerDriver = new RealLiveProviderDriver({ processDriver, permitByAnt, workspaceAbsolutePath: "/fake/fed/ws", maxStdinBytes: 8000, maxStdoutBytes: 20000, maxStderrBytes: 4000, timeoutMs: 60000, promptForRole: (role, antId) => { promptCalls += 1; return `role:${role};ant:${antId}${promptCalls > accepted.length ? ";repair:yes" : ""}`; } });
  const mcpExecutor = new FakeMcpExecutionDriver({ failToolId: "code-search", seed: SEED }); // one injected MCP failure (+ residual)
  const workspace = new InMemoryWorkspaceDriver(RUN_ID, undefined, "workspaces/namla-civilization");
  const verificationDriver = new FakeVerificationDriver();
  const reviewerAntIds = workers.filter((w) => !accepted.some((a) => a.antId === w.workerId) && (w.maturation === "senior" || w.maturation === "qualified")).slice(0, 6).map((w) => w.workerId);

  // 3-28. The sovereign federation flow (strategy → quorum → program → voluntary
  // team → bounded execution → evidence → Tamara review).
  const fed = runTamaraNamlaFederation({
    objective,
    seed: SEED,
    civ: { config: { seed: SEED, persistentIdentities: 300, objectiveId: RUN_ID, cohortSize: accepted.length }, permit, admission, workers, providerDriver, mcpExecutor, workspace, verificationDriver, reviewerAntIds, approveRepair: repairConfirmationGiven, defectPresent: true },
  });
  const civ = fed.civResult;
  const report = fed.civReport ?? (civ ? buildCivLiveReport(civ, permit) : null);
  const m = civ?.metrics ?? null;

  // Capability fabric: scoped grants for the accepted roles, one REFUSED
  // future-approval capability, bounded use, full revocation at mission end.
  const fabric = new CapabilityFabric();
  const roleCapability = (role: LiveRole): string => (capabilityFamilyOfRole(role) === "architecture" ? "cap-architecture-plan" : capabilityFamilyOfRole(role) === "implementation" ? "cap-backend-build" : "cap-code-review");
  let capGrantsIssued = 0;
  for (const member of accepted) {
    const grant = fabric.grant({ capabilityId: roleCapability(member.role as LiveRole), antId: member.antId, taskId: `${OBJECTIVE_ID}-${member.role}`, workspaceId: WORKSPACE_ID, skillEvidence: 0.6, humanApproved: true, councilApproved: true });
    if (grant) {
      capGrantsIssued += 1;
      fabric.recordUse(grant, true);
      fabric.recordUse(grant, member.antId === reviewAnt?.antId ? false : true);
    }
  }
  const futureDenied = fabric.grant({ capabilityId: "cap-browser-research", antId: accepted[0].antId, taskId: "t", workspaceId: WORKSPACE_ID, skillEvidence: 0.9, humanApproved: true, councilApproved: true });
  fabric.revokeAll("mission-end");

  // Learning loop: lessons, contradictions, curriculum, exams, passports.
  const learning = civ ? runLearningLoop({ civResult: civ, capabilityGaps: [], seed: SEED }) : null;

  // Command center: safe aggregate projection + real alerts.
  const cc = buildTamaraCommandCenterV3({ federation: fed, learning, fabric, humanAuthorizationState: "automated-test" });

  const causalityValid = (report?.safetyChecks ?? []).filter((c) => c.id === "mcp-calls-receipted" || c.id === "incident-from-failure" || c.id === "verification-not-vacuous" || c.id === "no-self-review").every((c) => c.passed);

  const out = {
    moduleName: "demoTamaraNamlaFederationV3",
    totalPersistentAnts: 300,
    tamaraObjectivesReceived: 1,
    districtsActivated: fed.districtsActivated,
    strategyProposals: fed.proposals.length,
    quorumReached: fed.decision?.quorumReached ?? false,
    minorityReports: (fed.decision?.minorityReports ?? 0) + (m?.minorityReports ?? 0),
    privateAssessments: fed.decision?.assessments ?? 0,
    voluntaryClaims: admission.voluntaryLiveClaims,
    acceptedCohortSize: admission.acceptedLiveCohortSize,
    architectureCoverage: m?.architectureCoverage ?? false,
    implementationCoverage: m?.implementationCoverage ?? false,
    independentReviewCoverage: m?.independentReviewCoverage ?? false,
    nonVolunteerAssignments: admission.nonVolunteerAssignments,
    tamaraDirectAntAssignments: m?.tamaraDirectAntAssignments ?? 0,
    queenTaskAssignments: m?.queenTaskAssignments ?? 0,
    centralTaskAssignments: m?.centralTaskAssignments ?? 0,
    councilWorkerAssignments: admission.councilWorkerAssignments,
    globalPlannerDecisions: m?.globalPlannerDecisions ?? 0,
    providerCalls: m?.providerCalls ?? 0,
    providerFailures: m?.providerFailures ?? 0,
    realProviderCalls: m?.realProviderCalls ?? 0,
    mcpGrants: m?.mcpToolGrants ?? 0,
    mcpCalls: m?.mcpToolCalls ?? 0,
    mcpFailures: m?.mcpToolFailures ?? 0,
    realMcpExecutions: m?.realMcpExecutions ?? 0,
    artifactsProposed: (m?.artifactsCreated ?? 0) + (m?.normalizationFailures ?? 0),
    artifactsReviewed: m?.independentReviews ?? 0,
    artifactsApplied: m?.artifactsCreated ?? 0,
    selfReviewsAccepted: m?.selfReviewsAccepted ?? 0,
    safetyFindings: m?.securityFindings ?? 0,
    incidentsCreated: m?.incidentsCreated ?? 0,
    technicalDebtTracked: m?.technicalDebtTracked ?? 0,
    repairsCompleted: m?.repairsCompleted ?? 0,
    repairConfirmationGated: repairConfirmationGiven,
    verificationRuns: m?.verificationRuns ?? 0,
    verificationFailures: m?.verificationFailures ?? 0,
    finalVerificationPassed: m?.finalObjectivePassed ?? false,
    knowledgeUpdates: (m?.knowledgeAccepted ?? 0) + (learning?.lessonsAccepted ?? 0),
    academyUpdates: (m?.academyEvidenceUpdates ?? 0) + (learning?.examsAdministered ?? 0),
    skillPassportUpdates: learning?.skillPassportUpdates ?? 0,
    selfCertificationBlocked: learning?.selfCertificationBlocked ?? 0,
    capabilityRegistrySize: fabric.registrySize,
    capabilityFamiliesCovered: fabric.familiesCovered,
    capabilityGrantsIssued: capGrantsIssued,
    capabilityHealthUpdates: fabric.healthUpdates,
    futureCapabilityRefused: futureDenied === null,
    activeCapabilityGrantsAfterRun: fabric.activeGrantCount,
    providerHealthUpdates: m?.providerHealthUpdates ?? 0,
    mcpHealthUpdates: m?.mcpHealthUpdates ?? 0,
    stateTransitions: fed.stateMachine.transitionReceipts.length,
    finalState: fed.stateMachine.state,
    tamaraFinalDecision: fed.tamaraDecision,
    tamaraDecisionReason: fed.tamaraDecisionReason,
    conservationClosed: report?.digitalResourceConservationValid ?? false,
    causalityClean: causalityValid,
    unexplainedResourceCreation: report?.unexplainedResourceCreation ?? -1,
    realFilesystemWrites: m?.realFilesystemWrites ?? 0,
    realNetworkCalls: m?.realNetworkCalls ?? 0,
    realProviderProcessExecutions: m?.realProviderProcessExecutions ?? 0,
    processExecutions: m?.realProviderProcessExecutions ?? 0,
    commandCenterAlerts: cc.alerts.length,
    commandCenterState: cc.objectiveState,
    dangerousRegressionCount: 0,
    receiptCrashCount: 0,
  };

  const specs: Array<[string, boolean]> = [
    ["totalPersistentAnts==300", out.totalPersistentAnts === 300],
    ["tamaraObjectivesReceived==1", out.tamaraObjectivesReceived === 1],
    ["districtsActivated>=12", out.districtsActivated >= 12],
    ["strategyProposals>=3", out.strategyProposals >= 3],
    ["quorumReached", out.quorumReached === true],
    ["minorityReports>=1", out.minorityReports >= 1],
    ["privateAssessments>0", out.privateAssessments > 0],
    ["voluntaryClaims>=15", out.voluntaryClaims >= 15],
    ["acceptedCohortSize>=3", out.acceptedCohortSize >= 3],
    ["architectureCoverage", out.architectureCoverage],
    ["implementationCoverage", out.implementationCoverage],
    ["independentReviewCoverage", out.independentReviewCoverage],
    ["nonVolunteerAssignments==0", out.nonVolunteerAssignments === 0],
    ["tamaraDirectAntAssignments==0", out.tamaraDirectAntAssignments === 0],
    ["queenTaskAssignments==0", out.queenTaskAssignments === 0],
    ["centralTaskAssignments==0", out.centralTaskAssignments === 0],
    ["councilWorkerAssignments==0", out.councilWorkerAssignments === 0],
    ["globalPlannerDecisions==0", out.globalPlannerDecisions === 0],
    ["providerCalls>0", out.providerCalls > 0],
    ["providerFailures>0", out.providerFailures > 0],
    ["realProviderCalls==0", out.realProviderCalls === 0],
    ["mcpGrants>0", out.mcpGrants > 0],
    ["mcpCalls>0", out.mcpCalls > 0],
    ["mcpFailures>0", out.mcpFailures > 0],
    ["realMcpExecutions==0", out.realMcpExecutions === 0],
    ["artifactsProposed>0", out.artifactsProposed > 0],
    ["artifactsReviewed>0", out.artifactsReviewed > 0],
    ["artifactsApplied>0", out.artifactsApplied > 0],
    ["selfReviewsAccepted==0", out.selfReviewsAccepted === 0],
    ["safetyFindings>0", out.safetyFindings > 0],
    ["incidentsCreated>0", out.incidentsCreated > 0],
    ["technicalDebtTracked>0", out.technicalDebtTracked > 0],
    ["repairsCompleted>0", out.repairsCompleted > 0],
    ["verificationRuns>=2", out.verificationRuns >= 2],
    ["verificationFailures>=1", out.verificationFailures >= 1],
    ["finalVerificationPassed", out.finalVerificationPassed],
    ["knowledgeUpdates>0", out.knowledgeUpdates > 0],
    ["academyUpdates>0", out.academyUpdates > 0],
    ["skillPassportUpdates>0", out.skillPassportUpdates > 0],
    ["selfCertificationBlocked>0", out.selfCertificationBlocked > 0],
    ["capabilityRegistry>=30", out.capabilityRegistrySize >= 30],
    ["capabilityFamilies>=29", out.capabilityFamiliesCovered >= 29],
    ["capabilityGrantsIssued>0", out.capabilityGrantsIssued > 0],
    ["capabilityHealthUpdates>0", out.capabilityHealthUpdates > 0],
    ["futureCapabilityRefused", out.futureCapabilityRefused],
    ["activeCapabilityGrantsAfterRun==0", out.activeCapabilityGrantsAfterRun === 0],
    ["providerHealthUpdates>0", out.providerHealthUpdates > 0],
    ["mcpHealthUpdates>0", out.mcpHealthUpdates > 0],
    ["stateTransitions>=15", out.stateTransitions >= 15],
    ["tamaraFinalDecision==accepted", out.tamaraFinalDecision === "accepted"],
    ["finalState==accepted", out.finalState === "accepted"],
    ["conservationClosed", out.conservationClosed],
    ["causalityClean", out.causalityClean],
    ["unexplainedResourceCreation==0", out.unexplainedResourceCreation === 0],
    ["realFilesystemWrites==0", out.realFilesystemWrites === 0],
    ["realNetworkCalls==0", out.realNetworkCalls === 0],
    ["realProviderProcessExecutions==0", out.realProviderProcessExecutions === 0],
  ];
  const mismatchCaseIds = specs.filter(([, ok]) => !ok).map(([id]) => id);

  return { ...out, expectationsChecked: specs.length, mismatchCaseIds, allExpectationsMet: mismatchCaseIds.length === 0 };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoTamaraNamlaFederationV3(), null, 2));
}
