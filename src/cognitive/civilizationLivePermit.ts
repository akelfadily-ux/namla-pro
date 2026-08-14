/**
 * CivilizationLivePermit — the capability token for a HUMAN-AUTHORIZED live
 * civilization run (Build Law §28). It mirrors the live-objective permit's
 * identity discipline: validity is membership in a module-private WeakSet, the
 * object is frozen, and a JSON round-trip / object literal / Tamara / Queen / ant
 * / council / mission datum / provider output / MCP result / argv flag / env var
 * is NEVER valid. Human-only minting requires a real TTY-typed `HumanConfirmation`;
 * automated runs mint "automated-test"-origin permits the real drivers refuse.
 *
 * The permit binds the civilization run, objective, workspace, the allowed
 * providers + MCP tools, the cohort/provider/repair-call caps (≤5 cohort, ≤5
 * initial + ≤3 repair = ≤8 total provider calls), the aggregate MCP + verification
 * budgets, byte/timeout/workspace caps, and token/compute/monetary budgets.
 * Consumption + per-permit call budgets are process-local; no durable replay is
 * claimed and it can never be delegated.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import type { HumanConfirmation, PermitOrigin, RealProviderId } from "./realProviderExecutionPermit";
import { isValidHumanConfirmation } from "./realProviderExecutionPermit";

export const CIV_MAX_COHORT = 5 as const;
export const CIV_MAX_PROVIDER_CALLS = 8 as const;
export const CIV_MAX_INITIAL_CALLS = 5 as const;
export const CIV_MAX_REPAIR_CALLS = 3 as const;

export interface CivCohortMember {
  readonly antId: string;
  readonly districtId: string;
  readonly provider: RealProviderId;
  readonly role: string;
}

export interface CivilizationLiveScope {
  readonly civilizationRunId: string;
  readonly objectiveId: string;
  readonly workspaceId: string;
  readonly allowedProviders: readonly RealProviderId[];
  readonly allowedMcpToolIds: readonly string[];
  readonly cohort: readonly CivCohortMember[]; // 1..5
  readonly maxCohortSize: number;
  readonly maxProviderCalls: number; // clamped ≤ 8
  readonly maxRepairCalls: number; // clamped ≤ 3
  readonly maxAggregateInputBytes: number;
  readonly maxAggregateOutputBytes: number;
  readonly maxMcpCalls: number;
  readonly maxVerificationCalls: number;
  readonly tokenBudget: number;
  readonly computeBudget: number;
  readonly monetaryBudget: number;
  readonly perCallTimeoutMs: number;
  readonly workspaceFileCap: number;
  readonly perFileByteCap: number;
  readonly totalWorkspaceByteCap: number;
}

export interface CivilizationLivePermit extends CivilizationLiveScope {
  readonly origin: PermitOrigin;
  readonly humanConfirmed: boolean;
  readonly issuedSequence: number;
}

interface CallState {
  initialCalls: number;
  repairCalls: number;
  mcpCalls: number;
  verificationCalls: number;
}

const VALID_CIV_PERMITS = new WeakSet<object>();
const CONSUMED_CIV_PERMITS = new WeakSet<object>();
const CALL_STATE = new WeakMap<object, CallState>();
let issuedCounter = 0;

function mint(scope: CivilizationLiveScope, origin: PermitOrigin, humanConfirmed: boolean): CivilizationLivePermit | null {
  if (scope.cohort.length < 1 || scope.cohort.length > CIV_MAX_COHORT) return null;
  const antIds = new Set(scope.cohort.map((c) => c.antId));
  if (antIds.size !== scope.cohort.length) return null;
  const permit: CivilizationLivePermit = Object.freeze({
    civilizationRunId: scope.civilizationRunId,
    objectiveId: scope.objectiveId,
    workspaceId: scope.workspaceId,
    allowedProviders: Object.freeze([...scope.allowedProviders]),
    allowedMcpToolIds: Object.freeze([...scope.allowedMcpToolIds]),
    cohort: Object.freeze(scope.cohort.map((c) => Object.freeze({ ...c }))),
    maxCohortSize: Math.min(Math.max(1, Math.floor(scope.maxCohortSize)), CIV_MAX_COHORT),
    maxProviderCalls: Math.min(Math.max(1, Math.floor(scope.maxProviderCalls)), CIV_MAX_PROVIDER_CALLS),
    maxRepairCalls: Math.min(Math.max(0, Math.floor(scope.maxRepairCalls)), CIV_MAX_REPAIR_CALLS),
    maxAggregateInputBytes: scope.maxAggregateInputBytes,
    maxAggregateOutputBytes: scope.maxAggregateOutputBytes,
    maxMcpCalls: scope.maxMcpCalls,
    maxVerificationCalls: scope.maxVerificationCalls,
    tokenBudget: scope.tokenBudget,
    computeBudget: scope.computeBudget,
    monetaryBudget: scope.monetaryBudget,
    perCallTimeoutMs: scope.perCallTimeoutMs,
    workspaceFileCap: scope.workspaceFileCap,
    perFileByteCap: scope.perFileByteCap,
    totalWorkspaceByteCap: scope.totalWorkspaceByteCap,
    origin,
    humanConfirmed,
    issuedSequence: (issuedCounter += 1),
  });
  VALID_CIV_PERMITS.add(permit);
  CALL_STATE.set(permit, { initialCalls: 0, repairCalls: 0, mcpCalls: 0, verificationCalls: 0 });
  return permit;
}

/** The REAL path: one genuine TTY-typed human confirmation mints one civ permit. */
export function mintHumanCivilizationPermit(scope: CivilizationLiveScope, confirmation: HumanConfirmation): CivilizationLivePermit | null {
  if (!isValidHumanConfirmation(confirmation)) return null;
  return mint(scope, "human-cli", true);
}

