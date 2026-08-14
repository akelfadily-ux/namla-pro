/**
 * CognitiveRequestValidator: bounds and safety-checks a CognitiveWorkRequest
 * before it is ever handed to a provider (fake or real). No request reaches
 * a provider unvalidated — this is the one chokepoint every request passes
 * through, mirroring SafetyGuard's role for planned actions elsewhere.
 */

import type { CognitiveWorkRequest } from "./cognitiveWorkTypes";
import { SafetyGuard } from "../core/safetyGuard";
import { looksLikeSecret } from "../policies/secretProtectionPolicy";

export const MAX_TASK_DESCRIPTION_LENGTH = 2000 as const;
export const MAX_RELEVANT_CONTEXT_LENGTH = 4000 as const;
export const MAX_ACCEPTANCE_CRITERIA = 10 as const;
export const MAX_ALLOWED_WORKSPACE_PATHS = 20 as const;
export const MAX_RESPONSE_SIZE_CEILING = 20000 as const;
export const MAX_ATTEMPTS_CEILING = 3 as const;

export interface RequestValidation {
  readonly ok: boolean;
  readonly reasonCode?: string;
}

export function validateCognitiveWorkRequest(request: CognitiveWorkRequest, safetyGuard: SafetyGuard): RequestValidation {
  if (request.taskDescription.length === 0 || request.taskDescription.length > MAX_TASK_DESCRIPTION_LENGTH) {
    return { ok: false, reasonCode: "task-description-out-of-bounds" };
  }
  if (request.relevantContext.length > MAX_RELEVANT_CONTEXT_LENGTH) {
    return { ok: false, reasonCode: "relevant-context-out-of-bounds" };
  }
  if (request.acceptanceCriteria.length === 0 || request.acceptanceCriteria.length > MAX_ACCEPTANCE_CRITERIA) {
    return { ok: false, reasonCode: "acceptance-criteria-out-of-bounds" };
  }
  if (request.allowedWorkspacePaths.length === 0 || request.allowedWorkspacePaths.length > MAX_ALLOWED_WORKSPACE_PATHS) {
    return { ok: false, reasonCode: "workspace-paths-out-of-bounds" };
  }
  if (request.maxResponseSize <= 0 || request.maxResponseSize > MAX_RESPONSE_SIZE_CEILING) {
    return { ok: false, reasonCode: "max-response-size-out-of-bounds" };
  }
  if (request.maxAttempts <= 0 || request.maxAttempts > MAX_ATTEMPTS_CEILING) {
    return { ok: false, reasonCode: "max-attempts-out-of-bounds" };
  }

  const combinedText = [request.taskDescription, request.relevantContext, ...request.acceptanceCriteria].join("\n");
  if (looksLikeSecret(combinedText)) {
    return { ok: false, reasonCode: "request-looks-like-secret" };
  }

  const metadataText = Object.entries(request.safeMetadata)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("\n");
  if (looksLikeSecret(metadataText)) {
    return { ok: false, reasonCode: "metadata-looks-like-secret" };
  }

  const decision = safetyGuard.evaluateText(combinedText);
  if (!decision.allowed) {
    return { ok: false, reasonCode: "safety-blocked" };
  }

  return { ok: true };
}
