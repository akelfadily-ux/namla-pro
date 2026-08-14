/**
 * safeWorkspacePath — the ONE path-security kernel for every real filesystem
 * write in Namla (P0 Workspace Security Kernel). All authorized workspace write
 * boundaries route through `SafeWorkspacePathResolver`; no other module may
 * re-implement path validation.
 *
 * Threats closed here that `path.resolve` alone does NOT close:
 *   - `resolve()` is PURELY LEXICAL: it collapses `..` but never inspects the
 *     filesystem, so a symlink or Windows junction in ANY existing parent
 *     component can still land the final write outside the authorized root.
 *     Every existing component is therefore `lstat`ed and rejected if it is a
 *     symlink/reparse point, and the deepest existing parent's `realpath` is
 *     compared against the `realpath` of the workspace root.
 *   - A pre-existing symlink AT the target path would make `writeFileSync`
 *     follow the link and clobber an external file; the target is `lstat`ed too.
 *   - TOCTOU: the resolution is re-validated immediately before the write, and
 *     the write itself uses exclusive creation (`wx`) or an atomic
 *     staged-write-then-rename, so an existing file is never silently
 *     overwritten.
 *
 * Byte limits are enforced in real UTF-8 bytes (`Buffer.byteLength`), never in
 * JavaScript character units — a string of 10 emoji is 10 chars but 40 bytes.
 *
 * User-facing reason codes are fixed, safe tokens; absolute external paths are
 * never returned to callers or logs.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { isAbsolute, relative, resolve, sep } from "path";

export type SafePathReason =
  | "ok"
  | "empty-path"
  | "path-too-long"
  | "path-traversal"
  | "absolute-path"
  | "null-byte"
  | "illegal-char"
  | "home-expansion"
  | "resolved-outside-workspace"
  | "symlink-parent-escape"
  | "symlink-target-escape"
  | "workspace-root-missing"
  | "workspace-root-not-directory"
  | "file-exists-refused-overwrite"
  | "content-too-large"
  | "write-failed";

export type SafePathResolution = { readonly ok: true; readonly absoluteTarget: string; readonly relativePath: string } | { readonly ok: false; readonly reasonCode: SafePathReason };

/** Max characters in a workspace-relative path (defense in depth, not a byte cap). */
export const MAX_REL_PATH_LENGTH = 200 as const;

/**
 * Validate the LEXICAL shape of a workspace-relative path. This is necessary but
 * NOT sufficient — filesystem-level link checks follow in `resolveForWrite`.
 */
export function validateRelativePathShape(relPath: string): SafePathReason {
  if (relPath.length === 0) return "empty-path";
  if (relPath.length > MAX_REL_PATH_LENGTH) return "path-too-long";
  if (relPath.includes("\0")) return "null-byte";
  if (isAbsolute(relPath) || /^[A-Za-z]:/.test(relPath) || relPath.startsWith("\\\\")) return "absolute-path";
  if (relPath.includes("..")) return "path-traversal";
  if (relPath.includes("~")) return "home-expansion";
  if (relPath.includes("\\")) return "illegal-char";
  for (const segment of relPath.split("/")) {
    if (segment.length === 0 || segment === ".") return "illegal-char";
  }
  return "ok";
}

/**
 * True when `child` is the same as, or nested inside, `parent` (both real paths).
 *
 * Exported because containment must have exactly ONE implementation: the Docker
 * bind-mount source validator (§31) needs the same test and must not re-derive
 * it. Both arguments are expected to be `realpath`s already — comparing a
 * lexical path against a real one is what lets an aliased parent slip through.
 */
