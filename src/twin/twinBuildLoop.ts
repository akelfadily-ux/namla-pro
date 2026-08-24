/**
 * twinBuildLoop — the bounded GENERATE → APPLY → VERIFY → REPAIR → RETEST loop
 * for ONE twin colony (TWIN-R1).
 *
 * Before this module a colony froze its bundle as soon as artifacts were applied,
 * so "frozen" meant only "files were generated" — nothing had ever been compiled
 * or tested. This adds the missing half: the applied candidate is verified through
 * the EXISTING `VerificationDriver` (and therefore, in the CLI, through
 * `verificationSandbox`), and a failing candidate is repaired by the SAME colony's
 * provider before being verified again.
 *
 * WHAT THIS MODULE DOES NOT DO. It does not spawn anything. It owns no sandbox,
 * no second verification architecture, and no filesystem authority: the
 * verification driver, the workspace applier and the provider driver are all
 * injected by a trusted composition root. A caller that cannot supply a
 * verification driver passes `null`, and the loop reports VERIFICATION_BLOCKED —
 * there is no host fallback and no path from "could not verify" to PASS.
 *
 * REPAIR IS A REAL PROVIDER CALL. The repair objective is assembled from bounded
 * verification evidence and sent to the same provider through the same
 * `LiveProviderDriver` (hence `safeProviderRequest`), which returns proposed file
 * operations that NAMLA applies. Nothing here edits a candidate's text directly:
 * there is no string replacement, no regex deletion, no prewritten patch.
 *
 * No fs, no child_process, no network, no wall clock in this module.
 */

import type { VerificationDriver, VerificationOutcome } from "../digital/digitalVerification";
import type { LiveProviderDriver } from "../digital/liveObjectiveRunner";
import type { RealProviderId } from "../cognitive/realProviderExecutionPermit";
import type { TwinColonyId } from "../cognitive/twinEmpireLivePermit";
import { acquireProviderSlot, releaseProviderSlot } from "../cognitive/twinEmpireLivePermit";
import type { TwinEmpireLivePermit } from "../cognitive/twinEmpireLivePermit";
import { normalizeProviderResult } from "../digital/liveProviderNormalization";
import { normalizeCivRoleOutput } from "../civilization/civRoleContracts";
import type { TwinWorkspaceApplier } from "./twinColonyLiveRunner";

/**
 * The four states a verification attempt may report.
 *
 * PASS and FAIL are claims about the CANDIDATE and may only be made when a
 * command actually ran. BLOCKED and UNVERIFIED are claims about the VERIFIER —
 * that nothing was established either way — and are deliberately distinct from
 * FAIL so that "we could not check" is never filed as "we checked and it failed",
 * and never as a pass.
 */
export type TwinVerificationStatus = "PASS" | "FAIL" | "BLOCKED" | "UNVERIFIED";

/** The finite states of the loop. There is no state that leaves the loop running. */
export type TwinLoopState =
  | "GENERATING"
  | "APPLYING"
  | "VERIFYING"
  | "ANALYSING_FAILURE"
  | "REPAIRING"
  | "CANDIDATE_VERIFIED"
  | "FAIL_CLOSED"
  | "VERIFICATION_BLOCKED";

/** Verification stages, in order. Each maps to an already-allowlisted command id. */
export const TWIN_VERIFICATION_STAGES = ["typecheck", "build", "test"] as const;
export type TwinVerificationStage = (typeof TWIN_VERIFICATION_STAGES)[number];

/** Conservative default: one candidate, two chances to repair it. */
export const TWIN_DEFAULT_MAX_REPAIR_ATTEMPTS = 2;
/** Hard ceiling. A larger request is a configuration error, not a bigger budget. */
export const TWIN_MAX_REPAIR_ATTEMPTS_CEILING = 5;

/**
 * Validate a repair budget. Returns null for anything that is not a finite
 * integer in [0, ceiling] — NaN and Infinity included, because both make every
 * `attempts < max` comparison permissive and would remove the bound entirely.
 */
