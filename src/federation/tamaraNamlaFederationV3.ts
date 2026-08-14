/**
 * Tamara–Namla Sovereign Federation Runtime V3 — the control plane connecting
 * Tamara (strategic sovereign) to the Namla digital civilization (autonomous,
 * voluntary, evidence-governed execution). It EXTENDS the V1 objective contract
 * (`tamaraObjective.ts`) — it does not replace it.
 *
 * Tamara MAY: publish national objectives, define policy/budgets/acceptance
 * criteria, rank strategy proposals AFTER quorum, pause, reduce budgets, request
 * evidence, and accept or reject the FINAL EVIDENCE. Tamara may NOT: choose a
 * named ant, assign work, bypass voluntary claims/councils/verification, read
 * private minds, mint provider permits, execute MCP, or write files — the V1
 * `TamaraAuthorityRecord` makes those powers unrepresentable and this runtime
 * never calls a worker-selection API with a Tamara-chosen identity.
 *
 * Every state transition is receipted; there is NO silent transition. The
 * execution segment REUSES the civilization live pipeline (capability-complete
 * voluntary cohorts, role contracts, artifact-gated verification, confirmed
 * repair) — this module adds sovereignty, strategy, and evidence, not a second
 * execution engine.
 *
 * No fs, no child_process, no network, no wall clock. Deterministic by seed.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import type { TamaraObjective, TamaraAuthorityRecord } from "./tamaraObjective";
import { createTamaraAuthorityRecord, tamaraHoldsNoWorkerAuthority, validateTamaraObjective } from "./tamaraObjective";
import type { ObjectiveValidationCode } from "./tamaraObjective";
import { DISTRICTS, civDraw } from "../civilization/settlementTypes";
import type { DistrictId } from "../civilization/settlementTypes";
import { createDistricts, publishDistrictDemand } from "../civilization/settlementDistricts";
import type { District } from "../civilization/settlementDistricts";
import { conveneCouncil } from "../civilization/councilsGovernance";
import type { CouncilSession } from "../civilization/councilsGovernance";
import type { DigitalWorker } from "../digital/digitalWorkers";
import { runCivilizationLive } from "../civilization/civilizationLiveRunner";
import type { CivLiveResult, CivLiveRunInput } from "../civilization/civilizationLiveRunner";
import { buildCivLiveReport } from "../civilization/civilizationLiveReport";
import type { CivLiveReport } from "../civilization/civilizationLiveReport";

// --- V3 national objective contract (extends the V1 strategic contract) ------

export type FilesystemPolicy = "isolated-run-workspace-only";
export type VerificationPolicy = readonly ("typecheck" | "test" | "build" | "lint")[];
export type SecurityClassification = "public" | "internal" | "sensitive";

export interface TamaraPolicyEnvelope {
  readonly providerPolicy: readonly ("claude" | "codex")[];
  readonly mcpCapabilityPolicy: readonly string[];
  readonly filesystemPolicy: FilesystemPolicy;
  readonly verificationPolicy: VerificationPolicy;
  readonly securityClassification: SecurityClassification;
  readonly reversibilityRequired: boolean;
  readonly humanApprovalRequired: boolean;
}

export interface TamaraBudgetEnvelope {
  readonly tokenBudget: number;
  readonly computeBudget: number;
  readonly monetaryBudget: number;
  readonly timeBudgetTicks: number;
}

export interface TamaraAcceptanceContract {
  readonly criteria: readonly string[];
  /** How many verification commands must be green for acceptance. */
  readonly minVerificationRuns: number;
  readonly requireIndependentReview: true;
  readonly requireConservationClosed: true;
  readonly failureTolerance: number;
  readonly stopConditions: readonly string[];
}

export interface TamaraNationalObjective extends TamaraObjective {
  readonly rationale: string;
  readonly policy: TamaraPolicyEnvelope;
  readonly budget: TamaraBudgetEnvelope;
  readonly acceptance: TamaraAcceptanceContract;
}

// --- federation state machine (no silent transitions) ------------------------

