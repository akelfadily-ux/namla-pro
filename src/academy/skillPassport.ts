/**
 * Ant Academy V1 — the persistent, bounded SkillPassport (Build Law §20).
 *
 * Every ant carries one passport. Proficiency by domain, scores, and levels are
 * EARNED FROM EVIDENCE, never set by a counter alone. Two rules are enforced
 * mechanically:
 *  - an ant can never self-certify (`recordExamEvidence` refuses when the
 *    evaluator is the student), and
 *  - a promotion requires evidence (`tryPromote` refuses without a passing exam
 *    plus an independent review on record), so `unsupportedPromotions` stays 0.
 *
 * All records are bounded and compacted: evidence, promotion, and demotion
 * histories each have a hard cap and evict the oldest.
 *
 * Pure data + arithmetic. No fs, no process, no network, no wall clock.
 */

import type { AcademyDomain, ProficiencyLevel } from "./academyDomains";
import { PROFICIENCY_LEVELS, levelRank } from "./academyDomains";

export const MAX_EVIDENCE_REFS = 8 as const;
export const MAX_PROMOTION_HISTORY = 8 as const;
export const MAX_DEMOTION_HISTORY = 8 as const;
export const MAX_FAILURE_PATTERNS = 6 as const;

export type CertificationState = "none" | "candidate" | "certified";

/** One bounded piece of evidence — a code + score, never raw reasoning. */
export interface EvidenceRef {
  readonly kind: "exam" | "project" | "review" | "mentorship" | "remediation";
  readonly domain: AcademyDomain;
  readonly evaluatorAntId: string;
  readonly score: number;
  readonly missionCode: string;
}

export interface DomainRecord {
  readonly level: ProficiencyLevel;
  readonly proficiency: number;
  readonly examPasses: number;
  readonly independentReviews: number;
  readonly certification: CertificationState;
}

export interface SkillPassport {
  readonly antId: string;
  readonly primarySpecialties: readonly AcademyDomain[];
  readonly secondarySpecialties: readonly AcademyDomain[];
  readonly domains: Readonly<Partial<Record<AcademyDomain, DomainRecord>>>;
  readonly completedUnits: readonly string[];
  readonly verifiedProjects: number;
  readonly testScore: number;
  readonly reviewScore: number;
  readonly reliability: number;
  readonly safetyScore: number;
  readonly collaborationScore: number;
  readonly mentorshipScore: number;
  readonly failurePatterns: readonly string[];
  readonly remediationStatus: "none" | "in-remediation" | "remediated";
  readonly recentEvidence: readonly EvidenceRef[];
  readonly promotionHistory: readonly string[];
  readonly demotionHistory: readonly string[];
}

export function createSkillPassport(antId: string, reliability: number): SkillPassport {
  return {
    antId,
    primarySpecialties: [],
    secondarySpecialties: [],
    domains: {},
    completedUnits: [],
    verifiedProjects: 0,
    testScore: 0,
    reviewScore: 0,
    reliability,
    safetyScore: 0.6,
    collaborationScore: 0.5,
    mentorshipScore: 0.5,
    failurePatterns: [],
    remediationStatus: "none",
    recentEvidence: [],
    promotionHistory: [],
    demotionHistory: [],
  };
}

function pushBounded<T>(list: readonly T[], item: T, cap: number): T[] {
  const next = [...list, item];
  while (next.length > cap) next.shift();
  return next;
}

function domainRecord(passport: SkillPassport, domain: AcademyDomain): DomainRecord {
  return passport.domains[domain] ?? { level: "trainee", proficiency: 0, examPasses: 0, independentReviews: 0, certification: "none" };
}

export interface ExamEvidenceResult {
  readonly passport: SkillPassport;
  readonly recorded: boolean;
  readonly selfCertificationBlocked: boolean;
}

/**
 * Record one exam's evidence. REFUSES self-grading: if the evaluator is the
 * student, nothing is recorded and `selfCertificationBlocked` is true.
 */
