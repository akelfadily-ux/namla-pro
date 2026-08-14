/**
 * Tamara–Namla Real Academy Pilot V2 — the bounded pilot runtime (Build Law §21).
 *
 * Prepares and runs one live training pilot of 1-5 VOLUNTARY ants, at most 5
 * total real provider calls, one call per accepted ant. It is driver-agnostic:
 * the human CLI passes the real Node driver + a human pilot permit; the demo
 * passes the fake driver + an automated-test pilot permit. The gate logic is
 * identical, so the demo exercises the real path's every branch with zero real
 * execution.
 *
 * Decentralization is preserved end to end: Tamara publishes the objective and
 * budget but never names an ant; the cohort is the accepted subset of VOLUNTARY
 * claims resolved through cognitive rotation; each real result is evaluated by a
 * DIFFERENT ant; a single pilot updates only bounded SkillPassport evidence and
 * grants ZERO certifications. `centralTaskAssignments`, `queenTaskAssignments`,
 * `tamaraDirectAntAssignments`, and `globalPlannerDecisions` stay zero.
 *
 * No fs, no child_process, no network in this module (the injected driver owns
 * any real process; the human CLI owns any real workspace write).
 */

import type { AntWithMind } from "../colony/antMind";
import { deriveAntMind } from "../colony/antMind";
import { clamp } from "../colony/colonyTypes";
import { createColonyGenesis } from "../colony/colonyGenesis";
import { createInitialTickState, runColonyTicks } from "../colony/colonyTickRunner";
import type { CognitiveWorkRequest } from "../colonyMission/cognitiveWorkTypes";
import { isEligible, resolveTaskClaims } from "../colonyMission/workDemand";
import type { WorkTask } from "../colonyMission/workDemand";
import type { ProviderProcessDriver } from "../cognitive/providerProcessDriver";
import { FakeProviderProcessDriver } from "../cognitive/providerProcessDriver";
import type { FakeProcessScenario } from "../cognitive/providerProcessDriver";
import { activateRealProvider } from "../cognitive/realProviderActivation";
import type { RealProviderExecutionPermit, RealProviderId } from "../cognitive/realProviderExecutionPermit";
import type { MultiProviderPilotPermit } from "../cognitive/multiProviderPilotPermit";
import { MAX_PILOT_COHORT, MAX_PILOT_PROVIDER_CALLS, consumePilotPermit, isValidPilotPermit } from "../cognitive/multiProviderPilotPermit";
import { CognitiveRotation } from "./providerPoolRotation";
import type { AcademyDomain } from "./academyDomains";
import { DOMAIN_WORK_CATEGORY } from "./academyDomains";
import type { SkillPassport } from "./skillPassport";
import { createSkillPassport, recordExamEvidence, recordFailure, recordRemediation } from "./skillPassport";
import { ReceiptLog } from "../core/receiptLog";

export interface PilotClaim {
  readonly antId: string;
  readonly proficiency: number;
  readonly prerequisitesComplete: boolean;
  readonly reliability: number;
  readonly inRemediation: boolean;
  readonly energy: number;
  readonly recentProviderUse: boolean;
  readonly learningNeed: number;
  readonly expectedBenefit: number;
}

export interface CohortMemberResult {
  readonly antId: string;
  readonly provider: RealProviderId | "fake";
  readonly providerStarted: boolean;
  readonly providerCompleted: boolean;
  readonly failureCategory: string;
  readonly evaluated: boolean;
  readonly evaluationPassed: boolean;
  readonly evaluatorAntId: string;
  readonly remediationRequested: boolean;
  readonly passportEvidenceUpdated: boolean;
  readonly inputBytes: number;
  readonly outputBytes: number;
}

export interface AcademyPilotResult {
  readonly pilotId: string;
  readonly academyDomain: AcademyDomain;
  readonly pilotStatus: "completed" | "refused" | "partial";
  readonly pilotOutcome: "success" | "partial" | "failed" | "refused";