export function validateMaxRepairAttempts(value: number): number | null {
  if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
  if (value < 0 || value > TWIN_MAX_REPAIR_ATTEMPTS_CEILING) return null;
  return value;
}

/**
 * One verification attempt's evidence. Bounded by construction: `outputLineCount`
 * is a count, `safeReasonCode` is the sandbox's own closed vocabulary. No raw
 * stdout, stderr, path, command text or secret is recorded.
 */
export interface TwinVerificationReceipt {
  readonly colonyId: TwinColonyId;
  /** 0 for the first candidate; N for the candidate produced by repair N. */
  readonly attempt: number;
  readonly stage: TwinVerificationStage;
  /** The approved command identity actually requested. */
  readonly commandId: string;
  readonly status: TwinVerificationStatus;
  readonly failureCategory: string | null;
  readonly safeReasonCode: string | null;
  readonly outputLineCount: number;
  readonly realProcessExecutions: number;
  /** Identity of the backend that was asked, e.g. "docker" or "none". */
  readonly sandboxBackendId: string;
  readonly sandboxVerified: boolean;
  /** Deterministic ordering index — no wall clock is read in this module. */
  readonly order: number;
}

/** One repair iteration's evidence. */
export interface TwinRepairReceipt {
  readonly colonyId: TwinColonyId;
  readonly attempt: number;
  readonly antId: string;
  readonly taskId: string;
  readonly providerId: string;
  readonly ok: boolean;
  readonly failureCategory: string | null;
  /** True only when the provider driver actually executed a real process. */
  readonly realProcessExecution: boolean;
  readonly filesProposed: number;
  readonly filesApplied: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly order: number;
}

/**
 * The verification capability, supplied by the composition root together with the
 * identity of the backend it was built from. `driver: null` is a first-class
 * value meaning "this caller has no verification capability" — it is never a
 * reason to run a generated package on the host.
 */
export interface TwinVerificationBackend {
  readonly driver: VerificationDriver | null;
  readonly sandboxBackendId: string;
  readonly sandboxVerified: boolean;
}

/** One pre-minted repair authorization. The loop never invents ant or task ids. */
export interface TwinRepairSlot {
  readonly antId: string;
  readonly taskId: string;
}

export interface TwinBuildLoopInput {
  readonly colonyId: TwinColonyId;
  readonly missionId: string;
  readonly provider: RealProviderId;
  readonly workspaceId: string;
  readonly applier: TwinWorkspaceApplier;
  readonly verification: TwinVerificationBackend;
  readonly providerDriver: LiveProviderDriver;
  readonly empirePermit: TwinEmpireLivePermit;
  /** Pre-minted, colony-bound repair authorizations, consumed in order. */
  readonly repairSlots: readonly TwinRepairSlot[];
  readonly maxRepairAttempts: number;
  readonly repairTimeoutMs: number;
  /** Paths currently applied, used to bound what the repair objective describes. */
  readonly candidatePaths: readonly string[];
  readonly log: (stage: string, meta?: Record<string, string | number | boolean>) => void;
}

export interface TwinBuildLoopResult {
  readonly state: TwinLoopState;
  readonly finalStatus: TwinVerificationStatus;
  /** Verification rounds performed (1 for the initial candidate, +1 per repair). */
  readonly verificationRounds: number;
  readonly repairAttempts: number;
  readonly filesAppliedByRepair: number;
  readonly receipts: readonly TwinVerificationReceipt[];
  readonly repairReceipts: readonly TwinRepairReceipt[];
  /** Set when the loop stopped for a reason other than a plain verification failure. */
  readonly stopReason: string | null;
  /** Every relative path applied to the candidate, including repair additions. */
  readonly finalCandidatePaths: readonly string[];
}

/**
 * Map one `VerificationOutcome` onto a loop status.
 *
 * The discriminator is the lower layer's own honest one: `verification-unavailable`
 * means nothing ran (absent sandbox, refused authorization, blocked start), so it
 * is BLOCKED — a statement about the verifier. `verification-command-failed` means
 * the sandbox executed the command and it did not pass, so it is FAIL — a
 * statement about the candidate. Any other failure category describes a request
 * that never reached execution (unknown command, invalid path), so it is also
 * BLOCKED. Nothing maps to PASS except an actual pass.
 */
