/**
 * twinEmpireLivePermit — the capability tokens for a HUMAN-AUTHORIZED live twin
 * empire run. Mirrors the civilization live-permit identity discipline: validity
 * is membership in a module-private WeakSet, the object is frozen, and a JSON /
 * object-literal / provider-output / argv / env token is NEVER valid. Human-only
 * minting requires a real TTY-typed `HumanConfirmation`; automated runs mint
 * "automated-test"-origin permits the real drivers refuse.
 *
 * The empire permit binds the mission + BOTH colony workspaces, and enforces the
 * scarcity caps: ≤1 concurrent Claude Code call, ≤1 concurrent Codex call, ≤10
 * total provider calls, ≤30 deep-cognition ants. Each `TwinColonyProviderPermit`
 * is bound to ONE colony so a Claude-colony permit can never authorize a
 * Codex-colony call (and vice versa). Consumption + call budgets are process-local
 * and single-use; no durable replay is claimed and no permit can be delegated.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import type { HumanConfirmation, PermitOrigin, RealProviderId } from "./realProviderExecutionPermit";
import { isValidHumanConfirmation } from "./realProviderExecutionPermit";

export type TwinColonyId = "claude-forge" | "codex-crucible";

export const TWIN_MAX_CLAUDE_CONCURRENCY = 1 as const;
export const TWIN_MAX_CODEX_CONCURRENCY = 1 as const;
export const TWIN_MAX_TOTAL_PROVIDER_CALLS = 10 as const;
export const TWIN_MAX_DEEP_COGNITION = 30 as const;

export interface TwinEmpireLiveScope {
  readonly missionId: string;
  readonly objectiveId: string;
  readonly claudeWorkspaceId: string;
  readonly codexWorkspaceId: string;
  readonly allowedProviders: readonly RealProviderId[];
  readonly maxClaudeConcurrency: number;
  readonly maxCodexConcurrency: number;
  readonly maxTotalProviderCalls: number;
  readonly maxDeepCognitionAnts: number;
  readonly maxMcpCalls: number;
  readonly perFileByteCap: number;
  readonly workspaceFileCap: number;
  readonly maxStdinBytes: number;
  readonly maxStdoutBytes: number;
  readonly perCallTimeoutMs: number;
}

export interface TwinEmpireLivePermit extends TwinEmpireLiveScope {
  readonly origin: PermitOrigin;
  readonly humanConfirmed: boolean;
  readonly issuedSequence: number;
}

interface EmpireCallState {
  claudeActive: number;
  codexActive: number;
  totalCalls: number;
  deepCognitionActive: number;
}

const VALID_EMPIRE = new WeakSet<object>();
const CONSUMED_EMPIRE = new WeakSet<object>();
const EMPIRE_CALL_STATE = new WeakMap<object, EmpireCallState>();
let empireSeq = 0;

function mintEmpire(scope: TwinEmpireLiveScope, origin: PermitOrigin, humanConfirmed: boolean): TwinEmpireLivePermit {
  const permit: TwinEmpireLivePermit = Object.freeze({
    missionId: scope.missionId,
    objectiveId: scope.objectiveId,
    claudeWorkspaceId: scope.claudeWorkspaceId,
    codexWorkspaceId: scope.codexWorkspaceId,
    allowedProviders: Object.freeze([...scope.allowedProviders]),
    maxClaudeConcurrency: Math.min(Math.max(1, Math.floor(scope.maxClaudeConcurrency)), TWIN_MAX_CLAUDE_CONCURRENCY),
    maxCodexConcurrency: Math.min(Math.max(1, Math.floor(scope.maxCodexConcurrency)), TWIN_MAX_CODEX_CONCURRENCY),
    maxTotalProviderCalls: Math.min(Math.max(1, Math.floor(scope.maxTotalProviderCalls)), TWIN_MAX_TOTAL_PROVIDER_CALLS),
    maxDeepCognitionAnts: Math.min(Math.max(1, Math.floor(scope.maxDeepCognitionAnts)), TWIN_MAX_DEEP_COGNITION),
    maxMcpCalls: scope.maxMcpCalls,
    perFileByteCap: scope.perFileByteCap,
    workspaceFileCap: scope.workspaceFileCap,
    maxStdinBytes: scope.maxStdinBytes,
    maxStdoutBytes: scope.maxStdoutBytes,
    perCallTimeoutMs: scope.perCallTimeoutMs,
    origin,
    humanConfirmed,
    issuedSequence: (empireSeq += 1),
  });
  VALID_EMPIRE.add(permit);
  EMPIRE_CALL_STATE.set(permit, { claudeActive: 0, codexActive: 0, totalCalls: 0, deepCognitionActive: 0 });
  return permit;
}

/** The REAL path: one genuine TTY-typed human confirmation mints one empire permit. */
export function mintHumanTwinEmpirePermit(scope: TwinEmpireLiveScope, confirmation: HumanConfirmation): TwinEmpireLivePermit | null {
  if (!isValidHumanConfirmation(confirmation)) return null;
  return mintEmpire(scope, "human-cli", true);
}