export function pathIsInside(parent: string, child: string): boolean {
  if (child === parent) return true;
  const rel = relative(parent, child);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Walk from the workspace root down to the target, `lstat`ing every component
 * that already exists. Any symlink / junction / reparse point in the chain is
 * refused — we never follow a link out of the authorized workspace.
 */
function assertNoLinkInChain(realRoot: string, absoluteTarget: string): SafePathReason {
  const rel = relative(realRoot, absoluteTarget);
  const segments = rel.split(sep).filter((s) => s.length > 0);
  let current = realRoot;
  for (let i = 0; i < segments.length; i += 1) {
    current = resolve(current, segments[i]);
    if (!existsSync(current)) return "ok"; // nothing below can exist either
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      return "ok"; // vanished between checks — the exclusive write will fail closed
    }
    // `isSymbolicLink()` covers POSIX symlinks AND Windows junctions/reparse
    // points as surfaced by libuv, which is exactly the escape we must refuse.
    if (stat.isSymbolicLink()) {
      return i === segments.length - 1 ? "symlink-target-escape" : "symlink-parent-escape";
    }
    // Defense in depth: even a non-link component must still resolve inside.
    try {
      if (!pathIsInside(realRoot, realpathSync(current))) {
        return i === segments.length - 1 ? "symlink-target-escape" : "symlink-parent-escape";
      }
    } catch {
      return "resolved-outside-workspace";
    }
  }
  return "ok";
}

/**
 * The single authorized path resolver. Callers pass an ALREADY-authorized
 * workspace root (an allowlisted root created by the owning boundary) plus a
 * relative path; it returns a validated absolute target or a safe reason code.
 */
export class SafeWorkspacePathResolver {
  private readonly realRoot: string;

  private constructor(realRoot: string) {
    this.realRoot = realRoot;
  }

  /** Open a resolver on an existing authorized workspace root. */
  static forRoot(workspaceRootAbsolute: string): { readonly ok: true; readonly resolver: SafeWorkspacePathResolver } | { readonly ok: false; readonly reasonCode: SafePathReason } {
    if (!existsSync(workspaceRootAbsolute)) return { ok: false, reasonCode: "workspace-root-missing" };
    let realRoot: string;
    try {
      realRoot = realpathSync(workspaceRootAbsolute);
      if (!lstatSync(realRoot).isDirectory()) return { ok: false, reasonCode: "workspace-root-not-directory" };
    } catch {
      return { ok: false, reasonCode: "workspace-root-missing" };
    }
    return { ok: true, resolver: new SafeWorkspacePathResolver(realRoot) };
  }

  get root(): string {
    return this.realRoot;
  }

  /** Full validation: lexical shape, containment, and link-chain inspection. */
  resolveForWrite(relPath: string): SafePathResolution {
    const shape = validateRelativePathShape(relPath);
    if (shape !== "ok") return { ok: false, reasonCode: shape };
    const absoluteTarget = resolve(this.realRoot, relPath);
    if (!pathIsInside(this.realRoot, absoluteTarget) || absoluteTarget === this.realRoot) {
      return { ok: false, reasonCode: "resolved-outside-workspace" };
    }
    const linkReason = assertNoLinkInChain(this.realRoot, absoluteTarget);
    if (linkReason !== "ok") return { ok: false, reasonCode: linkReason };
    return { ok: true, absoluteTarget, relativePath: relPath };
  }
}

export interface SafeWriteResult {
  readonly ok: boolean;
  readonly reasonCode: SafePathReason;
  /** Exact UTF-8 bytes accepted (written). 0 on refusal. */
  readonly acceptedBytes: number;
  /** Exact UTF-8 bytes refused (content size when over the cap). 0 otherwise. */
  readonly rejectedBytes: number;
}

/**
 * Write one bounded file into an authorized workspace.
 *
 *  - Byte cap enforced with `Buffer.byteLength(content, "utf8")`.
 *  - Path re-validated IMMEDIATELY before the write (TOCTOU).
 *  - Never silently overwrites: `allowOverwrite:false` (default) uses exclusive
 *    creation (`flag: "wx"`); `allowOverwrite:true` uses an atomic
 *    staged-write-then-rename so a reader never sees a partial file.
 */
