/**
 * RealProviderExecutionPermit — the non-serializable capability token that
 * gates the FIRST real provider process execution in Namla Pro (Build Law §19).
 *
 * A permit's validity is WeakSet identity, not any field value: a permit is
 * valid only if THIS module minted it. A JSON round-trip, an object literal,
 * mission data, an ant, the Queen, an environment variable, or an AI-generated
 * object all produce objects that are NOT in the WeakSet, so `isValidPermit`
 * rejects them. The permit is additionally frozen and single-use within the
 * process.
 *
 * A permit that authorizes REAL execution (`origin: "human-cli"`) can only be
 * minted with a `HumanConfirmation`, which `acquireHumanConfirmation` issues
 * only for an interactive TTY plus an exact typed phrase — never from argv, an
 * environment variable, piped stdin, or a boolean. Automated tests mint
 * `origin: "automated-test"` permits and pair them with the FAKE driver; the
 * real Node driver refuses any permit whose origin is not "human-cli".
 *
 * HONEST LIMITATION: this is an ARCHITECTURAL boundary, not cryptographic
 * protection against arbitrary trusted local code running in this process.
 * Replay prevention is process-local single-use only; it is not durable across
 * a process restart, and no durable guarantee is claimed. Anyone able to import
 * this module and call its functions with the right inputs can mint a permit —
 * the boundary stops accidental, data-driven, or AI-object activation, not a
 * human deliberately writing new trusted code.
 *
 * No fs, no child_process, no network. No module-level MUTABLE counter of state
 * beyond the identity WeakSets and a monotonic issue sequence.
 */

export type RealProviderId = "claude" | "codex";
export type PermitOrigin = "human-cli" | "automated-test";

export interface PermitScope {
  readonly provider: RealProviderId;
  readonly missionId: string;
  readonly taskId: string;
  readonly antId: string;
  readonly workspaceId: string;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
}

export interface RealProviderExecutionPermit {
  readonly provider: RealProviderId;
  readonly missionId: string;
  readonly taskId: string;
  readonly antId: string;
  readonly workspaceId: string;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
  /** Always exactly 1 — one permit authorizes one invocation. */
  readonly maxInvocations: 1;
  readonly issuedSequence: number;
  /** "human-cli" is the only origin the real Node driver will execute. */
  readonly origin: PermitOrigin;
  readonly humanConfirmed: boolean;
}

/** Opaque, module-private proof that a human typed the exact phrase at a TTY. */
export interface HumanConfirmation {
  readonly __brand: "human-confirmation";
}

// --- module-private identity registries (never exported) -------------------
const VALID_PERMITS = new WeakSet<object>();
const CONSUMED_PERMITS = new WeakSet<object>();
const HUMAN_CONFIRMATIONS = new WeakSet<object>();

// A monotonic issue sequence. Read-only to the outside; only mint advances it.
let issueSequence = 0;

export interface AcquireConfirmationInput {
  readonly typedPhrase: string;
  readonly requiredPhrase: string;
  readonly isInteractiveTty: boolean;
  /** True if a --confirm / -y style flag was present on argv. Must be false. */
  readonly argvConfirmationFlagPresent: boolean;
  /** True if stdin was piped rather than an interactive terminal. Must be false. */
  readonly stdinWasPiped: boolean;
}

export type AcquireConfirmationResult =
  | { readonly ok: true; readonly confirmation: HumanConfirmation }
  | { readonly ok: false; readonly reasonCode: string };

/**
 * Issue a human confirmation ONLY for an interactive terminal and an exact
 * typed phrase, with no argv flag and no piped stdin. Any deviation refuses.
 * The returned token's validity is WeakSet identity — it cannot be forged.
 */
export function acquireHumanConfirmation(input: AcquireConfirmationInput): AcquireConfirmationResult {
  if (!input.isInteractiveTty) return { ok: false, reasonCode: "not-interactive-tty" };
  if (input.stdinWasPiped) return { ok: false, reasonCode: "stdin-piped" };
  if (input.argvConfirmationFlagPresent) return { ok: false, reasonCode: "argv-confirmation-flag" };
  // Exact match only — never "y", "yes", "true", or a prefix.
  if (input.typedPhrase !== input.requiredPhrase) return { ok: false, reasonCode: "phrase-mismatch" };

  const confirmation = Object.freeze({ __brand: "human-confirmation" as const });
  HUMAN_CONFIRMATIONS.add(confirmation);
  return { ok: true, confirmation };
}

