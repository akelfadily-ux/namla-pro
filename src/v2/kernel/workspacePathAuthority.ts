/**
 * Centralized Workspace Path Authority (§08, P0-B1, P0-B2, P0-B4, P0-B5, P0-B8, P0-B10).
 *
 * Single authoritative path helper for all NAMLA PRO V2 effect paths:
 * TrustedKernel (read/write/command cwd), ProMaxVerifier, LabPackager, ColonyExecutor.
 *
 * Enforces:
 * 1. Real segment containment (path.relative + segment checking, NO startsWith string matching).
 * 2. Symlink escape defense (resolving nearest existing ancestor via realpathSync & verifying containment in canonical workspace root).
 * 3. Segment-aware capability scope matching (preventing prefix collisions like src/auth vs src/auth-evil).
 * 4. TOCTOU parent containment validation.
 */

import { existsSync, realpathSync } from "fs";
import { resolve, join, relative, isAbsolute, dirname } from "path";

export interface ResolvedWorkspacePath {
  readonly ok: boolean;
  readonly canonicalWorkspaceRoot: string;
  readonly absolutePath: string;
  readonly canonicalPath: string;
  readonly normalizedRelativePath: string;
  readonly reasonCode: string;
}

/**
 * Resolves realpath of the workspace root.
 * Creates directory if it doesn't exist yet, then returns canonical realpath.
 */
export function getCanonicalWorkspaceRoot(workspaceRoot: string): string {
  const absoluteRoot = resolve(workspaceRoot);
  if (existsSync(absoluteRoot)) {
    return realpathSync(absoluteRoot);
  }
  return absoluteRoot;
}

/**
 * Checks if targetPath is the canonical workspace root or a descendant of it.
 * Rejects sibling prefixes (e.g., workspace-evil) and path escapes.
 */
export function isCanonicalInsideWorkspace(canonicalWorkspaceRoot: string, targetAbsolutePath: string): boolean {
  const normRoot = resolve(canonicalWorkspaceRoot);
  const normTarget = resolve(targetAbsolutePath);

  if (normRoot === normTarget) {
    return true;
  }

  const rel = relative(normRoot, normTarget);

  // If rel starts with ".." or is absolute, it escapes the workspace
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return false;
  }

  // Double-check segment boundary: target must start with root + path separator
  const rootWithSep = normRoot.endsWith("/") || normRoot.endsWith("\\") ? normRoot : normRoot + "/";
  const rootWithWinSep = normRoot.endsWith("/") || normRoot.endsWith("\\") ? normRoot : normRoot + "\\";

  return normTarget.startsWith(rootWithSep) || normTarget.startsWith(rootWithWinSep);
}

/**
 * Single authoritative workspace relative path resolver and safety validator.
 */
export function resolveWorkspacePath(
  workspaceRoot: string,
  relativePath: string
): ResolvedWorkspacePath {
  const canonicalRoot = getCanonicalWorkspaceRoot(workspaceRoot);

  // 1. Lexical checks for forbidden path formats
  if (!relativePath || relativePath.trim().length === 0) {
    return {
      ok: false,
      canonicalWorkspaceRoot: canonicalRoot,
      absolutePath: canonicalRoot,
      canonicalPath: canonicalRoot,
      normalizedRelativePath: "",
      reasonCode: "EMPTY_PATH_REFUSED",
    };
  }

  const cleanRel = relativePath.trim();

  // Reject absolute paths, Windows drive letters, URL encoding, or traversal segments
  if (
    isAbsolute(cleanRel) ||
    /^[a-zA-Z]:/.test(cleanRel) ||
    cleanRel.includes("%") ||
    cleanRel.startsWith("\\\\")
  ) {
    return {
      ok: false,
      canonicalWorkspaceRoot: canonicalRoot,
      absolutePath: "",
      canonicalPath: "",
      normalizedRelativePath: cleanRel,
      reasonCode: "PATH_TRAVERSAL_REFUSED: Absolute or drive-letter path forbidden",
    };
  }

  const segments = cleanRel.replace(/\\/g, "/").split("/");
  if (segments.includes("..")) {
    return {
      ok: false,
      canonicalWorkspaceRoot: canonicalRoot,
      absolutePath: "",
      canonicalPath: "",
      normalizedRelativePath: cleanRel,
      reasonCode: "PATH_TRAVERSAL_REFUSED: Parent traversal segment .. forbidden",
    };
  }

  const absoluteTarget = resolve(join(canonicalRoot, cleanRel));

  // 2. Lexical containment check against canonical workspace root
  if (!isCanonicalInsideWorkspace(canonicalRoot, absoluteTarget)) {
    return {
      ok: false,
      canonicalWorkspaceRoot: canonicalRoot,
      absolutePath: absoluteTarget,
      canonicalPath: absoluteTarget,
      normalizedRelativePath: cleanRel,
      reasonCode: "PATH_TRAVERSAL_REFUSED: Target outside workspace root boundary",
    };
  }

  // 3. Symlink Escape Defense: Resolve realpath of nearest existing ancestor
  let nearestExisting = absoluteTarget;
  while (!existsSync(nearestExisting) && nearestExisting !== canonicalRoot) {
    const parent = dirname(nearestExisting);
    if (parent === nearestExisting) break;
    nearestExisting = parent;
  }

  let realNearest = nearestExisting;
  if (existsSync(nearestExisting)) {
    realNearest = realpathSync(nearestExisting);
  }

  if (!isCanonicalInsideWorkspace(canonicalRoot, realNearest)) {
    return {
      ok: false,
      canonicalWorkspaceRoot: canonicalRoot,
      absolutePath: absoluteTarget,
      canonicalPath: realNearest,
      normalizedRelativePath: cleanRel,
      reasonCode: "SYMLINK_ESCAPE_REFUSED: Ancestor directory resolves outside workspace root via symlink",
    };
  }

  // If the target itself exists, verify its realpath as well
  let realTarget = absoluteTarget;
  if (existsSync(absoluteTarget)) {
    realTarget = realpathSync(absoluteTarget);
    if (!isCanonicalInsideWorkspace(canonicalRoot, realTarget)) {
      return {
        ok: false,
        canonicalWorkspaceRoot: canonicalRoot,
        absolutePath: absoluteTarget,
        canonicalPath: realTarget,
        normalizedRelativePath: cleanRel,
        reasonCode: "SYMLINK_ESCAPE_REFUSED: Target resolves outside workspace root via symlink",
      };
    }
  }

  const normRel = relative(canonicalRoot, realTarget).replace(/\\/g, "/");

  return {
    ok: true,
    canonicalWorkspaceRoot: canonicalRoot,
    absolutePath: absoluteTarget,
    canonicalPath: realTarget,
    normalizedRelativePath: normRel || cleanRel.replace(/\\/g, "/"),
    reasonCode: "OK",
  };
}

