/**
 * Ant Intelligence Deepening V1 — temporary teams and guilds.
 *
 * Ants form SHORT-LIVED local teams through voluntary recruitment. No Queen
 * creates a team and no central function assigns a worker to one: a candidate
 * joins only when local demand, its own relevant skill, trust, and energy all
 * clear a bar. Teams are size-bounded, dissolve when the work completes or
 * confidence collapses, and may split when members strongly disagree. There is
 * no permanent hierarchy — every team is temporary by construction.
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 17 (Ant Intelligence Deepening V1).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state,
 * no external call of any kind.
 */

import type { AntWithMind, CognitiveDimension } from "./antMind";
import { clamp, createSeededRandom, roundTo } from "./colonyTypes";

export const TEAM_KINDS = [
  "research-pair",
  "architecture-council",
  "builder-reviewer-pair",
  "test-and-repair-group",
  "security-inspection-group",
  "documentation-group",
] as const;

export type TeamKind = (typeof TEAM_KINDS)[number];

export const MAX_TEAM_SIZE = 5 as const;

/** Target size and the aptitude that makes a candidate want to join each kind. */
const TEAM_SPEC: Record<TeamKind, { readonly targetSize: number; readonly dimension: CognitiveDimension }> = {
  "research-pair": { targetSize: 2, dimension: "analytical" },
  "architecture-council": { targetSize: 4, dimension: "architectural" },
  "builder-reviewer-pair": { targetSize: 2, dimension: "implementation" },
  "test-and-repair-group": { targetSize: 3, dimension: "debugging" },
  "security-inspection-group": { targetSize: 3, dimension: "security" },
  "documentation-group": { targetSize: 3, dimension: "documentation" },
};

export interface AntTeam {
  readonly teamKind: TeamKind;
  readonly memberIds: readonly string[];
  readonly formedTick: number;
  readonly dimension: CognitiveDimension;
  /** Bounded cohesion 0..1. Collapse below the floor dissolves the team. */
  readonly cohesion: number;
  readonly dissolved: boolean;
  readonly dissolveReasonCode: string;
}

const SALT_TEAM = 0x632be5ab;
const COHESION_FLOOR = 0.25;

function teamDraw(colonySeed: number, seedA: number, seedB: number, salt: number): number {
  const h = (Math.imul(colonySeed ^ salt, 2654435761) ^ Math.imul(seedA + 1, 40503) ^ Math.imul(seedB + 1, 2246822519)) >>> 0;
  return createSeededRandom(h)();
}

/**
 * Attempt to form a team from a bounded candidate pool. Candidates volunteer on
 * skill + trust + energy; the team forms only if at least the minimum join.
 * Returns null when too few volunteer — a real "no team formed" outcome.
 */
export function tryFormTeam(params: {
  readonly teamKind: TeamKind;
  readonly candidatePool: readonly AntWithMind[];
  readonly colonySeed: number;
  readonly tick: number;
}): AntTeam | null {
  const { teamKind, candidatePool, colonySeed, tick } = params;
  const spec = TEAM_SPEC[teamKind];

  const volunteers = candidatePool
    .filter((candidate) => {
      const skill = candidate.mind.cognitiveProfile[spec.dimension];
      return skill >= 0.5 && candidate.mind.socialTrust >= 0.4 && candidate.ant.energy >= 0.25;
    })
    .slice(0, Math.min(spec.targetSize, MAX_TEAM_SIZE));

  const minimum = Math.min(2, spec.targetSize);
  if (volunteers.length < minimum) return null;

  // Initial cohesion from members' average trust and skill alignment.
  let trust = 0;
  let skill = 0;
  for (const member of volunteers) {
    trust += member.mind.socialTrust;
    skill += member.mind.cognitiveProfile[spec.dimension];
  }
  const cohesion = clamp((trust / volunteers.length) * 0.5 + (skill / volunteers.length) * 0.5, 0, 1);

  return {
    teamKind,
    memberIds: volunteers.map((v) => v.ant.antId),
    formedTick: tick,
    dimension: spec.dimension,
    cohesion: roundTo(cohesion, 4),
    dissolved: false,
    dissolveReasonCode: "active",
  };
}

export interface TeamAdvanceResult {
  readonly team: AntTeam;
  readonly dissolved: boolean;
  readonly split: boolean;
  readonly disagreement: boolean;
  readonly successfulCooperation: boolean;
  readonly failedCooperation: boolean;
}

/**
 * Advance a team one round of cooperation. Members' aligned assessments raise
 * cohesion and yield successful cooperation; a strong internal disagreement
 * lowers cohesion and can split the team; completing the work, or cohesion
 * collapse, dissolves it. Every outcome is a real state transition.
 */
export function advanceTeam(params: {
  readonly team: AntTeam;
  readonly members: readonly AntWithMind[];
  readonly colonySeed: number;
  readonly tick: number;
}): TeamAdvanceResult {
  const { team, members, colonySeed, tick } = params;
  if (team.dissolved) {
    return { team, dissolved: true, split: false, disagreement: false, successfulCooperation: false, failedCooperation: false };
  }

  // Spread of relevant skill across members drives (dis)agreement.
  let min = 1;
  let max = 0;
  let energy = 0;
  for (const member of members) {
    const skill = member.mind.cognitiveProfile[team.dimension];
    min = Math.min(min, skill);
    max = Math.max(max, skill);
    energy += member.ant.energy;
  }
  const spread = max - min;
  const jitter = (teamDraw(colonySeed, team.formedTick, tick, SALT_TEAM) - 0.5) * 0.2;
  const disagreement = spread > 0.45;

  let cohesion = clamp(team.cohesion + (disagreement ? -0.2 : 0.08) + jitter, 0, 1);
  const avgEnergy = members.length > 0 ? energy / members.length : 0;

  const successfulCooperation = !disagreement && cohesion >= 0.5 && avgEnergy >= 0.2;
  const failedCooperation = disagreement && cohesion < COHESION_FLOOR;
  const split = disagreement && members.length >= 3 && cohesion < 0.35;
  const completed = cohesion >= 0.85;
  const dissolved = completed || cohesion < COHESION_FLOOR || split;

  const dissolveReasonCode = !dissolved
    ? "active"
    : completed
      ? "work-completed"
      : split
        ? "split-on-disagreement"
        : "confidence-collapsed";

  return {
    team: { ...team, cohesion: roundTo(cohesion, 4), dissolved, dissolveReasonCode },
    dissolved,
    split,
    disagreement,
    successfulCooperation,
    failedCooperation,
  };
}
