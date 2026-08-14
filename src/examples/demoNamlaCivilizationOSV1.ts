/**
 * demoNamlaCivilizationOSV1 — the deterministic proof that Namla is a living
 * digital civilization, not a demo collection (Build Law §27).
 *
 * It instantiates 300 persistent identities and all twenty districts, receives
 * ONE Tamara national software objective, floats competing plans that reach a
 * local quorum with minority reports, runs a voluntary labor market that forms
 * and dissolves temporary teams, activates bounded cognition through the MCP
 * nervous system with deterministic provider routing, builds artifacts, reviews
 * them independently, runs allowlisted verification, injects failures that become
 * waste + technical debt, recycles them through repair, scouts/verifies/
 * challenges/accepts/reuses national knowledge, and promotes ants on evidence —
 * all conserving, all decentralized, zero real provider/network/fs/process action.
 *
 * Every asserted number DERIVES from runtime events. `allExpectationsMet` and an
 * empty `mismatchCaseIds` are the demo's own self-check.
 *
 * No fs, no child_process, no network, no wall clock. Deterministic by seed.
 */

import { runCivilization } from "../civilization/settlementRunner";
import { buildCivilizationReport } from "../civilization/settlementReport";

const SEED = 20260904;

function scaleCheck(identities: number) {
  const run = runCivilization({ seed: SEED, persistentIdentities: identities, cycles: 12, teamSize: 12 });
  const r = buildCivilizationReport(run);
  const m = run.metrics;
  return {
    identities,
    conserved: r.digitalResourceConservationValid,
    causalityClean: r.causalityViolations === 0,
    boundedCognitive: m.peakCognitiveAnts <= 30,
    zeroCentralAssignment: m.centralTaskAssignments === 0 && m.queenTaskAssignments === 0 && m.tamaraDirectAntAssignments === 0 && m.globalPlannerDecisions === 0,
    zeroRealAction: m.realProviderCalls === 0 && m.realNetworkCalls === 0 && m.realFilesystemWrites === 0 && m.processExecutions === 0,
    boundedMcpSessions: run.mcp.sessionReceipts.length < identities * 40,
    specializationDiversity: m.specializationDiversity,
    finalObjectivePassed: m.finalObjectivePassed,
  };
}

export function runDemoNamlaCivilizationOSV1() {
  const run = runCivilization({ seed: SEED, persistentIdentities: 300, cycles: 24, teamSize: 12 });
  const report = buildCivilizationReport(run);
  const m = run.metrics;

  const specs: Array<[string, boolean]> = [
    ["totalPersistentAnts==300", m.totalPersistentAnts === 300],
    ["queenIdentities==1", m.queenIdentities === 1],
    ["workerIdentities==299", m.workerIdentities === 299],
    ["districtsCreated>=12", m.districtsCreated >= 12],
    ["tamaraObjectivesReceived==1", m.tamaraObjectivesReceived === 1],
    ["scoutProposals>=3", m.scoutProposals >= 3],
    ["quorumReached", m.quorumReached === true],
    ["minorityReports>=1", m.minorityReports >= 1],
    ["voluntaryClaims>0", m.voluntaryClaims > 0],
    ["acceptedClaims>0", m.acceptedClaims > 0],
    ["nonVolunteerAssignments==0", m.nonVolunteerAssignments === 0],
    ["temporaryTeamsFormed>0", m.temporaryTeamsFormed > 0],
    ["councilsActivated>0", m.councilsActivated > 0],
    ["mcpToolCalls>0", m.mcpToolCalls > 0],
    ["mcpToolFailures>0", m.mcpToolFailures > 0],
    ["providerCalls>0", m.providerCalls > 0],
    ["realProviderCalls==0", m.realProviderCalls === 0],
    ["artifactsCreated>0", m.artifactsCreated > 0],
    ["reviewsCompleted>0", m.reviewsCompleted > 0],
    ["verificationRuns>0", m.verificationRuns > 0],
    ["failuresDetected>=2", m.failuresDetected >= 2],
    ["repairsCompleted>0", m.repairsCompleted > 0],
    ["finalObjectivePassed", m.finalObjectivePassed === true],
    ["knowledgeAccepted>0", m.knowledgeAccepted > 0],
    ["knowledgeContradictions>0", m.knowledgeContradictions > 0],
    ["academyEvidenceUpdates>0", m.academyEvidenceUpdates > 0],
    ["skillPassportUpdates>0", m.skillPassportUpdates > 0],
    ["technicalDebtTracked>0", m.technicalDebtTracked > 0],
    ["wasteRecycled>0", m.wasteRecycled > 0],
    ["peakCognitiveAnts<=30", m.peakCognitiveAnts <= 30],
    ["tamaraDirectAntAssignments==0", m.tamaraDirectAntAssignments === 0],
    ["queenTaskAssignments==0", m.queenTaskAssignments === 0],
    ["centralTaskAssignments==0", m.centralTaskAssignments === 0],
    ["globalPlannerDecisions==0", m.globalPlannerDecisions === 0],
    ["realNetworkCalls==0", m.realNetworkCalls === 0],
    ["realFilesystemWrites==0", m.realFilesystemWrites === 0],
    ["processExecutions==0", m.processExecutions === 0],
    ["disagreementsRecorded>0", m.disagreementsRecorded > 0],
    ["peerReviewsCompleted>0", m.peerReviewsCompleted > 0],
    ["conservationValid", report.digitalResourceConservationValid === true],
    ["unexplainedResourceCreation==0", report.unexplainedResourceCreation === 0],
    ["causalityViolations==0", report.causalityViolations === 0],
    ["dangerousRegressionCount==0", m.dangerousRegressionCount === 0],
    ["receiptCrashCount==0", m.receiptCrashCount === 0],
  ];
  const mismatchCaseIds = specs.filter(([, ok]) => !ok).map(([id]) => id);

  const scaleChecks = [scaleCheck(300), scaleCheck(1000), scaleCheck(10000)];

  return {
    moduleName: "demoNamlaCivilizationOSV1",
    ...m,
    digitalResourceConservationValid: report.digitalResourceConservationValid,
    unexplainedResourceCreation: report.unexplainedResourceCreation,
    causalityViolations: report.causalityViolations,
    mcpSessions: run.mcp.sessionReceipts.length,
    knowledgeReused: run.knowledge.reused,
    expectationsChecked: specs.length,
    mismatchCaseIds,
    allExpectationsMet: mismatchCaseIds.length === 0,
    scaleChecks,
    // The safe command-center projection is built + validated by the report; it
    // is exposed for the UI but kept out of the golden digest to avoid summing
    // its counters with the top-level metrics.
    commandCenterOutcome: report.commandCenter.finalOutcome,
    commandCenterDistrictCount: report.commandCenter.districts.length,
  };
}

if (require.main === module) {
  const r = runDemoNamlaCivilizationOSV1();
  const { scaleChecks, ...summary } = r;
  console.log(JSON.stringify(summary, null, 2));
  console.log("scaleChecks:", JSON.stringify(scaleChecks));
}
