/**
 * MultiProviderPilotPermit — the bounded academy-pilot capability token
 * (Build Law §21). SEPARATE from the R2 one-request permit: a pilot permit
 * authorizes one live training pilot of 1-5 voluntary ants with at most 5
 * total real provider calls; each accepted ant then receives its own
 * single-use R2-style member permit (minted in one bounded batch from the
 * same single typed human confirmation).
 *
 * Identity discipline mirrors R2: validity is membership in a module-private
 * WeakSet, the object is frozen, and a JSON round-trip / object literal /
 * mission datum / ant / Queen / Tamara object is never valid. Human-only
 * minting: the real path requires a `HumanConfirmation` (TTY + exact typed
 * phrase); automated tests mint "automated-test"-origin pilots that the real
 * driver path refuses. Single-use is process-local; no durable replay claim.
 * A permit can never be delegated to an ant or a provider — neither is code
 * that can hold one.
 *
 * No fs, no child_process, no network.
 */

import type { HumanConfirmation, PermitOrigin, PermitScope, RealProviderExecutionPermit, RealProviderId } from "./realProviderExecutionPermit";
import { MAX_PILOT_MEMBER_PERMITS, mintHumanConfirmedPermitBatch, mintPermitForAutomatedTest } from "./realProviderExecutionPermit";
import type { AcademyDomain, DifficultyLevel } from "../academy/academyDomains";

export const MAX_PILOT_COHORT = 5 as const;
export const MAX_PILOT_PROVIDER_CALLS = 5 as const;

export interface PilotScope {
  readonly pilotId: string;
  readonly objectiveId: string;
  readonly academyDomain: AcademyDomain;
  readonly difficulty: DifficultyLevel;
  readonly allowedProviders: readonly RealProviderId[];
  readonly workspaceId: string;
  readonly maxCohortSize: number;
  readonly maxProviderCalls: number;
  readonly maxAggregateInputBytes: number;
  readonly maxAggregateOutputBytes: number;
  readonly perCallTimeoutMs: number;
  readonly maxPilotSteps: number;
}

export interface MultiProviderPilotPermit {
  readonly pilotId: string;
  readonly objectiveId: string;
  readonly academyDomain: AcademyDomain;
  readonly difficulty: DifficultyLevel;
  readonly allowedProviders: readonly RealProviderId[];
  readonly workspaceId: string;
  /** Clamped to MAX_PILOT_COHORT (5). */
  readonly maxCohortSize: number;
  /** Clamped to MAX_PILOT_PROVIDER_CALLS (5). */
  readonly maxProviderCalls: number;
  readonly maxAggregateInputBytes: number;
  readonly maxAggregateOutputBytes: number;
  readonly perCallTimeoutMs: number;
  readonly maxPilotSteps: number;
  readonly origin: PermitOrigin;
  readonly humanConfirmed: boolean;
}

const VALID_PILOT_PERMITS = new WeakSet<object>();
const CONSUMED_PILOT_PERMITS = new WeakSet<object>();

function mintPilot(scope: PilotScope, origin: PermitOrigin, humanConfirmed: boolean): MultiProviderPilotPermit {
  const permit: MultiProviderPilotPermit = Object.freeze({
    pilotId: scope.pilotId,
    objectiveId: scope.objectiveId,
    academyDomain: scope.academyDomain,
    difficulty: scope.difficulty,
    allowedProviders: Object.freeze([...scope.allowedProviders]),
    workspaceId: scope.workspaceId,
    maxCohortSize: Math.min(Math.max(1, Math.floor(scope.maxCohortSize)), MAX_PILOT_COHORT),
    maxProviderCalls: Math.min(Math.max(1, Math.floor(scope.maxProviderCalls)), MAX_PILOT_PROVIDER_CALLS),
    maxAggregateInputBytes: scope.maxAggregateInputBytes,
    maxAggregateOutputBytes: scope.maxAggregateOutputBytes,
    perCallTimeoutMs: scope.perCallTimeoutMs,
    maxPilotSteps: scope.maxPilotSteps,
    origin,
    humanConfirmed,
  });
  VALID_PILOT_PERMITS.add(permit);
  return permit;
}

export interface HumanPilotMint {
  readonly pilotPermit: MultiProviderPilotPermit;
  /** One single-use, human-cli member permit per accepted cohort ant. */
  readonly memberPermits: readonly RealProviderExecutionPermit[];
}

/**
 * The REAL path: one typed human confirmation mints the pilot permit AND its
 * bounded batch of per-ant member permits (≤5). The confirmation is redeemed
 * exactly once by the batch mint; a reused or forged confirmation yields null.
 */
export function mintHumanPilotPermit(scope: PilotScope, memberScopes: readonly PermitScope[], confirmation: HumanConfirmation): HumanPilotMint | null {
  if (memberScopes.length === 0 || memberScopes.length > Math.min(scope.maxCohortSize, MAX_PILOT_COHORT)) return null;
  if (memberScopes.length > MAX_PILOT_MEMBER_PERMITS) return null;
  const memberPermits = mintHumanConfirmedPermitBatch(memberScopes, confirmation);
  if (!memberPermits) return null;
  return { pilotPermit: mintPilot(scope, "human-cli", true), memberPermits };
}

/** Automated-test path: fake-driver demos only; the real driver refuses these. */
export function mintPilotPermitForAutomatedTest(scope: PilotScope, memberScopes: readonly PermitScope[]): HumanPilotMint | null {
  if (memberScopes.length === 0 || memberScopes.length > Math.min(scope.maxCohortSize, MAX_PILOT_COHORT)) return null;
  return {
    pilotPermit: mintPilot(scope, "automated-test", false),
    memberPermits: memberScopes.map((s) => mintPermitForAutomatedTest(s)),
  };
}

export function isValidPilotPermit(candidate: unknown): candidate is MultiProviderPilotPermit {
  return typeof candidate === "object" && candidate !== null && VALID_PILOT_PERMITS.has(candidate as object);
}

export function isPilotConsumed(permit: MultiProviderPilotPermit): boolean {
  return CONSUMED_PILOT_PERMITS.has(permit as unknown as object);
}

/** Single-use: first consumption wins; replay refuses. No un-consume exists. */
export function consumePilotPermit(permit: MultiProviderPilotPermit): boolean {
  if (!isValidPilotPermit(permit)) return false;
  if (CONSUMED_PILOT_PERMITS.has(permit as unknown as object)) return false;
  CONSUMED_PILOT_PERMITS.add(permit as unknown as object);
  return true;
}

/** The exact dynamic phrase the human must type for a cohort of `n`. */
export function requiredPilotPhrase(cohortSize: number): string {
  return `RUN TAMARA NAMLA PILOT WITH ${cohortSize} ANTS`;
}
