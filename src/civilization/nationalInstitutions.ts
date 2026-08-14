/**
 * nationalInstitutions — the national knowledge economy, the technology academy,
 * and the waste/repair economy (Build Law §27). Knowledge is a bounded living
 * system (source → scout → verify → challenge → accept → reuse → revalidate →
 * retire) with provenance, confidence, freshness, contradictions, reviewers, and
 * usage. Academy promotion is evidence-gated (missions + exam + peer review +
 * tests + reliability + safety + independent evaluator) with no self-certification
 * and no promotion from provider output alone. Failures never disappear: they are
 * classified, mined for lessons, recycled, and used to update reliability,
 * SkillPassport evidence, and provider health.
 *
 * No fs, no child_process, no network, no wall clock, no ambient randomness.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import { academyLevelRank, civDraw } from "./settlementTypes";
import type { AcademyDomain, AcademyLevel, FailureKind, KnowledgeState, WorkKind } from "./settlementTypes";
import { ACADEMY_LEVELS } from "./settlementTypes";
import type { DigitalResourceEconomy } from "../digital/digitalResourceEconomy";

// --- national knowledge economy --------------------------------------------

export interface KnowledgeItem {
  readonly knowledgeId: string;
  readonly workKind: WorkKind;
  state: KnowledgeState;
  readonly sourceAntId: string;
  readonly provenance: string;
  confidence: number;
  freshness: number;
  contradictions: number;
  reviewers: string[];
  usageCount: number;
  reuseCount: number;
  version: number;
  retired: boolean;
}

export class NationalKnowledgeBase {
  private readonly items: KnowledgeItem[] = [];
  private seq = 0;
  accepted = 0;
  contradictions = 0;
  reused = 0;
  retired = 0;
  revalidated = 0;

  get size(): number {
    return this.items.filter((i) => !i.retired).length;
  }
  get all(): readonly KnowledgeItem[] {
    return this.items;
  }

  /** Scout raw information into a knowledge candidate (conserving: economy collect). */
  scout(workKind: WorkKind, sourceAntId: string, economy: DigitalResourceEconomy, tick: number, seed: number): KnowledgeItem {
    economy.collect("rawInformation", 0.5);
    const item: KnowledgeItem = { knowledgeId: `kn-${this.seq++}`, workKind, state: "scouted", sourceAntId, provenance: `scout:${sourceAntId}`, confidence: roundTo(0.3 + civDraw(seed, this.seq, tick, 0x2545f491) * 0.3, 4), freshness: 1, contradictions: 0, reviewers: [], usageCount: 0, reuseCount: 0, version: 1, retired: false };
    if (this.items.length < 20000) this.items.push(item);
    return item;
  }

  /** Verify: consume raw information + produce verified knowledge (conserving). */
  verify(item: KnowledgeItem, reviewerAntId: string, economy: DigitalResourceEconomy): boolean {
    if (item.state !== "scouted") return false;
    economy.transform("verify", 0, reviewerAntId, [{ resource: "rawInformation", amount: 0.4 }], [{ resource: "verifiedKnowledge", amount: 0.4 }], true);
    item.state = "verified";
    item.reviewers.push(reviewerAntId);
    item.confidence = roundTo(clamp(item.confidence + 0.2, 0, 1), 4);
    return true;
  }

  /** Peer challenge: a challenger may surface a contradiction. */
  challenge(item: KnowledgeItem, challengerAntId: string, seed: number, tick: number): boolean {
    if (item.state !== "verified") return false;
    item.state = "challenged";
    const contradiction = civDraw(seed, item.knowledgeId.length, tick ^ challengerAntId.length, 0x165667b1) < 0.35;
    if (contradiction) {
      item.contradictions += 1;
      this.contradictions += 1;
      item.confidence = roundTo(clamp(item.confidence - 0.25, 0, 1), 4);
    }
    if (!item.reviewers.includes(challengerAntId)) item.reviewers.push(challengerAntId);
    return contradiction;
  }

  /** Accept knowledge that survived challenge with adequate confidence. */
  accept(item: KnowledgeItem): boolean {
    if (item.state !== "challenged") return false;
    if (item.confidence < 0.4) return false;
    item.state = "accepted";
    this.accepted += 1;
    return true;
  }

  /** Reuse accepted knowledge (bounded, task-relevant). */
  reuse(item: KnowledgeItem): boolean {
    if (item.state !== "accepted" && item.state !== "revalidated") return false;
    item.usageCount += 1;
    item.reuseCount += 1;
    this.reused += 1;
    return true;
  }

  /** Freshness decay + revalidation or retirement of stale knowledge. */
  ageAndRevalidate(economy: DigitalResourceEconomy, seed: number, tick: number): void {
    for (const item of this.items) {
      if (item.retired) continue;
      item.freshness = roundTo(clamp(item.freshness - 0.05, 0, 1), 4);
      if (item.freshness < 0.3 && (item.state === "accepted" || item.state === "revalidated")) {
        if (civDraw(seed, item.knowledgeId.length, tick, 0x27220a95) < 0.4) {
          // retire stale knowledge (conserving: verifiedKnowledge -> staleKnowledge)
          const moved = economy.consume("verifiedKnowledge", 0.1);
          if (moved > 0) economy.createVia("staleKnowledge", moved);
          item.state = "retired";
          item.retired = true;
          this.retired += 1;
        } else {
          item.state = "revalidated";
          item.freshness = 1;
          item.version += 1;
          this.revalidated += 1;
        }
      }
    }
  }
}

