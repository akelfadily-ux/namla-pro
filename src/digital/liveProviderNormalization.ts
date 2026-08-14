/**
 * liveProviderNormalization — turn a raw provider response into a bounded,
 * structured, DATA-ONLY result (Build Law §25). A provider output is never
 * authority: it is normalized, size- and path-checked, and stripped of anything
 * that would ask to run a command, write outside the workspace, touch the source
 * tree, or embed a secret. Rejected output produces a safe failure category, not
 * an applied artifact.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import { roundTo } from "../colony/colonyTypes";
import { fingerprint, validateWorkspacePath } from "./digitalWorkspace";
import type { RealProviderId } from "../cognitive/realProviderExecutionPermit";

export interface RawProviderFile {
  readonly path: string;
  readonly operation: "create" | "modify";
  readonly content: string;
}

export interface RawProviderPayload {
  readonly summary: string;
  readonly assumptions: readonly string[];
  readonly files: readonly RawProviderFile[];
  readonly risks: readonly string[];
  readonly tests: readonly string[];
  readonly confidence: number;
  /** A provider must NEVER request command execution; if present, it is rejected. */
  readonly requestedCommands?: readonly string[];
  readonly malformed?: boolean;
}

export interface NormalizedProviderFile {
  readonly relPath: string;
  readonly operation: "create" | "modify";
  readonly content: string;
  readonly fingerprint: string;
}

export interface NormalizedProviderResult {
  readonly proposalId: string;
  readonly antId: string;
  readonly providerId: RealProviderId;
  readonly taskId: string;
  readonly summary: string;
  readonly assumptions: readonly string[];
  readonly filesProposed: readonly NormalizedProviderFile[];
  readonly risks: readonly string[];
  readonly testSuggestions: readonly string[];
  readonly confidence: number;
  readonly uncertainty: number;
  readonly safeFailureCategory: string | null;
  readonly outputTruncated: boolean;
  readonly rejectionReasons: readonly string[];
}

export interface NormalizationCaps {
  readonly maxOutputBytes: number;
  readonly maxFiles: number;
  readonly perFileByteCap: number;
}

const SECRET_LIKE = /(api[_-]?key|secret|password|token|private[_-]?key|-----BEGIN)/i;

export interface NormalizeInput {
  readonly antId: string;
  readonly providerId: RealProviderId;
  readonly taskId: string;
  readonly proposalId: string;
  readonly payload: RawProviderPayload;
  readonly caps: NormalizationCaps;
}

/** Normalize + validate one provider response into a safe structured result. */
export function normalizeProviderResult(input: NormalizeInput): NormalizedProviderResult {
  const { payload, caps } = input;
  const rejectionReasons: string[] = [];
  const base = {
    proposalId: input.proposalId,
    antId: input.antId,
    providerId: input.providerId,
    taskId: input.taskId,
    assumptions: payload.assumptions ?? [],
    risks: payload.risks ?? [],
    testSuggestions: payload.tests ?? [],
  };

  if (payload.malformed || typeof payload.summary !== "string" || !Array.isArray(payload.files)) {
    return { ...base, summary: "", filesProposed: [], confidence: 0, uncertainty: 1, safeFailureCategory: "malformed-provider-output", outputTruncated: false, rejectionReasons: ["malformed-provider-output"] };
  }
  if (payload.requestedCommands && payload.requestedCommands.length > 0) {
    return { ...base, summary: "", filesProposed: [], confidence: 0, uncertainty: 1, safeFailureCategory: "executable-command-request", outputTruncated: false, rejectionReasons: ["executable-command-request"] };
  }

  const totalBytes = payload.files.reduce((s, f) => s + (f.content?.length ?? 0), 0) + payload.summary.length;
  const outputTruncated = totalBytes > caps.maxOutputBytes;
  if (outputTruncated) rejectionReasons.push("oversized-output");

  const filesProposed: NormalizedProviderFile[] = [];
  for (const f of payload.files) {
    if (filesProposed.length >= caps.maxFiles) {
      rejectionReasons.push("too-many-files");
      break;
    }
    const pathCheck = validateWorkspacePath(f.path);
    if (!pathCheck.ok) {
      rejectionReasons.push(`path:${pathCheck.reasonCode}`);
      continue;
    }
    if ((f.content?.length ?? 0) > caps.perFileByteCap) {
      rejectionReasons.push("file-too-large");
      continue;
    }
    if (SECRET_LIKE.test(f.content ?? "")) {
      rejectionReasons.push("secret-like-content");
      continue;
    }
    filesProposed.push({ relPath: f.path, operation: f.operation === "modify" ? "modify" : "create", content: f.content, fingerprint: fingerprint(f.content) });
  }

  const confidence = roundTo(Math.max(0, Math.min(1, payload.confidence ?? 0.5)), 4);
  // If oversized, we keep only the files that fit; if nothing usable survived,
  // surface a safe failure category so the pipeline treats it as a failure.
  const safeFailureCategory = filesProposed.length === 0 && payload.files.length > 0 ? "no-usable-files" : outputTruncated && filesProposed.length === 0 ? "oversized-output" : null;

  return {
    ...base,
    summary: payload.summary.slice(0, 2000),
    filesProposed,
    confidence,
    uncertainty: roundTo(1 - confidence, 4),
    safeFailureCategory,
    outputTruncated,
    rejectionReasons,
  };
}