export const FEDERATION_STATES = [
  "objective-received",
  "objective-validated",
  "strategy-market-open",
  "strategy-quorum-reached",
  "mission-program-created",
  "capability-market-open",
  "teams-formed",
  "execution-authorized",
  "artifacts-proposed",
  "artifacts-under-review",
  "artifacts-approved",
  "artifacts-applied",
  "verification-running",
  "repair-required",
  "repair-authorized",
  "evidence-complete",
  "tamara-review",
  "accepted",
  "rejected",
  "safely-aborted",
] as const;
export type FederationState = (typeof FEDERATION_STATES)[number];

const ALLOWED_TRANSITIONS: Readonly<Record<FederationState, readonly FederationState[]>> = {
  "objective-received": ["objective-validated", "safely-aborted"],
  "objective-validated": ["strategy-market-open", "safely-aborted"],
  "strategy-market-open": ["strategy-quorum-reached", "safely-aborted"],
  "strategy-quorum-reached": ["mission-program-created", "safely-aborted"],
  "mission-program-created": ["capability-market-open", "safely-aborted"],
  "capability-market-open": ["teams-formed", "safely-aborted"],
  "teams-formed": ["execution-authorized", "safely-aborted"],
  "execution-authorized": ["artifacts-proposed", "safely-aborted"],
  "artifacts-proposed": ["artifacts-under-review", "safely-aborted"],
  "artifacts-under-review": ["artifacts-approved", "safely-aborted"],
  "artifacts-approved": ["artifacts-applied", "safely-aborted"],
  "artifacts-applied": ["verification-running", "safely-aborted"],
  "verification-running": ["repair-required", "evidence-complete", "safely-aborted"],
  "repair-required": ["repair-authorized", "evidence-complete", "safely-aborted"],
  "repair-authorized": ["verification-running", "evidence-complete", "safely-aborted"],
  "evidence-complete": ["tamara-review", "safely-aborted"],
  "tamara-review": ["accepted", "rejected", "safely-aborted"],
  accepted: [],
  rejected: [],
  "safely-aborted": [],
};

export interface FederationTransitionReceipt {
  readonly seq: number;
  readonly from: FederationState;
  readonly to: FederationState;
  readonly note: string;
}

/** The receipted state holder — every change goes through `transition`. */
export class FederationStateMachine {
  private current: FederationState = "objective-received";
  private readonly receipts: FederationTransitionReceipt[] = [];
  get state(): FederationState {
    return this.current;
  }
  get transitionReceipts(): readonly FederationTransitionReceipt[] {
    return this.receipts;
  }
  transition(to: FederationState, note: string): boolean {
    if (!ALLOWED_TRANSITIONS[this.current].includes(to)) return false;
    this.receipts.push({ seq: this.receipts.length + 1, from: this.current, to, note });
    this.current = to;
    return true;
  }
}

// --- strategy market ---------------------------------------------------------

export interface FederationStrategyProposal {
  readonly proposalId: string;
  readonly scoutAntId: string;
  readonly approach: string;
  readonly estimatedCost: number;
  readonly risk: number;
  readonly coverageScore: number;
}

export interface FederationDecision {
  readonly chosenProposalId: string;
  readonly quorumReached: boolean;
  readonly minorityReports: number;
  readonly assessments: number;
}

/** Research scouts produce >=3 COMPETING strategy proposals (volunteer scouts, never named by Tamara). */
export function openStrategyMarket(objective: TamaraNationalObjective, workers: readonly DigitalWorker[], seed: number): FederationStrategyProposal[] {
  const scouts = workers.filter((w) => w.active && civDraw(seed, w.index, 13, 0x51ed270b) > 0.6).slice(0, 5);
  const approaches = ["layered-service-architecture", "modular-repository-pattern", "test-first-incremental", "domain-model-centric", "thin-vertical-slices"];
  const proposals: FederationStrategyProposal[] = [];
  for (let i = 0; i < Math.max(3, scouts.length); i += 1) {
    const scout = scouts[i % Math.max(1, scouts.length)];
    proposals.push({
      proposalId: `strategy-${objective.objectiveId}-${i}`,
      scoutAntId: scout?.workerId ?? `scout-${i}`,
      approach: approaches[i % approaches.length],
      estimatedCost: roundTo(objective.budget.computeBudget * (0.5 + civDraw(seed, i, 17, 0x2545f491) * 0.4), 4),
      risk: roundTo(civDraw(seed, i, 19, 0x63d83595) * 0.5, 4),
      coverageScore: roundTo(0.6 + civDraw(seed, i, 23, 0x27220a95) * 0.4, 4),
    });
  }
  return proposals;
}

