/**
 * CommandCenterState: the real state model a future command-center UI would
 * render. Not decorative — this is the actual data MissionRunner produces
 * as a mission executes, aggregated into one snapshot.
 */

import type { ActionReceipt } from "../types/receiptTypes";
import type { ArtifactProposal, ReviewObservation, VerificationResult } from "./artifactTypes";
import type { CognitiveBehavioralRole, CognitiveProviderName } from "./cognitiveWorkTypes";
import type { ScoutProposal } from "./proposalCompetition";
import type { VoluntaryClaim, WorkCategory } from "./workDemand";

export interface ProviderCallRecord {
  readonly antId: string;
  readonly providerName: CognitiveProviderName;
  readonly behavioralRole: CognitiveBehavioralRole;
  readonly status: "completed" | "failed" | "refused";
}

export type MissionOutcome = "success" | "failed" | "incomplete";

/**
 * R2: the safe projection of one real/fake provider activation. Carries only
 * flags, a category, ids, and a receipt id — never a raw prompt, raw private
 * AntMind, raw stdout/stderr, credentials, or environment.
 */
export interface ProviderActivationSummary {
  readonly realProviderEnabled: boolean;
  readonly providerSelected: "claude" | "codex" | "none";
  readonly permitValid: boolean;
  readonly permitConsumed: boolean;
  readonly providerInvocationStarted: boolean;
  readonly providerInvocationCompleted: boolean;
  readonly providerTimedOut: boolean;
  readonly providerOutputTruncated: boolean;
  readonly providerFailureCategory: string;
  readonly providerReceiptId: string | null;
}

export interface CommandCenterState {
  readonly missionId: string;
  readonly missionGoal: string;
  readonly colonyPopulation: { readonly total: number; readonly queenIdentities: number; readonly workerIdentities: number };
  readonly workDemandByCategory: Readonly<Record<WorkCategory, number>>;
  readonly voluntaryClaims: readonly VoluntaryClaim[];
  readonly acceptedClaims: readonly VoluntaryClaim[];
  readonly admittedCognitiveAntIds: readonly string[];
  readonly peakCognitiveAnts: number;
  readonly providerCalls: readonly ProviderCallRecord[];
  readonly scoutProposals: readonly ScoutProposal[];
  readonly quorumWinningProposalId: string | null;
  readonly quorumReached: boolean;
  readonly rejectedProposalIds: readonly string[];
  readonly artifactProposals: readonly ArtifactProposal[];
  readonly reviews: readonly ReviewObservation[];
  readonly verificationResults: readonly VerificationResult[];
  readonly repairRounds: number;
  readonly receipts: readonly ActionReceipt[];
  readonly finalOutcome: MissionOutcome;
  /** R2: present only when a provider activation was attempted (null otherwise). */
  readonly providerActivation: ProviderActivationSummary | null;
}

export class CommandCenterStateBuilder {
  private readonly voluntaryClaims: VoluntaryClaim[] = [];
  private readonly acceptedClaims: VoluntaryClaim[] = [];
  private readonly admittedCognitiveAntIds: string[] = [];
  private peakCognitiveAnts = 0;
  private readonly providerCalls: ProviderCallRecord[] = [];
  private scoutProposals: readonly ScoutProposal[] = [];
  private quorumWinningProposalId: string | null = null;
  private quorumReached = false;
  private rejectedProposalIds: readonly string[] = [];
  private readonly artifactProposals: ArtifactProposal[] = [];
  private readonly reviews: ReviewObservation[] = [];
  private readonly verificationResults: VerificationResult[] = [];
  private repairRounds = 0;
  private finalOutcome: MissionOutcome = "incomplete";
  private providerActivation: ProviderActivationSummary | null = null;

  constructor(
    private readonly missionId: string,
    private readonly missionGoal: string,
    private readonly colonyPopulation: { total: number; queenIdentities: number; workerIdentities: number },
    private readonly workDemandByCategory: Record<WorkCategory, number>
  ) {}

  recordClaims(claims: readonly VoluntaryClaim[]): void {
    this.voluntaryClaims.push(...claims);
  }

  recordAcceptedClaim(claim: VoluntaryClaim): void {
    this.acceptedClaims.push(claim);
  }

  recordCognitiveAdmission(antId: string, currentActiveCount: number): void {
    this.admittedCognitiveAntIds.push(antId);
    this.peakCognitiveAnts = Math.max(this.peakCognitiveAnts, currentActiveCount);
  }

  recordProviderCall(record: ProviderCallRecord): void {
    this.providerCalls.push(record);
  }

  recordProposals(proposals: readonly ScoutProposal[]): void {
    this.scoutProposals = proposals;
  }

  recordQuorum(winningProposalId: string | null, quorumReached: boolean, rejectedProposalIds: readonly string[]): void {
    this.quorumWinningProposalId = winningProposalId;
    this.quorumReached = quorumReached;
    this.rejectedProposalIds = rejectedProposalIds;
  }

  recordArtifact(artifact: ArtifactProposal): void {
    this.artifactProposals.push(artifact);
  }

  recordReview(review: ReviewObservation): void {
    this.reviews.push(review);
  }

  recordVerification(result: VerificationResult): void {
    this.verificationResults.push(result);
  }

  recordRepairRound(): void {
    this.repairRounds += 1;
  }

  setFinalOutcome(outcome: MissionOutcome): void {
    this.finalOutcome = outcome;
  }

  /** R2: record one provider activation's safe projection (no raw content). */
  recordProviderActivation(summary: ProviderActivationSummary): void {
    this.providerActivation = summary;
  }

  snapshot(receipts: readonly ActionReceipt[]): CommandCenterState {
    return {
      missionId: this.missionId,
      missionGoal: this.missionGoal,
      colonyPopulation: { ...this.colonyPopulation },
      workDemandByCategory: { ...this.workDemandByCategory },
      voluntaryClaims: [...this.voluntaryClaims],
      acceptedClaims: [...this.acceptedClaims],
      admittedCognitiveAntIds: [...this.admittedCognitiveAntIds],
      peakCognitiveAnts: this.peakCognitiveAnts,
      providerCalls: [...this.providerCalls],
      scoutProposals: this.scoutProposals,
      quorumWinningProposalId: this.quorumWinningProposalId,
      quorumReached: this.quorumReached,
      rejectedProposalIds: this.rejectedProposalIds,
      artifactProposals: [...this.artifactProposals],
      reviews: [...this.reviews],
      verificationResults: [...this.verificationResults],
      repairRounds: this.repairRounds,
      receipts,
      finalOutcome: this.finalOutcome,
      providerActivation: this.providerActivation,
    };
  }
}
