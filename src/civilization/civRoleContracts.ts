/**
 * civRoleContracts — role-specific provider-output contracts + robust real-output
 * normalization for the live civilization pipeline (Real Provider Reliability V4).
 *
 * The second real run proved two things: (a) review was invoked with zero
 * artifacts, and (b) real Codex review output normalized to an empty envelope and
 * was (correctly) rejected as `unsupported-role-output`. The dependency-aware
 * runner now fixes (a); the fence-aware Codex/Claude parser + this precise
 * normalization fix (b). Every failure maps to an explicit category and every
 * result yields a safe normalization RECEIPT (counts + fingerprint, never raw
 * output or secrets).
 *
 * Contracts:
 *   - architecture: a plan (summary + optional file plan). NO artifact writes.
 *   - implementation/repair: an artifacts array — validated relative paths +
 *     complete content. No shell, no absolute path, no traversal, no source tree.
 *   - independent review: findings/decisions. NO file writes.
 *
 * Provider output is DATA: nothing here executes, writes, or grants anything.
 * No fs, no child_process, no network, no wall clock.
 */

import type { LiveRole } from "./civLiveCohort";
import { capabilityFamilyOfRole } from "./civLiveCohort";
import { redactedText } from "../cognitive/safeRedactor";

export const ROLE_CONTRACT_SCHEMA_VERSION = "civ-role-contract-v4" as const;

export type CivNormalizationFailure =
  | "missing-agent-message"
  | "empty-agent-message"
  | "malformed-json"
  | "malformed-provider-envelope"
  | "unsupported-role-output"
  | "missing-architecture-plan"
  | "missing-artifact-array"
  | "empty-artifact-array"
  | "invalid-artifact-shape"
  | "invalid-relative-path"
  | "path-traversal"
  | "absolute-path"
  | "duplicate-artifact-path"
  | "empty-artifact-content"
  | "source-tree-target"
  | "command-injection-content"
  | "secret-like-content"
  | "output-size-limit"
  | "provider-timeout"
  | "provider-exit-failure";

export interface CivArtifactProposal {
  readonly relativePath: string;
  readonly content: string;
  readonly purpose: string;
}

export interface CivRoleOutput {
  readonly ok: boolean;
  readonly failureCategory: CivNormalizationFailure | null;
  readonly role: LiveRole;
  readonly artifacts: readonly CivArtifactProposal[];
  readonly planSummary: string;
  /** Architecture file plan (relative paths only) — a plan, never applied files. */
  readonly filePlan: readonly string[];
  readonly reviewFindings: number;
  readonly securityFindings: number;
  readonly testRecommendations: number;
}

/** A safe, persistable receipt of one normalization — no raw output, no secrets. */
export interface CivNormalizationReceipt {
  readonly role: LiveRole;
  readonly success: boolean;
  readonly category: CivNormalizationFailure | "ok";
  readonly artifactCount: number;
  readonly acceptedByteCount: number;
  readonly rejectedPathCount: number;
  readonly schemaVersion: string;
  readonly responseFingerprint: string;
}

/**
 * The deterministic minimal safe FILE PLAN used when the architecture ant times
 * out or fails. It is a PLAN (expected file paths) — never fabricated completed
 * artifacts. The implementation ant builds real content from it.
 */
export const DETERMINISTIC_FALLBACK_PLAN: readonly string[] = ["package.json", "tsconfig.json", "src/types.ts", "src/repository.ts", "src/taskManager.ts", "src/index.ts", "test/taskManager.test.ts", "README.md", "ARCHITECTURE.md"];

/** Map the provider driver's call-level failure category to a contract category. */
export function mapCallFailure(callFailureCategory: string): CivNormalizationFailure {
  if (callFailureCategory === "timed-out") return "provider-timeout";
  if (callFailureCategory === "provider-output-too-large" || callFailureCategory === "output-truncated") return "output-size-limit";
  if (callFailureCategory === "malformed-output" || callFailureCategory === "malformed-provider-output") return "malformed-provider-envelope";
  if (callFailureCategory === "malformed-json") return "malformed-json";
  if (callFailureCategory === "missing-provider-result") return "missing-agent-message";
  return "provider-exit-failure"; // spawn-failed / executable-missing / non-zero-exit / quota / permit issues
}

const SOURCE_TREE_TARGET = /(^|\/)(\.git|node_modules|dist)(\/|$)/;
const COMMAND_INJECTION = /(^|\n)\s*#!\/|child_process|spawnSync\s*\(|execSync\s*\(|\brm\s+-rf\b|curl\s+http|Invoke-WebRequest/;
const SECRET_LIKE = /-----BEGIN [A-Z ]*PRIVATE KEY-----|aws_secret_access_key|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}/;

