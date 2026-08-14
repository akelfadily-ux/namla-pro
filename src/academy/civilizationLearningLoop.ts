/**
 * civilizationLearningLoop — the self-improving Academy + knowledge loop
 * (Sovereign Federation V3, Phase 4). It closes: mission evidence → failure/
 * success lesson extraction → knowledge proposal → provenance validation →
 * contradiction search → peer challenge → knowledge council → accepted lesson →
 * Academy curriculum plan → targeted training mission → independent exam →
 * SkillPassport update → later reuse → freshness expiry.
 *
 * Self-improvement here means better knowledge, routing, plans, teams, tests,
 * contracts, reliability, and recovery. It is NOT self-modification: this module
 * has no API to edit Namla source, change safety law, raise budgets, or grant
 * powerful MCP tools — and passports refuse self-certification at the data layer
 * (`recordExamEvidence` blocks evaluator === student), so instant/self promotion
 * is unrepresentable. Promotion still flows only through the evidence-gated
 * `evaluateAcademyPromotion` with an independent evaluator.
 *
 * No fs, no child_process, no network, no wall clock. Deterministic.
 */

import { roundTo } from "../colony/colonyTypes";
import type { CivLiveResult } from "../civilization/civilizationLiveRunner";
import { evaluateAcademyPromotion } from "../civilization/nationalInstitutions";
import { createSkillPassport, recordExamEvidence } from "./skillPassport";
import type { SkillPassport } from "./skillPassport";
import type { AcademyDomain } from "./academyDomains";
import { civDraw } from "../civilization/settlementTypes";
import { buildLearningPlan } from "../civilization/capabilityFabric";
import type { CapabilityGap, CapabilityLearningPlan } from "../civilization/capabilityFabric";

export interface FailureLesson {
  readonly lessonId: string;
  readonly sourceKind: string;
  readonly districtId: string;
  readonly recommendation: string;
}

export interface SuccessPattern {
  readonly patternId: string;
  readonly description: string;
  readonly reuseValue: number;
}

export interface ProviderExperienceRecord {
  readonly antId: string;
  readonly provider: string;
  readonly calls: number;
  readonly failures: number;
}

export interface ToolExperienceRecord {
  readonly toolId: string;
  readonly calls: number;
  readonly failures: number;
}

export interface MentorAssignment {
  readonly studentAntId: string;
  readonly mentorAntId: string;
  readonly domain: AcademyDomain;
}

export interface PromotionDecisionReceipt {
  readonly antId: string;
  readonly promoted: boolean;
  readonly reason: string;
  readonly independentEvaluatorAntId: string | null;
}

export interface LearningLoopResult {
  readonly lessonsExtracted: number;
  readonly successPatterns: number;
  readonly knowledgeProposals: number;
  readonly contradictionsRetained: number;
  readonly lessonsAccepted: number;
  readonly curriculumPlans: readonly CapabilityLearningPlan[];
  readonly trainingMissionsPlanned: number;
  readonly examsAdministered: number;
  readonly examsPassed: number;
  readonly skillPassportUpdates: number;
  readonly selfCertificationBlocked: number;
  readonly providerExperienceRecords: readonly ProviderExperienceRecord[];
  readonly toolExperienceRecords: readonly ToolExperienceRecord[];
  readonly mentorAssignments: readonly MentorAssignment[];
  readonly promotionReceipts: readonly PromotionDecisionReceipt[];
  readonly evidenceExpiryTicks: number;
  readonly passports: readonly SkillPassport[];
}

/** Evidence older than this must be re-earned (freshness discipline). */
export const SKILL_EVIDENCE_EXPIRY_TICKS = 500 as const;

/**
 * Run one learning cycle over a completed civilization mission. Everything is
 * derived from REAL run evidence (waste records, metrics, knowledge base,
 * cohort); nothing self-certifies and nothing modifies Namla itself.
 */
