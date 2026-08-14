/**
 * CognitiveWorkerRouter: the one chokepoint every cognitive request passes
 * through. Validates the request, looks up the requested provider, submits,
 * validates the response, and receipts the outcome — no colony decision
 * module talks to a provider directly.
 *
 * Provider identity is never chosen here on an ant's behalf: the caller
 * (an already-admitted ant's own claim) supplies `providerName`. The router
 * only gates and records; it does not decide who works on what.
 */

import type { CognitiveWorkRequest, CognitiveWorkResult } from "./cognitiveWorkTypes";
import type { CognitiveWorkerRegistry } from "./cognitiveWorkerRegistry";
import { validateCognitiveWorkRequest } from "./cognitiveRequestValidator";
import { validateCognitiveWorkResponse } from "./cognitiveResultValidator";
import { SafetyGuard } from "../core/safetyGuard";
import { ReceiptLog } from "../core/receiptLog";
import { fingerprint } from "../core/redaction";

export class CognitiveWorkerRouter {
  constructor(
    private readonly registry: CognitiveWorkerRegistry,
    private readonly safetyGuard: SafetyGuard,
    private readonly receiptLog: ReceiptLog
  ) {}

  route(request: CognitiveWorkRequest): CognitiveWorkResult {
    const requestValidation = validateCognitiveWorkRequest(request, this.safetyGuard);
    if (!requestValidation.ok) {
      return this.refuse(request, requestValidation.reasonCode ?? "invalid-request");
    }

    const worker = this.registry.get(request.providerName);
    if (!worker) {
      return this.refuse(request, "no-provider-registered");
    }
    if (!worker.profile.supportedRoles.includes(request.behavioralRole)) {
      return this.refuse(request, "unsupported-behavioral-role");
    }

    const result = worker.submit(request);
    if (!result.ok) {
      this.receiptLog.create({
        summary: "Cognitive work request refused by provider.",
        status: "refused",
        links: { missionId: request.missionId, taskId: request.taskId, antId: request.antId },
        details: { requestId: request.requestId, providerName: request.providerName, reasonCode: result.refusal.reasonCode },
      });
      return result;
    }

    const responseValidation = validateCognitiveWorkResponse(request, result.response, this.safetyGuard);
    if (!responseValidation.ok) {
      return this.refuse(request, responseValidation.reasonCode ?? "invalid-response");
    }

    this.receiptLog.create({
      summary: "Cognitive work request completed.",
      status: "completed",
      links: { missionId: request.missionId, taskId: request.taskId, antId: request.antId },
      details: {
        requestId: request.requestId,
        providerName: request.providerName,
        behavioralRole: request.behavioralRole,
        artifactCount: result.response.artifactProposals.length,
        summaryFingerprint: fingerprint(result.response.summary),
      },
    });

    return result;
  }

  private refuse(request: CognitiveWorkRequest, reasonCode: string): CognitiveWorkResult {
    this.receiptLog.create({
      summary: "Cognitive work request refused before reaching a provider.",
      status: "refused",
      links: { missionId: request.missionId, taskId: request.taskId, antId: request.antId },
      details: { requestId: request.requestId, providerName: request.providerName, reasonCode },
    });
    return {
      ok: false,
      refusal: { requestId: request.requestId, antId: request.antId, reasonCode, createdAt: new Date().toISOString() },
    };
  }
}