/** Automated-test path: fake-driver demos only; the real drivers refuse these. */
export function mintCivilizationPermitForAutomatedTest(scope: CivilizationLiveScope): CivilizationLivePermit | null {
  return mint(scope, "automated-test", false);
}

export function isValidCivilizationPermit(candidate: unknown): candidate is CivilizationLivePermit {
  return typeof candidate === "object" && candidate !== null && VALID_CIV_PERMITS.has(candidate);
}

export function isCivilizationPermitConsumed(permit: CivilizationLivePermit): boolean {
  return CONSUMED_CIV_PERMITS.has(permit);
}

/** Single-use (process-local): first redemption wins; a replay returns false. */
export function consumeCivilizationPermit(permit: CivilizationLivePermit): boolean {
  if (!isValidCivilizationPermit(permit) || CONSUMED_CIV_PERMITS.has(permit)) return false;
  CONSUMED_CIV_PERMITS.add(permit);
  return true;
}

export type CivCallKind = "initial" | "repair" | "mcp" | "verification";

/** Record a call against the permit's relevant budget. */
export function recordCivilizationCall(permit: CivilizationLivePermit, kind: CivCallKind): { readonly ok: boolean; readonly reasonCode: string } {
  if (!isValidCivilizationPermit(permit)) return { ok: false, reasonCode: "invalid-permit" };
  const s = CALL_STATE.get(permit);
  if (!s) return { ok: false, reasonCode: "no-call-state" };
  if (kind === "mcp") {
    if (s.mcpCalls >= permit.maxMcpCalls) return { ok: false, reasonCode: "mcp-budget-exceeded" };
    s.mcpCalls += 1;
    return { ok: true, reasonCode: "ok" };
  }
  if (kind === "verification") {
    if (s.verificationCalls >= permit.maxVerificationCalls) return { ok: false, reasonCode: "verification-budget-exceeded" };
    s.verificationCalls += 1;
    return { ok: true, reasonCode: "ok" };
  }
  const totalProvider = s.initialCalls + s.repairCalls;
  if (totalProvider >= permit.maxProviderCalls) return { ok: false, reasonCode: "provider-call-budget-exceeded" };
  if (kind === "initial") {
    if (s.initialCalls >= CIV_MAX_INITIAL_CALLS) return { ok: false, reasonCode: "initial-call-budget-exceeded" };
    s.initialCalls += 1;
  } else {
    if (s.repairCalls >= permit.maxRepairCalls) return { ok: false, reasonCode: "repair-call-budget-exceeded" };
    s.repairCalls += 1;
  }
  return { ok: true, reasonCode: "ok" };
}

export function civCallBudgetUsed(permit: CivilizationLivePermit): CallState {
  const s = CALL_STATE.get(permit);
  return { initialCalls: s?.initialCalls ?? 0, repairCalls: s?.repairCalls ?? 0, mcpCalls: s?.mcpCalls ?? 0, verificationCalls: s?.verificationCalls ?? 0 };
}

/** The provider bound to an ant in this permit, or null if not in the cohort. */
export function civProviderForAnt(permit: CivilizationLivePermit, antId: string): RealProviderId | null {
  return permit.cohort.find((c) => c.antId === antId)?.provider ?? null;
}

/** True iff a tool id is allowlisted by this permit. */
export function civToolAllowed(permit: CivilizationLivePermit, toolId: string): boolean {
  return permit.allowedMcpToolIds.includes(toolId);
}
