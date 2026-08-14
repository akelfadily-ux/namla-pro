/**
 * Ant Academy V1 — the independent evaluator (Build Law §20).
 *
 * Evaluation is done BY A DIFFERENT ANT than the student, against a fixed
 * scoring rubric, "blind" (the evaluator scores an anonymized attempt quality,
 * not the student's identity). It prevents self-grading (the runtime always
 * passes an evaluator id distinct from the student), score inflation (scores are
 * derived from the student's real earned proficiency + reliability minus the
 * mission's difficulty bar, not from self-report), and rote memorization
 * (missions vary deterministically by seed).
 *
 * Pure arithmetic. No fs, no process, no network, no wall clock.
 */

import type { AntWithMind } from "../colony/antMind";
import { clamp, createSeededRandom, roundTo } from "../colony/colonyTypes";
import type { AcademyDomain } from "./academyDomains";
import { DOMAIN_WORK_CATEGORY } from "./academyDomains";
import type { SkillPassport } from "./skillPassport";
import type { TrainingMission } from "./trainingMissionFactory";

export const RUBRIC_DIMENSIONS = [
  "correctness",
  "completeness",
  "safety",
  "testQuality",
  "maintainability",
  "efficiency",
  "documentation",
  "reasoningEvidence",
  "collaboration",
  "constraintAdherence",
] as const;

export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

export interface EvaluationResult {
  readonly studentAntId: string;
  readonly evaluatorAntId: string;
  readonly domain: AcademyDomain;
  readonly missionCode: string;
  readonly rubric: Readonly<Record<RubricDimension, number>>;
  readonly overallScore: number;
  readonly passed: boolean;
  readonly failureCategory: string;
  readonly blind: true;
  readonly independent: boolean;
}

function domainProficiency(passport: SkillPassport, domain: AcademyDomain): number {
  return passport.domains[domain]?.proficiency ?? 0;
}

/** The student's own real competence at the mission's work category (from thresholds). */
function studentCompetence(student: AntWithMind, domain: AcademyDomain): number {
  const category = DOMAIN_WORK_CATEGORY[domain];
  const taskCategory = category === "frontend" || category === "backend" ? "building" : category === "review" ? "communicating" : category === "security" ? "guarding" : category === "testing" ? "cleaning" : category === "debugging" ? "repairing" : category === "research" || category === "architecture" || category === "planning" ? "scouting" : category === "documentation" ? "storing" : "transporting";
  const threshold = student.ant.responseThresholds[taskCategory as keyof typeof student.ant.responseThresholds] ?? 0.6;
  return clamp(1 - threshold, 0, 1);
}

export interface EvaluateInput {
  readonly student: AntWithMind;
  readonly evaluatorAntId: string;
  readonly mission: TrainingMission;
  readonly passport: SkillPassport;
  readonly seed: number;
}

/**
 * Score one attempt. The attempt's underlying quality is the student's earned
 * proficiency blended with its real competence and reliability, minus the
 * mission's difficulty bar, plus a small seeded jitter — never self-reported.
 * Rubric dimensions spread deterministically around that quality; the lowest
 * dimension names the failure category on a fail.
 */
export function evaluateAttempt(input: EvaluateInput): EvaluationResult {
  const { student, evaluatorAntId, mission, passport, seed } = input;
  const independent = evaluatorAntId !== student.ant.antId;

  const proficiency = domainProficiency(passport, mission.domain);
  const competence = studentCompetence(student, mission.domain);
  const draw = createSeededRandom(
    (Math.imul(seed ^ 0x2545f491, 2654435761) ^ Math.imul(student.ant.antIndex + 1, 40503) ^ Math.imul(mission.variantKey + 1, 2246822519)) >>> 0
  );

  const baseQuality = clamp(
    proficiency * 0.4 + competence * 0.35 + student.ant.reliability * 0.25 - (mission.qualityBar - 0.5) * 0.5 + (draw() - 0.5) * 0.2,
    0,
    1
  );

  const rubric = {} as Record<RubricDimension, number>;
  let lowestDim: RubricDimension = RUBRIC_DIMENSIONS[0];
  let lowest = Infinity;
  let sum = 0;
  for (let i = 0; i < RUBRIC_DIMENSIONS.length; i += 1) {
    const dim = RUBRIC_DIMENSIONS[i];
    const value = clamp(baseQuality + (draw() - 0.5) * 0.25, 0, 1);
    rubric[dim] = roundTo(value, 3);
    sum += value;
    if (value < lowest) {
      lowest = value;
      lowestDim = dim;
    }
  }

  const overallScore = roundTo(sum / RUBRIC_DIMENSIONS.length, 3);
  const passed = independent && overallScore >= mission.qualityBar && rubric.safety >= 0.4;

  const failureCategory = passed
    ? "none"
    : !independent
      ? "self-grading-blocked"
      : rubric.safety < 0.4
        ? "unsafe"
        : lowestDim === "testQuality"
          ? "inadequate-tests"
          : lowestDim === "correctness"
            ? "incorrect"
            : lowestDim === "completeness"
              ? "incomplete"
              : "insufficient-evidence";

  return {
    studentAntId: student.ant.antId,
    evaluatorAntId,
    domain: mission.domain,
    missionCode: mission.missionCode,
    rubric,
    overallScore,
    passed,
    failureCategory,
    blind: true,
    independent,
  };
}
