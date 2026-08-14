/**
 * activateRealProvider — the single orchestrator that turns a valid human
 * permit + a bounded request into ONE provider process run and a safe result
 * (Build Law §19). It is driver-agnostic: the smoke CLI passes the real
 * `NodeProviderProcessDriver`, and the automated demo passes the
 * `FakeProviderProcessDriver`. Nothing else changes between them, so the demo
 * exercises the exact same gate the real path uses.
 *
 * Permit-consumption discipline (Build Law §19 clause 8):
 *  - every PRE-ADMISSION refusal (invalid/forged permit, scope mismatch,
 *    already-consumed, non-real provider, non-human-cli origin on the real
 *    path, invalid or oversized request) returns WITHOUT consuming;
 *  - a workspace block returns WITHOUT consuming;
 *  - the permit is consumed IMMEDIATELY before the driver runs, and stays
 *    consumed for every post-spawn outcome (executable missing, spawn failure,
 *    timeout, non-zero exit, malformed output, receipt failure, success).
 *  - there is no retry with the same permit — a consumed permit refuses on
 *    replay.
 *
 * The result the provider produces is DATA for the existing review-gated
 * workflow — never applied automatically, never executed. Raw stdout/stderr,
 * environment, and credentials never reach a receipt: receipts carry counts,
 * categories, fingerprints, and the safe parsed summary only.
 *
 * No fs, no child_process, no network in this file.
 */

import type {
  CognitiveWorkRequest,
  CognitiveWorkResult,
} from "../colonyMission/cognitiveWorkTypes";
import { fingerprint } from "../core/redaction";
import type { ProviderExecutableId, ProviderProcessDriver } from "./providerProcessDriver";
import { parseProviderOutput } from "./providerOutputParser";
import type { RealProviderExecutionPermit, RealProviderId } from "./realProviderExecutionPermit";
import { consumePermit, isConsumed, isValidPermit, permitScopeMatches } from "./realProviderExecutionPermit";
import { environmentSecretsReadyForProviderWork } from "./environmentSecretBootstrap";

export type ActivationStatus = "refused" | "blocked" | "failed" | "completed";

export interface ActivationReceiptInput {
  readonly summary: string;
  readonly status: "completed" | "failed" | "refused" | "blocked";
  readonly details: Record<string, unknown>;
}

/** Writes a safe receipt and returns its id. May throw (the demo forces this). */
export type ActivationReceiptWriter = (input: ActivationReceiptInput) => string;

export interface ActivateRealProviderInput {
  readonly permitCandidate: unknown;
  readonly request: CognitiveWorkRequest;
  readonly workspaceId: string;
  /** Absolute, already-validated smoke-workspace directory for the process cwd. */
  readonly workingDirectoryAbsolute: string;
  readonly executableId: ProviderExecutableId;
  /** Fixed one-shot argument list from the adapter — never built from mission text. */
  readonly argumentList: readonly string[];
  readonly driver: ProviderProcessDriver;
  /** The real path sets true: a permit that is not "human-cli" origin is refused. */
  readonly requireHumanCliOrigin: boolean;
  readonly recordReceipt: ActivationReceiptWriter;
}

export interface ActivationOutcome {
  readonly status: ActivationStatus;
  readonly reasonCode: string;
  // --- command-center-safe fields ---
  readonly realProviderEnabled: boolean;
  readonly providerSelected: RealProviderId | "none";
  readonly permitValid: boolean;
  readonly permitConsumed: boolean;
  readonly providerInvocationStarted: boolean;
  readonly providerInvocationCompleted: boolean;
  readonly providerTimedOut: boolean;
  readonly providerOutputTruncated: boolean;
  readonly providerFailureCategory: string;
  readonly providerReceiptId: string | null;
  readonly receiptFailed: boolean;
  /** The bounded cognition result — DATA for the review-gated workflow. */
  readonly result: CognitiveWorkResult | null;
}

function refusal(reasonCode: string, antId: string): CognitiveWorkResult {
  return { ok: false, refusal: { requestId: "", antId, reasonCode, createdAt: new Date().toISOString() } };
}

/** Bounded-request check: lengths within the permit's input cap. Never throws. */
function requestWithinBounds(request: CognitiveWorkRequest, maxInputBytes: number): boolean {
  const total =
    request.taskDescription.length +
    request.relevantContext.length +
    request.acceptanceCriteria.reduce((sum, c) => sum + c.length, 0);
  if (request.taskDescription.length === 0) return false;
  return total <= maxInputBytes;
}