export function recordExamEvidence(passport: SkillPassport, evidence: EvidenceRef, passed: boolean): ExamEvidenceResult {
  if (evidence.evaluatorAntId === passport.antId) {
    return { passport, recorded: false, selfCertificationBlocked: true };
  }
  const record = domainRecord(passport, evidence.domain);
  const updated: DomainRecord = {
    ...record,
    proficiency: Math.round(Math.max(record.proficiency, evidence.score) * 1000) / 1000,
    examPasses: record.examPasses + (passed && evidence.kind === "exam" ? 1 : 0),
    independentReviews: record.independentReviews + (evidence.kind === "review" ? 1 : 0),
  };
  return {
    passport: {
      ...passport,
      domains: { ...passport.domains, [evidence.domain]: updated },
      recentEvidence: pushBounded(passport.recentEvidence, evidence, MAX_EVIDENCE_REFS),
      completedUnits: passed ? pushBounded(passport.completedUnits, evidence.missionCode, 24) : passport.completedUnits,
      testScore: Math.round(((passport.testScore * 3 + evidence.score) / 4) * 1000) / 1000,
    },
    recorded: true,
    selfCertificationBlocked: false,
  };
}

export interface PromotionResult {
  readonly passport: SkillPassport;
  readonly promoted: boolean;
  /** True when a promotion was attempted with NO supporting evidence (must never succeed). */
  readonly unsupported: boolean;
}

/**
 * Promote in a domain ONLY on evidence: at least one passing exam AND at least
 * one independent review on record for that domain, plus enough proficiency for
 * the next rank. Without both kinds of evidence the promotion is refused and
 * flagged `unsupported` — it never advances the level, keeping
 * `unsupportedPromotions` at zero for the runtime.
 */
export function tryPromote(passport: SkillPassport, domain: AcademyDomain): PromotionResult {
  const record = domainRecord(passport, domain);
  const nextRank = levelRank(record.level) + 1;
  if (nextRank >= PROFICIENCY_LEVELS.length) return { passport, promoted: false, unsupported: false };

  const hasEvidence = record.examPasses >= 1 && record.independentReviews >= 1;
  const proficiencyThreshold = 0.4 + nextRank * 0.08;
  if (!hasEvidence || record.proficiency < proficiencyThreshold) {
    return { passport, promoted: false, unsupported: !hasEvidence };
  }

  const nextLevel = PROFICIENCY_LEVELS[nextRank];
  const updated: DomainRecord = { ...record, level: nextLevel };
  return {
    passport: {
      ...passport,
      domains: { ...passport.domains, [domain]: updated },
      promotionHistory: pushBounded(passport.promotionHistory, `${domain}:${nextLevel}`, MAX_PROMOTION_HISTORY),
      primarySpecialties:
        passport.primarySpecialties.includes(domain) || passport.primarySpecialties.length >= 3
          ? passport.primarySpecialties
          : [...passport.primarySpecialties, domain],
    },
    promoted: true,
    unsupported: false,
  };
}

/**
 * Certify a domain at a high level. Requires the earned level to be at least
 * "senior" AND multiple independent reviews — never self-certified (the caller
 * supplies distinct reviewer ids; this checks the count on record).
 */
export function tryCertify(passport: SkillPassport, domain: AcademyDomain, independentReviewerCount: number): { passport: SkillPassport; certified: boolean } {
  const record = domainRecord(passport, domain);
  if (levelRank(record.level) < levelRank("senior") || independentReviewerCount < 2 || record.independentReviews < 2) {
    return { passport, certified: false };
  }
  const updated: DomainRecord = { ...record, certification: "certified" };
  return { passport: { ...passport, domains: { ...passport.domains, [domain]: updated } }, certified: true };
}

export function recordFailure(passport: SkillPassport, failureCategory: string): SkillPassport {
  return {
    ...passport,
    failurePatterns: pushBounded(passport.failurePatterns, failureCategory, MAX_FAILURE_PATTERNS),
    remediationStatus: "in-remediation",
  };
}

export function recordRemediation(passport: SkillPassport): SkillPassport {
  return { ...passport, remediationStatus: "remediated" };
}

/** Every bounded surface is within its cap. Checked, never assumed. */
export function passportWithinBounds(passport: SkillPassport): boolean {
  return (
    passport.recentEvidence.length <= MAX_EVIDENCE_REFS &&
    passport.promotionHistory.length <= MAX_PROMOTION_HISTORY &&
    passport.demotionHistory.length <= MAX_DEMOTION_HISTORY &&
    passport.failurePatterns.length <= MAX_FAILURE_PATTERNS &&
    passport.primarySpecialties.length <= 3 &&
    passport.completedUnits.length <= 24
  );
}
