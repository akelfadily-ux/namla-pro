/**
 * Colony Genesis G5 — recruitment and local quorum sensing.
 *
 * Source: Temnothorax albipennis house-hunting (Franks, Pratt). Scouts assess
 * candidate sites independently and hold private opinions; recruitment
 * spreads by direct contact, not broadcast; commitment is reversible until a
 * locally sensed quorum is reached.
 *
 * Design commitment (docs/ant-colony-biological-model.md, section 3): quorum
 * OBSERVES AND RECORDS, never tallies and decides. No function here counts
 * support across the population or declares a winner. Every commitment
 * transition belongs to exactly one ant, computed from only that ant's own
 * bounded state and its own bounded chamber-local encounter this tick.
 *
 * Candidate ids are a digital adaptation (no Temnothorax analogue for a
 * software colony's "candidate site") and are deterministic, seeded, and
 * chamber-local: a pure function of (colonySeed, chamberId) only — no
 * population, roster, or cross-chamber input, so there is never a stored
 * structure enumerating "every candidate in the colony."
 *
 * Recruitment and quorum sensing both reuse the exact same bounded partner
 * `encounterNetwork.firstEncounterOffset` already computes for that ant this
 * tick — not a second, separately unbounded contact.
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 14 (Colony Genesis G4-G5).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state.
 */

import type { AntAgent, PrivateCandidateAssessment } from "./antAgent";
import type { CommitmentState } from "./antAgent";
import type { ColonyPheromoneType } from "./colonyTypes";
import { clamp, createSeededRandom, roundTo } from "./colonyTypes";
import type { ChamberId } from "./nestGraph";
import { firstEncounterOffset } from "./encounterNetwork";

/** Bounded: at most this many private candidate opinions remembered per ant. */
export const MAX_CANDIDATE_MEMORY = 8 as const;

/** Fixed, small, chamber-local candidate namespace. Never population-wide. */
const CANDIDATES_PER_CHAMBER = 2 as const;

/** A freshly formed private assessment this good starts life already "recruiting". */
const RECRUITING_QUALITY_THRESHOLD = 0.6;

/** Per-tick chance an uncommitted ant spontaneously assesses one of its chamber's candidates. */
const ASSESS_CHANCE = 0.05;

const SALT_ASSESS_GATE = 0x1c69b3f7;
const SALT_ASSESS_PICK = 0x27d4eb2f;
const SALT_ASSESS_QUALITY = 0x165667b1;
const SALT_RECRUIT_QUALITY = 0x9c8f2f3b;

function drawFor(colonySeed: number, antIndex: number, tick: number, salt: number): number {
  const h =
    (Math.imul(colonySeed ^ salt, 2654435761) ^ Math.imul(antIndex + 1, 40503) ^ Math.imul(tick + 1, 2246822519)) >>> 0;
  return createSeededRandom(h)();
}

