/**
 * Ant Intelligence Deepening V1 — mentorship and young-worker development.
 *
 * Builds on the existing G6 brood/lifecycle system: a brood-origin ant admitted
 * into a persistent identity starts with inherited tendencies but LITTLE
 * experience (low reliability, few attempts). Such a young worker observes a
 * nearby experienced ant, receives bounded mentorship, and builds reliability
 * gradually — never instant expert status, and protected from high-risk work
 * until reliable enough.
 *
 * Mentors VOLUNTEER on local conditions (their own reputation, energy, and
 * relevant skill). The Queen chooses no mentor; nothing assigns a pairing. Some
 * mentorship fails (a poor skill match transfers little), which is a real,
 * counted outcome — not every pairing succeeds.
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 17 (Ant Intelligence Deepening V1).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state,
 * no external call of any kind.
 */

import type { AntWithMind, CognitiveDimension } from "./antMind";
import { COGNITIVE_DIMENSIONS, applyPeerFeedback } from "./antMind";
import { clamp, createSeededRandom, roundTo } from "./colonyTypes";

/** Reliability at or below this marks an inexperienced, still-developing worker. */
export const YOUNG_WORKER_RELIABILITY_CEILING = 0.45 as const;
/** Reliability an ant must reach before it is trusted with high-risk work. */
export const INDEPENDENT_TASK_RELIABILITY = 0.55 as const;

export interface MentorshipEvent {
  readonly mentorAntId: string;
  readonly menteeAntId: string;
  readonly dimension: CognitiveDimension;
  readonly skillTransferred: boolean;
  readonly reliabilityGain: number;
  readonly protectedFromHighRisk: boolean;
  readonly failed: boolean;
  readonly reasonCode: string;
}

export interface MentorshipOutcome {
  readonly event: MentorshipEvent;
  /** The mentee's updated mind — a real, bounded improvement when it succeeds. */
  readonly updatedMenteeMind: AntWithMind["mind"];
  /** Mentee reliability after the session (bounded, gradual). */
  readonly updatedMenteeReliability: number;
}

const SALT_MENTOR = 0x5bd1e995;

function mentorDraw(colonySeed: number, mentorIndex: number, menteeIndex: number): number {
  const h = (Math.imul(colonySeed ^ SALT_MENTOR, 2654435761) ^ Math.imul(mentorIndex + 1, 40503) ^ Math.imul(menteeIndex + 1, 2246822519)) >>> 0;
  return createSeededRandom(h)();
}

/** A worker still building experience: low reliability. */
export function isYoungWorker(ant: AntWithMind): boolean {
  return ant.ant.reliability <= YOUNG_WORKER_RELIABILITY_CEILING;
}

/** A worker volunteers to mentor when experienced, well-regarded, and energetic. */
export function willingMentor(ant: AntWithMind): boolean {
  return ant.ant.reliability >= INDEPENDENT_TASK_RELIABILITY && ant.mind.peerReputation >= 0.5 && ant.ant.energy >= 0.3;
}

/** The dimension the mentee most needs to grow — its own weakest aptitude. */
function weakestDimension(mentee: AntWithMind): CognitiveDimension {
  let dimension: CognitiveDimension = COGNITIVE_DIMENSIONS[0];
  let lowest = Infinity;
  for (const candidate of COGNITIVE_DIMENSIONS) {
    const value = mentee.mind.cognitiveProfile[candidate];
    if (value < lowest) {
      lowest = value;
      dimension = candidate;
    }
  }
  return dimension;
}

/**
 * Run one bounded mentorship session. Skill transfers only when the mentor is
 * genuinely stronger than the mentee in the target dimension; the reliability
 * gain is small and gradual (never a jump to expert), and a poor match fails
 * with no gain. A mentee below the independence bar is flagged as protected
 * from high-risk work.
 */
export function runMentorship(mentor: AntWithMind, mentee: AntWithMind, colonySeed: number): MentorshipOutcome {
  const dimension = weakestDimension(mentee);
  const mentorSkill = mentor.mind.cognitiveProfile[dimension];
  const menteeSkill = mentee.mind.cognitiveProfile[dimension];
  const draw = mentorDraw(colonySeed, mentor.ant.antIndex, mentee.ant.antIndex);

  const skillGap = mentorSkill - menteeSkill;
  // A real match needs the mentor meaningfully ahead; otherwise little passes.
  const failed = skillGap < 0.1 || draw < 0.15;
  const protectedFromHighRisk = mentee.ant.reliability < INDEPENDENT_TASK_RELIABILITY;

  if (failed) {
    return {
      event: {
        mentorAntId: mentor.ant.antId,
        menteeAntId: mentee.ant.antId,
        dimension,
        skillTransferred: false,
        reliabilityGain: 0,
        protectedFromHighRisk,
        failed: true,
        reasonCode: skillGap < 0.1 ? "insufficient-skill-gap" : "poor-match",
      },
      updatedMenteeMind: mentee.mind,
      updatedMenteeReliability: mentee.ant.reliability,
    };
  }

  // Gradual, bounded gains — a fraction of the gap, plus a small reliability step.
  const mindAfterFeedback = applyPeerFeedback(mentee.mind, dimension, true);
  const transferredMind = {
    ...mindAfterFeedback,
    cognitiveProfile: {
      ...mindAfterFeedback.cognitiveProfile,
      [dimension]: roundTo(clamp(menteeSkill + skillGap * 0.25, 0, 1), 4),
    },
  };
  const reliabilityGain = roundTo(clamp(skillGap * 0.08, 0, 0.05), 4);

  return {
    event: {
      mentorAntId: mentor.ant.antId,
      menteeAntId: mentee.ant.antId,
      dimension,
      skillTransferred: true,
      reliabilityGain,
      protectedFromHighRisk,
      failed: false,
      reasonCode: "skill-transferred",
    },
    updatedMenteeMind: transferredMind,
    updatedMenteeReliability: roundTo(clamp(mentee.ant.reliability + reliabilityGain, 0, 1), 4),
  };
}

/** After development, is the mentee ready to take independent (higher-risk) work. */
export function readyForIndependentTask(reliability: number): boolean {
  return reliability >= INDEPENDENT_TASK_RELIABILITY;
}