/**
 * True only for a genuine confirmation issued by `acquireHumanConfirmation`
 * (WeakSet identity). A forged `{ __brand: "human-confirmation" }` literal is
 * never valid. Used by other human-only capability mints (e.g. the live
 * objective permit) to require a real TTY-typed confirmation.
 */
export function isValidHumanConfirmation(candidate: unknown): candidate is HumanConfirmation {
  return typeof candidate === "object" && candidate !== null && HUMAN_CONFIRMATIONS.has(candidate);
}

function mint(scope: PermitScope, origin: PermitOrigin, humanConfirmed: boolean): RealProviderExecutionPermit {
  issueSequence += 1;
  const permit: RealProviderExecutionPermit = Object.freeze({
    provider: scope.provider,
    missionId: scope.missionId,
    taskId: scope.taskId,
    antId: scope.antId,
    workspaceId: scope.workspaceId,
    maxInputBytes: scope.maxInputBytes,
    maxOutputBytes: scope.maxOutputBytes,
    timeoutMs: scope.timeoutMs,
    maxInvocations: 1,
    issuedSequence: issueSequence,
    origin,
    humanConfirmed,
  });
  VALID_PERMITS.add(permit);
  return permit;
}

/**
 * Mint the one permit that authorizes REAL execution. Requires a valid
 * HumanConfirmation (WeakSet-checked). This is the ONLY path to a permit the
 * real Node driver will run.
 */
export function mintHumanConfirmedPermit(scope: PermitScope, confirmation: HumanConfirmation): RealProviderExecutionPermit | null {
  if (!HUMAN_CONFIRMATIONS.has(confirmation as unknown as object)) return null;
  // A confirmation is single-use, like the permit it mints.
  HUMAN_CONFIRMATIONS.delete(confirmation as unknown as object);
  return mint(scope, "human-cli", true);
}

/**
 * Mint a valid-scope permit for AUTOMATED TESTS. It exercises the scope-match,
 * consumption, and lifecycle logic with the FAKE driver. Its origin is
 * "automated-test", so the real Node driver refuses it — a demo can never
 * reach real execution through this.
 */
export function mintPermitForAutomatedTest(scope: PermitScope): RealProviderExecutionPermit {
  return mint(scope, "automated-test", false);
}

/** Hard ceiling on how many member permits one human confirmation can mint (V2 pilot). */
export const MAX_PILOT_MEMBER_PERMITS = 5 as const;

/**
 * V2 academy pilot (Build Law §21): mint a BOUNDED BATCH of human-confirmed
 * permits — one per accepted cohort ant, capped at MAX_PILOT_MEMBER_PERMITS —
 * from ONE typed human confirmation. The confirmation is consumed exactly once
 * whether 1 or 5 permits are minted; each member permit remains single-use and
 * scope-bound to its own ant, so no ant can make a second call in the pilot.
 * Returns null for an invalid/reused confirmation or an over-cap request.
 */
export function mintHumanConfirmedPermitBatch(
  scopes: readonly PermitScope[],
  confirmation: HumanConfirmation
): readonly RealProviderExecutionPermit[] | null {
  if (scopes.length === 0 || scopes.length > MAX_PILOT_MEMBER_PERMITS) return null;
  if (!HUMAN_CONFIRMATIONS.has(confirmation as unknown as object)) return null;
  HUMAN_CONFIRMATIONS.delete(confirmation as unknown as object);
  return scopes.map((scope) => mint(scope, "human-cli", true));
}

/** Twin empire: at most 3 sequential role calls per colony, 6 across both colonies. */
export const MAX_TWIN_COLONY_PERMITS_PER_COLONY = 3 as const;
export const MAX_TWIN_COLONY_PERMITS_TOTAL = 6 as const;