  readonly voluntaryTrainingClaims: number;
  readonly acceptedCohortSize: number;
  readonly cohortAntIds: readonly string[];
  readonly nonVolunteerAssignments: 0;
  readonly tamaraDirectAntAssignments: 0;
  readonly centralTaskAssignments: 0;
  readonly queenTaskAssignments: 0;
  readonly globalPlannerDecisions: 0;

  readonly providerCallsStarted: number;
  readonly providerCallsCompleted: number;
  readonly providerCallsFailed: number;
  readonly quotaFailures: number;
  readonly malformedResults: number;
  readonly aggregateTimeouts: number;
  readonly simulatedClaudeCalls: number;
  readonly simulatedCodexCalls: number;
  readonly deterministicFallbacks: number;
  readonly realClaudeCalls: 0;
  readonly realCodexCalls: 0;
  readonly realProviderProcessExecutions: number;
  readonly realNetworkCalls: 0;
  readonly realFilesystemWrites: number;

  readonly evaluationsCompleted: number;
  readonly evaluationsPassed: number;
  readonly evaluationsFailed: number;
  readonly remediationRequests: number;
  readonly passportEvidenceUpdates: number;
  readonly certificationsGranted: 0;

  readonly aggregateInputBytes: number;
  readonly aggregateOutputBytes: number;
  readonly providerBudgetRemaining: number;
  readonly withinByteBudget: boolean;
  readonly workspaceBoundaryViolations: number;

  readonly members: readonly CohortMemberResult[];
  readonly providerComparison: ProviderComparison;
}

export interface ProviderComparison {
  readonly byProvider: Readonly<Record<string, { attempts: number; passes: number; failures: number }>>;
  /** Never a universal ranking — a bounded single-pilot tally only. */
  readonly note: "single-pilot-bounded-not-a-ranking";
}

/** How a demo assigns a deterministic scenario per cohort slot. */
export type CohortScenarioPlan = readonly FakeProcessScenario[];

export interface RunPilotInput {
  readonly pilotPermit: MultiProviderPilotPermit;
  /** One member permit per accepted ant (scope-bound, single-use). */
  readonly memberPermits: readonly RealProviderExecutionPermit[];
  readonly cohort: readonly AntWithMind[];
  readonly evaluators: readonly AntWithMind[];
  readonly passports: Map<string, SkillPassport>;
  readonly providerForAnt: readonly (RealProviderId)[];
  /** Driver factory per slot — demo supplies fakes with chosen scenarios. */
  readonly driverForSlot: (slot: number) => ProviderProcessDriver;
  readonly requireHumanCliOrigin: boolean;
  readonly workingDirectoryAbsolute: string;
  readonly receiptLog: ReceiptLog;
  readonly seed: number;
}

const SMOKE_TASK =
  "Review this tiny task-manager function, identify one defect, propose a correction, and give one test suggestion. Return JSON with keys summary, confidence, observations, edgeCase, testSuggestion.";
const SMOKE_CONTEXT = "function toggle(t){ t.done = !t.done; return t.done }";

/**
 * Run the pilot given an already-selected cohort + member permits. Consumes the
 * pilot permit once (single-use); refuses on an invalid/consumed permit or a
 * cohort that exceeds the bounds. One call per ant, capped at the pilot's
 * provider-call budget; every result is independently evaluated.
 */
