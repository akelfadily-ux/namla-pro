/**
 * smokeWorkspace — the dedicated, bounded, human-only smoke workspace on real
 * disk (Build Law §19). This is one of the two authorized real-fs-mutation
 * surfaces in the whole codebase (the other is
 * `application/projectFileCreator.ts`), and — like the real process driver —
 * it is NEVER imported by any automated demo or test. Automated verification
 * uses the in-memory fake workspace instead.
 *
 * It can only ever create `workspaces/provider-smoke/<claude|codex>/<mission>/`
 * under the repository root, validated by a strict allowlist regex: no
 * traversal, no absolute path, no source-tree path, no protected name. It
 * writes only a bounded request manifest and a safe (redacted) result summary
 * — never a raw prompt, raw stdout/stderr, environment, or credentials.
 *
 * It performs no Git action and never writes outside the smoke workspace.
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from "fs";
import { resolve, sep } from "path";
import { SafeWorkspacePathResolver, safeWriteWorkspaceFile, safeReadWorkspaceFile, utf8Bytes } from "./safeWorkspacePath";

/**
 * The ONLY workspace-id shapes this module will ever touch: the R2 one-ant
 * smoke root, and (since Build Law §21) the V2 academy-pilot root. Both are
 * human-only paths; no automated demo imports this module.
 */
const SMOKE_WORKSPACE_PATTERN = /^workspaces\/provider-smoke\/(claude|codex)\/[a-z0-9-]{1,64}$/;
const ACADEMY_PILOT_PATTERN = /^workspaces\/academy-pilot\/[a-z0-9-]{1,64}$/;
const DIGITAL_LIVE_OBJECTIVE_PATTERN = /^workspaces\/digital-live-objective\/[a-z0-9-]{1,64}$/;
const NAMLA_CIVILIZATION_PATTERN = /^workspaces\/namla-civilization\/[a-z0-9-]{1,64}$/;
// A twin colony root, optionally with ONE numbered repair area so a resumed
// colony writes beside — never over — its earlier output.
const NAMOLA_TWIN_PATTERN = /^workspaces\/namola-twin\/[a-z0-9-]{1,64}\/(claude-forge|codex-crucible)(\/repair-[1-9][0-9]{0,2})?$/;

export interface SmokeWorkspaceHandle {
  readonly workspaceId: string;
  readonly absolutePath: string;
}

export type SmokeWorkspaceResult =
  | { readonly ok: true; readonly handle: SmokeWorkspaceHandle }
  | { readonly ok: false; readonly reasonCode: string };

/** Validate the workspace id against the strict allowlist. No traversal, no escape. */
export function validateSmokeWorkspaceId(workspaceId: string): { readonly ok: boolean; readonly reasonCode: string } {
  if (workspaceId.includes("..")) return { ok: false, reasonCode: "path-traversal" };
  if (workspaceId.startsWith("/") || /^[A-Za-z]:/.test(workspaceId)) return { ok: false, reasonCode: "absolute-path" };
  if (!SMOKE_WORKSPACE_PATTERN.test(workspaceId)) return { ok: false, reasonCode: "outside-smoke-root" };
  return { ok: true, reasonCode: "ok" };
}

/**
 * Create (or validate) the dedicated smoke workspace directory under the repo
 * root. Refuses anything that is not an allowlisted smoke path, and refuses if
 * the resolved absolute path would escape the repo's `workspaces/provider-smoke`
 * tree (defense-in-depth against symlink surprises in the components above).
 */
export function ensureSmokeWorkspace(workspaceId: string): SmokeWorkspaceResult {
  const validation = validateSmokeWorkspaceId(workspaceId);
  if (!validation.ok) return { ok: false, reasonCode: validation.reasonCode };

  const repoRoot = process.cwd();
  const smokeRoot = resolve(repoRoot, "workspaces", "provider-smoke");
  const absolutePath = resolve(repoRoot, workspaceId);
  if (absolutePath !== smokeRoot && !absolutePath.startsWith(smokeRoot + sep)) {
    return { ok: false, reasonCode: "resolved-outside-smoke-root" };
  }

  try {
    if (!existsSync(absolutePath)) mkdirSync(absolutePath, { recursive: true });
  } catch {
    return { ok: false, reasonCode: "workspace-create-failed" };
  }

  return { ok: true, handle: { workspaceId, absolutePath } };
}