/** Quorum over proposals: councils assess privately; only aggregates leave the room. */
export function decideStrategy(proposals: readonly FederationStrategyProposal[], workers: readonly DigitalWorker[], seed: number): { decision: FederationDecision; council: CouncilSession } {
  const council = conveneCouncil("architecture", workers, new Set(), proposals.length, seed, 1);
  const ranked = [...proposals].sort((a, b) => b.coverageScore - a.risk * 0.5 - (a.coverageScore - b.risk * 0.5));
  return {
    decision: { chosenProposalId: ranked[0]?.proposalId ?? "none", quorumReached: council.quorumReached, minorityReports: council.minorityReports.length, assessments: council.assessments.length },
    council,
  };
}

// --- mission program ---------------------------------------------------------

/** Districts a software national objective activates with bounded demand (>=12). */
export const SOFTWARE_PROGRAM_DISTRICTS: readonly DistrictId[] = ["research", "architecture-council", "software-engineering", "frontend-guild", "backend-guild", "database-guild", "testing-quality", "debugging-repair", "defensive-security", "devops-infrastructure", "knowledge-memory", "tool-mcp", "provider-compute", "operations-command"];

export interface FederationMissionProgram {
  readonly programId: string;
  readonly objectiveId: string;
  readonly chosenProposalId: string;
  readonly districtDemands: number;
  readonly districtsActivated: number;
}

// --- final evidence + Tamara review ------------------------------------------

export interface FederationFinalEvidence {
  readonly objectiveId: string;
  readonly finalObjectivePassed: boolean;
  readonly artifactsCreated: number;
  readonly independentReviews: number;
  readonly verificationRuns: number;
  readonly verificationFailures: number;
  readonly incidentsCreated: number;
  readonly repairsCompleted: number;
  readonly safetyViolations: number;
  readonly conservationValid: boolean;
  readonly failureCategories: readonly string[];
}

export type TamaraFinalDecision = "accepted" | "rejected";

/**
 * Tamara reviews EVIDENCE, never process internals: acceptance requires green
 * final verification, at least one reviewed artifact, closed conservation, zero
 * safety violations, and failure count within her declared tolerance.
 */
export function tamaraReviewEvidence(objective: TamaraNationalObjective, evidence: FederationFinalEvidence): { decision: TamaraFinalDecision; reason: string } {
  if (!evidence.finalObjectivePassed) return { decision: "rejected", reason: "final-verification-not-green" };
  if (evidence.artifactsCreated === 0) return { decision: "rejected", reason: "no-artifacts" };
  if (evidence.independentReviews === 0) return { decision: "rejected", reason: "no-independent-review" };
  if (evidence.verificationRuns < objective.acceptance.minVerificationRuns) return { decision: "rejected", reason: "insufficient-verification" };
  if (!evidence.conservationValid) return { decision: "rejected", reason: "conservation-open" };
  if (evidence.safetyViolations > 0) return { decision: "rejected", reason: "safety-violations" };
  if (evidence.incidentsCreated - evidence.repairsCompleted > objective.acceptance.failureTolerance) return { decision: "rejected", reason: "failure-tolerance-exceeded" };
  return { decision: "accepted", reason: "evidence-satisfies-acceptance-contract" };
}

// --- the sovereign federation flow -------------------------------------------

export interface FederationRunInput {
  /** The already-assembled civilization live run input (drivers injected by the caller — fakes in tests). */
  readonly civ: CivLiveRunInput;
  readonly objective: TamaraNationalObjective;
  readonly seed: number;
}