/** Automated-test path: fake-driver demos only; the real drivers refuse these. */
export function mintTwinEmpirePermitForAutomatedTest(scope: TwinEmpireLiveScope): TwinEmpireLivePermit {
  return mintEmpire(scope, "automated-test", false);
}

export function isValidTwinEmpirePermit(candidate: unknown): candidate is TwinEmpireLivePermit {
  return typeof candidate === "object" && candidate !== null && VALID_EMPIRE.has(candidate);
}
export function isTwinEmpirePermitConsumed(permit: TwinEmpireLivePermit): boolean {
  return CONSUMED_EMPIRE.has(permit);
}
export function consumeTwinEmpirePermit(permit: TwinEmpireLivePermit): boolean {
  if (!isValidTwinEmpirePermit(permit) || CONSUMED_EMPIRE.has(permit)) return false;
  CONSUMED_EMPIRE.add(permit);
  return true;
}

export type ProviderSlotResult = { readonly ok: true } | { readonly ok: false; readonly reasonCode: string };

/** Acquire one concurrent provider slot for a colony. Enforces per-provider + total caps. */
export function acquireProviderSlot(permit: TwinEmpireLivePermit, colony: TwinColonyId): ProviderSlotResult {
  if (!isValidTwinEmpirePermit(permit)) return { ok: false, reasonCode: "invalid-permit" };
  const s = EMPIRE_CALL_STATE.get(permit);
  if (!s) return { ok: false, reasonCode: "no-call-state" };
  if (s.totalCalls >= permit.maxTotalProviderCalls) return { ok: false, reasonCode: "total-provider-calls-exceeded" };
  if (colony === "claude-forge") {
    if (s.claudeActive >= permit.maxClaudeConcurrency) return { ok: false, reasonCode: "claude-concurrency-exceeded" };
    s.claudeActive += 1;
  } else {
    if (s.codexActive >= permit.maxCodexConcurrency) return { ok: false, reasonCode: "codex-concurrency-exceeded" };
    s.codexActive += 1;
  }
  s.totalCalls += 1;
  return { ok: true };
}

/** Release a previously acquired concurrent slot. */
export function releaseProviderSlot(permit: TwinEmpireLivePermit, colony: TwinColonyId): void {
  const s = EMPIRE_CALL_STATE.get(permit);
  if (!s) return;
  if (colony === "claude-forge") s.claudeActive = Math.max(0, s.claudeActive - 1);
  else s.codexActive = Math.max(0, s.codexActive - 1);
}

/** Admit up to the deep-cognition cap. Returns the number admitted (never over cap). */
export function admitDeepCognition(permit: TwinEmpireLivePermit, requested: number): number {
  const s = EMPIRE_CALL_STATE.get(permit);
  if (!s) return 0;
  const room = Math.max(0, permit.maxDeepCognitionAnts - s.deepCognitionActive);
  const admit = Math.min(Math.max(0, Math.floor(requested)), room);
  s.deepCognitionActive += admit;
  return admit;
}