export interface SmokeManifest {
  readonly provider: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly antId: string;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
  readonly invocationCount: 1;
}

/** Write the bounded request manifest — ids and caps only, never prompt content. */
export function writeSmokeManifest(handle: SmokeWorkspaceHandle, manifest: SmokeManifest): void {
  const opened = SafeWorkspacePathResolver.forRoot(handle.absolutePath);
  if (!opened.ok) return;
  safeWriteWorkspaceFile(opened.resolver, "request-manifest.json", JSON.stringify(manifest, null, 2), 262144, { allowOverwrite: true });
}

export interface SmokeResultSummary {
  readonly status: string;
  readonly providerFailureCategory: string;
  readonly outputTruncated: boolean;
  readonly permitConsumed: boolean;
  readonly receiptId: string | null;
}

/** Write the safe (already-redacted) result summary — never raw stdout/stderr. */
export function writeSmokeResultSummary(handle: SmokeWorkspaceHandle, summary: SmokeResultSummary): void {
  const opened = SafeWorkspacePathResolver.forRoot(handle.absolutePath);
  if (!opened.ok) return;
  safeWriteWorkspaceFile(opened.resolver, "result-summary.json", JSON.stringify(summary, null, 2), 262144, { allowOverwrite: true });
}

// --- V2 academy-pilot workspace (Build Law §21) ----------------------------

/** Validate an academy-pilot workspace id against the strict allowlist. */
export function validateAcademyPilotWorkspaceId(workspaceId: string): { readonly ok: boolean; readonly reasonCode: string } {
  if (workspaceId.includes("..")) return { ok: false, reasonCode: "path-traversal" };
  if (workspaceId.startsWith("/") || /^[A-Za-z]:/.test(workspaceId)) return { ok: false, reasonCode: "absolute-path" };
  if (!ACADEMY_PILOT_PATTERN.test(workspaceId)) return { ok: false, reasonCode: "outside-pilot-root" };
  return { ok: true, reasonCode: "ok" };
}

/**
 * Create (or validate) the dedicated academy-pilot directory under the repo
 * root — `workspaces/academy-pilot/<pilot-id>/` only. The same defense-in-depth
 * resolved-path check refuses any escape. Writes are limited to the bounded
 * pilot artifacts (manifest, prompt files, safe results, evaluation summaries,
 * receipts); Namla source, Git, and protected paths are unreachable by
 * construction of the allowlist.
 */
export function ensureAcademyPilotWorkspace(workspaceId: string): SmokeWorkspaceResult {
  const validation = validateAcademyPilotWorkspaceId(workspaceId);
  if (!validation.ok) return { ok: false, reasonCode: validation.reasonCode };

  const repoRoot = process.cwd();
  const pilotRoot = resolve(repoRoot, "workspaces", "academy-pilot");
  const absolutePath = resolve(repoRoot, workspaceId);
  if (absolutePath !== pilotRoot && !absolutePath.startsWith(pilotRoot + sep)) {
    return { ok: false, reasonCode: "resolved-outside-pilot-root" };
  }

  try {
    if (!existsSync(absolutePath)) mkdirSync(absolutePath, { recursive: true });
  } catch {
    return { ok: false, reasonCode: "workspace-create-failed" };
  }
  return { ok: true, handle: { workspaceId, absolutePath } };
}

/** Write one bounded, safe pilot artifact (manifest / prompt / result / evaluation / receipt export). */
export function writePilotArtifact(handle: SmokeWorkspaceHandle, fileName: string, safeContent: string): { readonly ok: boolean; readonly reasonCode: string } {
  // Bounded flat filenames only — no separators, no traversal, no executables.
  if (!/^[a-z0-9][a-z0-9-]{0,60}\.(json|md|txt)$/.test(fileName)) return { ok: false, reasonCode: "invalid-artifact-name" };
  if (utf8Bytes(safeContent) > 262144) return { ok: false, reasonCode: "artifact-too-large" };
  const openedPilot = SafeWorkspacePathResolver.forRoot(handle.absolutePath);
  if (!openedPilot.ok) return { ok: false, reasonCode: openedPilot.reasonCode };
  const wrotePilot = safeWriteWorkspaceFile(openedPilot.resolver, fileName, safeContent, 262144, { allowOverwrite: true });
  return { ok: wrotePilot.ok, reasonCode: wrotePilot.reasonCode };
}