export interface FederationRunResult {
  readonly ok: boolean;
  readonly abortReason?: string;
  readonly authority: TamaraAuthorityRecord;
  readonly validation: ObjectiveValidationCode;
  readonly stateMachine: FederationStateMachine;
  readonly proposals: readonly FederationStrategyProposal[];
  readonly decision: FederationDecision | null;
  readonly strategyCouncil: CouncilSession | null;
  readonly program: FederationMissionProgram | null;
  readonly civResult: CivLiveResult | null;
  readonly civReport: CivLiveReport | null;
  readonly evidence: FederationFinalEvidence | null;
  readonly tamaraDecision: TamaraFinalDecision | "not-reviewed";
  readonly tamaraDecisionReason: string;
  readonly districtsActivated: number;
  readonly districtDemands: number;
  /** The national program demand board (safe aggregate district state). */
  readonly programDistricts: Record<DistrictId, District>;
}

/**
 * Tamara objective → validation → strategy market (>=3 proposals) → quorum with
 * minority reports → mission program (>=12 district demands) → voluntary
 * capability market → capability-complete team → bounded execution (the reused
 * civilization pipeline) → evidence → Tamara acceptance/rejection. Every
 * transition is receipted; Tamara never touches a worker identity.
 */
export function runTamaraNamlaFederation(input: FederationRunInput): FederationRunResult {
  const { objective, seed } = input;
  const authority = createTamaraAuthorityRecord();
  const fsm = new FederationStateMachine();
  const programDistricts = createDistricts();
  const base = { authority, stateMachine: fsm, proposals: [] as FederationStrategyProposal[], decision: null, strategyCouncil: null, program: null, civResult: null, civReport: null, evidence: null, tamaraDecision: "not-reviewed" as const, tamaraDecisionReason: "", districtsActivated: 0, districtDemands: 0, programDistricts };

  // Sovereignty invariant re-checked at runtime.
  if (!tamaraHoldsNoWorkerAuthority(authority)) {
    fsm.transition("safely-aborted", "tamara-authority-invalid");
    return { ok: false, abortReason: "tamara-authority-invalid", validation: "objective-valid", ...base };
  }

  // 1. Objective validation.
  const validation = validateTamaraObjective(objective);
  if (validation !== "objective-valid") {
    fsm.transition("safely-aborted", `objective-invalid:${validation}`);
    return { ok: false, abortReason: validation, validation, ...base };
  }
  fsm.transition("objective-validated", objective.objectiveId);

  // 2. Strategy market: >=3 competing proposals from volunteer scouts.
  fsm.transition("strategy-market-open", "research-scouts-propose");
  const proposals = openStrategyMarket(objective, input.civ.workers, seed);
  const { decision, council } = decideStrategy(proposals, input.civ.workers, seed);
  fsm.transition("strategy-quorum-reached", `quorum=${decision.quorumReached} minority=${decision.minorityReports}`);

  // 3. Mission program: bounded demand into every relevant district on the
  // NATIONAL demand board (workers volunteer against demand; nobody is assigned).
  let districtDemands = 0;
  for (const id of SOFTWARE_PROGRAM_DISTRICTS) districtDemands += publishDistrictDemand(programDistricts[id], 0.8, seed, 2);
  const program: FederationMissionProgram = { programId: `program-${objective.objectiveId}`, objectiveId: objective.objectiveId, chosenProposalId: decision.chosenProposalId, districtDemands, districtsActivated: SOFTWARE_PROGRAM_DISTRICTS.length };
  fsm.transition("mission-program-created", program.programId);

  // 4. Voluntary capability market → capability-complete team (validity, not assignment).
  fsm.transition("capability-market-open", `volunteers=${input.civ.admission.voluntaryLiveClaims}`);
  if (input.civ.admission.capabilityGap || input.civ.admission.accepted.length === 0) {
    fsm.transition("safely-aborted", "cohort-capability-gap");
    return { ok: false, abortReason: "cohort-capability-gap", validation, ...base, proposals, decision, strategyCouncil: council, program, districtsActivated: program.districtsActivated, districtDemands };
  }
  fsm.transition("teams-formed", `cohort=${input.civ.admission.accepted.length}`);

  // 5. Bounded execution — the REUSED civilization pipeline (voluntary cohort,
  // role contracts, MCP grants, reviews, artifact-gated verification, repair).
  fsm.transition("execution-authorized", "civilization-live-pipeline");
  const civResult = runCivilizationLive(input.civ);
  const civReport = buildCivLiveReport(civResult, input.civ.permit);
  const m = civResult.metrics;
  fsm.transition("artifacts-proposed", `proposals=${m.artifactsCreated + m.normalizationFailures}`);
  fsm.transition("artifacts-under-review", `reviews=${m.independentReviews}`);
  fsm.transition("artifacts-approved", `approved=${m.artifactsCreated}`);
  fsm.transition("artifacts-applied", `applied=${m.artifactsCreated}`);
  fsm.transition("verification-running", `runs=${m.verificationRuns}`);
  if (m.verificationFailures > 0 || m.verificationBlockedRuns > 0) {
    fsm.transition("repair-required", m.verificationBlockedRuns > 0 ? "no-build-artifacts" : "verification-failure");
    if (m.repairCalls > 0) fsm.transition("repair-authorized", "separately-confirmed-repair");
    fsm.transition("evidence-complete", "post-repair-evidence");
  } else {
    fsm.transition("evidence-complete", "clean-evidence");
  }

  // 6. Evidence → Tamara review (aggregate evidence only; no private minds).
  const evidence: FederationFinalEvidence = {
    objectiveId: objective.objectiveId,
    finalObjectivePassed: m.finalObjectivePassed,
    artifactsCreated: m.artifactsCreated,
    independentReviews: m.independentReviews,
    verificationRuns: m.verificationRuns,
    verificationFailures: m.verificationFailures,
    incidentsCreated: m.incidentsCreated,
    repairsCompleted: m.repairsCompleted,
    safetyViolations: civReport.safetyViolations,
    conservationValid: civReport.digitalResourceConservationValid,
    failureCategories: civResult.failureCategories,
  };
  fsm.transition("tamara-review", "evidence-presented");
  const review = tamaraReviewEvidence(objective, evidence);
  fsm.transition(review.decision, review.reason);

  return {
    ok: true,
    validation,
    authority,
    stateMachine: fsm,
    proposals,
    decision,
    strategyCouncil: council,
    program,
    civResult,
    civReport,
    evidence,
    tamaraDecision: review.decision,
    tamaraDecisionReason: review.reason,
    districtsActivated: program.districtsActivated,
    districtDemands,
    programDistricts,
  };
}