export function classifyVerificationOutcome(outcome: VerificationOutcome): TwinVerificationStatus {
  if (outcome.status === "passed") return "PASS";
  if (outcome.failureCategory === "verification-command-failed") return "FAIL";
  return "BLOCKED";
}

/** True only for a status that permits a repair attempt. */
function isRepairable(status: TwinVerificationStatus): boolean {
  return status === "FAIL";
}

/**
 * Build the bounded repair objective.
 *
 * It carries the mission, the failing stage, the closed-vocabulary reason, the
 * attempt number and the candidate's PATHS — never their contents, never raw
 * compiler or test output, never a workspace absolute path. Everything here is
 * either a fixed string, a small integer, or a relative path the colony itself
 * proposed, so nothing new is disclosed to the provider by repairing.
 */
export function buildRepairObjective(input: {
  readonly missionObjective: string;
  readonly stage: TwinVerificationStage;
  readonly safeReasonCode: string | null;
  readonly failureCategory: string | null;
  readonly outputLineCount: number;
  readonly attempt: number;
  readonly candidatePaths: readonly string[];
  readonly maxPaths?: number;
}): string {
  const maxPaths = input.maxPaths ?? 32;
  const paths = input.candidatePaths.slice(0, maxPaths);
  return [
    "REPAIR TASK. A previously generated candidate failed Namla verification.",
    `MISSION: ${input.missionObjective}`,
    `FAILED STAGE: ${input.stage}`,
    `FAILURE CATEGORY: ${input.failureCategory ?? "unknown"}`,
    `SAFE REASON CODE: ${input.safeReasonCode ?? "none"}`,
    `DIAGNOSTIC LINE COUNT: ${input.outputLineCount}`,
    `REPAIR ATTEMPT: ${input.attempt}`,
    `CANDIDATE FILES (${paths.length}): ${paths.join(", ")}`,
    "Return revised file operations that make the candidate compile, build and pass its tests.",
    "Return JSON {summary, files:[{path,operation,content}], risks, tests, confidence}.",
    "Write NO files yourself and request NO commands — Namla applies every file operation.",
  ].join("\n");
}

/**
 * Run the bounded loop over an ALREADY-APPLIED candidate.
 *
 * Generation and the first application happen in `runTwinColonyLive`; this begins
 * at VERIFYING. Each round runs the stages in order and stops at the first stage
 * that is not PASS, because a candidate that does not typecheck has nothing to
 * learn from running its tests.
 */