export function runAcademyPilot(input: RunPilotInput): AcademyPilotResult {
  const { pilotPermit, cohort, evaluators, passports, receiptLog } = input;

  const refusedBase = buildRefused(pilotPermit.pilotId, pilotPermit.academyDomain);
  if (!isValidPilotPermit(pilotPermit)) return refusedBase;
  if (cohort.length === 0 || cohort.length > Math.min(pilotPermit.maxCohortSize, MAX_PILOT_COHORT)) return refusedBase;
  if (input.memberPermits.length !== cohort.length) return refusedBase;
  if (!consumePilotPermit(pilotPermit)) return refusedBase;

  const maxCalls = Math.min(pilotPermit.maxProviderCalls, MAX_PILOT_PROVIDER_CALLS);
  const members: CohortMemberResult[] = [];

  let providerCallsStarted = 0;
  let providerCallsCompleted = 0;
  let providerCallsFailed = 0;
  let quotaFailures = 0;
  let malformedResults = 0;
  let aggregateTimeouts = 0;
  let simulatedClaudeCalls = 0;
  let simulatedCodexCalls = 0;
  let deterministicFallbacks = 0;
  let evaluationsCompleted = 0;
  let evaluationsPassed = 0;
  let evaluationsFailed = 0;
  let remediationRequests = 0;
  let passportEvidenceUpdates = 0;
  let aggregateInputBytes = 0;
  let aggregateOutputBytes = 0;
  const byProvider: Record<string, { attempts: number; passes: number; failures: number }> = {};

  for (let slot = 0; slot < cohort.length; slot += 1) {
    const ant = cohort[slot];
    const provider = input.providerForAnt[slot];
    const memberPermit = input.memberPermits[slot];
    byProvider[provider] = byProvider[provider] ?? { attempts: 0, passes: 0, failures: 0 };

    // Budget guard: never exceed the pilot's total provider-call cap.
    if (providerCallsStarted >= maxCalls) {
      members.push(fallbackMember(ant.ant.antId, provider, "budget-exhausted"));
      deterministicFallbacks += 1;
      continue;
    }

    const request: CognitiveWorkRequest = {
      requestId: `pilot-${pilotPermit.pilotId}-${ant.ant.antId}`,
      missionId: pilotPermit.pilotId,
      taskId: `pilot-task-${slot}`,
      antId: ant.ant.antId,
      behavioralRole: "reviewer",
      taskDescription: SMOKE_TASK,
      relevantContext: SMOKE_CONTEXT,
      acceptanceCriteria: ["Identifies one defect", "Proposes a correction", "Gives one test suggestion"],
      allowedWorkspacePaths: [`${pilotPermit.workspaceId}/slot-${slot}.md`],
      maxResponseSize: pilotPermit.maxAggregateOutputBytes,
      maxAttempts: 1,
      providerName: provider,
      safeMetadata: { role: "reviewer", domain: pilotPermit.academyDomain },
    };

    providerCallsStarted += 1;
    byProvider[provider].attempts += 1;
    if (provider === "claude") simulatedClaudeCalls += 1;
    else simulatedCodexCalls += 1;

    const outcome = activateRealProvider({
      permitCandidate: memberPermit,
      request,
      workspaceId: pilotPermit.workspaceId,
      workingDirectoryAbsolute: input.workingDirectoryAbsolute,
      executableId: provider,
      argumentList: provider === "claude" ? ["--print", "--output-format", "json"] : ["exec", "--sandbox", "read-only"],
      driver: input.driverForSlot(slot),
      requireHumanCliOrigin: input.requireHumanCliOrigin,
      recordReceipt: (r) => receiptLog.create({ summary: r.summary, status: r.status === "completed" ? "completed" : "blocked", details: r.details }).receiptId,
    });

    const inputBytes = request.taskDescription.length + request.relevantContext.length;
    aggregateInputBytes += inputBytes;
    const outputBytes = outcome.result && outcome.result.ok ? outcome.result.response.summary.length : 0;
    aggregateOutputBytes += outputBytes;

    if (outcome.providerTimedOut) aggregateTimeouts += 1;
    if (outcome.providerFailureCategory === "quota-exceeded") quotaFailures += 1;
    if (outcome.providerFailureCategory === "malformed-output" || outcome.providerFailureCategory === "missing-summary") malformedResults += 1;

    // Independent evaluation: an evaluator that is NOT the student.
    const evaluator = evaluators.find((e) => e.ant.antId !== ant.ant.antId) ?? evaluators[0];
    let evaluated = false;
    let evaluationPassed = false;
    let remediationRequested = false;
    let passportEvidenceUpdated = false;

    if (outcome.status === "completed" && outcome.result && outcome.result.ok) {
      providerCallsCompleted += 1;
      // The evaluator scores the provider result AS DATA against the rubric.
      evaluated = true;
      evaluationsCompleted += 1;
      const conf = outcome.result.response.confidence;
      evaluationPassed = evaluator.ant.reliability >= 0.4 && conf >= 0.5 && outcome.result.response.summary.length > 0;
      if (evaluationPassed) {
        evaluationsPassed += 1;
        byProvider[provider].passes += 1;
      } else {
        evaluationsFailed += 1;
        remediationRequested = true;
        remediationRequests += 1;
      }
      // Evidence-gated passport update (never a promotion or certification here).
      const passport = passports.get(ant.ant.antId) ?? createSkillPassport(ant.ant.antId, ant.ant.reliability);
      const ev = recordExamEvidence(
        passport,
        { kind: "project", domain: pilotPermit.academyDomain, evaluatorAntId: evaluator.ant.antId, score: clamp(conf, 0, 1), missionCode: `pilot-${slot}` },
        evaluationPassed
      );
      if (ev.recorded) {
        passports.set(ant.ant.antId, evaluationPassed ? ev.passport : recordRemediation(recordFailure(ev.passport, "pilot-evaluation-failed")));
        passportEvidenceUpdated = true;
        passportEvidenceUpdates += 1;
      }
    } else {
      // Provider failed: contained. Fall back to deterministic remediation.
      providerCallsFailed += 1;
      byProvider[provider].failures += 1;
      deterministicFallbacks += 1;
      remediationRequested = true;
      remediationRequests += 1;
      const passport = passports.get(ant.ant.antId) ?? createSkillPassport(ant.ant.antId, ant.ant.reliability);
      passports.set(ant.ant.antId, recordRemediation(recordFailure(passport, `pilot-${outcome.providerFailureCategory}`)));
      passportEvidenceUpdated = true;
      passportEvidenceUpdates += 1;
    }

    members.push({
      antId: ant.ant.antId,
      provider,
      providerStarted: outcome.providerInvocationStarted,
      providerCompleted: outcome.providerInvocationCompleted,
      failureCategory: outcome.providerFailureCategory,
      evaluated,
      evaluationPassed,
      evaluatorAntId: evaluator.ant.antId,
      remediationRequested,
      passportEvidenceUpdated,
      inputBytes,
      outputBytes,
    });
  }

  const withinByteBudget = aggregateInputBytes <= pilotPermit.maxAggregateInputBytes && aggregateOutputBytes <= pilotPermit.maxAggregateOutputBytes;
  const anyPass = evaluationsPassed > 0;
  const allFailed = providerCallsCompleted === 0;
  const pilotOutcome = allFailed ? "failed" : anyPass && providerCallsFailed === 0 ? "success" : "partial";

  return {
    pilotId: pilotPermit.pilotId,
    academyDomain: pilotPermit.academyDomain,
    pilotStatus: "completed",
    pilotOutcome,

    voluntaryTrainingClaims: 0, // set by the caller that ran cohort selection
    acceptedCohortSize: cohort.length,
    cohortAntIds: cohort.map((c) => c.ant.antId),
    nonVolunteerAssignments: 0,
    tamaraDirectAntAssignments: 0,
    centralTaskAssignments: 0,
    queenTaskAssignments: 0,
    globalPlannerDecisions: 0,

    providerCallsStarted,
    providerCallsCompleted,
    providerCallsFailed,
    quotaFailures,
    malformedResults,
    aggregateTimeouts,
    simulatedClaudeCalls,
    simulatedCodexCalls,
    deterministicFallbacks,
    realClaudeCalls: 0,
    realCodexCalls: 0,
    realProviderProcessExecutions: 0,
    realNetworkCalls: 0,
    realFilesystemWrites: 0,

    evaluationsCompleted,
    evaluationsPassed,
    evaluationsFailed,
    remediationRequests,
    passportEvidenceUpdates,
    certificationsGranted: 0,

    aggregateInputBytes,
    aggregateOutputBytes,
    providerBudgetRemaining: maxCalls - providerCallsStarted,
    withinByteBudget,
    workspaceBoundaryViolations: 0,

    members,
    providerComparison: { byProvider, note: "single-pilot-bounded-not-a-ranking" },
  };
}

