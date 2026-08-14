/**
 * LiveObjectivePermit — the capability token for the first human-authorized,
 * three-ant LIVE software objective (Build Law §25). Identity discipline mirrors
 * the R2 / academy-pilot permits: validity is membership in a module-private
 * WeakSet, the object is frozen, and a JSON round-trip / object literal / mission
 * datum / ant / Queen / Tamara / argv flag / env var is NEVER valid. Human-only
 * minting requires a `HumanConfirmation` (TTY + exact typed phrase); automated
 * tests mint "automated-test"-origin permits that the real driver path refuses.
 *
 * The permit binds the objective, pilot, workspace, the EXACTLY THREE ant ids
 * and their assigned providers, the provider-call and repair-call caps (≤5 and
 * ≤2), byte/timeout budgets, allowed verification commands, and workspace file
 * caps. Consumption + per-permit call budgets are tracked process-locally (no
 * durable replay guarantee is claimed). A permit can never be delegated.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import type { HumanConfirmation, PermitOrigin, RealProviderId } from "./realProviderExecutionPermit";
import { isValidHumanConfirmation } from "./realProviderExecutionPermit";

export const LIVE_COHORT_SIZE = 3 as const;
export const LIVE_MAX_PROVIDER_CALLS = 5 as const;
export const LIVE_MAX_INITIAL_CALLS = 3 as const;
export const LIVE_MAX_REPAIR_CALLS = 2 as const;

export interface LiveCohortMember {
  readonly antId: string;
  readonly provider: RealProviderId;
}

export interface LiveObjectiveScope {
  readonly objectiveId: string;
  readonly pilotId: string;
  readonly workspaceId: string;
  readonly cohort: readonly LiveCohortMember[]; // exactly 3
  readonly maxProviderCalls: number; // clamped ≤ 5
  readonly maxRepairCalls: number; // clamped ≤ 2
  readonly maxAggregateInputBytes: number;
  readonly maxAggregateOutputBytes: number;
  readonly perCallTimeoutMs: number;
  readonly allowedVerificationCommands: readonly string[];
  readonly workspaceFileCap: number;
  readonly perFileByteCap: number;
  readonly totalWorkspaceByteCap: number;
}

export interface LiveObjectivePermit extends LiveObjectiveScope {
  readonly origin: PermitOrigin;
  readonly humanConfirmed: boolean;
  readonly issuedSequence: number;
}

interface CallState {
  initialCalls: number;
  repairCalls: number;
}

const VALID_LIVE_PERMITS = new WeakSet<object>();
const CONSUMED_LIVE_PERMITS = new WeakSet<object>();
const CALL_STATE = new WeakMap<object, CallState>();
let issuedCounter = 0;

function mint(scope: LiveObjectiveScope, origin: PermitOrigin, humanConfirmed: boolean): LiveObjectivePermit | null {
  // Hard structural gate: exactly three cohort members, distinct ant ids.
  if (scope.cohort.length !== LIVE_COHORT_SIZE) return null;
  const antIds = new Set(scope.cohort.map((c) => c.antId));
  if (antIds.size !== LIVE_COHORT_SIZE) return null;
  const permit: LiveObjectivePermit = Object.freeze({
    objectiveId: scope.objectiveId,
    pilotId: scope.pilotId,
    workspaceId: scope.workspaceId,
    cohort: Object.freeze(scope.cohort.map((c) => Object.freeze({ ...c }))),
    maxProviderCalls: Math.min(Math.max(1, Math.floor(scope.maxProviderCalls)), LIVE_MAX_PROVIDER_CALLS),
    maxRepairCalls: Math.min(Math.max(0, Math.floor(scope.maxRepairCalls)), LIVE_MAX_REPAIR_CALLS),
    maxAggregateInputBytes: scope.maxAggregateInputBytes,
    maxAggregateOutputBytes: scope.maxAggregateOutputBytes,
    perCallTimeoutMs: scope.perCallTimeoutMs,
    allowedVerificationCommands: Object.freeze([...scope.allowedVerificationCommands]),
    workspaceFileCap: scope.workspaceFileCap,
    perFileByteCap: scope.perFileByteCap,
    totalWorkspaceByteCap: scope.totalWorkspaceByteCap,
    origin,
    humanConfirmed,
    issuedSequence: (issuedCounter += 1),
  });
  VALID_LIVE_PERMITS.add(permit);
  CALL_STATE.set(permit, { initialCalls: 0, repairCalls: 0 });
  return permit;
}

/** The REAL path: one genuine TTY-typed human confirmation mints one live permit. */
export function mintHumanLiveObjectivePermit(scope: LiveObjectiveScope, confirmation: HumanConfirmation): LiveObjectivePermit | null {
  // The confirmation must be a real one issued by acquireHumanConfirmation
  // (WeakSet identity) — a forged literal is never valid.
  if (!isValidHumanConfirmation(confirmation)) return null;
  return mint(scope, "human-cli", true);
}

