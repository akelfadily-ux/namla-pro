/**
 * Ant Academy V1 — domains, proficiency levels, and curriculum structure
 * (Build Law §20).
 *
 * 18 technology domains spanning software, IT, data, AI, DevOps, and
 * DEFENSIVE security. Each domain derives a bounded curriculum deterministically
 * (skill tree with prerequisites, learning/practice/examination templates,
 * difficulty levels, rubric, failure categories, remediation, mentorship and
 * graduation requirements). Proficiency levels are an ordered ladder; the
 * runtime NEVER assigns a level from a counter alone — a level is earned from
 * evidence (see `skillPassport.ts`).
 *
 * Pure data + derivation. No fs, no process, no network, no wall clock.
 */

import type { WorkCategory } from "../colonyMission/workDemand";

export const ACADEMY_DOMAINS = [
  "frontend",
  "backend",
  "databases",
  "mobile",
  "testing",
  "debugging",
  "devops",
  "cloud",
  "defensive-security",
  "data-engineering",
  "ai-ml",
  "agent-engineering",
  "architecture",
  "documentation",
  "product-management",
  "it-operations",
  "code-review",
  "security-review",
] as const;

export type AcademyDomain = (typeof ACADEMY_DOMAINS)[number];

/** The earned ladder. Order is meaningful; index is the rank. */
export const PROFICIENCY_LEVELS = [
  "trainee",
  "junior",
  "worker",
  "specialist",
  "senior",
  "mentor",
  "master",
] as const;

export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number];

export function levelRank(level: ProficiencyLevel): number {
  return PROFICIENCY_LEVELS.indexOf(level);
}

export const DIFFICULTY_LEVELS = ["intro", "core", "advanced", "mastery"] as const;
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

/** Every academy domain maps to an existing work-market category (for eligibility). */
export const DOMAIN_WORK_CATEGORY: Readonly<Record<AcademyDomain, WorkCategory>> = {
  frontend: "frontend",
  backend: "backend",
  databases: "backend",
  mobile: "frontend",
  testing: "testing",
  debugging: "debugging",
  devops: "integration",
  cloud: "integration",
  "defensive-security": "security",
  "data-engineering": "backend",
  "ai-ml": "research",
  "agent-engineering": "research",
  architecture: "architecture",
  documentation: "documentation",
  "product-management": "planning",
  "it-operations": "integration",
  "code-review": "review",
  "security-review": "security",
};

/** A bounded curriculum unit. Concrete missions are generated from these codes. */
export interface CurriculumUnit {
  readonly unitCode: string;
  readonly difficulty: DifficultyLevel;
  /** Prerequisite unit codes within the same domain. */
  readonly prerequisites: readonly string[];
  readonly acceptanceCriteria: readonly string[];
}

export interface DomainCurriculum {
  readonly curriculumId: string;
  readonly domain: AcademyDomain;
  readonly workCategory: WorkCategory;
  readonly skillTree: readonly CurriculumUnit[];
  readonly failureCategories: readonly string[];
  readonly remediationPath: readonly string[];
  /** Minimum mentor-reviewed practice runs before graduation to the next level. */
  readonly mentorshipRequirement: number;
  /** Score (0..1) an examination must clear to graduate a difficulty level. */
  readonly graduationScore: number;
}

/**
 * Deterministically derive one domain's curriculum. Only DEFENSIVE security
 * scenarios appear; no offensive exploitation or unauthorized-access content is
 * ever generated (see `trainingMissionFactory.ts`).
 */
export function deriveCurriculum(domain: AcademyDomain): DomainCurriculum {
  const skillTree: CurriculumUnit[] = DIFFICULTY_LEVELS.map((difficulty, i) => ({
    unitCode: `${domain}-${difficulty}`,
    difficulty,
    prerequisites: i === 0 ? [] : [`${domain}-${DIFFICULTY_LEVELS[i - 1]}`],
    acceptanceCriteria: [
      `Meets the ${difficulty} acceptance bar for ${domain}`,
      `Provides reasoning evidence`,
      `Adheres to stated constraints`,
    ],
  }));

  return {
    curriculumId: `curriculum-${domain}`,
    domain,
    workCategory: DOMAIN_WORK_CATEGORY[domain],
    skillTree,
    failureCategories: ["incorrect", "incomplete", "unsafe", "inadequate-tests", "poor-maintainability", "insufficient-evidence"],
    remediationPath: [`review-${domain}-fundamentals`, `mentored-practice-${domain}`, `re-examination-${domain}`],
    mentorshipRequirement: 1,
    graduationScore: 0.6,
  };
}

export function allCurricula(): readonly DomainCurriculum[] {
  return ACADEMY_DOMAINS.map(deriveCurriculum);
}