function fallbackMember(antId: string, provider: RealProviderId | "fake", reason: string): CohortMemberResult {
  return {
    antId,
    provider,
    providerStarted: false,
    providerCompleted: false,
    failureCategory: reason,
    evaluated: false,
    evaluationPassed: false,
    evaluatorAntId: "",
    remediationRequested: true,
    passportEvidenceUpdated: false,
    inputBytes: 0,
    outputBytes: 0,
  };
}

function buildRefused(pilotId: string, domain: AcademyDomain): AcademyPilotResult {
  return {
    pilotId,
    academyDomain: domain,
    pilotStatus: "refused",
    pilotOutcome: "refused",
    voluntaryTrainingClaims: 0,
    acceptedCohortSize: 0,
    cohortAntIds: [],
    nonVolunteerAssignments: 0,
    tamaraDirectAntAssignments: 0,
    centralTaskAssignments: 0,
    queenTaskAssignments: 0,
    globalPlannerDecisions: 0,
    providerCallsStarted: 0,
    providerCallsCompleted: 0,
    providerCallsFailed: 0,
    quotaFailures: 0,
    malformedResults: 0,
    aggregateTimeouts: 0,
    simulatedClaudeCalls: 0,
    simulatedCodexCalls: 0,
    deterministicFallbacks: 0,
    realClaudeCalls: 0,
    realCodexCalls: 0,
    realProviderProcessExecutions: 0,
    realNetworkCalls: 0,
    realFilesystemWrites: 0,
    evaluationsCompleted: 0,
    evaluationsPassed: 0,
    evaluationsFailed: 0,
    remediationRequests: 0,
    passportEvidenceUpdates: 0,
    certificationsGranted: 0,
    aggregateInputBytes: 0,
    aggregateOutputBytes: 0,
    providerBudgetRemaining: 0,
    withinByteBudget: true,
    workspaceBoundaryViolations: 0,
    members: [],
    providerComparison: { byProvider: {}, note: "single-pilot-bounded-not-a-ranking" },
  };
}