/** Bounded helper for demos: a fully-populated national objective. */
export function buildSoftwareNationalObjective(objectiveId: string): TamaraNationalObjective {
  return {
    objectiveId,
    title: "Small TypeScript project-management application",
    desiredOutcome: "Projects + tasks CRUD with status, priorities, listing; tested; documented.",
    rationale: "Prove the sovereign federation can deliver reviewed, verified software through voluntary civilization labor.",
    constraints: ["no npm install", "no network", "isolated workspace only"],
    priority: "high",
    riskLevel: "moderate",
    budgetUnits: 100,
    maxTicks: 200,
    requiredSkills: ["backend-implementation", "test-authoring", "code-review"] as never,
    acceptanceCriteria: ["projects+tasks CRUD", "in-memory repository", "unit tests present", "README + architecture docs", "security review", "typecheck/build evidence"],
    humanApprovalRequired: true,
    allowedProviderPool: ["codex", "claude"] as never,
    maxCognitivelyActiveAnts: 5,
    maxRealProviderCalls: 5,
    workspacePolicy: "in-memory-fake",
    safeMetadata: { domain: "software", version: 3 },
    policy: { providerPolicy: ["codex", "claude"], mcpCapabilityPolicy: ["repo-inspection", "code-search", "project-analysis", "documentation", "workspace-file-create", "typecheck", "tests", "build"], filesystemPolicy: "isolated-run-workspace-only", verificationPolicy: ["typecheck", "test", "build"], securityClassification: "internal", reversibilityRequired: true, humanApprovalRequired: true },
    budget: { tokenBudget: 400, computeBudget: 300, monetaryBudget: 100, timeBudgetTicks: 200 },
    acceptance: { criteria: ["projects+tasks CRUD", "unit tests", "docs", "security review"], minVerificationRuns: 2, requireIndependentReview: true, requireConservationClosed: true, failureTolerance: 6, stopConditions: ["budget-exhausted", "safety-violation", "human-stop"] },
  };
}
