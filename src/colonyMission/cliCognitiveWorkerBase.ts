/**
 * CliCognitiveWorkerBase: shared spine for CLI-backed providers (Claude
 * Code CLI, Codex CLI). The MISSION path (`submit`) still builds the
 * fully-specified PlannedCliInvocation and always REFUSES — no automated or
 * mission code path ever spawns a process. See plannedCliInvocation.ts.
 *
 * Since Real Cognitive Ants R2 (Build Law §19) the adapter is additionally
 * CONDITIONALLY EXECUTABLE through `executeReal`, and ONLY through it: that
 * method runs one bounded process via an injected `ProviderProcessDriver`, but
 * only after a valid, human-confirmed, scope-matched, not-yet-consumed
 * `RealProviderExecutionPermit` passes every gate in
 * `activateRealProvider`. The real process code lives in exactly one module
 * (`src/cognitive/nodeProviderProcessDriver.ts`, the only `child_process`
 * importer); automated tests inject the FAKE driver, so `submit` and every
 * demo remain execution-free. The R2 amendment authorized this narrow
 * human-only exception; nothing here can activate without a human-minted permit.
 */

import { randomUUID } from "crypto";
import type {
  CognitiveBehavioralRole,
  CognitiveProviderName,
  CognitiveWorkRequest,
  CognitiveWorkResult,
  CognitiveWorkerContract,
  CognitiveWorkerProfile,
} from "./cognitiveWorkTypes";
import type { PlannedCliInvocation } from "./plannedCliInvocation";
import { buildPlannedCliInvocation } from "./plannedCliInvocation";
import { ReceiptLog } from "../core/receiptLog";
import type { ProviderExecutableId, ProviderProcessDriver } from "../cognitive/providerProcessDriver";
import type { ActivationOutcome, ActivationReceiptWriter } from "../cognitive/realProviderActivation";
import { activateRealProvider } from "../cognitive/realProviderActivation";

export interface ExecuteRealInput {
  readonly request: CognitiveWorkRequest;
  readonly permitCandidate: unknown;
  readonly workspaceId: string;
  readonly workingDirectoryAbsolute: string;
  readonly driver: ProviderProcessDriver;
  /** The real path sets true; the automated demo (fake driver) sets false. */
  readonly requireHumanCliOrigin: boolean;
  /** Optional override so the demo can force a receipt-failure path. */
  readonly recordReceipt?: ActivationReceiptWriter;
}

export abstract class CliCognitiveWorkerBase implements CognitiveWorkerContract {
  constructor(protected readonly receiptLog: ReceiptLog) {}

  abstract get profile(): CognitiveWorkerProfile;
  protected abstract get executableName(): string;
  protected abstract buildArgumentTemplate(request: CognitiveWorkRequest): readonly string[];

  /** The hard-coded executable id (never a path, never mission text). */
  protected abstract get realExecutableId(): ProviderExecutableId;
  /** The fixed one-shot argument list for real execution. */
  protected abstract realArgumentList(): readonly string[];

  /**
   * The ONLY path that can run a real provider process — and only when the
   * injected driver and a valid human permit allow it. All gating,
   * consume-before-spawn, and safe-result handling live in
   * `activateRealProvider`; this method just supplies the adapter's fixed
   * executable id + argument list and a receipt writer.
   */
  executeReal(input: ExecuteRealInput): ActivationOutcome {
    const recordReceipt: ActivationReceiptWriter =
      input.recordReceipt ??
      ((receipt) => {
        const created = this.receiptLog.create({
          summary: receipt.summary,
          status: receipt.status === "completed" ? "completed" : "blocked",
          links: { missionId: input.request.missionId, taskId: input.request.taskId, antId: input.request.antId },
          details: receipt.details,
        });
        return created.receiptId;
      });

    return activateRealProvider({
      permitCandidate: input.permitCandidate,
      request: input.request,
      workspaceId: input.workspaceId,
      workingDirectoryAbsolute: input.workingDirectoryAbsolute,
      executableId: this.realExecutableId,
      argumentList: this.realArgumentList(),
      driver: input.driver,
      requireHumanCliOrigin: input.requireHumanCliOrigin,
      recordReceipt,
    });
  }

  submit(request: CognitiveWorkRequest): CognitiveWorkResult {
    if (!this.profile.supportedRoles.includes(request.behavioralRole)) {
      return this.refuse(request, "unsupported-behavioral-role");
    }

    const promptText = [
      `Task: ${request.taskDescription}`,
      `Acceptance criteria: ${request.acceptanceCriteria.join("; ")}`,
      `Context: ${request.relevantContext}`,
    ].join("\n");

    const invocation = buildPlannedCliInvocation({
      executableName: this.executableName,
      argumentTemplate: this.buildArgumentTemplate(request),
      promptDeliveryMode: "prompt-file",
      promptText,
      workingDirectoryRelative: `workspaces/${request.missionId}`,
      antId: request.antId,
      taskId: request.taskId,
      missionId: request.missionId,
    });

    return this.refuseWithPlan(request, invocation);
  }

  private refuseWithPlan(request: CognitiveWorkRequest, invocation: PlannedCliInvocation): CognitiveWorkResult {
    this.receiptLog.create({
      summary: `Real ${this.profile.displayName} invocation planned and refused (Phase 0 hard boundary).`,
      status: "refused",
      links: { missionId: request.missionId, taskId: request.taskId, antId: request.antId },
      details: {
        requestId: request.requestId,
        providerName: this.profile.providerName,
        reasonCode: "real-provider-execution-not-authorized",
        invocationId: invocation.invocationId,
        executableName: invocation.executableName,
        argumentCount: invocation.argumentTemplate.length,
        promptFingerprint: invocation.promptFingerprint,
        timeoutMs: invocation.timeoutMs,
        maxStdoutBytes: invocation.maxStdoutBytes,
      },
    });

    return {
      ok: false,
      refusal: {
        requestId: request.requestId,
        antId: request.antId,
        reasonCode: "real-provider-execution-not-authorized",
        createdAt: new Date().toISOString(),
      },
    };
  }

  private refuse(request: CognitiveWorkRequest, reasonCode: string): CognitiveWorkResult {
    this.receiptLog.create({
      summary: `Real ${this.profile.displayName} request refused before planning.`,
      status: "refused",
      links: { missionId: request.missionId, taskId: request.taskId, antId: request.antId },
      details: { requestId: request.requestId, providerName: this.profile.providerName, reasonCode },
    });
    return {
      ok: false,
      refusal: { requestId: request.requestId, antId: request.antId, reasonCode, createdAt: new Date().toISOString() },
    };
  }
}

export const CLI_SUPPORTED_ROLES: readonly CognitiveBehavioralRole[] = ["scout", "builder", "reviewer", "tester", "repair"];

export function displayNameFor(providerName: CognitiveProviderName): string {
  return providerName === "claude" ? "Claude Code CLI" : providerName === "codex" ? "Codex CLI" : "Fake Worker";
}
