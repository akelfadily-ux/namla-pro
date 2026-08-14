/**
 * CognitiveResultValidator: bounds and safety-checks a CognitiveWorkResponse
 * before the colony ever acts on it. Every artifact's target path must fall
 * inside the ORIGINAL request's `allowedWorkspacePaths` — a provider cannot
 * expand its own write scope by simply naming a different path in its
 * response.
 */

import type { CognitiveWorkRequest, CognitiveWorkResponse } from "./cognitiveWorkTypes";
import { SafetyGuard } from "../core/safetyGuard";
import { looksLikeSecret } from "../policies/secretProtectionPolicy";

export interface ResultValidation {
  readonly ok: boolean;
  readonly reasonCode?: string;
}

function isWithinAllowedPaths(targetRelativePath: string, allowedWorkspacePaths: readonly string[]): boolean {
  const normalized = targetRelativePath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes("..") || normalized.includes(":")) return false;
  return allowedWorkspacePaths.some((allowed) => {
    const prefix = allowed.replace(/\\/g, "/").replace(/\/$/, "");
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  });
}

export function validateCognitiveWorkResponse(
  request: CognitiveWorkRequest,
  response: CognitiveWorkResponse,
  safetyGuard: SafetyGuard
): ResultValidation {
  if (response.summary.length > request.maxResponseSize) {
    return { ok: false, reasonCode: "response-exceeds-max-size" };
  }
  if (response.confidence < 0 || response.confidence > 1) {
    return { ok: false, reasonCode: "confidence-out-of-bounds" };
  }

  for (const artifact of response.artifactProposals) {
    if (!isWithinAllowedPaths(artifact.targetRelativePath, request.allowedWorkspacePaths)) {
      return { ok: false, reasonCode: "artifact-outside-allowed-workspace-paths" };
    }
    if (artifact.content.length > request.maxResponseSize) {
      return { ok: false, reasonCode: "artifact-exceeds-max-size" };
    }
  }

  const combinedText = [response.summary, ...response.reviewObservations, ...response.verificationSuggestions].join(
    "\n"
  );
  if (looksLikeSecret(combinedText)) {
    return { ok: false, reasonCode: "response-looks-like-secret" };
  }

  const decision = safetyGuard.evaluateText(combinedText);
  if (!decision.allowed) {
    return { ok: false, reasonCode: "safety-blocked" };
  }

  return { ok: true };
}
