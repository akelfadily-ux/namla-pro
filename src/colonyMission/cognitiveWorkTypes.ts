/**
 * colonyMission — the canonical, provider-neutral cognitive worker contract.
 *
 * A CognitiveWorkRequest is what an admitted ant sends; a CognitiveWorkResult
 * is what comes back. No colony decision module imports a provider-specific
 * type — every provider (fake, Claude, Codex) implements the same
 * CognitiveWorkerContract, so provider identity never leaks into task
 * choice, claim resolution, or quorum. This is the SAME discipline
 * `src/colony/cognitiveBudgetSystem.ts`'s `CognitiveWorkerContract` already
 * established for Colony Genesis G7; this is a separate, richer contract for
 * the mission layer, not a replacement of that one.
 *
 * `realExecutionEnabled` is a literal `false` on every profile shipped in
 * this phase — see docs/real-provider-adapters.md for why.
 */

import type { ArtifactProposal } from "./artifactTypes";

export type CognitiveProviderName = "fake" | "claude" | "codex";

export type CognitiveBehavioralRole = "scout" | "builder" | "reviewer" | "tester" | "repair";

export interface CognitiveWorkRequest {
  readonly requestId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly antId: string;
  readonly behavioralRole: CognitiveBehavioralRole;
  /** Bounded — enforced by CognitiveRequestValidator before submission. */
  readonly taskDescription: string;
  readonly relevantContext: string;
  readonly acceptanceCriteria: readonly string[];
  readonly allowedWorkspacePaths: readonly string[];
  readonly maxResponseSize: number;
  readonly maxAttempts: number;
  readonly providerName: CognitiveProviderName;
  readonly safeMetadata: Readonly<Record<string, string | number | boolean>>;
}

export type CognitiveWorkStatus = "completed" | "failed" | "refused";

export interface CognitiveWorkResponse {
  readonly requestId: string;
  readonly antId: string;
  readonly status: CognitiveWorkStatus;
  readonly summary: string;
  readonly artifactProposals: readonly ArtifactProposal[];
  readonly reviewObservations: readonly string[];
  readonly verificationSuggestions: readonly string[];
  readonly confidence: number;
  readonly usageMetadata: Readonly<Record<string, number>>;
  readonly safeFailureCategory?: string;
  readonly createdAt: string;
}

export interface CognitiveWorkRefusal {
  readonly requestId: string;
  readonly antId: string;
  readonly reasonCode: string;
  readonly createdAt: string;
}

export type CognitiveWorkResult =
  | { readonly ok: true; readonly response: CognitiveWorkResponse }
  | { readonly ok: false; readonly refusal: CognitiveWorkRefusal };

export interface CognitiveWorkerProfile {
  readonly providerName: CognitiveProviderName;
  readonly displayName: string;
  readonly supportedRoles: readonly CognitiveBehavioralRole[];
  readonly realExecutionEnabled: false;
}

/**
 * The one shape every provider satisfies. `submit` never throws for an
 * ordinary refusal — those come back as `{ ok: false, refusal }`. No
 * provider-specific field exists on this interface; provider identity lives
 * only in `profile.providerName` and `request.providerName`.
 */
export interface CognitiveWorkerContract {
  readonly profile: CognitiveWorkerProfile;
  submit(request: CognitiveWorkRequest): CognitiveWorkResult;
}