export function runTwinBuildLoop(input: TwinBuildLoopInput & { readonly missionObjective: string }): TwinBuildLoopResult {
  const receipts: TwinVerificationReceipt[] = [];
  const repairReceipts: TwinRepairReceipt[] = [];
  let order = 0;
  let repairAttempts = 0;
  let filesAppliedByRepair = 0;
  let candidatePaths = [...input.candidatePaths];

  const budget = validateMaxRepairAttempts(input.maxRepairAttempts);
  if (budget === null) {
    input.log(`${input.colonyId}-loop-refused`, { reason: "invalid-max-repair-attempts" });
    return { state: "FAIL_CLOSED", finalStatus: "UNVERIFIED", verificationRounds: 0, repairAttempts: 0, filesAppliedByRepair: 0, receipts, repairReceipts, stopReason: "invalid-max-repair-attempts", finalCandidatePaths: candidatePaths };
  }

  // An absent verification capability is stated once, up front, and ends the
  // loop. It is NOT a failure of the candidate, so no repair is attempted: there
  // is nothing to repair towards.
  const driver = input.verification.driver;
  if (!driver) {
    input.log(`${input.colonyId}-verification-blocked`, { reason: "no-verification-driver", sandboxVerified: input.verification.sandboxVerified });
    receipts.push({
      colonyId: input.colonyId,
      attempt: 0,
      stage: "typecheck",
      commandId: "typecheck",
      status: "UNVERIFIED",
      failureCategory: null,
      safeReasonCode: "verification-driver-absent",
      outputLineCount: 0,
      realProcessExecutions: 0,
      sandboxBackendId: input.verification.sandboxBackendId,
      sandboxVerified: input.verification.sandboxVerified,
      order: order++,
    });
    return { state: "VERIFICATION_BLOCKED", finalStatus: "UNVERIFIED", verificationRounds: 0, repairAttempts: 0, filesAppliedByRepair: 0, receipts, repairReceipts, stopReason: "no-verification-driver", finalCandidatePaths: candidatePaths };
  }

  let verificationRounds = 0;
  for (;;) {
    // ---- VERIFYING ---------------------------------------------------------
    verificationRounds += 1;
    let roundStatus: TwinVerificationStatus = "PASS";
    let failingStage: TwinVerificationStage = "typecheck";
    let failingReceipt: TwinVerificationReceipt | null = null;

    for (const stage of TWIN_VERIFICATION_STAGES) {
      // `defectPresent` is the fake driver's deterministic switch; the real
      // driver ignores it entirely. It is passed as `false` so that no caller of
      // this loop can declare a verdict the verifier did not reach.
      const outcome = driver.run(stage, input.workspaceId, false);
      const status = classifyVerificationOutcome(outcome);
      const receipt: TwinVerificationReceipt = {
        colonyId: input.colonyId,
        attempt: repairAttempts,
        stage,
        commandId: outcome.commandId,
        status,
        failureCategory: outcome.failureCategory,
        safeReasonCode: outcome.safeReasonCode,
        outputLineCount: outcome.outputLineCount,
        realProcessExecutions: outcome.realProcessExecutions,
        sandboxBackendId: input.verification.sandboxBackendId,
        sandboxVerified: input.verification.sandboxVerified,
        order: order++,
      };
      receipts.push(receipt);
      input.log(`${input.colonyId}-verify`, { stage, status, attempt: repairAttempts, safeReasonCode: outcome.safeReasonCode ?? "none" });
      if (status !== "PASS") {
        roundStatus = status;
        failingStage = stage;
        failingReceipt = receipt;
        break;
      }
    }

    if (roundStatus === "PASS") {
      input.log(`${input.colonyId}-candidate-verified`, { rounds: verificationRounds, repairAttempts });
      return { state: "CANDIDATE_VERIFIED", finalStatus: "PASS", verificationRounds, repairAttempts, filesAppliedByRepair, receipts, repairReceipts, stopReason: null, finalCandidatePaths: candidatePaths };
    }

    // A verifier that could not establish anything never becomes a repair cycle
    // and never becomes a pass.
    if (!isRepairable(roundStatus)) {
      input.log(`${input.colonyId}-verification-blocked`, { stage: failingStage, safeReasonCode: failingReceipt?.safeReasonCode ?? "none" });
      return { state: "VERIFICATION_BLOCKED", finalStatus: roundStatus, verificationRounds, repairAttempts, filesAppliedByRepair, receipts, repairReceipts, stopReason: failingReceipt?.safeReasonCode ?? "verification-blocked", finalCandidatePaths: candidatePaths };
    }

    // ---- ANALYSING_FAILURE -------------------------------------------------
    if (repairAttempts >= budget) {
      input.log(`${input.colonyId}-fail-closed`, { reason: "repair-budget-exhausted", repairAttempts, budget });
      return { state: "FAIL_CLOSED", finalStatus: "FAIL", verificationRounds, repairAttempts, filesAppliedByRepair, receipts, repairReceipts, stopReason: "repair-budget-exhausted", finalCandidatePaths: candidatePaths };
    }
    const slot = input.repairSlots[repairAttempts];
    if (!slot) {
      input.log(`${input.colonyId}-fail-closed`, { reason: "repair-permit-exhausted", repairAttempts });
      return { state: "FAIL_CLOSED", finalStatus: "FAIL", verificationRounds, repairAttempts, filesAppliedByRepair, receipts, repairReceipts, stopReason: "repair-permit-exhausted", finalCandidatePaths: candidatePaths };
    }

    const repairObjective = buildRepairObjective({
      missionObjective: input.missionObjective,
      stage: failingStage,
      safeReasonCode: failingReceipt?.safeReasonCode ?? null,
      failureCategory: failingReceipt?.failureCategory ?? null,
      outputLineCount: failingReceipt?.outputLineCount ?? 0,
      attempt: repairAttempts + 1,
      candidatePaths,
    });

    // ---- REPAIRING ---------------------------------------------------------
    const gate = acquireProviderSlot(input.empirePermit, input.colonyId);
    if (!gate.ok) {
      input.log(`${input.colonyId}-fail-closed`, { reason: gate.reasonCode, repairAttempts });
      return { state: "FAIL_CLOSED", finalStatus: "FAIL", verificationRounds, repairAttempts, filesAppliedByRepair, receipts, repairReceipts, stopReason: gate.reasonCode, finalCandidatePaths: candidatePaths };
    }
    const before = input.providerDriver.realProviderProcessExecutions;
    const res = input.providerDriver.call({
      antId: slot.antId,
      providerId: input.provider,
      taskId: slot.taskId,
      role: "build",
      timeoutMs: input.repairTimeoutMs,
      contextBrief: repairObjective,
    });
    releaseProviderSlot(input.empirePermit, input.colonyId);
    const realProcessExecution = input.providerDriver.realProviderProcessExecutions > before;
    repairAttempts += 1;

    let filesProposed = 0;
    let filesApplied = 0;
    if (res.ok && res.payload) {
      const norm = normalizeProviderResult({ antId: slot.antId, providerId: input.provider, taskId: slot.taskId, proposalId: `repair-${slot.antId}-${repairAttempts}`, payload: res.payload, caps: { maxOutputBytes: 20000, maxFiles: 32, perFileByteCap: 20000 } });
      const roleOut = normalizeCivRoleOutput({ role: "repair", callFailureCategory: null, summary: norm.summary, filesProposed: norm.filesProposed, risks: norm.risks, testSuggestions: norm.testSuggestions, malformed: false, outputTruncated: norm.outputTruncated });
      if (roleOut.ok) {
        filesProposed = roleOut.artifacts.length;
        // NAMLA applies every operation. The provider proposed text; it did not
        // write anything, and the applier re-validates every relative path.
        const seen = new Set<string>();
        for (const a of roleOut.artifacts) {
          if (seen.has(a.relativePath)) continue;
          const applied = input.applier.apply(a.relativePath, a.content);
          if (applied.ok) {
            filesApplied += 1;
            seen.add(a.relativePath);
            if (!candidatePaths.includes(a.relativePath)) candidatePaths = [...candidatePaths, a.relativePath];
          }
        }
      }
    }
    filesAppliedByRepair += filesApplied;
    repairReceipts.push({
      colonyId: input.colonyId,
      attempt: repairAttempts,
      antId: slot.antId,
      taskId: slot.taskId,
      providerId: input.provider,
      ok: res.ok,
      failureCategory: res.failureCategory ?? null,
      realProcessExecution,
      filesProposed,
      filesApplied,
      requestBytes: res.requestBytes ?? 0,
      responseBytes: res.responseBytes ?? 0,
      order: order++,
    });
    input.log(`${input.colonyId}-repair`, { attempt: repairAttempts, ok: res.ok, filesProposed, filesApplied });

    // A repair that changed nothing cannot change the next verification result.
    // Stopping here spends no further budget on a candidate that did not move.
    if (filesApplied === 0) {
      input.log(`${input.colonyId}-fail-closed`, { reason: "repair-produced-no-change", repairAttempts });
      return { state: "FAIL_CLOSED", finalStatus: "FAIL", verificationRounds, repairAttempts, filesAppliedByRepair, receipts, repairReceipts, stopReason: "repair-produced-no-change", finalCandidatePaths: candidatePaths };
    }
    // ---- APPLYING done; loop returns to VERIFYING --------------------------
  }
}
