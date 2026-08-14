/**
 * AgentAdapterBase: the shared safety spine of every adapter. Concrete
 * adapters only supply a capability profile and canned response text; this
 * base class owns the gates and the receipts, so no subclass can skip them.
 *
 * Gates on every exchange, in order:
 * 1. The request's agentKind must match this adapter's profile.
 * 2. The request's purpose must be in the profile's supported list.
 * 3. SafetyGuard over purpose + requestedCapability + promptText; RISKY and
 *    FORBIDDEN refuse.
 * 4. The canned response text is safety re-checked before it is returned
 *    (defense in depth: canned text is audited at write time, but the gate
 *    makes the audit enforceable rather than conventional).
 *
 * This class performs no network call, no process call, no terminal, no
 * real agent invocation — it imports nothing capable of any of those. The
 * receipt discipline is the established one: summaries are fixed audited
 * phrases; details carry ids, kinds, purposes, lengths, fingerprints, and
 * reason codes; raw prompt text never enters the receipt log.
 */

import { randomUUID } from "crypto";
import type {
  AgentAdapterResult,
  AgentCapabilityProfile,
  AgentRequest,
  AgentResponse,
} from "./agentAdapterTypes";
import { SafetyGuard } from "../core/safetyGuard";
import { ReceiptLog } from "../core/receiptLog";
import { fingerprint } from "../core/redaction";

export abstract class AgentAdapterBase {
  constructor(
    protected readonly safetyGuard: SafetyGuard,
    protected readonly receiptLog: ReceiptLog
  ) {}

  abstract get profile(): AgentCapabilityProfile;

  /** Canned, deterministic text per request; no model, no randomness. */
  protected abstract buildSimulatedResponseText(request: AgentRequest): string;

  handle(request: AgentRequest): AgentAdapterResult {
    if (request.agentKind !== this.profile.agentKind) {
      return this.refuse(request, "kind-mismatch", "the request kind does not match this adapter");
    }

    if (!this.profile.supportedPurposes.includes(request.purpose)) {
      return this.refuse(request, "unsupported-purpose", "the purpose is not supported by this adapter");
    }

    const outgoingDecision = this.safetyGuard.evaluateText(
      `${request.agentKind}\n${request.purpose}\n${request.requestedCapability}\n${request.promptText}`
    );
    if (!outgoingDecision.allowed) {
      return this.refuse(request, "safety-blocked", `blocked by SafetyGuard (${outgoingDecision.level})`);
    }

    const responseText = this.buildSimulatedResponseText(request);

    const responseDecision = this.safetyGuard.evaluateText(responseText);
    if (!responseDecision.allowed) {
      return this.refuse(request, "unsafe-simulated-response", "the canned response failed the safety re-check");
    }

    const receipt = this.receiptLog.create({
      summary: "Simulated agent exchange completed (no real agent was contacted).",
      status: "completed",
      links: { missionId: request.missionId, taskId: request.taskId },
      details: {
        requestId: request.requestId,
        agentKind: request.agentKind,
        purpose: request.purpose,
        promptTextLength: request.promptText.length,
        responseTextLength: responseText.length,
      },
    });

    const response: AgentResponse = {
      responseId: `agent-response-${randomUUID()}`,
      requestId: request.requestId,
      agentKind: request.agentKind,
      simulated: true,
      responseText,
      safetyDecision: outgoingDecision,
      receiptId: receipt.receiptId,
      createdAt: new Date().toISOString(),
    };

    return { ok: true, response, receipt };
  }

  private refuse(request: AgentRequest, reasonCode: string, reasonText: string): AgentAdapterResult {
    // Redacted per the established standard: no raw prompt text, only
    // non-reversible metadata for correlation.
    const receipt = this.receiptLog.create({
      summary: `Simulated agent exchange refused: ${reasonText}.`,
      status: "refused",
      links: { missionId: request.missionId, taskId: request.taskId },
      details: {
        reasonCode,
        requestId: request.requestId,
        agentKind: request.agentKind,
        purpose: request.purpose,
        promptTextLength: request.promptText.length,
        promptFingerprint: fingerprint(request.promptText),
      },
    });

    return {
      ok: false,
      refusal: {
        refusalId: `agent-refusal-${randomUUID()}`,
        requestId: request.requestId,
        reasonCode,
        receiptId: receipt.receiptId,
        refusedAt: new Date().toISOString(),
      },
      receipt,
    };
  }
}
