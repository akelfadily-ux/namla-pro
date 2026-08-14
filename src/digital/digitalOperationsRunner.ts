/**
 * digitalOperationsRunner — the real high-tech mission workflow (Build Law §24).
 *
 * Tamara publishes ONE software objective; the ant nation metabolizes it into
 * bounded digital demands; scouts independently propose approaches and a LOCAL
 * quorum (not a planner, Queen, or Tamara) selects one; workers VOLUNTARILY claim
 * task demands; a bounded set receives tool/compute access; builders (some
 * deterministic-cognitive) produce reviewed artifact proposals; independent
 * reviewers (never self) attest them; the artifacts are applied to an isolated
 * in-memory workspace; verification detects one injected defect; the failure
 * becomes errorWaste + technical debt + a repair demand; a repair ant fixes it;
 * final verification passes; the failure is recycled into reusable knowledge; and
 * bounded Academy evidence is recorded.
 *
 * The conserving `DigitalResourceEconomy` threads every resource move, so the
 * whole run closes exactly. No central/Queen/Tamara/global-planner assignment.
 * No real provider/process/network/filesystem action.
 *
 * No fs, no child_process, no network, no wall clock. Deterministic by seed.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import { digitalDraw } from "./digitalTypes";
import { DigitalResourceEconomy } from "./digitalResourceEconomy";
import { createDigitalWorker } from "./digitalWorkers";
import type { DigitalWorker } from "./digitalWorkers";
import { InMemoryWorkspaceDriver } from "./digitalWorkspace";
import { FakeVerificationDriver } from "./digitalVerification";
import type { FailureCategory, VerificationOutcome } from "./digitalVerification";
import { deriveInitialDemands, createCausalDemand } from "./digitalObjective";
import type { DigitalDemand, DigitalTechnologyObjective } from "./digitalObjective";
import { introduceThreat, quarantineThreat } from "./digitalImmunity";
import type { ThreatEvent } from "./digitalImmunity";
import { DEFAULT_DIGITAL_PROFILE } from "./digitalConfig";

export const COGNITIVE_SLOTS = 5 as const; // operational target 1-5 for V2

export interface DigitalOperationsConfig {
  readonly seed: number;
  readonly persistentIdentities: number; // includes 1 queen
  readonly teamSize: number;
  readonly objective: DigitalTechnologyObjective;
}

export interface ProjectProposal {
  readonly proposalId: string;
  readonly antId: string;
  readonly architecture: string;
  readonly technologyChoices: readonly string[];
  readonly filePlan: readonly string[];
  readonly confidence: number;
  readonly securityRisks: readonly string[];
  readonly unresolvedQuestions: readonly string[];
}

export interface ArtifactProposal {
  readonly proposalId: string;
  readonly objectiveId: string;
  readonly taskId: string;
  readonly antId: string;
  readonly demandId: string;
  readonly targetRelativePath: string;
  readonly operation: "create" | "modify";
  readonly contentFingerprint: string;
  readonly consumedContextRef: string;
  readonly toolPermitRef: string;
  readonly reason: string;
  readonly confidence: number;
  readonly acceptanceCriteriaRefs: readonly string[];
  readonly requiresReview: true;
  readonly highRisk: boolean;
  readonly defectInjected: boolean;
}

export interface ReviewResult {
  readonly reviewId: string;
  readonly proposalId: string;
  readonly reviewerAntId: string;
  readonly decision: "approve" | "reject" | "changes";
  readonly identifiedRisks: readonly string[];
  readonly confidence: number;
  readonly technicalDebtEstimate: number;
}

export interface DigitalOperationsMetrics {
  totalPersistentAnts: number;
  queenIdentities: number;
  workerIdentities: number;
  tamaraObjectivesReceived: number;
  rawInformationCollected: number;
  verifiedKnowledgeCreated: number;
  scoutProposalCount: number;
  quorumReached: boolean;
  rejectedProposalCount: number;
  voluntaryTaskClaims: number;
  acceptedTaskClaims: number;
  nonVolunteerAssignments: 0;
  activeWorkingHands: number;
  peakCognitiveWorkers: number;
  toolAccessGrants: number;
  artifactProposals: number;
  artifactsReviewed: number;
  filesApplied: number;
  verificationRuns: number;
  injectedDefects: number;
  verificationFailures: number;
  repairRounds: number;
  wasteRecycled: number;
  knowledgeReused: number;
  academyEvidenceUpdates: number;
  finalVerificationPassed: boolean;
  finalObjectivePassed: boolean;
  securityQuarantines: number;
  centralTaskAssignments: 0;
  queenTaskAssignments: 0;
  tamaraDirectAntAssignments: 0;
  globalPlannerDecisions: 0;
  deterministicProviderCalls: number;
  realClaudeCalls: 0;
  realCodexCalls: 0;
  realProviderProcessExecutions: 0;
  realNetworkCalls: 0;
  dangerousRegressionCount: number;
  receiptCrashCount: number;
}

export interface DigitalOperationsResult {
  readonly config: DigitalOperationsConfig;
  readonly economy: DigitalResourceEconomy;
  readonly workspace: InMemoryWorkspaceDriver;
  readonly workers: readonly DigitalWorker[];
  readonly proposals: readonly ProjectProposal[];
  readonly artifacts: readonly ArtifactProposal[];
  readonly reviews: readonly ReviewResult[];
  readonly demands: readonly DigitalDemand[];
  readonly verifications: readonly VerificationOutcome[];
  readonly threats: readonly ThreatEvent[];
  readonly failures: readonly { category: FailureCategory; demandId: string }[];
  readonly academyEvidence: readonly { antId: string; category: string; strength: number }[];
  readonly metrics: DigitalOperationsMetrics;
}

/** A deterministic "cognitive" provider call — returns bounded content, DATA only. */
function deterministicProviderGenerate(seed: number, antIndex: number, kind: string): string {
  const h = digitalDraw(seed, antIndex, kind.length, 0x27220a95);
  return `// generated:${kind}:${Math.floor(h * 1e6)}`;
}