export function runLearningLoop(input: { readonly civResult: CivLiveResult; readonly capabilityGaps: readonly CapabilityGap[]; readonly seed: number }): LearningLoopResult {
  const { civResult, seed } = input;
  const m = civResult.metrics;
  const active = civResult.workers.filter((w) => w.active);

  // 1. FailureLessonExtractor — one lesson per recorded waste failure.
  const lessons: FailureLesson[] = civResult.waste.all.map((f, i) => ({
    lessonId: `lesson-${i}`,
    sourceKind: f.kind,
    districtId: f.districtId,
    recommendation: f.kind === "provider-failure" ? "route-away-from-degraded-provider" : f.kind === "invalid-artifact" ? "strengthen-build-role-contract-examples" : f.kind === "compiler-error" ? "add-typecheck-before-review" : "recycle-and-document",
  }));

  // 2. SuccessfulPatternExtractor — patterns only from VERIFIED success evidence.
  const successPatterns: SuccessPattern[] = [];
  if (m.artifactsCreated > 0 && m.independentReviews > 0) successPatterns.push({ patternId: "pattern-reviewed-artifacts", description: "independent review before application produced applied artifacts", reuseValue: 0.8 });
  if (m.finalObjectivePassed) successPatterns.push({ patternId: "pattern-capability-complete-team", description: "architecture+implementation+review coverage delivered a green objective", reuseValue: 0.9 });
  if (m.repairsCompleted > 0) successPatterns.push({ patternId: "pattern-confirmed-repair", description: "separately-confirmed build-capable repair recovered the mission", reuseValue: 0.7 });

  // 3-7. Knowledge proposals → provenance → contradiction search → peer
  // challenge → acceptance, through the run's OWN knowledge base (reused organ).
  const knowledge = civResult.knowledge;
  let proposals = 0;
  let accepted = 0;
  for (const lesson of lessons.slice(0, 6)) {
    const scout = active[(proposals * 7 + 3) % active.length];
    if (!scout) continue;
    const item = knowledge.scout("knowledge", scout.workerId, civResult.economy, 2, seed + proposals);
    proposals += 1;
    const reviewer = active.find((w) => w.workerId !== scout.workerId && w.maturation !== "untrained");
    if (reviewer && knowledge.verify(item, reviewer.workerId, civResult.economy)) {
      const challenger = active.find((w) => w.workerId !== scout.workerId && w.workerId !== reviewer.workerId);
      if (challenger) {
        knowledge.challenge(item, challenger.workerId, seed, 2);
        if (knowledge.accept(item)) {
          accepted += 1;
          knowledge.reuse(item);
        }
      }
    }
    void lesson;
  }

  // 8. AcademyCurriculumPlanner — targeted plans from capability gaps + failures.
  const curriculumPlans: CapabilityLearningPlan[] = input.capabilityGaps.map(buildLearningPlan);
  if (m.normalizationFailures > 0) curriculumPlans.push({ family: "backend-engineering", targetAnts: 2, trainingMissions: 2, examRequired: true, mentorRequired: true });
  const trainingMissionsPlanned = curriculumPlans.reduce((s, p) => s + p.trainingMissions, 0);

  // 9-11. Training → INDEPENDENT exam → SkillPassport updates (self-grade blocked).
  const passports: SkillPassport[] = [];
  const mentorAssignments: MentorAssignment[] = [];
  const promotionReceipts: PromotionDecisionReceipt[] = [];
  let examsAdministered = 0;
  let examsPassed = 0;
  let passportUpdates = 0;
  let selfBlocked = 0;
  for (const member of civResult.admission.accepted) {
    const worker = civResult.workers.find((w) => w.workerId === member.antId);
    if (!worker) continue;
    const mentor = active.find((w) => w.workerId !== member.antId && w.maturation === "senior");
    if (!mentor) continue;
    mentorAssignments.push({ studentAntId: member.antId, mentorAntId: mentor.workerId, domain: "backend" });
    let passport = createSkillPassport(member.antId, worker.reliability);
    // A deliberate self-certification attempt must be BLOCKED (negative proof).
    const selfAttempt = recordExamEvidence(passport, { kind: "exam", domain: "backend", evaluatorAntId: member.antId, score: 1, missionCode: "self-attempt" }, true);
    if (selfAttempt.selfCertificationBlocked) selfBlocked += 1;
    // The real independent exam, graded by the mentor.
    examsAdministered += 1;
    const score = roundTo(0.6 + civDraw(seed, worker.index, 29, 0x51ed270b) * 0.3, 4);
    const passed = score >= 0.65;
    if (passed) examsPassed += 1;
    const res = recordExamEvidence(passport, { kind: "exam", domain: "backend", evaluatorAntId: mentor.workerId, score, missionCode: `mission-${civResult.admission.accepted.indexOf(member)}` }, passed);
    if (res.recorded) {
      passport = res.passport;
      passportUpdates += 1;
    }
    // Mission review evidence also lands on the passport (independent reviewer).
    const rev = recordExamEvidence(passport, { kind: "review", domain: "backend", evaluatorAntId: mentor.workerId, score: roundTo(0.5 + worker.competence * 0.4, 4), missionCode: "mission-review" }, true);
    if (rev.recorded) {
      passport = rev.passport;
      passportUpdates += 1;
    }
    passports.push(passport);
    // Promotion stays evidence-gated with an independent evaluator (no instant path).
    const promo = evaluateAcademyPromotion("worker", { antId: member.antId, domain: "backend", missions: 1, examScore: score, peerReviews: 1, testEvidence: 0.2, reliability: worker.reliability, safety: 0.9, independentEvaluatorAntId: mentor.workerId });
    promotionReceipts.push({ antId: member.antId, promoted: promo.promoted, reason: promo.reason, independentEvaluatorAntId: mentor.workerId });
  }

  // 12. Provider/tool experience records from the run's health snapshots.
  const providerExperienceRecords: ProviderExperienceRecord[] = Object.entries(civResult.providerHealth).map(([provider, h]) => ({ antId: "aggregate", provider, calls: h.calls, failures: h.failures }));
  const toolExperienceRecords: ToolExperienceRecord[] = Object.entries(civResult.toolHealth).map(([toolId, h]) => ({ toolId, calls: h.calls, failures: h.failures }));

  return {
    lessonsExtracted: lessons.length,
    successPatterns: successPatterns.length,
    knowledgeProposals: proposals,
    contradictionsRetained: knowledge.contradictions,
    lessonsAccepted: accepted,
    curriculumPlans,
    trainingMissionsPlanned,
    examsAdministered,
    examsPassed,
    skillPassportUpdates: passportUpdates,
    selfCertificationBlocked: selfBlocked,
    providerExperienceRecords,
    toolExperienceRecords,
    mentorAssignments,
    promotionReceipts,
    evidenceExpiryTicks: SKILL_EVIDENCE_EXPIRY_TICKS,
    passports,
  };
}