/**
 * Twin empire (Namola): mint the per-colony execution permits for BOTH colonies
 * from ONE typed human confirmation. The twin flow needs 3 sequential role
 * permits per colony (architecture / implementation / independent-review) — 6
 * total — which exceeds the 5-permit pilot batch, so this bounded variant exists
 * rather than widening the pilot cap.
 *
 * Single-use semantics are preserved exactly: ONE human act mints ONE set, and
 * the confirmation is consumed once here (a second call with the same
 * confirmation returns null). Each permit remains scope-bound and single-use, so
 * no ant can make a second call, and the per-colony cap keeps a colony from
 * spending the other colony's budget.
 */
export function mintHumanConfirmedTwinColonyPermits(
  claudeScopes: readonly PermitScope[],
  codexScopes: readonly PermitScope[],
  confirmation: HumanConfirmation
): { readonly claude: readonly RealProviderExecutionPermit[]; readonly codex: readonly RealProviderExecutionPermit[] } | null {
  if (claudeScopes.length === 0 || codexScopes.length === 0) return null;
  if (claudeScopes.length > MAX_TWIN_COLONY_PERMITS_PER_COLONY || codexScopes.length > MAX_TWIN_COLONY_PERMITS_PER_COLONY) return null;
  if (claudeScopes.length + codexScopes.length > MAX_TWIN_COLONY_PERMITS_TOTAL) return null;
  if (!HUMAN_CONFIRMATIONS.has(confirmation as unknown as object)) return null;
  HUMAN_CONFIRMATIONS.delete(confirmation as unknown as object);
  return {
    claude: claudeScopes.map((scope) => mint(scope, "human-cli", true)),
    codex: codexScopes.map((scope) => mint(scope, "human-cli", true)),
  };
}

/** True only for a permit THIS module minted (WeakSet identity). Rejects forgeries. */
export function isValidPermit(candidate: unknown): candidate is RealProviderExecutionPermit {
  return typeof candidate === "object" && candidate !== null && VALID_PERMITS.has(candidate as object);
}

export function isConsumed(permit: RealProviderExecutionPermit): boolean {
  return CONSUMED_PERMITS.has(permit as unknown as object);
}

/**
 * Consume the permit (single-use). Returns true on the FIRST consumption of a
 * valid, not-yet-consumed permit; false for an invalid or already-consumed one.
 * There is no un-consume: no retry with the same permit is ever possible.
 */
export function consumePermit(permit: RealProviderExecutionPermit): boolean {
  if (!isValidPermit(permit)) return false;
  if (CONSUMED_PERMITS.has(permit as unknown as object)) return false;
  CONSUMED_PERMITS.add(permit as unknown as object);
  return true;
}

export interface ScopeMatchInput {
  readonly provider: RealProviderId;
  readonly missionId: string;
  readonly taskId: string;
  readonly antId: string;
  readonly workspaceId: string;
}

/** Every scope field must match exactly. Returns a fixed reason code on the first mismatch. */
export function permitScopeMatches(permit: RealProviderExecutionPermit, target: ScopeMatchInput): { readonly ok: boolean; readonly reasonCode: string } {
  if (permit.provider !== target.provider) return { ok: false, reasonCode: "permit-provider-mismatch" };
  if (permit.missionId !== target.missionId) return { ok: false, reasonCode: "permit-mission-mismatch" };
  if (permit.taskId !== target.taskId) return { ok: false, reasonCode: "permit-task-mismatch" };
  if (permit.antId !== target.antId) return { ok: false, reasonCode: "permit-ant-mismatch" };
  if (permit.workspaceId !== target.workspaceId) return { ok: false, reasonCode: "permit-workspace-mismatch" };
  return { ok: true, reasonCode: "scope-matches" };
}

/** The exact phrases a human must type. Provider-specific, never abbreviated. */
export const REQUIRED_CONFIRMATION_PHRASE: Readonly<Record<RealProviderId, string>> = {
  claude: "RUN ONE CLAUDE ANT",
  codex: "RUN ONE CODEX ANT",
};