/**
 * Candidate Workspace Relative Path Boundary Helper (P0-CB1).
 * Guarantees that an artifact path belongs strictly to the candidate workspace
 * directory or its descendants, rejecting sibling-prefix matches (e.g. leggo-integrated-evil).
 */
export function isInsideCandidateWorkspace(
  candidateWorkspaceRelPath: string,
  artifactPath: string
): { readonly ok: boolean; readonly resolvedRelPath: string; readonly reasonCode: string } {
  const normCand = candidateWorkspaceRelPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  const normArt = artifactPath.replace(/\\/g, "/").replace(/^\.\//, "");

  if (!normCand) {
    return { ok: true, resolvedRelPath: normArt, reasonCode: "OK" };
  }

  // Exact match with candidate workspace directory is NOT a file artifact
  if (normArt === normCand) {
    return { ok: false, resolvedRelPath: normArt, reasonCode: "CANDIDATE_BOUNDARY_REFUSED: Path is workspace directory itself" };
  }

  // Case 1: Artifact path is already prefixed with the exact candidate workspace path + "/"
  if (normArt.startsWith(normCand + "/")) {
    return { ok: true, resolvedRelPath: normArt, reasonCode: "OK" };
  }

  // Case 2: Artifact path is rooted at workspace or a sibling/parent directory
  // (e.g., starts with "workspaces/", contains parent of normCand, or is absolute / traversal)
  const candParent = dirname(normCand);
  const isWorkspaceRooted =
    normArt.startsWith("workspaces/") ||
    (candParent !== "." && normArt.startsWith(candParent + "/")) ||
    isAbsolute(normArt) ||
    normArt.startsWith("..");

  if (isWorkspaceRooted) {
    return {
      ok: false,
      resolvedRelPath: normArt,
      reasonCode: `CANDIDATE_BOUNDARY_REFUSED: Path ${normArt} is outside candidate workspace ${normCand}`,
    };
  }

  // Case 3: Candidate-relative path (e.g. "src/index.ts", "package.json") -> prepend candidate workspace
  const prefixedArt = `${normCand}/${normArt}`;
  const rel = relative(normCand, prefixedArt);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return {
      ok: false,
      resolvedRelPath: prefixedArt,
      reasonCode: `CANDIDATE_BOUNDARY_REFUSED: Relative path ${normArt} escapes candidate workspace ${normCand}`,
    };
  }

  return { ok: true, resolvedRelPath: prefixedArt, reasonCode: "OK" };
}

/**
 * Segment-aware capability scope validator (P0-B4).
 * Prevents capability collisions like src/auth vs src/auth-evil.
 */
export function validateCapabilityScope(
  targetPath: string,
  allowedScopeTarget: string
): boolean {
  if (allowedScopeTarget === "*") {
    return true;
  }

  const normTarget = targetPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  const normAllowed = allowedScopeTarget.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");

  if (normTarget === normAllowed) {
    return true;
  }

  // Segment-aware descendant check: target must start with allowedScope + "/"
  return normTarget.startsWith(normAllowed + "/");
}