export function activateRealProvider(input: ActivateRealProviderInput): ActivationOutcome {
  const { permitCandidate, request, workspaceId, driver, recordReceipt } = input;
  const antId = request.antId;

  const baseOutcome = {
    realProviderEnabled: driver.isReal,
    providerInvocationStarted: false,
    providerInvocationCompleted: false,
    providerTimedOut: false,
    providerOutputTruncated: false,
    providerFailureCategory: "none",
    providerReceiptId: null as string | null,
    receiptFailed: false,
    result: null as CognitiveWorkResult | null,
  };

  const refuse = (reasonCode: string, permitValid: boolean, providerSelected: RealProviderId | "none"): ActivationOutcome => ({
    ...baseOutcome,
    status: "refused",
    reasonCode,
    providerSelected,
    permitValid,
    permitConsumed: false,
    result: refusal(reasonCode, antId),
  });

  // --- pre-admission gate (never consumes) --------------------------------
  // 0. §34: the environment-secret registry must be populated BEFORE any
  //    provider-derived text is assembled, requested, or written to a receipt.
  //    Composition roots call the same central bootstrap; this is the single
  //    choke point every real provider path passes through, so it re-checks
  //    rather than trusting that a caller did it. Initialization is idempotent.
  //
  //    A host with no credentials configured initializes cleanly with zero
  //    registrations — legitimate, not a failure. A host that HAS one and could
  //    not prove it was registered fails closed here, before any request
  //    exists: the exact-value defence would otherwise be silently absent.
  const secretStatus = environmentSecretsReadyForProviderWork();
  if (!secretStatus.initialized) {
    return refuse(secretStatus.safeReasonCode, false, "none");
  }

  // 1. provider must be a real one (not "fake").
  if (request.providerName !== "claude" && request.providerName !== "codex") {
    return refuse("provider-not-real", false, "none");
  }
  const providerSelected = request.providerName;

  // 2. permit identity — rejects missing, forged, JSON, and object-literal permits.
  if (!isValidPermit(permitCandidate)) {
    return refuse("invalid-or-forged-permit", false, providerSelected);
  }
  const permit: RealProviderExecutionPermit = permitCandidate;

  // 3. scope must bind exactly to this provider/mission/task/ant/workspace.
  const scope = permitScopeMatches(permit, {
    provider: providerSelected,
    missionId: request.missionId,
    taskId: request.taskId,
    antId: request.antId,
    workspaceId,
  });
  if (!scope.ok) return refuse(scope.reasonCode, true, providerSelected);

  // 4. already consumed → replay refusal (never re-consumes).
  if (isConsumed(permit)) return refuse("permit-already-consumed", true, providerSelected);

  // 5. real path requires a human-confirmed permit; an automated-test permit
  //    can never reach the real Node driver.
  if (input.requireHumanCliOrigin && (permit.origin !== "human-cli" || !permit.humanConfirmed)) {
    return refuse("permit-not-human-confirmed", true, providerSelected);
  }

  // 6. bounded request (invalid / oversized input) — pre-admission, no consume.
  if (!requestWithinBounds(request, permit.maxInputBytes)) {
    return refuse("invalid-or-oversized-request", true, providerSelected);
  }

  // --- consume immediately before spawning (single-use) -------------------
  const consumed = consumePermit(permit);
  if (!consumed) {
    // Lost a race to another consumer; treat as replay refusal, still no double-run.
    return refuse("permit-already-consumed", true, providerSelected);
  }

  // The prompt on stdin is bounded again at the driver; build it here as data.
  const stdinData = [
    `Task: ${request.taskDescription}`,
    `Acceptance criteria: ${request.acceptanceCriteria.join("; ")}`,
    `Context: ${request.relevantContext}`,
  ].join("\n");

  // --- run exactly one process (permit stays consumed from here on) -------
  const processResult = driver.run({
    executableId: input.executableId,
    argumentList: input.argumentList,
    stdinData,
    maxStdinBytes: permit.maxInputBytes,
    maxStdoutBytes: permit.maxOutputBytes,
    maxStderrBytes: 16384,
    timeoutMs: permit.timeoutMs,
    workingDirectoryAbsolute: input.workingDirectoryAbsolute,
  });

  const timedOut = processResult.failureCategory === "timed-out";
  const parsed = parseProviderOutput(processResult.stdout, permit.maxOutputBytes, true);

  const succeeded =
    processResult.ran &&
    processResult.exitCode === 0 &&
    processResult.failureCategory === "none" &&
    parsed.ok;

  const providerFailureCategory = succeeded
    ? "none"
    : processResult.failureCategory !== "none"
      ? processResult.failureCategory
      : parsed.safeFailureCategory;

  const status: ActivationStatus = succeeded ? "completed" : "failed";

  // Build the cognition result (DATA only — never applied, never executed).
  const result: CognitiveWorkResult = succeeded
    ? {
        ok: true,
        response: {
          requestId: request.requestId,
          antId,
          status: "completed",
          summary: parsed.summary,
          artifactProposals: parsed.artifactProposals,
          reviewObservations: parsed.observations,
          verificationSuggestions: [],
          confidence: parsed.confidence,
          usageMetadata: { outputBytes: processResult.stdout.length, argumentCount: input.argumentList.length },
          createdAt: new Date().toISOString(),
        },
      }
    : { ok: false, refusal: { requestId: request.requestId, antId, reasonCode: providerFailureCategory, createdAt: new Date().toISOString() } };

  // Safe receipt — no raw stdout/stderr/env, only fingerprints/categories/counts.
  let providerReceiptId: string | null = null;
  let receiptFailed = false;
  try {
    providerReceiptId = recordReceipt({
      summary: `Provider ${providerSelected} invocation ${status} for one admitted ant (bounded, one-shot).`,
      status: status === "completed" ? "completed" : "failed",
      details: {
        requestId: request.requestId,
        providerName: providerSelected,
        realProvider: driver.isReal,
        failureCategory: providerFailureCategory,
        timedOut,
        outputTruncated: parsed.outputTruncated || processResult.stdoutTruncated,
        outputFingerprint: fingerprint(processResult.stdout),
        argumentCount: input.argumentList.length,
        exitCode: processResult.exitCode,
      },
    });
  } catch {
    // Receipt failure AFTER a real invocation: the permit stays consumed; we
    // record the failure but never re-run and never un-consume.
    receiptFailed = true;
  }

  return {
    status,
    reasonCode: succeeded ? "provider-completed" : providerFailureCategory,
    realProviderEnabled: driver.isReal,
    providerSelected,
    permitValid: true,
    permitConsumed: true,
    providerInvocationStarted: true,
    providerInvocationCompleted: processResult.ran && !timedOut,
    providerTimedOut: timedOut,
    providerOutputTruncated: parsed.outputTruncated || processResult.stdoutTruncated,
    providerFailureCategory,
    providerReceiptId,
    receiptFailed,
    result,
  };
}