export function safeWriteWorkspaceFile(resolver: SafeWorkspacePathResolver, relPath: string, content: string, maxBytes: number, options: { readonly allowOverwrite?: boolean } = {}): SafeWriteResult {
  const byteLength = Buffer.byteLength(content, "utf8");
  const first = resolver.resolveForWrite(relPath);
  if (!first.ok) return { ok: false, reasonCode: first.reasonCode, acceptedBytes: 0, rejectedBytes: byteLength };
  if (byteLength > maxBytes) return { ok: false, reasonCode: "content-too-large", acceptedBytes: 0, rejectedBytes: byteLength };

  const parentDir = resolve(first.absoluteTarget, "..");
  try {
    if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
  } catch {
    return { ok: false, reasonCode: "write-failed", acceptedBytes: 0, rejectedBytes: byteLength };
  }

  // Re-validate AFTER creating directories and immediately before writing: a
  // component could have been swapped for a link in between.
  const second = resolver.resolveForWrite(relPath);
  if (!second.ok) return { ok: false, reasonCode: second.reasonCode, acceptedBytes: 0, rejectedBytes: byteLength };

  const allowOverwrite = options.allowOverwrite === true;
  if (!allowOverwrite && existsSync(second.absoluteTarget)) {
    return { ok: false, reasonCode: "file-exists-refused-overwrite", acceptedBytes: 0, rejectedBytes: byteLength };
  }

  try {
    if (!allowOverwrite) {
      // Exclusive creation: fails if the path exists, including as a dangling link.
      writeFileSync(second.absoluteTarget, content, { encoding: "utf8", flag: "wx" });
    } else {
      const staged = `${second.absoluteTarget}.tmp-${process.pid}`;
      writeFileSync(staged, content, { encoding: "utf8", flag: "wx" });
      try {
        renameSync(staged, second.absoluteTarget);
      } catch (renameError) {
        try {
          unlinkSync(staged);
        } catch {
          /* best-effort cleanup of the staged file */
        }
        throw renameError;
      }
    }
  } catch {
    return { ok: false, reasonCode: "write-failed", acceptedBytes: 0, rejectedBytes: byteLength };
  }
  return { ok: true, reasonCode: "ok", acceptedBytes: byteLength, rejectedBytes: 0 };
}

// --- Authorized read / list --------------------------------------------------
// Reads were the gap: writes routed through the resolver while
// `readLiveObjectiveFile` re-implemented validation lexically and used `stat`,
// which FOLLOWS links. A junction planted inside a workspace therefore
// exfiltrated external file content. Reads now use the SAME resolver and the
// SAME link-chain refusal as writes - there is one containment implementation.

export interface SafeReadResult {
  readonly ok: boolean;
  readonly reasonCode: SafePathReason | "not-found" | "file-too-large" | "read-failed";
  readonly content: string;
  readonly acceptedBytes: number;
}

/** Read one bounded file from an authorized workspace. Never follows a link out. */
export function safeReadWorkspaceFile(resolver: SafeWorkspacePathResolver, relPath: string, maxBytes: number): SafeReadResult {
  const resolved = resolver.resolveForWrite(relPath);
  if (!resolved.ok) return { ok: false, reasonCode: resolved.reasonCode, content: "", acceptedBytes: 0 };
  if (!existsSync(resolved.absoluteTarget)) return { ok: false, reasonCode: "not-found", content: "", acceptedBytes: 0 };
  try {
    // lstat, NOT stat: a symlinked target must be refused, not followed.
    const st = lstatSync(resolved.absoluteTarget);
    if (st.isSymbolicLink()) return { ok: false, reasonCode: "symlink-target-escape", content: "", acceptedBytes: 0 };
    if (!st.isFile()) return { ok: false, reasonCode: "read-failed", content: "", acceptedBytes: 0 };
    if (st.size > maxBytes) return { ok: false, reasonCode: "file-too-large", content: "", acceptedBytes: 0 };
    const content = readFileSync(resolved.absoluteTarget, "utf8");
    return { ok: true, reasonCode: "ok", content, acceptedBytes: Buffer.byteLength(content, "utf8") };
  } catch {
    return { ok: false, reasonCode: "read-failed", content: "", acceptedBytes: 0 };
  }
}

// --- Authorized delete / rename ----------------------------------------------
// Write was the only mutating operation the kernel exposed, so delete and
// rename escapes could not be tested at all. These use the SAME resolver and
// the SAME reason codes - no second path-security system - and both re-validate
// immediately before touching the filesystem, exactly as the write path does.

export interface SafeMutationResult {
  readonly ok: boolean;
  readonly reasonCode: SafePathReason;
}

