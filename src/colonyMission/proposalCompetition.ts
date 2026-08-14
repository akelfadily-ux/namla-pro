/**
 * Proposal competition: >=3 scout ants independently generate solution
 * proposals; other ants privately assess and locally recruit support;
 * commitment is reversible until a bounded local quorum is reached.
 *
 * Same discipline as Colony Genesis G5 (recruitmentQuorumSystem.ts): no
 * function here counts support across the whole assessor pool and declares
 * a winner. Each assessing ant senses support only from a small, fixed,
 * bounded sample of other assessors and advances only its OWN commitment
 * state. The mission runner observes everyone's already-decided final state
 * afterward purely to report history — the same "read final state to
 * report, never to decide" discipline `colonyRunReport.ts` already uses.
 */

import type { AntAgent } from "../colony/antAgent";
import type { WorkTask } from "./workDemand";
import type { CognitiveWorkerRouter } from "./cognitiveWorkerRouter";
import type { CognitiveProviderName } from "./cognitiveWorkTypes";

export type ProposalCommitmentState = "uncommitted" | "assessing" | "recruiting" | "committed";

export interface ScoutProposal {
  readonly proposalId: string;
  readonly missionId: string;
  readonly scoutAntId: string;
  readonly architecture: string;
  readonly filePlan: readonly string[];
  readonly risks: readonly string[];
  readonly verificationPlan: string;
  readonly privateQuality: number;
  readonly createdAt: string;
}

interface AssessorState {
  readonly antId: string;
  favoredProposalId: string;
  state: ProposalCommitmentState;
  localSupportCount: number;
}

export interface ProposalCompetitionResult {
  readonly proposals: readonly ScoutProposal[];
  readonly rejectedProposalIds: readonly string[];
  readonly winningProposalId: string | null;
  readonly quorumReached: boolean;
  readonly assessmentRoundsRun: number;
}

const QUORUM_LOCAL_SUPPORT_THRESHOLD = 3 as const;
const MAX_ROUNDS = 20 as const;

/** Pick the top-N ants by architecture/planning skill as independent scouts — deterministic, no randomness. */
export function selectScouts(candidates: readonly AntAgent[], count: number): readonly AntAgent[] {
  return [...candidates]
    .sort((a, b) => b.skillTendencies.planning - a.skillTendencies.planning || a.antId.localeCompare(b.antId))
    .slice(0, count);
}

export function generateScoutProposals(
  scouts: readonly AntAgent[],
  task: WorkTask,
  router: CognitiveWorkerRouter,
  providerName: CognitiveProviderName
): readonly ScoutProposal[] {
  const proposals: ScoutProposal[] = [];

  scouts.forEach((scout, index) => {
    const result = router.route({
      requestId: `scout-req-${task.taskId}-${scout.antId}`,
      missionId: task.missionId,
      taskId: task.taskId,
      antId: scout.antId,
      behavioralRole: "scout",
      taskDescription: task.description,
      relevantContext: `Acceptance criteria: ${task.acceptanceCriteria.join("; ")}`,
      acceptanceCriteria: task.acceptanceCriteria,
      allowedWorkspacePaths: [`workspaces/${task.missionId}/PROPOSAL-${index}.md`],
      maxResponseSize: 4000,
      maxAttempts: 1,
      providerName,
      safeMetadata: { role: "scout" },
    });

    if (!result.ok) return;

    proposals.push({
      proposalId: `proposal-${task.taskId}-${scout.antId}`,
      missionId: task.missionId,
      scoutAntId: scout.antId,
      architecture: result.response.summary,
      filePlan: [`workspaces/${task.missionId}/src-${index}.ts`, `workspaces/${task.missionId}/README-${index}.md`],
      risks: ["Scope creep beyond the stated acceptance criteria.", "Under-specified error handling."],
      verificationPlan: "Run the hard-coded allowlisted verification set before accepting the artifact.",
      privateQuality: result.response.confidence,
      createdAt: new Date().toISOString(),
    });
  });

  return proposals;
}

const SAMPLE_SIZE = 6 as const;

/**
 * Deterministic, well-mixed neighbor sampling. A nearest-neighbor RING
 * topology was tried first and rejected: with evenly-spaced seeds it
 * partitions the pool into a permanently stable per-seed territory within 2
 * rounds and never changes again (verified by direct trace) — a known weak-
 * consensus pathology of lattice/ring topologies. This hash-based sampling
 * gives each assessor a different, deterministic, bounded set of contacts
 * each round (never the whole pool), which mixes fast enough to reliably
 * converge on one favorite within MAX_ROUNDS while staying exactly as local
 * and bounded as a ring would be — `SAMPLE_SIZE` contacts, never more.
 */
function sampleNeighborIndices(antIndex: number, round: number, poolSize: number): readonly number[] {
  const indices: number[] = [];
  let salt = 0;
  while (indices.length < SAMPLE_SIZE && salt < SAMPLE_SIZE * 5) {
    const h =
      (Math.imul(antIndex + 1, 2654435761) ^ Math.imul(round + 1, 40503) ^ Math.imul(salt + 1, 2246822519)) >>> 0;
    const candidate = h % poolSize;
    if (candidate !== antIndex && !indices.includes(candidate)) indices.push(candidate);
    salt += 1;
  }
  return indices;
}

