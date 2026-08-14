/**
 * Capability C2-A — narrow C2 structural create policy (pure).
 *
 * This is a SEPARATE, STRICTER policy than the C0 projectCreatePolicy; it
 * does not replace or broaden it. It pins the first future real-write scope
 * to a single mechanical shape: exactly one create of a direct-child,
 * lowercase-ASCII `.md` file inside `docs/generated/`, at most 65,536 exact
 * UTF-8 bytes, with the exact-byte content checks folded in.
 *
 * Pure: no fs, no process/env, no network, no timers. It performs NO
 * filesystem access — real existence/link/parent checks are the injected
 * C1 inspection's job. Returns fixed reason codes only; never raw content
 * or raw path.
 */

import { isSecretLikeFilename } from "../inspector/fileClassifier";
import {
  ExactContentRefusalCode,
  prepareExactUtf8Content,
} from "./exactContentBytes";

export const C2_ALLOWED_DIRECTORY = "docs/generated/" as const;
export const C2_ALLOWED_EXTENSION = ".md" as const;
export const MAX_C2_CREATE_BYTES = 65536 as const;
/** Direct-child, lowercase-ASCII markdown basename. */
export const C2_FILENAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}\.md$/;

const WINDOWS_RESERVED_STEMS = new Set<string>([
  "con",
  "prn",
  "aux",
  "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

export type C2CreatePolicyReasonCode =
  | "c2-structural-policy-passed"
  | "not-single-operation"
  | "wrong-change-kind"
  | "requires-human-approval-false"
  | "applied-not-false"
  | "empty-path"
  | "absolute-path"
  | "path-traversal"
  | "not-in-generated-dir"
  | "nested-path"
  | "separator-in-basename"
  | "disallowed-extension"
  | "filename-not-allowed"
  | "windows-reserved-name"
  | "protected-name-segment"
  | "empty-content"
  | "content-too-large"
  | ExactContentRefusalCode;

export interface C2CreatePolicyInput {
  changeKind: string;
  normalizedRelativePath: string;
  content: string;
  operationCount: number;
  requiresHumanApproval: boolean;
  applied: boolean;
}

export interface C2CreatePolicyResult {
  structuralPolicyPassed: boolean;
  reasonCode: C2CreatePolicyReasonCode;
  byteLength: number;
  contentBytesFingerprint?: string;
  /** Always true: structure is not disk truth — C1 inspection still required. */
  realFilesystemVerificationStillRequired: true;
}

export function evaluateC2CreatePolicy(input: C2CreatePolicyInput): C2CreatePolicyResult {
  const fail = (reasonCode: C2CreatePolicyReasonCode, byteLength = 0): C2CreatePolicyResult => ({
    structuralPolicyPassed: false,
    reasonCode,
    byteLength,
    realFilesystemVerificationStillRequired: true,
  });

  if (input.operationCount !== 1) return fail("not-single-operation");
  if (input.changeKind !== "create") return fail("wrong-change-kind");
  if (input.requiresHumanApproval !== true) return fail("requires-human-approval-false");
  if (input.applied !== false) return fail("applied-not-false");

  const path = input.normalizedRelativePath;
  if (path.trim().length === 0) return fail("empty-path");
  if (/^([A-Za-z]:|[\\/])/.test(path)) return fail("absolute-path");
  if (path.split(/[\\/]+/).some((s) => s === "..")) return fail("path-traversal");

  if (!path.startsWith(C2_ALLOWED_DIRECTORY)) return fail("not-in-generated-dir");
  const remainder = path.slice(C2_ALLOWED_DIRECTORY.length);
  if (remainder.length === 0) return fail("filename-not-allowed");
  if (remainder.includes("/")) return fail("nested-path");
  if (remainder.includes("\\")) return fail("separator-in-basename");

  const basename = remainder;
  if (!basename.endsWith(C2_ALLOWED_EXTENSION)) return fail("disallowed-extension");
  if (!C2_FILENAME_PATTERN.test(basename)) return fail("filename-not-allowed");

  const stem = basename.slice(0, basename.length - C2_ALLOWED_EXTENSION.length);
  if (WINDOWS_RESERVED_STEMS.has(stem)) return fail("windows-reserved-name");
  if (isSecretLikeFilename(basename)) return fail("protected-name-segment");

  if (input.content.length === 0) return fail("empty-content");

  const exact = prepareExactUtf8Content(input.content);
  if (!exact.ok) return fail(exact.reasonCode);
  if (exact.byteLength > MAX_C2_CREATE_BYTES) return fail("content-too-large", exact.byteLength);

  return {
    structuralPolicyPassed: true,
    reasonCode: "c2-structural-policy-passed",
    byteLength: exact.byteLength,
    contentBytesFingerprint: exact.contentBytesFingerprint,
    realFilesystemVerificationStillRequired: true,
  };
}
