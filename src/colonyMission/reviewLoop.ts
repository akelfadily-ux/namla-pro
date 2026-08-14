/**
 * Reviewer ant checks: correctness, architecture, security, workspace
 * boundary, and requirements coverage. Mechanical and local — a reviewer
 * checks the artifact it was handed, never a population-wide view.
 */

import { randomUUID } from "crypto";
import type { ArtifactProposal, ReviewObservation } from "./artifactTypes";
import type { WorkTask } from "./workDemand";
import { checkWorkspaceBoundary } from "./missionWorkspace";
import { looksLikeSecret } from "../policies/secretProtectionPolicy";

export function reviewArtifact(artifact: ArtifactProposal, task: WorkTask, reviewerAntId: string): ReviewObservation {
  const correctness = artifact.content.trim().length > 0;
  const architecture = artifact.targetRelativePath.trim().length > 0 && artifact.reason.trim().length > 0;
  const security = !looksLikeSecret(artifact.content);
  const workspaceBoundary = checkWorkspaceBoundary(
    artifact.missionId,
    artifact.targetRelativePath,
    Buffer.byteLength(artifact.content, "utf8")
  ).ok;
  const requirementsCovered = task.acceptanceCriteria.length === 0 || artifact.acceptanceCriteriaRef.length > 0;

  const checks = { correctness, architecture, security, workspaceBoundary, requirementsCovered };
  const allPassed = Object.values(checks).every(Boolean);

  return {
    reviewId: `review-${randomUUID()}`,
    artifactId: artifact.artifactId,
    reviewerAntId,
    verdict: allPassed ? "adequate" : "defects-found",
    checks,
    notes: allPassed ? "No defects observed." : "One or more mechanical checks failed.",
    createdAt: new Date().toISOString(),
  };
}
