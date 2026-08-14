/**
 * colonyMission — structured artifact types.
 *
 * A cognitive builder ant never writes directly to disk. It produces a
 * structured ArtifactProposal — data describing an intended change — which
 * must pass review before MissionWorkspace ever applies it. This mirrors
 * the existing CodeProposal / PlannedAction discipline used everywhere else
 * in Namla Pro: propose as data first, apply only after a gate.
 */

export type ArtifactChangeKind =
  | "create-file"
  | "modify-file"
  | "documentation"
  | "test-file"
  | "configuration-file"
  | "review-comment"
  | "repair-proposal";

export interface ArtifactProposal {
  readonly artifactId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly antId: string;
  readonly targetRelativePath: string;
  readonly changeKind: ArtifactChangeKind;
  readonly content: string;
  readonly contentFingerprint: string;
  readonly reason: string;
  readonly acceptanceCriteriaRef: string;
  readonly confidence: number;
  readonly requiresReview: true;
  readonly createdAt: string;
}

export type ReviewVerdict = "adequate" | "defects-found" | "major-concern";

export interface ReviewObservation {
  readonly reviewId: string;
  readonly artifactId: string;
  readonly reviewerAntId: string;
  readonly verdict: ReviewVerdict;
  readonly checks: {
    readonly correctness: boolean;
    readonly architecture: boolean;
    readonly security: boolean;
    readonly workspaceBoundary: boolean;
    readonly requirementsCovered: boolean;
  };
  readonly notes: string;
  readonly createdAt: string;
}

export type VerificationOutcome = "passed" | "failed";

/**
 * Every verification result produced in this phase is simulated — see
 * docs/real-provider-adapters.md for why real command execution stays
 * refused. `simulated: true` is a literal type, matching the same
 * unrepresentable-as-real discipline `AgentResponse.simulated` already uses.
 */
export interface VerificationResult {
  readonly verificationId: string;
  readonly missionId: string;
  readonly commandLabel: string;
  readonly outcome: VerificationOutcome;
  readonly summary: string;
  readonly simulated: true;
  readonly createdAt: string;
}