// --- V3 digital-live-objective workspace (Build Law §25) -------------------
// Human-only real-fs surface for the three-ant live objective. NEVER imported
// by any automated demo/test (those use the in-memory driver). Rooted only at
// `workspaces/digital-live-objective/<objective-id>/`; nested project files are
// allowed but validated against the same strict allowlist, and the resolved
// path must stay inside the objective root (defense-in-depth vs junctions).

const LIVE_PROTECTED = /(^|\/)\.env(\.|$|\/)|\.(pem|key|crt|cer|p12|pfx)$|(^|\/)\.ssh(\/|$)|id_rsa|(credential|secret|token|password|apikey|api-key)|(^|\/)\.git(\/|$)|(cookies|login\s?data|browser)/i;
const LIVE_FILE_EXT = /\.(ts|tsx|js|json|md|txt)$/;

export function validateLiveObjectiveWorkspaceId(workspaceId: string): { readonly ok: boolean; readonly reasonCode: string } {
  if (workspaceId.includes("..")) return { ok: false, reasonCode: "path-traversal" };
  if (workspaceId.startsWith("/") || /^[A-Za-z]:/.test(workspaceId)) return { ok: false, reasonCode: "absolute-path" };
  if (!DIGITAL_LIVE_OBJECTIVE_PATTERN.test(workspaceId)) return { ok: false, reasonCode: "outside-live-root" };
  return { ok: true, reasonCode: "ok" };
}

/** Create (or validate) the dedicated live-objective directory under the repo root. */
export function ensureLiveObjectiveWorkspace(workspaceId: string): SmokeWorkspaceResult {
  const validation = validateLiveObjectiveWorkspaceId(workspaceId);
  if (!validation.ok) return { ok: false, reasonCode: validation.reasonCode };
  const repoRoot = process.cwd();
  const liveRoot = resolve(repoRoot, "workspaces", "digital-live-objective");
  const absolutePath = resolve(repoRoot, workspaceId);
  if (absolutePath !== liveRoot && !absolutePath.startsWith(liveRoot + sep)) {
    return { ok: false, reasonCode: "resolved-outside-live-root" };
  }
  try {
    if (!existsSync(absolutePath)) mkdirSync(absolutePath, { recursive: true });
  } catch {
    return { ok: false, reasonCode: "workspace-create-failed" };
  }
  return { ok: true, handle: { workspaceId, absolutePath } };
}

// --- V2 namla-civilization workspace (Build Law §28) -----------------------
// Human-only real-fs surface for a live civilization settlement mission. NEVER
// imported by any automated demo/test (those use the in-memory driver). Rooted
// only at `workspaces/namla-civilization/<run-id>/`; nested project files are
// validated against the same strict allowlist as the live-objective workspace,
// and the resolved path must stay inside the run root (defense-in-depth). File
// writes reuse `writeLiveObjectiveFile` (the same bounded, reviewed-file boundary).

export function validateCivilizationWorkspaceId(workspaceId: string): { readonly ok: boolean; readonly reasonCode: string } {
  if (workspaceId.includes("..")) return { ok: false, reasonCode: "path-traversal" };
  if (workspaceId.startsWith("/") || /^[A-Za-z]:/.test(workspaceId)) return { ok: false, reasonCode: "absolute-path" };
  if (!NAMLA_CIVILIZATION_PATTERN.test(workspaceId)) return { ok: false, reasonCode: "outside-civilization-root" };
  return { ok: true, reasonCode: "ok" };
}

export interface CivilizationWorkspaceInspection {
  readonly ok: boolean;
  readonly reasonCode: string;
  readonly workspaceId: string;
  readonly resolvedPath: string | null;
  readonly insideAllowedRoot: boolean;
  readonly exists: boolean;
  readonly isNew: boolean;
  readonly fileCount: number;
  readonly byteCount: number;
  /** True when the directory already holds prior-run output that must not be silently overwritten. */
  readonly staleOutput: boolean;
}

/**
 * Inspect (WITHOUT creating or mutating anything) the civilization run directory
 * before a live run. Reports the resolved path, whether it is inside the allowed
 * root, whether it already exists, its recursive file + byte count (bounded walk),
 * whether it is new or reused, and whether it holds stale prior-run output. The
 * caller (human CLI) uses `staleOutput` to STOP rather than silently overwrite an
 * earlier live run. It reads directory metadata only — never file contents.
 */