export function twinEmpireCallBudget(permit: TwinEmpireLivePermit): EmpireCallState {
  const s = EMPIRE_CALL_STATE.get(permit);
  return { claudeActive: s?.claudeActive ?? 0, codexActive: s?.codexActive ?? 0, totalCalls: s?.totalCalls ?? 0, deepCognitionActive: s?.deepCognitionActive ?? 0 };
}

// --- per-colony provider permits (colony-bound) -----------------------------

export interface TwinColonyProviderScope {
  readonly colonyId: TwinColonyId;
  readonly provider: RealProviderId;
  readonly missionId: string;
  readonly workspaceId: string;
  readonly antId: string;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
}

export interface TwinColonyProviderPermit extends TwinColonyProviderScope {
  readonly origin: PermitOrigin;
  readonly humanConfirmed: boolean;
  readonly issuedSequence: number;
}

const VALID_COLONY = new WeakSet<object>();
const CONSUMED_COLONY = new WeakSet<object>();
let colonySeq = 0;

function mintColony(scope: TwinColonyProviderScope, origin: PermitOrigin, humanConfirmed: boolean): TwinColonyProviderPermit {
  const permit: TwinColonyProviderPermit = Object.freeze({ ...scope, origin, humanConfirmed, issuedSequence: (colonySeq += 1) });
  VALID_COLONY.add(permit);
  return permit;
}

/** Mint one colony-bound provider permit under a genuine human confirmation. */
export function mintTwinColonyProviderPermit(scope: TwinColonyProviderScope, confirmation: HumanConfirmation): TwinColonyProviderPermit | null {
  if (!isValidHumanConfirmation(confirmation)) return null;
  return mintColony(scope, "human-cli", true);
}
export function mintTwinColonyProviderPermitForTest(scope: TwinColonyProviderScope): TwinColonyProviderPermit {
  return mintColony(scope, "automated-test", false);
}

export const TWIN_MAX_COLONY_PERMITS = 5 as const;

/** Mint a BOUNDED BATCH of colony-bound provider permits from one human confirmation. */
export function mintHumanTwinColonyProviderPermitBatch(colony: TwinColonyId, scopes: readonly TwinColonyProviderScope[], confirmation: HumanConfirmation): readonly TwinColonyProviderPermit[] | null {
  if (scopes.length === 0 || scopes.length > TWIN_MAX_COLONY_PERMITS) return null;
  if (!isValidHumanConfirmation(confirmation)) return null;
  if (scopes.some((s) => s.colonyId !== colony)) return null;
  return scopes.map((s) => mintColony(s, "human-cli", true));
}
export function mintTwinColonyProviderPermitBatchForTest(colony: TwinColonyId, scopes: readonly TwinColonyProviderScope[]): readonly TwinColonyProviderPermit[] {
  return scopes.map((s) => mintColony(s, "automated-test", false));
}

export function isValidTwinColonyProviderPermit(candidate: unknown): candidate is TwinColonyProviderPermit {
  return typeof candidate === "object" && candidate !== null && VALID_COLONY.has(candidate);
}
export function consumeTwinColonyProviderPermit(permit: TwinColonyProviderPermit): boolean {
  if (!isValidTwinColonyProviderPermit(permit) || CONSUMED_COLONY.has(permit)) return false;
  CONSUMED_COLONY.add(permit);
  return true;
}

/** A colony permit authorizes a call ONLY for its own colony + provider (and only while unconsumed). */
export function twinPermitAuthorizedFor(permit: TwinColonyProviderPermit, colony: TwinColonyId, provider: RealProviderId): boolean {
  return isValidTwinColonyProviderPermit(permit) && !CONSUMED_COLONY.has(permit) && permit.colonyId === colony && permit.provider === provider;
}
