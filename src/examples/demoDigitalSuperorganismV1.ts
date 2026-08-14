/**
 * demoDigitalSuperorganismV1 — the canonical deterministic proof that Digital
 * Superorganism Metabolism V1 is a real causal economy, not a counter demo
 * (Build Law §23).
 *
 * It runs a bounded high-tech project with 300 persistent identities and
 * deterministic workers only (zero real provider calls): a strategic objective
 * is published, scouts collect raw information, it is verified into knowledge, a
 * quorum selects a plan, workers voluntarily claim tasks, a bounded set gets tool
 * access, builders produce artifacts, reviewers and testers produce evidence,
 * failures become structured waste, repair recycles it, threats are quarantined,
 * knowledge is shared by bounded trophallaxis, and brood workers mature on
 * evidence. It then re-verifies conservation + causality at 300 / 1,000 / 10,000
 * identities.
 *
 * Every asserted number below DERIVES from simulation events and ledger
 * differences — none is hard-coded. `allExpectationsMet` and an empty
 * `mismatchCaseIds` are the demo's own self-check.
 *
 * No fs, no child_process, no network, no wall clock. Deterministic by seed.
 */

import { runDigitalSuperorganism } from "../digital/digitalSuperorganismRunner";
import { buildDigitalReport } from "../digital/digitalSuperorganismReport";
import type { DigitalReport } from "../digital/digitalSuperorganismReport";
import { summarizeDigitalFidelity } from "../digital/digitalFidelityMatrix";

const DEMO_SEED = 20260721;

interface ExpectationSpec {
  readonly id: string;
  readonly ok: boolean;
}

function evaluateExpectations(r: DigitalReport): { expectationsChecked: number; mismatchCaseIds: string[]; allExpectationsMet: boolean } {
  const specs: ExpectationSpec[] = [
    { id: "rawInformationCollected>0", ok: r.rawInformationCollected > 0 },
    { id: "verifiedKnowledgeCreated>0", ok: r.verifiedKnowledgeCreated > 0 },
    { id: "workingContextConsumed>0", ok: r.workingContextConsumed > 0 },
    { id: "computeConsumed>0", ok: r.computeConsumed > 0 },
    { id: "tokenBudgetConsumed>0", ok: r.tokenBudgetConsumed > 0 },
    { id: "toolAccessGrants>0", ok: r.toolAccessGrants > 0 },
    { id: "voluntaryTaskClaims>0", ok: r.voluntaryTaskClaims > 0 },
    { id: "activeWorkingHands>0", ok: r.activeWorkingHands > 0 },
    { id: "peakCognitiveWorkers<=30", ok: r.peakCognitiveWorkers <= 30 },
    { id: "artifactsCreated>0", ok: r.artifactsCreated > 0 },
    { id: "reviewsCompleted>0", ok: r.reviewsCompleted > 0 },
    { id: "testsExecuted>0", ok: r.testsExecuted > 0 },
    { id: "failuresGenerated>0", ok: r.failuresGenerated > 0 },
    { id: "errorWasteCreated>0", ok: r.errorWasteCreated > 0 },
    { id: "wasteRecycled>0", ok: r.wasteRecycled > 0 },
    { id: "technicalDebtTracked>0", ok: r.technicalDebtTracked > 0 },
    { id: "knowledgeReused>0", ok: r.knowledgeReused > 0 },
    { id: "digitalTrophallaxisEvents>0", ok: r.digitalTrophallaxisEvents > 0 },
    { id: "bandwidthConsumed>0", ok: r.bandwidthConsumed > 0 },
    { id: "providerCalls==0", ok: r.providerCalls === 0 },
    { id: "securityThreatsDetected>0", ok: r.securityThreatsDetected > 0 },
    { id: "quarantinedArtifacts>0", ok: r.quarantinedArtifacts > 0 },
    { id: "remediationActions>0", ok: r.remediationActions > 0 },
    { id: "broodTrained>0", ok: r.broodTrained > 0 },
    { id: "promotions>0", ok: r.promotions > 0 },
    { id: "reserveActivations>0", ok: r.reserveActivations > 0 },
    { id: "transmissionEdges>0", ok: r.transmissionEdges > 0 },
    { id: "quorumReached==true", ok: r.quorumReached === true },
    { id: "finalObjectivePassed==true", ok: r.finalObjectivePassed === true },
    { id: "centralTaskAssignments==0", ok: r.centralTaskAssignments === 0 },
    { id: "queenTaskAssignments==0", ok: r.queenTaskAssignments === 0 },
    { id: "tamaraDirectAntAssignments==0", ok: r.tamaraDirectAntAssignments === 0 },
    { id: "globalPlannerDecisions==0", ok: r.globalPlannerDecisions === 0 },
    { id: "digitalResourceConservationValid==true", ok: r.digitalResourceConservationValid === true },
    { id: "unexplainedResourceCreation==0", ok: r.unexplainedResourceCreation === 0 },
    { id: "causalityViolations==0", ok: r.causalityViolations === 0 },
  ];
  const mismatchCaseIds = specs.filter((s) => !s.ok).map((s) => s.id);
  return { expectationsChecked: specs.length, mismatchCaseIds, allExpectationsMet: mismatchCaseIds.length === 0 };
}

/** A bounded conservation/causality re-check at one identity scale. */
function scaleCheck(identities: number) {
  const run = runDigitalSuperorganism({ seed: DEMO_SEED, persistentIdentities: identities, cycles: 10, teamSize: 12, threatIntroCycle: 4, workforceLossCycle: 8, workforceLossFraction: 0.1 });
  const r = buildDigitalReport(run);
  return {
    identities,
    conserved: r.digitalResourceConservationValid,
    causalityClean: r.causalityViolations === 0,
    boundedCognitive: r.peakCognitiveWorkers <= 30,
    objectivePassed: r.finalObjectivePassed,
    providerCalls: r.providerCalls,
  };
}

export function runDemoDigitalSuperorganismV1() {
  const run = runDigitalSuperorganism({
    seed: DEMO_SEED,
    persistentIdentities: 300,
    cycles: 30,
    teamSize: 12,
    threatIntroCycle: 8,
    workforceLossCycle: 18,
    workforceLossFraction: 0.15,
  });
  const report = buildDigitalReport(run);
  const expectations = evaluateExpectations(report);
  const fidelity = summarizeDigitalFidelity();
  const scaleChecks = [scaleCheck(300), scaleCheck(1000), scaleCheck(10000)];

  return {
    moduleName: "demoDigitalSuperorganismV1",
    ...report,
    persistentIdentities: run.config.persistentIdentities,
    expectationsChecked: expectations.expectationsChecked,
    mismatchCaseIds: expectations.mismatchCaseIds,
    allExpectationsMet: expectations.allExpectationsMet,
    scaleChecks,
    fidelityTotal: fidelity.total,
    fidelityFullyMechanistic: fidelity.fullyMechanistic,
    fidelityPartiallyMechanistic: fidelity.partiallyMechanistic,
    fidelityPostponed: fidelity.postponed,
  };
}

if (require.main === module) {
  const result = runDemoDigitalSuperorganismV1();
  // Trim the verbose per-check arrays for console readability.
  const { causalChecks, resourceChecks, ...summary } = result;
  void causalChecks;
  void resourceChecks;
  console.log(JSON.stringify(summary, null, 2));
}