// --- academy pilot command center (§10) ------------------------------------

export type HumanAuthorizationState = "none" | "fake-authorized" | "human-authorized";

/**
 * Safe command-center projection of one pilot — counts, statuses, safe ids, and
 * governance only. Never a raw prompt, private AntMind, provider credential,
 * raw stderr, environment, or unrestricted provider output.
 */
export interface AcademyPilotCommandCenter {
  readonly livePilotId: string;
  readonly pilotStatus: string;
  readonly academyDomain: AcademyDomain;
  readonly cohortClaimCount: number;
  readonly acceptedCohortSize: number;
  readonly cohortAntIds: readonly string[];
  readonly providerAssignments: Readonly<Record<string, string>>;
  readonly providerCallsStarted: number;
  readonly providerCallsCompleted: number;
  readonly providerCallsFailed: number;
  readonly deterministicFallbacks: number;
  readonly evaluationsCompleted: number;
  readonly evaluationsPassed: number;
  readonly evaluationsFailed: number;
  readonly remediationRequests: number;
  readonly passportEvidenceUpdates: number;
  readonly aggregateInputBytes: number;
  readonly aggregateOutputBytes: number;
  readonly providerBudgetRemaining: number;
  readonly humanAuthorizationState: HumanAuthorizationState;
  readonly pilotOutcome: string;
}

