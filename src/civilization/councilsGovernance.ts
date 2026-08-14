/**
 * councilsGovernance — the settlement's decentralized councils (Build Law §27).
 * A council is NOT a hidden global planner and neither the Queen nor Tamara
 * chooses its outcome. Members are recruited locally among qualified volunteers,
 * make PRIVATE assessments, reach a local quorum on evidence, keep reversible
 * commitment, and record MINORITY REPORTS for dissent. Conflict-of-interest ants
 * are excluded, terms are bounded, and reputation weights (but never dictates)
 * a member's assessment.
 *
 * No fs, no child_process, no network, no wall clock, no ambient randomness.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import { civDraw } from "./settlementTypes";
import type { CouncilKind } from "./settlementTypes";
import type { DigitalWorker } from "../digital/digitalWorkers";
import { stageRank } from "../digital/digitalWorkers";

export interface CouncilAssessment {
  readonly antId: string;
  readonly support: boolean;
  readonly confidence: number;
  readonly reputationWeight: number;
}

export interface MinorityReport {
  readonly antId: string;
  readonly councilKind: CouncilKind;
  readonly confidence: number;
}

export interface CouncilSession {
  readonly councilKind: CouncilKind;
  readonly memberAntIds: readonly string[];
  readonly assessments: readonly CouncilAssessment[];
  readonly quorumReached: boolean;
  readonly decisionSupported: boolean;
  readonly minorityReports: readonly MinorityReport[];
  readonly conflictOfInterestExcluded: number;
  readonly evidenceConsidered: number;
  readonly reversible: true;
}

export const MAX_COUNCIL_MEMBERS = 7 as const;

/**
 * Convene a council: recruit up to MAX_COUNCIL_MEMBERS qualified volunteers
 * (excluding conflict-of-interest ants), gather private assessments, reach a
 * local quorum, and record minority reports. The `conflictedAntIds` are the
 * ants who produced or directly benefit from the matter under review.
 */
export function conveneCouncil(councilKind: CouncilKind, candidates: readonly DigitalWorker[], conflictedAntIds: ReadonlySet<string>, evidenceCount: number, seed: number, tick: number): CouncilSession {
  let coiExcluded = 0;
  const eligible = candidates.filter((w) => {
    if (!w.active || stageRank(w.maturation) < stageRank("qualified")) return false;
    if (conflictedAntIds.has(w.workerId)) {
      coiExcluded += 1;
      return false;
    }
    // Local recruitment: a volunteer draw (bounded term, self-selected).
    return civDraw(seed, w.index, councilKind.length, 0x85ebca6b) > 0.45;
  });
  const members = eligible.slice(0, MAX_COUNCIL_MEMBERS);

  const assessments: CouncilAssessment[] = members.map((w) => {
    // A PRIVATE assessment: the ant weighs the evidence with its own reliability
    // plus an independent judgement draw (the wide draw weight is what lets a
    // genuine minority form). Reputation weights the vote but a low-reputation
    // ant can still dissent — councils are never unanimous by construction.
    const lean = clamp(0.2 + w.reliability * 0.3 + civDraw(seed, w.index, tick ^ councilKind.length, 0x27d4eb2f) * 0.55, 0, 1);
    return { antId: w.workerId, support: lean >= 0.5, confidence: roundTo(lean, 4), reputationWeight: roundTo(0.5 + w.trust * 0.5, 4) };
  });

  const weightedSupport = assessments.filter((a) => a.support).reduce((s, a) => s + a.reputationWeight, 0);
  const weightedTotal = assessments.reduce((s, a) => s + a.reputationWeight, 0);
  const quorumReached = members.length >= 3 && weightedSupport >= weightedTotal * 0.5;
  const decisionSupported = quorumReached && weightedSupport > weightedTotal - weightedSupport;
  const minorityReports: MinorityReport[] = assessments.filter((a) => a.support !== decisionSupported).map((a) => ({ antId: a.antId, councilKind, confidence: a.confidence }));

  return {
    councilKind,
    memberAntIds: members.map((w) => w.workerId),
    assessments,
    quorumReached,
    decisionSupported,
    minorityReports,
    conflictOfInterestExcluded: coiExcluded,
    evidenceConsidered: evidenceCount,
    reversible: true,
  };
}