/** Delete one file inside an authorized workspace. Never follows a link out. */
export function safeDeleteWorkspaceFile(resolver: SafeWorkspacePathResolver, relPath: string): SafeMutationResult {
  const first = resolver.resolveForWrite(relPath);
  if (!first.ok) return { ok: false, reasonCode: first.reasonCode };
  if (!existsSync(first.absoluteTarget)) return { ok: false, reasonCode: "write-failed" };

  // Re-validate immediately before unlinking (TOCTOU): a component may have been
  // swapped for a link since the first check.
  const second = resolver.resolveForWrite(relPath);
  if (!second.ok) return { ok: false, reasonCode: second.reasonCode };

  // lstat, not stat: a symlink must be refused rather than followed to its target.
  try {
    if (lstatSync(second.absoluteTarget).isSymbolicLink()) return { ok: false, reasonCode: "symlink-target-escape" };
  } catch {
    return { ok: false, reasonCode: "write-failed" };
  }
  try {
    unlinkSync(second.absoluteTarget);
  } catch {
    return { ok: false, reasonCode: "write-failed" };
  }
  return { ok: true, reasonCode: "ok" };
}

/**
 * Rename inside an authorized workspace. Source and destination are validated
 * INDEPENDENTLY: a valid source does not authorize an arbitrary destination,
 * and vice versa. Both are re-validated immediately before the rename.
 */
export function safeRenameWorkspaceFile(resolver: SafeWorkspacePathResolver, fromRelPath: string, toRelPath: string, options: { readonly allowOverwrite?: boolean } = {}): SafeMutationResult {
  const from = resolver.resolveForWrite(fromRelPath);
  if (!from.ok) return { ok: false, reasonCode: from.reasonCode };
  const to = resolver.resolveForWrite(toRelPath);
  if (!to.ok) return { ok: false, reasonCode: to.reasonCode };
  if (!existsSync(from.absoluteTarget)) return { ok: false, reasonCode: "write-failed" };
  if (options.allowOverwrite !== true && existsSync(to.absoluteTarget)) {
    return { ok: false, reasonCode: "file-exists-refused-overwrite" };
  }

  const from2 = resolver.resolveForWrite(fromRelPath);
  if (!from2.ok) return { ok: false, reasonCode: from2.reasonCode };
  const to2 = resolver.resolveForWrite(toRelPath);
  if (!to2.ok) return { ok: false, reasonCode: to2.reasonCode };

  try {
    if (lstatSync(from2.absoluteTarget).isSymbolicLink()) return { ok: false, reasonCode: "symlink-target-escape" };
  } catch {
    return { ok: false, reasonCode: "write-failed" };
  }
  try {
    renameSync(from2.absoluteTarget, to2.absoluteTarget);
  } catch {
    return { ok: false, reasonCode: "write-failed" };
  }
  return { ok: true, reasonCode: "ok" };
}

// --- UTF-8 byte accounting ---------------------------------------------------

export interface Utf8Truncation {
  readonly text: string;
  readonly truncated: boolean;
  readonly acceptedBytes: number;
  readonly rejectedBytes: number;
}

/**
 * Truncate a string to a real UTF-8 BYTE budget without producing broken UTF-8.
 * Encoding to a Buffer and slicing can split a multi-byte sequence, so the cut
 * point is walked back off any continuation byte before decoding.
 */
export function truncateUtf8(value: string, maxBytes: number): Utf8Truncation {
  const buf = Buffer.from(value, "utf8");
  if (buf.length <= maxBytes) return { text: value, truncated: false, acceptedBytes: buf.length, rejectedBytes: 0 };
  if (maxBytes <= 0) return { text: "", truncated: true, acceptedBytes: 0, rejectedBytes: buf.length };
  let cut = maxBytes;
  // 0b10xxxxxx is a continuation byte: walk back to the start of the sequence.
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut -= 1;
  const text = buf.subarray(0, cut).toString("utf8");
  const acceptedBytes = Buffer.byteLength(text, "utf8");
  return { text, truncated: true, acceptedBytes, rejectedBytes: buf.length - acceptedBytes };
}

/** Exact UTF-8 byte length — the ONLY correct way to measure a byte budget. */
export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** True when the value fits the byte budget (bytes, never characters). */
export function withinUtf8Budget(value: string, maxBytes: number): boolean {
  return Buffer.byteLength(value, "utf8") <= maxBytes;
}
