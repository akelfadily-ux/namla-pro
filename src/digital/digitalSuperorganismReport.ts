/**
 * digitalSuperorganismReport — aggregates a digital run into reported metrics AND
 * validates the two runtime invariants that separate a real causal economy from
 * a counter demo (Build Law §23, the digital analogue of the biology report):
 *
 *   1. CONSERVATION — for every digital resource,
 *      quantity == initial + collected + created - consumed - expired - quarantined,
 *      and tool-access capacity closes (available + held == initial). A demo that
 *      fabricates knowledge, artifacts, budget, or tool access fails this
 *      (`unexplainedResourceCreation` > 0).
 *
 *   2. CAUSALITY — every reported outcome is backed by an event chain in the
 *      transformation ledger: no verified knowledge without a raw-information
 *      input, no artifact without knowledge + compute + tokens + context, no
 *      repaired failure without a failure, no promotion without evidence, no
 *      provider call, and no action by a retired worker after it retired.
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import { roundTo } from "../colony/colonyTypes";
import type { DigitalRunResult } from "./digitalSuperorganismRunner";

export interface DigitalCausalCheck {
  readonly id: string;
  readonly description: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface DigitalReport {
  // conservation
  readonly digitalResourceConservationValid: boolean;
  readonly unexplainedResourceCreation: number;
  readonly toolAccessClosed: boolean;
  readonly resourceChecks: readonly { resource: string; quantity: number; reconstructed: number; closed: boolean }[];

  // metabolism flow (ledger-sourced)
  readonly rawInformationCollected: number;
  readonly verifiedKnowledgeCreated: number;
  readonly workingContextConsumed: number;
  readonly computeConsumed: number;
  readonly tokenBudgetConsumed: number;
  readonly monetaryBudgetConsumed: number;
  readonly reusableComponentsCreated: number;
  readonly testEvidenceCreated: number;
  readonly errorWasteCreated: number;
  readonly technicalDebtTracked: number;
  readonly staleKnowledgeCreated: number;
  readonly securityRiskIntroduced: number;
  readonly securityRiskQuarantined: number;

  // tools / oxygen
  readonly toolAccessGrants: number;
  readonly toolAccessReleases: number;
  readonly toolAccessDenials: number;
  readonly toolAccessHeldAtEnd: number;

  // work + immunity + maturation (event counts)
  readonly voluntaryTaskClaims: number;
  readonly activeWorkingHands: number;
  readonly peakCognitiveWorkers: number;
  readonly artifactsCreated: number;
  readonly reviewsCompleted: number;
  readonly testsExecuted: number;
  readonly failuresGenerated: number;
  readonly wasteRecycled: number;
  readonly knowledgeReused: number;
  readonly digitalTrophallaxisEvents: number;
  readonly bandwidthConsumed: number;
  readonly providerCalls: 0;
  readonly threatsIntroduced: number;
  readonly securityThreatsDetected: number;
  readonly quarantinedArtifacts: number;
  readonly remediationActions: number;
  readonly transmissionEdges: number;
  readonly broodTrained: number;
  readonly promotions: number;
  readonly retirements: number;
  readonly reserveActivations: number;
  readonly quorumReached: boolean;
  readonly taskFlexibilityObserved: number;
  readonly maturationTaskCorrelation: number;

  // decentralization guarantees
  readonly centralTaskAssignments: 0;
  readonly queenTaskAssignments: 0;
  readonly tamaraDirectAntAssignments: 0;
  readonly globalPlannerDecisions: 0;

  readonly finalObjectivePassed: boolean;

  // causality
  readonly causalChecks: readonly DigitalCausalCheck[];
  readonly causalityViolations: number;
}

export function buildDigitalReport(run: DigitalRunResult): DigitalReport {
  const { economy, metrics: m, config } = run;
  const conservation = economy.validate();
  const log = economy.transformationLog;

  const consumedOf = (r: Parameters<typeof economy.totals>[0]) => roundTo(economy.totals(r).consumed, 6);
  const createdOf = (r: Parameters<typeof economy.totals>[0]) => roundTo(economy.totals(r).created, 6);

  // ---- CAUSAL CHECKS (each would fail for a counter-only demo) -------------
  const checks: DigitalCausalCheck[] = [];
  const add = (id: string, description: string, passed: boolean, detail: string) => checks.push({ id, description, passed, detail });

  const verifyReceipts = log.filter((r) => r.kind === "verify" && r.outputs.some((o) => o.resource === "verifiedKnowledge"));
  const knowledgeHasSource = verifyReceipts.every((r) => r.inputs.some((i) => i.resource === "rawInformation"));
  add("knowledge-has-source", "verified knowledge only from raw-information + verification", knowledgeHasSource, `verifyReceipts=${verifyReceipts.length}`);

  const buildReceipts = log.filter((r) => r.kind === "build" && r.outputs.some((o) => o.resource === "reusableComponents"));
  const artifactHasInputs = buildReceipts.every(
    (r) => r.inputs.some((i) => i.resource === "verifiedKnowledge") && r.inputs.some((i) => i.resource === "computeCapacity") && r.inputs.some((i) => i.resource === "tokenBudget") && r.inputs.some((i) => i.resource === "workingContext")
  );
  add("artifact-has-inputs", "artifacts require knowledge + compute + tokens + context", artifactHasInputs, `buildReceipts=${buildReceipts.length}`);

  add("repaired-has-failure", "waste can only be recycled if failures occurred", m.wasteRecycled === 0 || m.failuresGenerated > 0, `recycled=${m.wasteRecycled}, failures=${m.failuresGenerated}`);
  add("promotion-has-evidence", "no promotion without accumulated evidence", m.promotionWithoutEvidence === 0, `promotionWithoutEvidence=${m.promotionWithoutEvidence}`);
  add("no-provider-calls", "deterministic run makes zero real provider calls", m.providerCalls === 0, `providerCalls=${m.providerCalls}`);

  const retiredIds = new Set(run.workers.filter((w) => !w.active).map((w) => w.workerId));
  const actionAfterRetire = config.workforceLossCycle > 0 ? log.filter((r) => retiredIds.has(r.workerId) && r.tick > config.workforceLossCycle).length : 0;
  add("no-action-after-retire", "retired workers take no action after retirement", actionAfterRetire === 0, `violations=${actionAfterRetire}`);

  add("bounded-cognitive", "deep-cognitive concurrency never exceeds the global cap of 30", m.peakCognitiveWorkers <= 30, `peakCognitive=${m.peakCognitiveWorkers}`);
  add("bounded-tool-access", "tool permits are all released (held==0) and capacity closes", economy.toolAccessHeld === 0 && conservation.toolAccessClosed, `held=${economy.toolAccessHeld}`);
  add("decentralized", "no central/queen/tamara-direct/global-planner assignment", m.centralTaskAssignments === 0 && m.queenTaskAssignments === 0 && m.tamaraDirectAntAssignments === 0 && m.globalPlannerDecisions === 0, "all zero");
  add("conservation-closed", "every resource ledger reconstructs exactly", conservation.allClosed, `unexplained=${conservation.unexplainedResourceCreation}`);
  add("trophallaxis-bounded", "knowledge sharing produced real bounded transfers", (m.digitalTrophallaxisEvents > 0) === (m.bandwidthConsumed > 0), `events=${m.digitalTrophallaxisEvents}, bandwidth=${m.bandwidthConsumed}`);

  const causalityViolations = checks.filter((c) => !c.passed).length;

  return {
    digitalResourceConservationValid: conservation.allClosed,
    unexplainedResourceCreation: conservation.unexplainedResourceCreation,
    toolAccessClosed: conservation.toolAccessClosed,
    resourceChecks: conservation.checks.map((c) => ({ resource: c.resource, quantity: c.quantity, reconstructed: c.reconstructed, closed: c.closed })),

    rawInformationCollected: roundTo(economy.totals("rawInformation").collected, 6),
    verifiedKnowledgeCreated: createdOf("verifiedKnowledge"),
    workingContextConsumed: consumedOf("workingContext"),
    computeConsumed: consumedOf("computeCapacity"),
    tokenBudgetConsumed: consumedOf("tokenBudget"),
    monetaryBudgetConsumed: consumedOf("monetaryBudget"),
    reusableComponentsCreated: createdOf("reusableComponents"),
    testEvidenceCreated: createdOf("testEvidence"),
    errorWasteCreated: createdOf("errorWaste"),
    technicalDebtTracked: createdOf("technicalDebt"),
    staleKnowledgeCreated: createdOf("staleKnowledge"),
    securityRiskIntroduced: roundTo(economy.totals("securityRisk").collected, 6),
    securityRiskQuarantined: roundTo(economy.totals("securityRisk").quarantined, 6),

    toolAccessGrants: economy.toolAccessGrants,
    toolAccessReleases: economy.toolAccessReleases,
    toolAccessDenials: economy.toolAccessDenials,
    toolAccessHeldAtEnd: economy.toolAccessHeld,

    voluntaryTaskClaims: m.voluntaryTaskClaims,
    activeWorkingHands: m.activeWorkingHands,
    peakCognitiveWorkers: m.peakCognitiveWorkers,
    artifactsCreated: m.artifactsCreated,
    reviewsCompleted: m.reviewsCompleted,
    testsExecuted: m.testsExecuted,
    failuresGenerated: m.failuresGenerated,
    wasteRecycled: m.wasteRecycled,
    knowledgeReused: m.knowledgeReused,
    digitalTrophallaxisEvents: m.digitalTrophallaxisEvents,
    bandwidthConsumed: m.bandwidthConsumed,
    providerCalls: 0,
    threatsIntroduced: m.threatsIntroduced,
    securityThreatsDetected: m.securityThreatsDetected,
    quarantinedArtifacts: m.quarantinedArtifacts,
    remediationActions: m.remediationActions,
    transmissionEdges: m.transmissionEdges,
    broodTrained: m.broodTrained,
    promotions: m.promotions,
    retirements: m.retirements,
    reserveActivations: m.reserveActivations,
    quorumReached: m.quorumReached,
    taskFlexibilityObserved: m.taskFlexibilityObserved,
    maturationTaskCorrelation: m.maturationTaskCorrelation,

    centralTaskAssignments: 0,
    queenTaskAssignments: 0,
    tamaraDirectAntAssignments: 0,
    globalPlannerDecisions: 0,

    finalObjectivePassed: m.finalObjectivePassed,

    causalChecks: checks,
    causalityViolations,
  };
}