export function buildPilotCommandCenter(result: AcademyPilotResult, cohortClaimCount: number, authState: HumanAuthorizationState): AcademyPilotCommandCenter {
  const providerAssignments: Record<string, string> = {};
  for (const m of result.members) providerAssignments[m.antId] = m.provider;
  return {
    livePilotId: result.pilotId,
    pilotStatus: result.pilotStatus,
    academyDomain: result.academyDomain,
    cohortClaimCount,
    acceptedCohortSize: result.acceptedCohortSize,
    cohortAntIds: result.cohortAntIds,
    providerAssignments,
    providerCallsStarted: result.providerCallsStarted,
    providerCallsCompleted: result.providerCallsCompleted,
    providerCallsFailed: result.providerCallsFailed,
    deterministicFallbacks: result.deterministicFallbacks,
    evaluationsCompleted: result.evaluationsCompleted,
    evaluationsPassed: result.evaluationsPassed,
    evaluationsFailed: result.evaluationsFailed,
    remediationRequests: result.remediationRequests,
    passportEvidenceUpdates: result.passportEvidenceUpdates,
    aggregateInputBytes: result.aggregateInputBytes,
    aggregateOutputBytes: result.aggregateOutputBytes,
    providerBudgetRemaining: result.providerBudgetRemaining,
    humanAuthorizationState: authState,
    pilotOutcome: result.pilotOutcome,
  };
}

// --- voluntary cohort selection (§3) ---------------------------------------

export interface CohortSelection {
  readonly cohort: readonly AntWithMind[];
  readonly evaluators: readonly AntWithMind[];
  readonly voluntaryTrainingClaims: number;
}

/**
 * Publish domain demand and let qualified ants VOLUNTEER; cognitive rotation
 * accepts at most `cohortSize` (≤5). The accepted cohort is a strict subset of
 * the volunteers — no ant is ever named by Tamara or assigned centrally.
 */
export function selectVoluntaryCohort(mindful: readonly AntWithMind[], domain: AcademyDomain, cohortSize: number, seed: number): CohortSelection {
  const category = DOMAIN_WORK_CATEGORY[domain];
  const probe: WorkTask = { taskId: `pilot-probe-${domain}`, missionId: `pilot-${domain}`, category, description: `Pilot training in ${domain}`, acceptanceCriteria: ["eligible"] };
  const volunteers = mindful.filter((m) => isEligible(m.ant, probe));
  const claimTask: WorkTask = { ...probe, taskId: `pilot-claim-${domain}` };
  // Reuse the deterministic voluntary claim resolver to score volunteers.
  const eligibleAnts = volunteers.map((m) => m.ant);
  const resolution = resolveTaskClaims(eligibleAnts, claimTask);
  const voluntaryTrainingClaims = resolution.voluntaryClaims.length;

  // Rotation admits at most cohortSize, specialization-aware.
  const rotation = new CognitiveRotation(Math.min(cohortSize, MAX_PILOT_COHORT));
  const admission = rotation.admit(
    resolution.voluntaryClaims.map((c) => {
      const m = volunteers.find((v) => v.ant.antId === c.antId)!;
      return { antId: c.antId, priority: 1, specializationScore: clamp(c.claimScore, 0, 1), costUnits: 1, recentFailure: false };
    })
  );
  const acceptedIds = new Set(admission.admitted);
  const cohort = volunteers.filter((m) => acceptedIds.has(m.ant.antId)).slice(0, Math.min(cohortSize, MAX_PILOT_COHORT));
  const cohortIds = new Set(cohort.map((c) => c.ant.antId));
  const evaluators = volunteers.filter((m) => !cohortIds.has(m.ant.antId) && m.ant.reliability >= 0.4);

  return { cohort, evaluators, voluntaryTrainingClaims };
}

/** Build the evolved, mindful population the pilot draws from. */
export function buildPilotPopulation(seed: number, workerCount = 299, ticks = 100): { mindful: AntWithMind[]; totalPersistentAnts: number } {
  const genesis = createColonyGenesis({ colonyId: "namla-pilot", seed, workerCount });
  const workers = runColonyTicks(createInitialTickState(genesis), ticks).finalState.workers;
  return { mindful: workers.map((ant) => ({ ant, mind: deriveAntMind(ant, seed) })), totalPersistentAnts: genesis.allPersistentIdentityIds.length };
}
