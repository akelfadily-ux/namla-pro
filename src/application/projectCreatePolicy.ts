/**
 * Capability C0 — structural create policy.
 *
 * STRUCTURAL AND PURE ONLY. This module validates the SHAPE of a proposed
 * create operation against policy DATA; it performs no filesystem access
 * whatsoever. It does NOT resolve real paths, check existence, inspect
 * symlinks, or read parent chains — those are real-filesystem checks
 * deferred to C1 (dry-run) and enforced before any write in C2. A pass
 * here means "structurally permissible", never "safe on disk".
 *
 * Pure: no fs, no process/env, no network, no timers, no mutation. All
 * reason literals are audited against the canonical protected-text matcher.
 */

import { isSecretLikeFilename } from "../inspector/fileClassifier";

/**
 * Hard-coded maximum content size. Not environment-configurable, not
 * mission/ant/adapter/user-runtime-changeable — a code constant, like the
 * simulation budget.
 */
export const MAX_CREATE_CONTENT_BYTES = 262_144 as const; // 256 KB

/** Subdirectories a create may target (prefix match on the first segment). */
export const ALLOWED_CREATE_ROOTS: readonly string[] = ["docs", "examples", "src/generated"];

/** Extensions a create may produce. */
export const ALLOWED_CREATE_EXTENSIONS: readonly string[] = [".md", ".txt", ".ts", ".json"];

export type CreatePolicyReasonCode =
  | "structural-policy-passed"
  | "empty-path"
  | "absolute-path"
  | "path-traversal"
  | "empty-or-dot-segment"
  | "disallowed-root"
  | "disallowed-extension"
  | "protected-name-segment"
  | "content-too-large"
  | "not-single-operation"
  | "wrong-change-kind";

export interface CreatePolicyResult {
  /** True only when the structural checks passed. */
  structuralPolicyPassed: boolean;
  reasonCode: CreatePolicyReasonCode;
  /** Always true: C0 asserts structure only; disk truth is a C1 concern. */
  realFilesystemVerificationStillRequired: true;
}

export interface CreatePolicyInput {
  changeKind: string;
  normalizedRelativePath: string;
  contentByteLength: number;
  /** Number of file operations described; must be exactly one. */
  operationCount: number;
}

function segmentsOf(path: string): string[] {
  return path.split(/[\\/]+/);
}

export function evaluateCreatePolicy(input: CreatePolicyInput): CreatePolicyResult {
  const pass = (reasonCode: CreatePolicyReasonCode, ok: boolean): CreatePolicyResult => ({
    structuralPolicyPassed: ok,
    reasonCode,
    realFilesystemVerificationStillRequired: true,
  });

  if (input.operationCount !== 1) return pass("not-single-operation", false);
  if (input.changeKind !== "create") return pass("wrong-change-kind", false);

  const path = input.normalizedRelativePath;
  if (path.trim().length === 0) return pass("empty-path", false);
  if (/^([A-Za-z]:|[\\/])/.test(path)) return pass("absolute-path", false);

  const rawSegments = segmentsOf(path);
  if (rawSegments.some((s) => s === "..")) return pass("path-traversal", false);
  if (rawSegments.some((s) => s.length === 0 || s === ".")) return pass("empty-or-dot-segment", false);

  const segments = rawSegments.filter((s) => s.length > 0);
  if (segments.some((s) => isSecretLikeFilename(s))) return pass("protected-name-segment", false);

  const inAllowedRoot = ALLOWED_CREATE_ROOTS.some(
    (root) => path === root || path.startsWith(`${root}/`)
  );
  if (!inAllowedRoot) return pass("disallowed-root", false);

  const fileName = segments[segments.length - 1];
  const dot = fileName.lastIndexOf(".");
  const ext = dot > 0 ? fileName.slice(dot).toLowerCase() : "";
  if (!ALLOWED_CREATE_EXTENSIONS.includes(ext)) return pass("disallowed-extension", false);

  if (input.contentByteLength > MAX_CREATE_CONTENT_BYTES) return pass("content-too-large", false);

  return pass("structural-policy-passed", true);
}