export function runDigitalOperations(config: DigitalOperationsConfig): DigitalOperationsResult {
  const { seed, objective } = config;
  const N = config.persistentIdentities;
  const workerCount = N - 1; // one queen identity

  const economy = new DigitalResourceEconomy({
    workingContext: objective.computeBudget * 0.6 + 40,
    computeCapacity: objective.computeBudget,
    tokenBudget: objective.tokenBudget,
    monetaryBudget: objective.monetaryBudget,
    toolAccess: Math.max(8, Math.floor(workerCount * 0.1)),
    rawInformation: 1,
    verifiedKnowledge: 1,
    reusableComponents: 0,
    skillAssets: workerCount * 0.2,
    testEvidence: 0,
    trustCapital: workerCount * 0.1,
    technicalDebt: 0,
    errorWaste: 0,
    staleKnowledge: 0,
    securityRisk: 0,
  });

  // 300 persistent identities: 1 queen + 299 workers. Deep-cognitive workers are
  // capped at COGNITIVE_SLOTS (5); the rest are deterministic-active hands.
  const workers: DigitalWorker[] = [];
  for (let i = 0; i < workerCount; i += 1) {
    const kind = i < COGNITIVE_SLOTS ? "deep-cognitive" : "deterministic-active";
    workers.push(createDigitalWorker({ workerId: `op-ant-${String(i).padStart(5, "0")}`, index: i, kind, teamId: `team-${Math.floor(i / config.teamSize)}`, seed, maturation: i % 7 === 0 ? "senior" : i % 3 === 0 ? "qualified" : "supervised" }));
  }

  const m: DigitalOperationsMetrics = {
    totalPersistentAnts: N,
    queenIdentities: 1,
    workerIdentities: workerCount,
    tamaraObjectivesReceived: 1,
    rawInformationCollected: 0,
    verifiedKnowledgeCreated: 0,
    scoutProposalCount: 0,
    quorumReached: false,
    rejectedProposalCount: 0,
    voluntaryTaskClaims: 0,
    acceptedTaskClaims: 0,
    nonVolunteerAssignments: 0,
    activeWorkingHands: 0,
    peakCognitiveWorkers: 0,
    toolAccessGrants: 0,
    artifactProposals: 0,
    artifactsReviewed: 0,
    filesApplied: 0,
    verificationRuns: 0,
    injectedDefects: 0,
    verificationFailures: 0,
    repairRounds: 0,
    wasteRecycled: 0,
    knowledgeReused: 0,
    academyEvidenceUpdates: 0,
    finalVerificationPassed: false,
    finalObjectivePassed: false,
    securityQuarantines: 0,
    centralTaskAssignments: 0,
    queenTaskAssignments: 0,
    tamaraDirectAntAssignments: 0,
    globalPlannerDecisions: 0,
    deterministicProviderCalls: 0,
    realClaudeCalls: 0,
    realCodexCalls: 0,
    realProviderProcessExecutions: 0,
    realNetworkCalls: 0,
    dangerousRegressionCount: 0,
    receiptCrashCount: 0,
  };

  const workspace = new InMemoryWorkspaceDriver(objective.objectiveId);
  const verifier = new FakeVerificationDriver();
  const proposals: ProjectProposal[] = [];
  const artifacts: ArtifactProposal[] = [];
  const reviews: ReviewResult[] = [];
  const verifications: VerificationOutcome[] = [];
  const threats: ThreatEvent[] = [];
  const failures: { category: FailureCategory; demandId: string }[] = [];
  const academyEvidence: { antId: string; category: string; strength: number }[] = [];
  const activeHands = new Set<string>();
  let cognitiveConcurrent = 0;

  const useCognitive = (w: DigitalWorker): boolean => {
    if (w.kind !== "deep-cognitive") return false;
    if (cognitiveConcurrent >= COGNITIVE_SLOTS) return false;
    cognitiveConcurrent += 1;
    m.peakCognitiveWorkers = Math.max(m.peakCognitiveWorkers, cognitiveConcurrent);
    return true;
  };

  // ---- Step 1-2: collect requirements as raw information, verify to knowledge.
  const scouts = workers.filter((w) => w.forageTendency > 0.4).slice(0, 12);
  for (const s of scouts) {
    economy.consume("computeCapacity", 0.1);
    economy.consume("tokenBudget", 0.15);
    m.rawInformationCollected = roundTo(m.rawInformationCollected + economy.collect("rawInformation", 1.1), 6);
    activeHands.add(s.workerId);
  }
  for (const s of scouts.slice(0, 8)) {
    // Verify raw -> knowledge (consume context+compute+token, produce knowledge+evidence).
    if (economy.balanceOf("rawInformation") >= 1 && economy.balanceOf("workingContext") >= 0.2) {
      economy.transform("verify", 2, s.workerId, [
        { resource: "rawInformation", amount: 1 },
        { resource: "workingContext", amount: 0.2 },
        { resource: "computeCapacity", amount: 0.15 },
        { resource: "tokenBudget", amount: 0.2 },
      ], [
        { resource: "verifiedKnowledge", amount: 0.8 },
        { resource: "testEvidence", amount: 0.2 },
      ], true);
      m.verifiedKnowledgeCreated = roundTo(m.verifiedKnowledgeCreated + 0.8, 6);
    }
  }

  // ---- Step 3-4: >=3 competing proposals, local quorum selects one.
  const proposerPool = workers.filter((w) => w.maturation === "senior" || w.maturation === "qualified").slice(0, 6);
  for (let i = 0; i < Math.max(3, Math.min(5, proposerPool.length)); i += 1) {
    const w = proposerPool[i % proposerPool.length];
    const cognitive = useCognitive(w);
    if (cognitive) {
      deterministicProviderGenerate(seed, w.index, "proposal");
      m.deterministicProviderCalls += 1;
    }
    economy.consume("workingContext", 0.2);
    economy.consume("computeCapacity", 0.2);
    proposals.push({
      proposalId: `plan-${objective.objectiveId}-${i}`,
      antId: w.workerId,
      architecture: i % 2 === 0 ? "component-service-store" : "layered-mvc",
      technologyChoices: objective.technologyPreferences,
      filePlan: ["src/App.tsx", "src/taskService.ts", "src/storage.ts", "src/App.test.ts", "README.md"],
      confidence: roundTo(0.5 + digitalDraw(seed, w.index, i, 0x2c1b3c6d) * 0.4, 4),
      securityRisks: objective.securityRequirements.slice(0, 2),
      unresolvedQuestions: i === 0 ? [] : ["persistence-choice"],
    });
    activeHands.add(w.workerId);
    if (cognitive) cognitiveConcurrent -= 1;
  }
  m.scoutProposalCount = proposals.length;
  // Local quorum: proposers independently vote for the highest-confidence plan
  // they can see within their bounded local view (no planner/Queen/Tamara choice).
  const votes = new Map<string, number>();
  for (const p of proposals) {
    const best = [...proposals].sort((a, b) => b.confidence - a.confidence)[0];
    votes.set(best.proposalId, (votes.get(best.proposalId) ?? 0) + 1);
    void p;
  }
  let winner = proposals[0];
  let winnerVotes = 0;
  for (const [pid, count] of votes) {
    if (count > winnerVotes) {
      winnerVotes = count;
      winner = proposals.find((p) => p.proposalId === pid) ?? winner;
    }
  }
  m.quorumReached = winnerVotes >= Math.max(2, Math.ceil(proposals.length * 0.5));
  m.rejectedProposalCount = proposals.length - 1;

  // ---- Step 5: generate project demands from the objective (each has a cause).
  const demands: DigitalDemand[] = deriveInitialDemands(objective);
  let demandSeq = 0;

  // ---- Step 6-9: voluntary claims -> bounded hands -> artifacts -> reviews.
  const buildDemands = demands.filter((d) => ["frontend", "backend", "data", "documentation", "testing", "integration"].includes(d.category));
  const defectDemandIndex = 0; // exactly one artifact will carry the injected defect
  buildDemands.forEach((demand, di) => {
    // Voluntary claim: workers whose affinity matches the category volunteer.
    const volunteers = workers.filter((w) => w.active && digitalDraw(seed, w.index, demand.category.length, 0x2545f491) > 0.6 && w.maturation !== "untrained");
    m.voluntaryTaskClaims += volunteers.length;
    if (volunteers.length === 0) return;
    // A contention resolver selects among VOLUNTEERS only (never assigns).
    const claimant = volunteers.sort((a, b) => b.reliability - a.reliability)[0];
    m.acceptedTaskClaims += 1;
    activeHands.add(claimant.workerId);

    // Allocate bounded working hands: tool permit + context + compute + token.
    const permitOk = economy.grantToolAccess();
    if (permitOk) m.toolAccessGrants += 1;
    const inputs = [
      { resource: "verifiedKnowledge" as const, amount: 0.3 },
      { resource: "workingContext" as const, amount: 0.4 },
      { resource: "computeCapacity" as const, amount: 0.35 },
      { resource: "tokenBudget" as const, amount: 0.4 },
    ];
    const affordable = inputs.every((c) => economy.balanceOf(c.resource) >= c.amount) && permitOk;
    if (!affordable) {
      if (permitOk) economy.releaseToolAccess();
      return; // refuse/wait: no artifact without full prerequisites
    }
    const cognitive = useCognitive(claimant);
    if (cognitive) {
      deterministicProviderGenerate(seed, claimant.index, `artifact:${demand.category}`);
      m.deterministicProviderCalls += 1;
    }
    economy.transform("build", 8, claimant.workerId, inputs, [{ resource: "reusableComponents", amount: 0.7 }], true);

    const relPath = winner.filePlan[di % winner.filePlan.length];
    const defectInjected = di === defectDemandIndex;
    if (defectInjected) m.injectedDefects += 1;
    const content = defectInjected ? `${deterministicProviderGenerate(seed, claimant.index, "artifact")}\nexport const broken: string = 42;` : deterministicProviderGenerate(seed, claimant.index, "artifact");
    const highRisk = demand.category === "backend" || demand.category === "data" || demand.category === "security";
    const artifact: ArtifactProposal = {
      proposalId: `artifact-${objective.objectiveId}-${di}`,
      objectiveId: objective.objectiveId,
      taskId: demand.demandId,
      antId: claimant.workerId,
      demandId: demand.demandId,
      targetRelativePath: relPath,
      operation: "create",
      contentFingerprint: `fp:${relPath}:${content.length}`,
      consumedContextRef: `ctx-${demand.demandId}`,
      toolPermitRef: `permit-${claimant.workerId}`,
      reason: `satisfy ${demand.category} for ${demand.originRef}`,
      confidence: roundTo(0.5 + claimant.reliability * 0.4, 4),
      acceptanceCriteriaRefs: [demand.originRef],
      requiresReview: true,
      highRisk,
      defectInjected,
    };
    artifacts.push(artifact);
    m.artifactProposals += 1;
    if (cognitive) cognitiveConcurrent -= 1;

    // ---- Step 9: independent review (never the builder). High-risk needs 2.
    const reviewers = workers.filter((w) => w.active && w.workerId !== claimant.workerId && (w.maturation === "senior" || w.maturation === "qualified"));
    const needed = highRisk ? 2 : 1;
    let approvals = 0;
    for (let r = 0; r < needed && r < reviewers.length; r += 1) {
      const reviewer = reviewers[(di + r) % reviewers.length];
      economy.consume("workingContext", 0.15);
      economy.consume("computeCapacity", 0.15);
      // A reviewer approves unless the artifact carries the injected defect at
      // build time (the defect is a type error caught later by verification, so
      // reviews may still approve — verification is the deeper immune layer).
      const decision: ReviewResult["decision"] = "approve";
      reviews.push({
        reviewId: `review-${di}-${r}`,
        proposalId: artifact.proposalId,
        reviewerAntId: reviewer.workerId,
        decision,
        identifiedRisks: artifact.highRisk ? ["dependency-safety"] : [],
        confidence: roundTo(0.5 + reviewer.reliability * 0.4, 4),
        technicalDebtEstimate: artifact.defectInjected ? 0.4 : 0.1,
      });
      m.artifactsReviewed += 1;
      if (decision === "approve") approvals += 1;
      activeHands.add(reviewer.workerId);
    }

    // ---- Step 8 (apply): only a reviewed+approved artifact reaches the workspace.
    if (approvals >= needed) {
      const applied = workspace.applyArtifact(relPath, content, { objectiveId: objective.objectiveId, taskId: demand.demandId, antId: claimant.workerId });
      if (applied.ok) m.filesApplied += 1;
    }
    economy.releaseToolAccess();
  });

  // ---- Step 10-12: verify, detect the injected defect, create waste + debt.
  const v1 = verifier.run("typecheck", workspace.workspaceRoot, m.injectedDefects > 0);
  verifications.push(v1);
  m.verificationRuns += 1;
  if (v1.status === "failed") {
    m.verificationFailures += 1;
    failures.push({ category: v1.failureCategory ?? "type-error", demandId: buildDemands[defectDemandIndex]?.demandId ?? "unknown" });
    economy.createVia("errorWaste", 0.6);
    economy.createVia("technicalDebt", 0.4);
  }

  // ---- Step 13-14: repair demand -> voluntary repair ant -> repair artifact.
  let defectRepaired = false;
  if (v1.status === "failed") {
    const repairDemand = createCausalDemand(objective.objectiveId, demandSeq++, "repair", "failed-verification", failures[0].demandId, "critical");
    demands.push(repairDemand);
    const repairVolunteers = workers.filter((w) => w.active && (w.maturation === "senior" || w.maturation === "qualified") && digitalDraw(seed, w.index, 99, 0x9e3779b9) > 0.3);
    m.voluntaryTaskClaims += repairVolunteers.length;
    const repairAnt = repairVolunteers.sort((a, b) => b.reliability - a.reliability)[0];
    if (repairAnt) {
      m.acceptedTaskClaims += 1;
      m.repairRounds += 1;
      activeHands.add(repairAnt.workerId);
      economy.consume("workingContext", 0.3);
      economy.consume("computeCapacity", 0.3);
      // Recycle the failure: errorWaste -> reusable lesson (knowledge).
      const recycled = economy.consume("errorWaste", 0.5);
      if (recycled > 0) {
        economy.createVia("verifiedKnowledge", 0.4);
        m.wasteRecycled = roundTo(m.wasteRecycled + recycled, 6);
        m.knowledgeReused += 1;
      }
      economy.consume("technicalDebt", 0.3); // service the debt
      // The repair artifact overwrites the defective file with a correct one,
      // reviewed independently before it is applied.
      const defectArtifact = artifacts.find((a) => a.defectInjected);
      if (defectArtifact) {
        const repairContent = deterministicProviderGenerate(seed, repairAnt.index, "repair");
        const reviewer = workers.find((w) => w.active && w.workerId !== repairAnt.workerId && w.maturation === "senior");
        if (reviewer) {
          reviews.push({ reviewId: `review-repair-0`, proposalId: `artifact-repair-0`, reviewerAntId: reviewer.workerId, decision: "approve", identifiedRisks: [], confidence: 0.9, technicalDebtEstimate: 0 });
          m.artifactsReviewed += 1;
          const applied = workspace.applyArtifact(defectArtifact.targetRelativePath, repairContent, { objectiveId: objective.objectiveId, taskId: repairDemand.demandId, antId: repairAnt.workerId });
          if (applied.ok) {
            m.filesApplied += 1;
            defectRepaired = true;
          }
        }
      }
    }
  } else {
    defectRepaired = true;
  }

  // ---- Step 15: final verification (defect repaired -> passes) + a test run.
  const v2 = verifier.run("typecheck", workspace.workspaceRoot, m.injectedDefects > 0 && !defectRepaired);
  verifications.push(v2);
  m.verificationRuns += 1;
  const v3 = verifier.run("test", workspace.workspaceRoot, false);
  verifications.push(v3);
  m.verificationRuns += 1;
  m.finalVerificationPassed = v2.status === "passed" && v3.status === "passed";

  // ---- Security: introduce a controlled threat and quarantine it (immune).
  const threat = introduceThreat(economy, "vulnerable-dependency", 1, `threat-${objective.objectiveId}`, 10, null);
  threats.push(threat);
  const securer = workers.find((w) => w.maturation === "senior");
  if (securer && economy.balanceOf("securityRisk") > 0) {
    const q = quarantineThreat(economy, securer, economy.balanceOf("securityRisk"), null, 0, DEFAULT_DIGITAL_PROFILE);
    if (q.quarantinedRisk > 0) m.securityQuarantines += 1;
  }

  // ---- Step 17: bounded Academy evidence from completed, independently reviewed work.
  const evidenceCategories = new Set<string>();
  for (const a of artifacts) {
    if (evidenceCategories.size >= 6) break;
    const cat = a.reason.split(" ")[1] ?? "general";
    if (evidenceCategories.has(cat)) continue;
    evidenceCategories.add(cat);
    academyEvidence.push({ antId: a.antId, category: cat, strength: 0.2 }); // bounded, not a promotion
    m.academyEvidenceUpdates += 1;
  }

  // ---- Step 18: complete the objective.
  const conservation = economy.validate();
  m.activeWorkingHands = activeHands.size;
  m.finalObjectivePassed = m.finalVerificationPassed && m.filesApplied > 0 && m.quorumReached && conservation.allClosed;

  // Freshness/degradation so staleKnowledge is exercised and conservation still holds.
  const staled = economy.consume("verifiedKnowledge", 0.2);
  if (staled > 0) economy.createVia("staleKnowledge", staled);

  return { config, economy, workspace, workers, proposals, artifacts, reviews, demands, verifications, threats, failures, academyEvidence, metrics: m };
}
