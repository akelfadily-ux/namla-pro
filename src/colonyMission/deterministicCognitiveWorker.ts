/**
 * DeterministicCognitiveWorker: the "fake" provider. Same request always
 * yields the same response — no model, no network, no process, no
 * randomness. This is what every automated test and demo uses; real
 * providers (claudeCliAdapter, codexCliAdapter) are never invoked by
 * anything in this codebase's test/demo suite.
 *
 * Content generation is a deterministic lookup keyed by (behavioralRole,
 * antId, taskId) — different ants proposing for the same task produce
 * genuinely different (but reproducible) content, which is what lets
 * scout-proposal competition actually have something to compete over.
 *
 * Repair behavior is intentionally simple and explicit: it strips the known
 * demo defect marker (`DEFECT_MARKER`) from whatever broken content is
 * handed back in `relevantContext`. This is a real, reproducible algorithm
 * fixtures can rely on — not a hard-coded success flag.
 */

import { createHash } from "crypto";
import type {
  CognitiveWorkRequest,
  CognitiveWorkResponse,
  CognitiveWorkResult,
  CognitiveWorkerContract,
  CognitiveWorkerProfile,
} from "./cognitiveWorkTypes";
import type { ArtifactProposal } from "./artifactTypes";

/** The one marker `FakeVerificationRunner` treats as a verification failure. */
export const DEFECT_MARKER = "__NAMLA_DEMO_DEFECT__";

function fingerprint(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function hashToIndex(seed: string, modulus: number): number {
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) % modulus;
}

const SCOUT_APPROACHES = [
  {
    label: "layered-architecture",
    summary:
      "Proposed plan: a layered architecture with a data model, a task-store service, and a thin CLI/UI boundary.",
  },
  {
    label: "feature-folder-architecture",
    summary: "Proposed plan: feature-folder organization grouping model, storage, and presentation per capability.",
  },
  {
    label: "minimal-single-module",
    summary: "Proposed plan: one small module with in-memory storage, favoring the fewest moving parts.",
  },
];

function buildScoutResponse(request: CognitiveWorkRequest): CognitiveWorkResponse {
  const approachIndex = hashToIndex(`${request.taskId}:${request.antId}`, SCOUT_APPROACHES.length);
  const approach = SCOUT_APPROACHES[approachIndex];
  const qualityDraw = hashToIndex(`quality:${request.taskId}:${request.antId}`, 1000) / 1000;

  return {
    requestId: request.requestId,
    antId: request.antId,
    status: "completed",
    summary: approach.summary,
    artifactProposals: [],
    reviewObservations: [],
    verificationSuggestions: [`Verify against: ${request.acceptanceCriteria.join("; ")}`],
    confidence: Math.round((0.55 + qualityDraw * 0.4) * 100) / 100,
    usageMetadata: { attemptsUsed: 1, responseLength: approach.summary.length },
    createdAt: new Date().toISOString(),
  };
}

function buildBuilderResponse(request: CognitiveWorkRequest): CognitiveWorkResponse {
  const targetPath = request.allowedWorkspacePaths[0] ?? "src/generated.ts";
  const content = [
    `// Generated for task ${request.taskId} by ant ${request.antId}`,
    `// Acceptance criteria: ${request.acceptanceCriteria.join(", ")}`,
    "",
    "export function handle(): string {",
    `  return "ok:${request.taskId}";`,
    "}",
    "",
  ].join("\n");

  const artifact: ArtifactProposal = {
    artifactId: `artifact-${request.requestId}`,
    missionId: request.missionId,
    taskId: request.taskId,
    antId: request.antId,
    targetRelativePath: targetPath,
    changeKind: "create-file",
    content,
    contentFingerprint: fingerprint(content),
    reason: "Deterministic builder output for the demo mission.",
    acceptanceCriteriaRef: request.acceptanceCriteria[0] ?? "unspecified",
    confidence: 0.8,
    requiresReview: true,
    createdAt: new Date().toISOString(),
  };

  return {
    requestId: request.requestId,
    antId: request.antId,
    status: "completed",
    summary: `Produced one artifact for ${request.taskId}.`,
    artifactProposals: [artifact],
    reviewObservations: [],
    verificationSuggestions: [],
    confidence: 0.8,
    usageMetadata: { attemptsUsed: 1, responseLength: content.length },
    createdAt: new Date().toISOString(),
  };
}

function buildReviewerResponse(request: CognitiveWorkRequest): CognitiveWorkResponse {
  return {
    requestId: request.requestId,
    antId: request.antId,
    status: "completed",
    summary: `Reviewed artifact(s) for ${request.taskId}.`,
    artifactProposals: [],
    reviewObservations: [
      "Naming is consistent with the acceptance criteria.",
      "No workspace-boundary or security concern observed.",
    ],
    verificationSuggestions: [],
    confidence: 0.75,
    usageMetadata: { attemptsUsed: 1, responseLength: 0 },
    createdAt: new Date().toISOString(),
  };
}

function buildRepairResponse(request: CognitiveWorkRequest): CognitiveWorkResponse {
  const targetPath = request.allowedWorkspacePaths[0] ?? "src/generated.ts";
  const repaired = request.relevantContext.split(DEFECT_MARKER).join("");

  const artifact: ArtifactProposal = {
    artifactId: `artifact-repair-${request.requestId}`,
    missionId: request.missionId,
    taskId: request.taskId,
    antId: request.antId,
    targetRelativePath: targetPath,
    changeKind: "repair-proposal",
    content: repaired,
    contentFingerprint: fingerprint(repaired),
    reason: "Removed the marker verification flagged as a defect.",
    acceptanceCriteriaRef: request.acceptanceCriteria[0] ?? "unspecified",
    confidence: 0.85,
    requiresReview: true,
    createdAt: new Date().toISOString(),
  };

  return {
    requestId: request.requestId,
    antId: request.antId,
    status: "completed",
    summary: `Repaired the artifact flagged by verification for ${request.taskId}.`,
    artifactProposals: [artifact],
    reviewObservations: [],
    verificationSuggestions: [],
    confidence: 0.85,
    usageMetadata: { attemptsUsed: 1, responseLength: repaired.length },
    createdAt: new Date().toISOString(),
  };
}

function buildTesterResponse(request: CognitiveWorkRequest): CognitiveWorkResponse {
  return {
    requestId: request.requestId,
    antId: request.antId,
    status: "completed",
    summary: `Verification suggestion prepared for ${request.taskId}.`,
    artifactProposals: [],
    reviewObservations: [],
    verificationSuggestions: ["Run the hard-coded allowlisted verification set."],
    confidence: 0.7,
    usageMetadata: { attemptsUsed: 1, responseLength: 0 },
    createdAt: new Date().toISOString(),
  };
}

export class DeterministicCognitiveWorker implements CognitiveWorkerContract {
  get profile(): CognitiveWorkerProfile {
    return {
      providerName: "fake",
      displayName: "Deterministic Fake Worker",
      supportedRoles: ["scout", "builder", "reviewer", "tester", "repair"],
      realExecutionEnabled: false,
    };
  }

  submit(request: CognitiveWorkRequest): CognitiveWorkResult {
    let response: CognitiveWorkResponse;
    switch (request.behavioralRole) {
      case "scout":
        response = buildScoutResponse(request);
        break;
      case "builder":
        response = buildBuilderResponse(request);
        break;
      case "reviewer":
        response = buildReviewerResponse(request);
        break;
      case "repair":
        response = buildRepairResponse(request);
        break;
      case "tester":
        response = buildTesterResponse(request);
        break;
    }
    return { ok: true, response };
  }
}