export function inspectCivilizationWorkspace(workspaceId: string, maxEntries = 4096): CivilizationWorkspaceInspection {
  const base: CivilizationWorkspaceInspection = { ok: false, reasonCode: "ok", workspaceId, resolvedPath: null, insideAllowedRoot: false, exists: false, isNew: true, fileCount: 0, byteCount: 0, staleOutput: false };
  const validation = validateCivilizationWorkspaceId(workspaceId);
  if (!validation.ok) return { ...base, reasonCode: validation.reasonCode };
  const repoRoot = process.cwd();
  const civRoot = resolve(repoRoot, "workspaces", "namla-civilization");
  const absolutePath = resolve(repoRoot, workspaceId);
  const insideAllowedRoot = absolutePath === civRoot || absolutePath.startsWith(civRoot + sep);
  if (!insideAllowedRoot) return { ...base, reasonCode: "resolved-outside-civilization-root", resolvedPath: absolutePath };
  if (!existsSync(absolutePath)) {
    return { ...base, ok: true, resolvedPath: absolutePath, insideAllowedRoot: true, exists: false, isNew: true };
  }
  // Bounded recursive walk of directory metadata only (no file contents read).
  let fileCount = 0;
  let byteCount = 0;
  let visited = 0;
  const stack: string[] = [absolutePath];
  try {
    while (stack.length > 0 && visited < maxEntries) {
      const dir = stack.pop() as string;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (visited >= maxEntries) break;
        visited += 1;
        const child = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(child);
        } else if (entry.isFile()) {
          fileCount += 1;
          try {
            byteCount += statSync(child).size;
          } catch {
            /* unreadable size is ignored — the count still flags stale output */
          }
        }
      }
    }
  } catch {
    return { ...base, ok: false, reasonCode: "workspace-inspect-failed", resolvedPath: absolutePath, insideAllowedRoot: true, exists: true, isNew: false };
  }
  return { ok: true, reasonCode: "ok", workspaceId, resolvedPath: absolutePath, insideAllowedRoot: true, exists: true, isNew: false, fileCount, byteCount, staleOutput: fileCount > 0 };
}

/** Create (or validate) the dedicated civilization run directory under the repo root. */
export function ensureCivilizationWorkspace(workspaceId: string): SmokeWorkspaceResult {
  const validation = validateCivilizationWorkspaceId(workspaceId);
  if (!validation.ok) return { ok: false, reasonCode: validation.reasonCode };
  const repoRoot = process.cwd();
  const civRoot = resolve(repoRoot, "workspaces", "namla-civilization");
  const absolutePath = resolve(repoRoot, workspaceId);
  if (absolutePath !== civRoot && !absolutePath.startsWith(civRoot + sep)) {
    return { ok: false, reasonCode: "resolved-outside-civilization-root" };
  }
  try {
    if (!existsSync(absolutePath)) mkdirSync(absolutePath, { recursive: true });
  } catch {
    return { ok: false, reasonCode: "workspace-create-failed" };
  }
  return { ok: true, handle: { workspaceId, absolutePath } };
}

// --- Twin empire per-colony workspace (human-only real-fs surface) ---------
// Rooted only at `workspaces/namola-twin/<mission-id>/<claude-forge|codex-crucible>/`.
// NEVER imported by any automated demo/test (those use the in-memory authority).

export function validateTwinColonyWorkspaceId(workspaceId: string): { readonly ok: boolean; readonly reasonCode: string } {
  if (workspaceId.includes("..")) return { ok: false, reasonCode: "path-traversal" };
  if (workspaceId.startsWith("/") || /^[A-Za-z]:/.test(workspaceId)) return { ok: false, reasonCode: "absolute-path" };
  if (!NAMOLA_TWIN_PATTERN.test(workspaceId)) return { ok: false, reasonCode: "outside-twin-root" };
  return { ok: true, reasonCode: "ok" };
}