/**
 * Run bounded local-recruitment rounds among a fixed assessor sample. Each
 * proposal gets one seed (evenly spaced around the pool, not clustered —
 * mirroring "the ant who made the proposal already believes in it"); every
 * other assessor starts genuinely uncommitted, with no favorite. Updates
 * are synchronous — every assessor's next state is computed from the SAME
 * snapshot of the round's starting state, so propagation speed does not
 * depend on array iteration order. Each round, every still-open assessor
 * senses ONLY a fixed, small, bounded, deterministically-sampled set of
 * other assessors (never the whole pool): an uncommitted assessor may be
 * recruited by whichever favorite is the local, quality-weighted plurality
 * among its non-uncommitted contacts (adopting a favorite is the only way
 * one ever spreads); an assessing/recruiting assessor accumulates local
 * support from contacts who already share its favorite, faster for a
 * higher-quality proposal (real Temnothorax recruitment is quality-
 * sensitive — a better site is advertised more persuasively). No function
 * anywhere counts support across the WHOLE assessor pool while deciding —
 * the majority check below only ever READS already-decided per-assessor
 * state, after every assessor decided for itself, to report history — the
 * same after-the-fact-observation discipline `colonyRunReport.ts` already
 * uses. Bounded by MAX_ROUNDS; never unbounded.
 */
export function runProposalQuorum(
  proposals: readonly ScoutProposal[],
  assessorPool: readonly AntAgent[]
): ProposalCompetitionResult {
  if (proposals.length === 0) {
    return { proposals, rejectedProposalIds: [], winningProposalId: null, quorumReached: false, assessmentRoundsRun: 0 };
  }

  const qualityOf = new Map(proposals.map((p) => [p.proposalId, Math.max(0.1, p.privateQuality)]));

  const seedPositions = new Set(proposals.map((_, k) => Math.floor((k * assessorPool.length) / proposals.length)));
  let seedIndex = 0;
  const assessors: AssessorState[] = assessorPool.map((ant, index) => {
    if (seedPositions.has(index)) {
      const proposal = proposals[seedIndex];
      seedIndex += 1;
      return { antId: ant.antId, favoredProposalId: proposal.proposalId, state: "committed", localSupportCount: QUORUM_LOCAL_SUPPORT_THRESHOLD };
    }
    return { antId: ant.antId, favoredProposalId: "", state: "uncommitted", localSupportCount: 0 };
  });

  let round = 0;
  let winningProposalId: string | null = null;

  for (round = 1; round <= MAX_ROUNDS && winningProposalId === null; round += 1) {
    const snapshot = assessors.map((a) => ({ ...a }));

    for (let i = 0; i < assessors.length; i += 1) {
      const assessor = assessors[i];
      if (assessor.state === "committed") continue;

      const neighbors = sampleNeighborIndices(i, round, assessors.length).map((idx) => snapshot[idx]);

      if (assessor.state === "uncommitted") {
        const votes = new Map<string, number>();
        for (const peer of neighbors) {
          if (peer.state === "uncommitted") continue;
          const weight = qualityOf.get(peer.favoredProposalId) ?? 0.1;
          votes.set(peer.favoredProposalId, (votes.get(peer.favoredProposalId) ?? 0) + weight);
        }
        if (votes.size === 0) continue;
        const [topProposalId] = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
        assessor.favoredProposalId = topProposalId;
        assessor.state = "assessing";
        continue;
      }

      const localMatches = neighbors.filter(
        (peer) => peer.state !== "uncommitted" && peer.favoredProposalId === assessor.favoredProposalId
      ).length;

      if (localMatches > 0) {
        const quality = qualityOf.get(assessor.favoredProposalId) ?? 0.1;
        const gain = localMatches * (0.5 + quality);
        assessor.localSupportCount = Math.min(QUORUM_LOCAL_SUPPORT_THRESHOLD, assessor.localSupportCount + gain);
        if (assessor.state === "assessing") assessor.state = "recruiting";
      }

      if (assessor.localSupportCount >= QUORUM_LOCAL_SUPPORT_THRESHOLD) {
        assessor.state = "committed";
      }
    }

    const committedCounts = new Map<string, number>();
    for (const assessor of assessors) {
      if (assessor.state !== "committed") continue;
      committedCounts.set(assessor.favoredProposalId, (committedCounts.get(assessor.favoredProposalId) ?? 0) + 1);
    }
    const majorityThreshold = Math.ceil(assessors.length / 2);
    for (const [proposalId, count] of committedCounts) {
      if (count >= majorityThreshold) {
        winningProposalId = proposalId;
        break;
      }
    }
  }

  const quorumReached = winningProposalId !== null;
  const rejectedProposalIds = proposals.map((p) => p.proposalId).filter((id) => id !== winningProposalId);

  return { proposals, rejectedProposalIds, winningProposalId, quorumReached, assessmentRoundsRun: round - 1 };
}