function hashChamberId(chamberId: ChamberId): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < chamberId.length; i += 1) hash = Math.imul(hash ^ chamberId.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/**
 * Deterministic, seeded, chamber-local candidate ids. Pure function of
 * `(colonySeed, chamberId)` only — no ant, population, or roster input, so
 * there is no global candidate board, no central winner, and no
 * population-wide tally derivable from this function by construction.
 */
export function candidateIdsForChamber(colonySeed: number, chamberId: ChamberId): readonly string[] {
  const ids: string[] = [];
  for (let n = 0; n < CANDIDATES_PER_CHAMBER; n += 1) {
    const h = (Math.imul(colonySeed ^ hashChamberId(chamberId), 2654435761) ^ Math.imul(n + 1, 40503)) >>> 0;
    ids.push(`candidate-${chamberId}-${h.toString(36)}`);
  }
  return ids;
}

function capAssessments(list: readonly PrivateCandidateAssessment[]): readonly PrivateCandidateAssessment[] {
  return list.length > MAX_CANDIDATE_MEMORY ? list.slice(list.length - MAX_CANDIDATE_MEMORY) : list;
}

function commitmentStateForNewAssessment(privateQuality: number): "assessing" | "recruiting" {
  return privateQuality >= RECRUITING_QUALITY_THRESHOLD ? "recruiting" : "assessing";
}

/** The candidate this ant currently favors most, from only its own bounded memory. */
export function topCandidateId(ant: AntAgent): string | null {
  if (ant.privateCandidateAssessments.length === 0) return null;
  let best = ant.privateCandidateAssessments[0];
  for (const entry of ant.privateCandidateAssessments.slice(1)) {
    if (
      entry.privateQuality > best.privateQuality ||
      (entry.privateQuality === best.privateQuality && entry.assessedAtTick > best.assessedAtTick) ||
      (entry.privateQuality === best.privateQuality &&
        entry.assessedAtTick === best.assessedAtTick &&
        entry.candidateId > best.candidateId)
    ) {
      best = entry;
    }
  }
  return best.candidateId;
}

/**
 * An uncommitted ant may, with a small seeded chance, spontaneously assess
 * one of its OWN chamber's candidates from only its own seeded stream and
 * its own chamber's already-authorized pheromone reads. Reads and writes
 * only the ant passed in.
 */
export function maybeFormNewAssessment(
  ant: AntAgent,
  colonySeed: number,
  tick: number,
  pheromonesHere: Readonly<Record<ColonyPheromoneType, number>>
): AntAgent {
  if (ant.commitmentState !== "uncommitted") return ant;

  const gateDraw = drawFor(colonySeed, ant.antIndex, tick, SALT_ASSESS_GATE);
  if (gateDraw >= ASSESS_CHANCE) return ant;

  const candidates = candidateIdsForChamber(colonySeed, ant.chamberId);
  if (candidates.length === 0) return ant;

  const pickDraw = drawFor(colonySeed, ant.antIndex, tick, SALT_ASSESS_PICK);
  const candidateId = candidates[Math.min(candidates.length - 1, Math.floor(pickDraw * candidates.length))];

  const qualityDraw = drawFor(colonySeed, ant.antIndex, tick, SALT_ASSESS_QUALITY);
  const opportunityBonus = (pheromonesHere.opportunity + pheromonesHere["knowledge-found"]) * 0.15;
  const privateQuality = roundTo(clamp(qualityDraw * 0.75 + opportunityBonus, 0, 1), 4);

  const assessment: PrivateCandidateAssessment = { candidateId, privateQuality, assessedAtTick: tick };

  return {
    ...ant,
    privateCandidateAssessments: capAssessments([...ant.privateCandidateAssessments, assessment]),
    commitmentState: commitmentStateForNewAssessment(privateQuality),
  };
}

export interface RecruitmentQuorumResult {
  readonly ants: readonly AntAgent[];
  readonly recruitmentEvents: number;
  readonly quorumLocalCommitments: number;
}

const QUORUM_SENSITIVE_STATES: readonly CommitmentState[] = ["assessing", "recruiting"];
const SUPPORTING_STATES: readonly CommitmentState[] = ["recruiting", "committed"];

/**
 * One bounded, chamber-local pass over ants sharing a chamber this tick.
 * Reuses each ant's own real first encounter partner (the same one
 * `encounterNetwork.runChamberEncounters` computes for it this tick) for
 * both recruitment and quorum sensing — never a second, separately unbounded
 * contact, never a population-wide scan.
 */
export function runChamberRecruitmentAndQuorum(
  ants: readonly AntAgent[],
  colonySeed: number,
  tick: number,
  quorumThreshold: number
): RecruitmentQuorumResult {
  const groups = new Map<ChamberId, AntAgent[]>();
  for (const ant of ants) {
    const group = groups.get(ant.chamberId);
    if (group) group.push(ant);
    else groups.set(ant.chamberId, [ant]);
  }

  const updatedById = new Map<string, AntAgent>();
  let recruitmentEvents = 0;
  let quorumLocalCommitments = 0;

  for (const members of groups.values()) {
    const groupSize = members.length;
    if (groupSize < 2) continue;

    for (let i = 0; i < groupSize; i += 1) {
      const actingOriginal = members[i];
      const offset = firstEncounterOffset(colonySeed, actingOriginal.antIndex, tick, groupSize);
      const partnerIndex = (i + offset) % groupSize;
      if (partnerIndex === i) continue;
      const partnerOriginal = members[partnerIndex];

      // Each read reflects any update from an EARLIER iteration this tick
      // (this same ant as someone else's partner), but never a same-iteration
      // echo of the write this iteration itself is about to make.
      const acting = updatedById.get(actingOriginal.antId) ?? actingOriginal;
      const partner = updatedById.get(partnerOriginal.antId) ?? partnerOriginal;

      // --- Recruitment: directed, one tick, acting -> partner only. ---
      if (acting.commitmentState === "recruiting" && partner.commitmentState === "uncommitted") {
        const candidateId = topCandidateId(acting);
        if (candidateId) {
          const qualityDraw = drawFor(colonySeed, partnerOriginal.antIndex, tick, SALT_RECRUIT_QUALITY);
          const privateQuality = roundTo(clamp(qualityDraw * 0.75, 0, 1), 4);
          const assessment: PrivateCandidateAssessment = { candidateId, privateQuality, assessedAtTick: tick };
          updatedById.set(partner.antId, {
            ...partner,
            privateCandidateAssessments: capAssessments([...partner.privateCandidateAssessments, assessment]),
            commitmentState: commitmentStateForNewAssessment(privateQuality),
          });
          recruitmentEvents += 1;
        }
      }

      // --- Local quorum sensing: acting senses ONLY partner's pre-tick state. ---
      if (QUORUM_SENSITIVE_STATES.includes(acting.commitmentState)) {
        const myTop = topCandidateId(acting);
        const partnerSupports =
          myTop !== null && SUPPORTING_STATES.includes(partner.commitmentState) && topCandidateId(partner) === myTop;

        if (partnerSupports) {
          const nextSupport = Math.min(quorumThreshold, acting.localQuorumSupportCount + 1);
          const crossed = nextSupport >= quorumThreshold;
          const nextCommitment: CommitmentState = crossed
            ? acting.commitmentState === "assessing"
              ? "recruiting"
              : "committed"
            : acting.commitmentState;
          if (crossed && nextCommitment === "committed") quorumLocalCommitments += 1;

          updatedById.set(acting.antId, {
            ...acting,
            localQuorumSupportCount: crossed ? 0 : nextSupport,
            commitmentState: nextCommitment,
          });
        }
      }
    }
  }

  const resultAnts = ants.map((ant) => updatedById.get(ant.antId) ?? ant);
  return { ants: resultAnts, recruitmentEvents, quorumLocalCommitments };
}