/** Automated-test path: fake-driver demos only; the real driver path refuses these. */
export function mintLiveObjectivePermitForAutomatedTest(scope: LiveObjectiveScope): LiveObjectivePermit | null {
  return mint(scope, "automated-test", false);
}

/** Validity = membership in the private WeakSet. A forged/JSON object is never valid. */
export function isValidLivePermit(candidate: unknown): candidate is LiveObjectivePermit {
  return typeof candidate === "object" && candidate !== null && VALID_LIVE_PERMITS.has(candidate);
}

export function isLivePermitConsumed(permit: LiveObjectivePermit): boolean {
  return CONSUMED_LIVE_PERMITS.has(permit);
}

/** Single-use (process-local): the first redemption wins; a replay returns false. */
export function consumeLivePermit(permit: LiveObjectivePermit): boolean {
  if (!isValidLivePermit(permit) || CONSUMED_LIVE_PERMITS.has(permit)) return false;
  CONSUMED_LIVE_PERMITS.add(permit);
  return true;
}

export type CallKind = "initial" | "repair";

/**
 * Record a provider call against the permit's budget. Returns ok only when the
 * relevant cap (initial ≤ 3, repair ≤ 2) and the aggregate cap (≤ 5) all hold.
 */
export function recordProviderCall(permit: LiveObjectivePermit, kind: CallKind): { readonly ok: boolean; readonly reasonCode: string } {
  if (!isValidLivePermit(permit)) return { ok: false, reasonCode: "invalid-permit" };
  const state = CALL_STATE.get(permit);
  if (!state) return { ok: false, reasonCode: "no-call-state" };
  const total = state.initialCalls + state.repairCalls;
  if (total >= permit.maxProviderCalls) return { ok: false, reasonCode: "provider-call-budget-exceeded" };
  if (kind === "initial") {
    if (state.initialCalls >= LIVE_MAX_INITIAL_CALLS) return { ok: false, reasonCode: "initial-call-budget-exceeded" };
    state.initialCalls += 1;
  } else {
    if (state.repairCalls >= permit.maxRepairCalls) return { ok: false, reasonCode: "repair-call-budget-exceeded" };
    state.repairCalls += 1;
  }
  return { ok: true, reasonCode: "ok" };
}

export function callBudgetUsed(permit: LiveObjectivePermit): { readonly initial: number; readonly repair: number } {
  const state = CALL_STATE.get(permit);
  return { initial: state?.initialCalls ?? 0, repair: state?.repairCalls ?? 0 };
}

/** Validate that a live permit matches the target objective/workspace/cohort. */
export function livePermitMatches(permit: LiveObjectivePermit, target: { objectiveId: string; workspaceId: string; antIds: readonly string[] }): { readonly ok: boolean; readonly reasonCode: string } {
  if (!isValidLivePermit(permit)) return { ok: false, reasonCode: "invalid-permit" };
  if (permit.objectiveId !== target.objectiveId) return { ok: false, reasonCode: "objective-mismatch" };
  if (permit.workspaceId !== target.workspaceId) return { ok: false, reasonCode: "workspace-mismatch" };
  const permitAnts = new Set(permit.cohort.map((c) => c.antId));
  if (target.antIds.length !== LIVE_COHORT_SIZE || !target.antIds.every((a) => permitAnts.has(a))) return { ok: false, reasonCode: "cohort-mismatch" };
  return { ok: true, reasonCode: "ok" };
}

/** The provider bound to an ant in this permit, or null if the ant is not in the cohort. */
export function providerForAnt(permit: LiveObjectivePermit, antId: string): RealProviderId | null {
  return permit.cohort.find((c) => c.antId === antId)?.provider ?? null;
}