// --- national technology academy -------------------------------------------

export interface AcademyEvidence {
  readonly antId: string;
  readonly domain: AcademyDomain;
  readonly missions: number;
  readonly examScore: number;
  readonly peerReviews: number;
  readonly testEvidence: number;
  readonly reliability: number;
  readonly safety: number;
  readonly independentEvaluatorAntId: string | null;
}

export const EVIDENCE_TO_PROMOTE = { missions: 1, examScore: 0.6, peerReviews: 1, reliability: 0.55, safety: 0.6 };

export interface PromotionOutcome {
  readonly promoted: boolean;
  readonly fromLevel: AcademyLevel;
  readonly toLevel: AcademyLevel;
  readonly reason: string;
}

/**
 * Evidence-gated promotion. Requires completed missions, an exam score, peer
 * review, test evidence, a reliability + safety threshold, AND an INDEPENDENT
 * evaluator that is not the ant itself. No self-certification; no promotion from
 * provider output alone; master is the cap and is never reached instantly.
 */
export function evaluateAcademyPromotion(currentLevel: AcademyLevel, evidence: AcademyEvidence): PromotionOutcome {
  const rank = academyLevelRank(currentLevel);
  if (rank >= academyLevelRank("master")) return { promoted: false, fromLevel: currentLevel, toLevel: currentLevel, reason: "already-master" };
  if (evidence.independentEvaluatorAntId === null || evidence.independentEvaluatorAntId === evidence.antId) return { promoted: false, fromLevel: currentLevel, toLevel: currentLevel, reason: "no-independent-evaluator" };
  if (evidence.missions < EVIDENCE_TO_PROMOTE.missions) return { promoted: false, fromLevel: currentLevel, toLevel: currentLevel, reason: "insufficient-missions" };
  if (evidence.examScore < EVIDENCE_TO_PROMOTE.examScore) return { promoted: false, fromLevel: currentLevel, toLevel: currentLevel, reason: "exam-failed" };
  if (evidence.peerReviews < EVIDENCE_TO_PROMOTE.peerReviews) return { promoted: false, fromLevel: currentLevel, toLevel: currentLevel, reason: "insufficient-peer-review" };
  if (evidence.testEvidence <= 0) return { promoted: false, fromLevel: currentLevel, toLevel: currentLevel, reason: "no-test-evidence" };
  if (evidence.reliability < EVIDENCE_TO_PROMOTE.reliability || evidence.safety < EVIDENCE_TO_PROMOTE.safety) return { promoted: false, fromLevel: currentLevel, toLevel: currentLevel, reason: "below-threshold" };
  const toLevel = ACADEMY_LEVELS[rank + 1];
  return { promoted: true, fromLevel: currentLevel, toLevel, reason: "evidence-met" };
}

// --- waste / repair economy ------------------------------------------------

export interface FailureRecord {
  readonly failureId: string;
  readonly kind: FailureKind;
  readonly districtId: string;
  readonly antId: string;
  classified: boolean;
  lessonExtracted: boolean;
  repaired: boolean;
  quarantined: boolean;
}

export class WasteRepairEconomy {
  private readonly failures: FailureRecord[] = [];
  private seq = 0;
  classified = 0;
  lessonsExtracted = 0;
  repaired = 0;
  quarantined = 0;

  get all(): readonly FailureRecord[] {
    return this.failures;
  }

  /** Record a failure as structured waste (conserving: economy createVia). */
  record(kind: FailureKind, districtId: string, antId: string, economy: DigitalResourceEconomy): FailureRecord {
    economy.createVia("errorWaste", 0.4);
    economy.createVia("technicalDebt", kind === "technical-debt" ? 0.4 : 0.2);
    const f: FailureRecord = { failureId: `fail-${this.seq++}`, kind, districtId, antId, classified: false, lessonExtracted: false, repaired: false, quarantined: false };
    if (this.failures.length < 20000) this.failures.push(f);
    return f;
  }

  /** Cleaner/repair ants classify, extract a lesson, and recycle waste to knowledge. */
  recycle(f: FailureRecord, economy: DigitalResourceEconomy): { readonly recycled: number; readonly lesson: boolean } {
    if (f.repaired) return { recycled: 0, lesson: false };
    f.classified = true;
    this.classified += 1;
    const recycled = economy.consume("errorWaste", 0.3);
    let lesson = false;
    if (recycled > 0) {
      economy.createVia("verifiedKnowledge", 0.2); // a reusable lesson
      economy.consume("technicalDebt", 0.15); // service some debt
      f.lessonExtracted = true;
      f.repaired = true;
      this.lessonsExtracted += 1;
      this.repaired += 1;
      lesson = true;
    }
    return { recycled: roundTo(recycled, 6), lesson };
  }

  /** Quarantine a dangerous result (conserving: economy quarantine). */
  quarantine(f: FailureRecord, economy: DigitalResourceEconomy): void {
    if (f.quarantined) return;
    economy.quarantine("securityRisk", 0.1);
    f.quarantined = true;
    this.quarantined += 1;
  }
}