/** Create (or validate) one twin colony workspace directory under the repo root. */
export function ensureTwinColonyWorkspace(workspaceId: string): SmokeWorkspaceResult {
  const validation = validateTwinColonyWorkspaceId(workspaceId);
  if (!validation.ok) return { ok: false, reasonCode: validation.reasonCode };
  const repoRoot = process.cwd();
  const twinRoot = resolve(repoRoot, "workspaces", "namola-twin");
  const absolutePath = resolve(repoRoot, workspaceId);
  if (absolutePath !== twinRoot && !absolutePath.startsWith(twinRoot + sep)) {
    return { ok: false, reasonCode: "resolved-outside-twin-root" };
  }
  try {
    if (!existsSync(absolutePath)) mkdirSync(absolutePath, { recursive: true });
  } catch {
    return { ok: false, reasonCode: "workspace-create-failed" };
  }
  return { ok: true, handle: { workspaceId, absolutePath } };
}

/**
 * Write one bounded live-objective project file at a validated relative path
 * inside the objective workspace. Refuses traversal, absolute, protected names,
 * disallowed extensions, oversize, or any resolved path escaping the workspace.
 */
export function writeLiveObjectiveFile(handle: SmokeWorkspaceHandle, relPath: string, content: string, maxBytes: number, options: { readonly allowOverwrite?: boolean } = {}): { readonly ok: boolean; readonly reasonCode: string; readonly acceptedBytes?: number; readonly rejectedBytes?: number } {
  // Policy checks that are SPECIFIC to this boundary (protected names, allowed
  // extensions) stay here; ALL path-security and byte accounting is delegated to
  // the single SafeWorkspacePathResolver — no duplicated path logic.
  if (LIVE_PROTECTED.test(relPath)) return { ok: false, reasonCode: "protected-path" };
  if (!LIVE_FILE_EXT.test(relPath)) return { ok: false, reasonCode: "disallowed-extension" };
  const opened = SafeWorkspacePathResolver.forRoot(handle.absolutePath);
  if (!opened.ok) return { ok: false, reasonCode: opened.reasonCode };
  const written = safeWriteWorkspaceFile(opened.resolver, relPath, content, maxBytes, { allowOverwrite: options.allowOverwrite === true });
  return { ok: written.ok, reasonCode: written.reasonCode, acceptedBytes: written.acceptedBytes, rejectedBytes: written.rejectedBytes };
}

export type LiveObjectiveFileReadResult = { readonly ok: true; readonly content: string } | { readonly ok: false; readonly reasonCode: string };

/**
 * Read one bounded live-objective/twin-colony record file back — the read-side
 * counterpart to `writeLiveObjectiveFile`, used ONLY to reload a colony's own
 * previously-persisted record (e.g. a frozen-bundle or attempt record) across
 * separate human CLI invocations. Same path safety as the write path (traversal,
 * absolute, protected-name, extension, and containment checks), plus a hard byte
 * cap so a tampered or oversized file cannot be read wholesale into memory.
 */
export function readLiveObjectiveFile(handle: SmokeWorkspaceHandle, relPath: string, maxBytes: number): LiveObjectiveFileReadResult {
  // Policy checks SPECIFIC to this surface: what may be read at all.
  if (LIVE_PROTECTED.test(relPath)) return { ok: false, reasonCode: "protected-path" };
  if (!LIVE_FILE_EXT.test(relPath)) return { ok: false, reasonCode: "disallowed-extension" };

  // CONTAINMENT is the kernel's job, not this module's. The lexical checks that
  // used to live here (own regexes, a naive `startsWith` prefix compare, and
  // `statSync`, which FOLLOWS links) were a second, weaker implementation: a
  // junction planted inside a workspace exfiltrated external file content.
  const opened = SafeWorkspacePathResolver.forRoot(handle.absolutePath);
  if (!opened.ok) return { ok: false, reasonCode: "read-failed" };
  const read = safeReadWorkspaceFile(opened.resolver, relPath, maxBytes);
  if (read.ok) return { ok: true, content: read.content };

  switch (read.reasonCode) {
    case "not-found":
    case "file-too-large":
      return { ok: false, reasonCode: read.reasonCode };
    case "symlink-parent-escape":
    case "symlink-target-escape":
    case "resolved-outside-workspace":
      return { ok: false, reasonCode: "resolved-outside-workspace" };
    case "path-traversal":
    case "absolute-path":
    case "empty-path":
    case "path-too-long":
      return { ok: false, reasonCode: "invalid-path" };
    case "illegal-char":
    case "null-byte":
    case "home-expansion":
      return { ok: false, reasonCode: "illegal-char" };
    default:
      return { ok: false, reasonCode: "read-failed" };
  }
}