/** Stable, non-reversible fingerprint of the response (length + FNV hash) — never the content. */
export function responseFingerprint(summary: string, artifactCount: number, findings: number): string {
  let h = 0x811c9dc5;
  const s = `${summary.length}|${artifactCount}|${findings}`;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fp-${h.toString(16).padStart(8, "0")}`;
}

function fail(role: LiveRole, failureCategory: CivNormalizationFailure): CivRoleOutput {
  return { ok: false, failureCategory, role, artifacts: [], planSummary: "", filePlan: [], reviewFindings: 0, securityFindings: 0, testRecommendations: 0 };
}

export interface CivRoleOutputInput {
  readonly role: LiveRole;
  readonly callFailureCategory: string | null;
  readonly summary: string;
  readonly filesProposed: readonly { readonly relPath: string; readonly content: string }[];
  readonly risks: readonly string[];
  readonly testSuggestions: readonly string[];
  readonly malformed: boolean;
  readonly outputTruncated: boolean;
  /** True when the provider ran but produced no agent_message text at all. */
  readonly emptyAgentMessage?: boolean;
}

/** Validate one normalized provider result against its role contract. */
export function normalizeCivRoleOutput(input: CivRoleOutputInput): CivRoleOutput {
  const { role } = input;
  if (input.callFailureCategory) return fail(role, mapCallFailure(input.callFailureCategory));
  if (input.emptyAgentMessage) return fail(role, "empty-agent-message");
  if (input.malformed) return fail(role, "malformed-provider-envelope");
  if (input.outputTruncated) return fail(role, "output-size-limit");

  const family = capabilityFamilyOfRole(role);

  if (family === "architecture") {
    // A plan: summary and/or a file plan. Proposed files are the FILE PLAN, not artifacts.
    if (input.summary.trim().length === 0 && input.filesProposed.length === 0) return fail(role, "missing-architecture-plan");
    const filePlan = input.filesProposed.map((f) => f.relPath).filter((p) => p.length > 0 && !/^([A-Za-z]:|\/|\\)/.test(p) && !p.includes(".."));
    return { ok: true, failureCategory: null, role, artifacts: [], planSummary: redactedText(input.summary, 2000), filePlan, reviewFindings: 0, securityFindings: 0, testRecommendations: 0 };
  }

  if (family === "independent-review") {
    // Findings/decisions only — file writes from a review role are ignored by contract.
    const findings = input.risks.length + input.testSuggestions.length;
    if (input.summary.trim().length === 0 && findings === 0) return fail(role, "unsupported-role-output");
    return { ok: true, failureCategory: null, role, artifacts: [], planSummary: "", filePlan: [], reviewFindings: Math.max(1, findings), securityFindings: input.risks.length, testRecommendations: input.testSuggestions.length };
  }

  // implementation / repair: a validated artifacts array is REQUIRED.
  if (input.filesProposed.length === 0) return fail(role, "missing-artifact-array");
  const seen = new Set<string>();
  const artifacts: CivArtifactProposal[] = [];
  for (const f of input.filesProposed) {
    if (typeof f.relPath !== "string" || typeof f.content !== "string") return fail(role, "invalid-artifact-shape");
    if (f.relPath.length === 0) return fail(role, "invalid-relative-path");
    if (f.relPath.includes("..")) return fail(role, "path-traversal");
    if (/^([A-Za-z]:|\/|\\)/.test(f.relPath)) return fail(role, "absolute-path");
    if (SOURCE_TREE_TARGET.test(f.relPath)) return fail(role, "source-tree-target");
    if (f.content.trim().length === 0) return fail(role, "empty-artifact-content");
    if (seen.has(f.relPath)) return fail(role, "duplicate-artifact-path");
    if (COMMAND_INJECTION.test(f.content)) return fail(role, "command-injection-content");
    if (SECRET_LIKE.test(f.content) || SECRET_LIKE.test(f.relPath)) return fail(role, "secret-like-content");
    seen.add(f.relPath);
    artifacts.push({ relativePath: f.relPath, content: f.content, purpose: redactedText(input.summary, 200) || `artifact for role ${role}` });
  }
  if (artifacts.length === 0) return fail(role, "empty-artifact-array");
  return { ok: true, failureCategory: null, role, artifacts, planSummary: "", filePlan: [], reviewFindings: 0, securityFindings: 0, testRecommendations: 0 };
}

/** Build a safe normalization receipt from a role output (counts + fingerprint only). */
export function buildNormalizationReceipt(role: LiveRole, out: CivRoleOutput, rejectedPathCount = 0): CivNormalizationReceipt {
  const acceptedByteCount = out.artifacts.reduce((s, a) => s + a.content.length, 0);
  return {
    role,
    success: out.ok,
    category: out.ok ? "ok" : (out.failureCategory ?? "unsupported-role-output"),
    artifactCount: out.artifacts.length,
    acceptedByteCount,
    rejectedPathCount,
    schemaVersion: ROLE_CONTRACT_SCHEMA_VERSION,
    responseFingerprint: responseFingerprint(out.planSummary, out.artifacts.length, out.reviewFindings + out.securityFindings + out.testRecommendations),
  };
}
