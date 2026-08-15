/**
 * trustedExecutableRegistry — the ONE place an executable path is decided.
 *
 * Previously the drivers spawned bare names (`claude`, `codex`, `npm.cmd`) and
 * therefore trusted whatever the inherited PATH resolved them to. Anything
 * earlier on PATH — including a file dropped into a generated workspace — would
 * be executed instead of the real provider. This module removes that trust:
 * every executable is resolved to an absolute, canonical, validated path before
 * a process is ever created.
 *
 * Two findings drove the design, both reproduced on this host:
 *
 *   1. PATH ORDER IS ATTACKER-CONTROLLED. Resolution therefore does not stop at
 *      "the first match on PATH"; each candidate must also pass a trust check,
 *      and untrusted candidates are SKIPPED rather than accepted.
 *   2. `spawnSync("npm.cmd", …, { shell: false })` fails with EINVAL on modern
 *      Node (>= 18.20.2 refuses .cmd/.bat without a shell — the CVE-2024-27980
 *      batch-injection fix). Resolving to `npm.cmd` at all is therefore not just
 *      unsafe, it does not work. npm/npx are instead resolved to their JS entry
 *      points and run with `process.execPath`, which is absolute by definition,
 *      identical across Windows/Linux/macOS, and cannot be shadowed via PATH.
 *
 * This module reads the filesystem (`lstat`/`realpath`/`existsSync`) because
 * proving an executable is a real, non-symlinked file is inherently a
 * filesystem question. It never writes, never uses a shell, and never logs an
 * environment value.
 */

import { existsSync, lstatSync, realpathSync, readFileSync, statSync } from "fs";
import { createHash } from "crypto";
import { delimiter, isAbsolute, join, basename, dirname, resolve, sep } from "path";
import { spawnSync } from "child_process";
import { buildSafeChildEnv } from "./safeProviderRequest";

export type TrustedExecutableId = "claude" | "codex" | "npm" | "npx" | "docker" | "podman";

export const TRUSTED_EXECUTABLE_IDS: readonly TrustedExecutableId[] = ["claude", "codex", "npm", "npx", "docker", "podman"];

export type ExecutableReasonCode =
  | "ok"
  | "unknown-executable-id"
  | "executable-not-found"
  | "relative-path-refused"
  | "workspace-local-executable-refused"
  | "symlink-executable-refused"
  | "basename-mismatch"
  | "not-a-regular-file"
  | "hash-mismatch"
  | "version-probe-failed"
  // §38 (S-9): provenance and identity.
  | "untrusted-executable-owner"
  | "untrusted-executable-parent"
  | "executable-identity-unpinned"
  | "executable-identity-changed"
  | "executable-provenance-unprovable"
  | "node-cli-script-unavailable";

/**
 * What the platform could actually PROVE about an executable's provenance.
 *
 * Recorded on every resolution so no caller can mistake "we did not check" for
 * "we checked and it was fine". On Windows the honest value is
 * `unprovable-on-platform`: `fs.statSync` there reports uid/gid 0 and a
 * synthesised mode (measured on this host: uid 0, gid 0, mode 0o666 for
 * `process.execPath`), so POSIX ownership logic applied to Windows would be
 * fabricated evidence, not a security check.
 */
export type ExecutableProvenance = "posix-owner-verified" | "unprovable-on-platform";

/** One file whose exact content was sealed at trust establishment (§38). */
export interface ExecutableIdentityEntry {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

/** A resolved, validated executable. `command` + `prefixArgs` is what to spawn. */
export interface ResolvedExecutable {
  readonly id: TrustedExecutableId;
  /** Absolute, canonical path of the binary to execute. */
  readonly command: string;
  /** Fixed leading arguments (e.g. the npm CLI script) — never mission-derived. */
  readonly prefixArgs: readonly string[];
  readonly realPath: string;
  readonly basename: string;
  /** Bounded version token, or "" when not probed. Never raw multi-line output. */
  readonly version: string;
  /** Lowercase sha256 of the primary executed file. Never "" for a resolution. */
  readonly hash: string;
  /**
   * EVERY file whose content this resolution vouches for, sealed at the moment
   * trust was established. For npm/npx that is BOTH the node binary and the CLI
   * script, because both are executed code. Re-checked immediately before any
   * process starts (§38 TOCTOU).
   */
  readonly identity: readonly ExecutableIdentityEntry[];
  /** What the platform could prove about ownership. Never assumed. */
  readonly provenance: ExecutableProvenance;
  /**
   * DISCOVERED is not TRUSTED-FOR-EXECUTION (§38).
   *
   * A candidate can be located, canonicalised, type-checked and sealed without
   * anyone having established that it is safe to RUN. Where the platform can
   * prove ownership, provenance supplies that authority. Where it cannot
   * (Windows), only an externally supplied identity pin does — and if none is
   * configured, this stays false and no process may start.
   */
  readonly executionAuthorized: boolean;
  /** Why execution is not authorized; "ok" when it is. */
  readonly authorizationReason: ExecutableReasonCode;
}

export type ExecutableResolution = { readonly ok: true; readonly value: ResolvedExecutable; readonly reasonCode: "ok" } | { readonly ok: false; readonly value: null; readonly reasonCode: ExecutableReasonCode };

/**
 * Acceptable basenames per id, per platform. Nothing else may ever be executed.
 *
 * NOTE on npm/npx: their entries here are UNREACHABLE for execution. Those two
 * ids return from the CLI-script branch in every case — with a resolution or
 * with `node-cli-script-unavailable` — and never reach the PATH search this
 * table serves. The entries remain only so the table stays a complete
 * description of the id space; a `.cmd` shim can never become the npm/npx
 * execution target.
 */
const EXPECTED_BASENAMES: Readonly<Record<TrustedExecutableId, readonly string[]>> =
  process.platform === "win32"
    ? { claude: ["claude.exe", "claude.cmd", "claude.bat", "claude"], codex: ["codex.exe", "codex.cmd", "codex.bat", "codex"], npm: ["npm.cmd", "npm.exe", "npm"], npx: ["npx.cmd", "npx.exe", "npx"], docker: ["docker.exe", "docker"], podman: ["podman.exe", "podman"] }
    : { claude: ["claude"], codex: ["codex"], npm: ["npm"], npx: ["npx"], docker: ["docker"], podman: ["podman"] };

/** Windows executable extensions, in the order PATHEXT would apply them. */
const WINDOWS_EXTENSIONS: readonly string[] = [".com", ".exe", ".cmd", ".bat"];

export interface ResolveOptions {
  /** PATH string to search. Defaults to the real PATH. */
  readonly searchPath?: string;
  /**
   * Absolute workspace roots. An executable resolving INSIDE one of these is
   * refused: generated, untrusted code must never supply its own toolchain.
   */
  readonly workspaceRoots?: readonly string[];
  /** Run a bounded `--version` probe. Off by default — a probe starts a process. */
  readonly probeVersion?: boolean;
  /** Compute the sha256 of the resolved file. Off by default (reads the file). */
  readonly computeHash?: boolean;
  /**
   * Pinned sha256 from TRUSTED CONFIGURATION. Unlike the seal computed from the
   * candidate itself, this originates outside the candidate and is a real pin;
   * a mismatch refuses.
   */
  readonly expectedSha256?: string;
  /**
   * Require an externally supplied pin (§38). A trusted caller that knows the
   * identity it expects can demand it; a resolution with no `expectedSha256`
   * then refuses with `executable-identity-unpinned` instead of falling back to
   * self-derived evidence.
   */
  readonly requireIdentityPin?: boolean;
  /**
   * Pin for the INTERPRETER of a two-artifact resolution (the node binary that
   * runs npm-cli.js / npx-cli.js). npm/npx execute two files, so authorizing
   * them on a platform that cannot prove ownership requires an external
   * identity for BOTH; pinning only the script would leave the interpreter
   * unvouched.
   */
  readonly expectedInterpreterSha256?: string;
  /** Injected platform, for cross-platform tests. */
  readonly platform?: NodeJS.Platform;
  /**
   * TEST SEAM ONLY. Overrides how the npm/npx CLI entry point is located, so a
   * test can model a host where that script is missing. Production never sets
   * it and always uses `findNodeCliScript`.
   */
  readonly cliScriptLookup?: (name: "npm" | "npx") => string | null;
  /**
   * TEST SEAM ONLY. Replaces the version-probe process launcher so a test can
   * COUNT process starts. Production never sets it, so production always goes
   * through `spawnSync` below.
   */
  readonly processRunner?: (command: string, args: readonly string[]) => { readonly status: number | null; readonly stdout: string; readonly failed: boolean };
}

// ------------------------------------------------ §38 PROVENANCE (S-9) ---

/**
 * Can this file be replaced by someone other than its owner or root?
 *
 * THE TRUST MODEL, stated rather than assumed:
 *
 * Linux / macOS — `stat` reports real uid/gid and real mode bits, so two
 * properties are genuinely provable and both are required, for the file AND
 * for its containing directory:
 *   - the owner is root (uid 0) or the current effective user. An executable
 *     owned by a THIRD party can be rewritten by that party at any time, so it
 *     is not trustworthy no matter where it sits.
 *   - it is not group- or world-writable (mode & 0o022). A directory anyone can
 *     write is a directory anyone can plant an executable in. There is no
 *     sticky-bit exemption: `/tmp` is 1777, and the sticky bit only stops
 *     deleting OTHER people's files — an attacker can still create their own
 *     `docker` there, which is exactly the attack.
 *
 * Windows — none of that evidence exists. Node reports uid 0, gid 0 and a
 * synthesised mode, and exposes no ACL API, so ownership is UNPROVABLE. The
 * honest response is to say so, not to run POSIX arithmetic on fabricated
 * numbers and call the result verified. Windows therefore relies on the
 * properties it CAN prove — canonical path, non-symlink, regular file,
 * basename, workspace exclusion — plus the sealed identity and its
 * revalidation, and every resolution carries `unprovable-on-platform` so no
 * receipt can overclaim.
 *
 * SCOPE, stated honestly: the file and its immediate parent are checked, not
 * every ancestor. An attacker able to write a GRANDparent could rename the
 * parent and substitute a directory of their own. That attacker already has
 * write access outside the workspace, which is outside this repository's threat
 * model (untrusted code inside a generated workspace); widening to a full
 * ancestor walk is a filesystem-hardening project, not S-9. A test documents
 * the boundary rather than leaving it implied.
 */
/** The only filesystem metadata the POSIX provenance rule consumes. */
export interface ProvenanceEvidence {
  readonly ownerUid: number;
  /** True when the group or world write bit is set (mode & 0o022). */
  readonly writableByOthers: boolean;
}

/**
 * THE POSIX provenance rule, as a pure function of the evidence.
 *
 * Separated from `statSync` so the rule itself can be exercised deterministically
 * on ANY host — including Windows, where the real metadata does not exist and a
 * filesystem-driven test could only ever skip. Tests call THIS function, so they
 * exercise production logic rather than restating it.
 */
export function evaluatePosixProvenance(file: ProvenanceEvidence, parent: ProvenanceEvidence, effectiveUid: number): ExecutableReasonCode {
  const ownerAllowed = (uid: number) => uid === 0 || uid === effectiveUid;

  // The executable itself: a third-party owner can rewrite it at will, and a
  // world-writable file can be rewritten by anyone at all.
  if (!ownerAllowed(file.ownerUid)) return "untrusted-executable-owner";
  if (file.writableByOthers) return "untrusted-executable-owner";

  // Its directory: a directory anyone may write is a directory anyone may
  // plant an executable in, which defeats every check above it.
  if (!ownerAllowed(parent.ownerUid)) return "untrusted-executable-parent";
  if (parent.writableByOthers) return "untrusted-executable-parent";

  return "ok";
}

function readEvidence(target: string): ProvenanceEvidence | null {
  try {
    const s = statSync(target);
    return { ownerUid: s.uid, writableByOthers: (s.mode & 0o022) !== 0 };
  } catch {
    return null;
  }
}

function validateProvenance(realPath: string, platform: NodeJS.Platform): { readonly provenance: ExecutableProvenance; readonly reasonCode: ExecutableReasonCode } {
  if (platform === "win32") {
    // Ownership genuinely cannot be shown here. This is NOT an acceptance: the
    // caller must still supply an external identity (see
    // `decideExecutionAuthorization`) before this candidate may be EXECUTED.
    return { provenance: "unprovable-on-platform", reasonCode: "ok" };
  }

  const euid = typeof process.geteuid === "function" ? process.geteuid() : 0;
  const file = readEvidence(realPath);
  if (!file) return { provenance: "unprovable-on-platform", reasonCode: "untrusted-executable-owner" };
  const parent = readEvidence(dirname(realPath));
  if (!parent) return { provenance: "unprovable-on-platform", reasonCode: "untrusted-executable-parent" };

  const verdict = evaluatePosixProvenance(file, parent, euid);
  if (verdict !== "ok") return { provenance: "unprovable-on-platform", reasonCode: verdict };
  return { provenance: "posix-owner-verified", reasonCode: "ok" };
}

/**
 * Decide whether a sealed resolution may actually START A PROCESS (§38).
 *
 * Measured on win32 BEFORE this split existed: an inert file named
 * `docker.exe` written into a scratch directory resolved ok, sealed an
 * identity, revalidated cleanly, and a `probeVersion` request STARTED A
 * PROCESS. Basename plus regular-file status was the entire bar. That is
 * fail-OPEN, and "the platform cannot prove ownership" is a reason to demand
 * other evidence, not a reason to stop asking.
 *
 * Where provenance is PROVEN, that proof is the authority.
 *
 * Where it is UNPROVABLE, the only accepted substitute is an externally
 * supplied identity for every executed artifact — `expectedSha256` for the
 * primary file and, for npm/npx, `expectedInterpreterSha256` for the node
 * binary as well. Those values come from trusted configuration, i.e. from
 * outside the candidate. A digest the resolver measured from the candidate
 * itself is explicitly NOT accepted here: it says "still the same bytes", never
 * "these bytes were trusted". Nothing in this module ever copies a measured
 * digest into the expected one.
 *
 * When no pin is configured, execution authority is simply absent and the
 * resolution stays discoverable-but-unauthorized.
 */
function decideExecutionAuthorization(provenance: ExecutableProvenance, identity: readonly ExecutableIdentityEntry[], opts: ResolveOptions): { readonly authorized: boolean; readonly reason: ExecutableReasonCode } {
  if (provenance === "posix-owner-verified") return { authorized: true, reason: "ok" };

  // Unprovable: every executed artifact needs an external identity.
  const hasTargetPin = typeof opts.expectedSha256 === "string" && opts.expectedSha256.length > 0;
  if (!hasTargetPin) return { authorized: false, reason: "executable-provenance-unprovable" };
  if (identity.length > 1) {
    const hasInterpreterPin = typeof opts.expectedInterpreterSha256 === "string" && opts.expectedInterpreterSha256.length > 0;
    if (!hasInterpreterPin) return { authorized: false, reason: "executable-provenance-unprovable" };
    if (identity[0].sha256.toLowerCase() !== opts.expectedInterpreterSha256!.toLowerCase()) return { authorized: false, reason: "hash-mismatch" };
  }
  return { authorized: true, reason: "ok" };
}

/**
 * Seal one file's exact content.
 *
 * WHAT THIS IS AND IS NOT (§38). Hashing a candidate and then declaring that
 * same hash trusted proves nothing — it fingerprints whatever an attacker put
 * there. So this digest is NOT the source of trust and is never copied into
 * `expectedSha256`. Its only job is to detect that a file proven at validation
 * time was swapped before execution.
 */
function sealFile(filePath: string): ExecutableIdentityEntry | null {
  try {
    const bytes = readFileSync(filePath);
    return { path: filePath, sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length };
  } catch {
    return null;
  }
}

/**
 * Re-prove a resolution immediately before a process starts (§38 TOCTOU).
 *
 * An executable proven at discovery and replaced before spawn is still an
 * executed attacker file. Every sealed file is re-checked for link status,
 * file kind, provenance and exact content; any difference refuses rather than
 * running the replacement.
 */
export function revalidateResolvedExecutable(resolved: ResolvedExecutable, platform: NodeJS.Platform = process.platform): ExecutableReasonCode {
  for (const entry of resolved.identity) {
    let link;
    try {
      link = lstatSync(entry.path);
    } catch {
      return "executable-identity-changed";
    }
    if (link.isSymbolicLink()) return "symlink-executable-refused";
    if (!link.isFile()) return "not-a-regular-file";

    const provenance = validateProvenance(entry.path, platform);
    if (provenance.reasonCode !== "ok") return provenance.reasonCode;

    const resealed = sealFile(entry.path);
    if (!resealed) return "executable-identity-changed";
    if (resealed.sizeBytes !== entry.sizeBytes || resealed.sha256 !== entry.sha256) return "executable-identity-changed";
  }
  return "ok";
}

/** Locate npm/npx's JS entry point next to the running node binary. */
function findNodeCliScript(name: "npm" | "npx"): string | null {
  const nodeDir = dirname(process.execPath);
  const candidates = [join(nodeDir, "node_modules", "npm", "bin", `${name}-cli.js`), join(nodeDir, "lib", "node_modules", "npm", "bin", `${name}-cli.js`), join(nodeDir, "..", "lib", "node_modules", "npm", "bin", `${name}-cli.js`)];
  for (const c of candidates) {
    if (existsSync(c)) return resolve(c);
  }
  return null;
}

/** Is `candidate` inside any of the given workspace roots? Canonical comparison. */
function isInsideWorkspace(candidate: string, workspaceRoots: readonly string[]): boolean {
  const norm = (p: string) => {
    let real = p;
    try {
      real = realpathSync(p);
    } catch {
      /* not yet existing — compare lexically */
    }
    const withSep = real.endsWith(sep) ? real : real + sep;
    return process.platform === "win32" ? withSep.toLowerCase() : withSep;
  };
  const c = norm(candidate);
  return workspaceRoots.some((root) => c.startsWith(norm(root)));
}

/**
 * Validate ONE candidate absolute path. Every rejection is a distinct reason
 * code so a receipt can say exactly why an executable was refused.
 */
function validateCandidate(id: TrustedExecutableId, candidate: string, opts: ResolveOptions): ExecutableResolution {
  if (!isAbsolute(candidate)) return { ok: false, value: null, reasonCode: "relative-path-refused" };
  if (!existsSync(candidate)) return { ok: false, value: null, reasonCode: "executable-not-found" };

  // lstat, NOT stat: stat follows the link and would report the TARGET's type,
  // hiding the fact that the executable itself is a symlink or junction.
  let link;
  try {
    link = lstatSync(candidate);
  } catch {
    return { ok: false, value: null, reasonCode: "executable-not-found" };
  }
  if (link.isSymbolicLink()) return { ok: false, value: null, reasonCode: "symlink-executable-refused" };
  if (!link.isFile()) return { ok: false, value: null, reasonCode: "not-a-regular-file" };

  let realPath: string;
  try {
    realPath = realpathSync(candidate);
  } catch {
    return { ok: false, value: null, reasonCode: "executable-not-found" };
  }
  // The candidate is built from an ALREADY-CANONICAL directory, so any residual
  // difference here can only come from the executable file itself being a link.
  // Comparing against a lexical directory instead would flag the standard macOS
  // /var -> /private/var ancestor alias as an executable symlink, which is a
  // false positive rather than a security finding. The lstat refusal above
  // remains the primary defence and is unchanged.
  const changed = process.platform === "win32" ? realPath.toLowerCase() !== candidate.toLowerCase() : realPath !== candidate;
  if (changed) return { ok: false, value: null, reasonCode: "symlink-executable-refused" };

  const base = basename(realPath);
  const expected = EXPECTED_BASENAMES[id];
  const baseMatches = process.platform === "win32" ? expected.some((e) => e.toLowerCase() === base.toLowerCase()) : expected.includes(base);
  if (!baseMatches) return { ok: false, value: null, reasonCode: "basename-mismatch" };

  // Untrusted generated code must never supply the toolchain that verifies it.
  // Checked BEFORE provenance so a workspace decoy still reports the reason a
  // reader needs, rather than being masked by a directory-permission verdict.
  if (isInsideWorkspace(realPath, opts.workspaceRoots ?? [])) return { ok: false, value: null, reasonCode: "workspace-local-executable-refused" };

  // §38: ownership and parent mutability, BEFORE any identity work and long
  // before any process could start.
  const platform = opts.platform ?? process.platform;
  const provenance = validateProvenance(realPath, platform);
  if (provenance.reasonCode !== "ok") return { ok: false, value: null, reasonCode: provenance.reasonCode };

  const sealed = establishIdentity([realPath], opts);
  if (!sealed.ok) return { ok: false, value: null, reasonCode: sealed.reasonCode };

  const authorization = decideExecutionAuthorization(provenance.provenance, sealed.identity, opts);
  return { ok: true, reasonCode: "ok", value: { id, command: realPath, prefixArgs: [], realPath, basename: base, version: "", hash: sealed.identity[0].sha256, identity: sealed.identity, provenance: provenance.provenance, executionAuthorized: authorization.authorized, authorizationReason: authorization.reason } };
}

/**
 * Seal every executed file and enforce any externally supplied pin (§38).
 *
 * The seal is now UNCONDITIONAL. Before S-9 it was computed only when a caller
 * asked, so the default path executed a file whose exact content had never been
 * recorded and therefore could not be re-checked before spawn. `computeHash`
 * survives as a no-op-compatible option because callers still pass it, but the
 * identity no longer depends on anyone remembering to.
 */
function establishIdentity(paths: readonly string[], opts: ResolveOptions): { readonly ok: true; readonly identity: readonly ExecutableIdentityEntry[] } | { readonly ok: false; readonly reasonCode: ExecutableReasonCode } {
  if (opts.requireIdentityPin && !opts.expectedSha256) return { ok: false, reasonCode: "executable-identity-unpinned" };

  const identity: ExecutableIdentityEntry[] = [];
  for (const p of paths) {
    const entry = sealFile(p);
    if (!entry) return { ok: false, reasonCode: "not-a-regular-file" };
    identity.push(entry);
  }
  // The pin names the PRIMARY executed artifact: the binary for a plain
  // executable, the CLI script for npm/npx (the node binary is the interpreter,
  // not the thing being pinned).
  const primary = identity[identity.length - 1];
  if (opts.expectedSha256 && primary.sha256.toLowerCase() !== opts.expectedSha256.toLowerCase()) return { ok: false, reasonCode: "hash-mismatch" };
  return { ok: true, identity };
}

/**
 * The file-level trust checks shared by the PATH path and the npm/npx path.
 *
 * Deliberately excludes the basename rule, which is id-specific and belongs to
 * `validateCandidate`. Everything else — canonical path, link substitution,
 * regular-file status, workspace exclusion, provenance — applies identically to
 * any file this module is willing to hand to a process, including a JS entry
 * point. Having ONE function makes "npm/npx skipped the checks" a thing that
 * cannot quietly happen again.
 */
function validateTrustedFile(candidate: string, opts: ResolveOptions, platform: NodeJS.Platform): { readonly reasonCode: ExecutableReasonCode; readonly realPath: string; readonly provenance: ExecutableProvenance } {
  const fail = (reasonCode: ExecutableReasonCode) => ({ reasonCode, realPath: "", provenance: "unprovable-on-platform" as const });

  if (!isAbsolute(candidate)) return fail("relative-path-refused");
  if (!existsSync(candidate)) return fail("executable-not-found");

  let link;
  try {
    link = lstatSync(candidate);
  } catch {
    return fail("executable-not-found");
  }
  if (link.isSymbolicLink()) return fail("symlink-executable-refused");
  if (!link.isFile()) return fail("not-a-regular-file");

  let realPath: string;
  try {
    realPath = realpathSync(candidate);
  } catch {
    return fail("executable-not-found");
  }

  if (isInsideWorkspace(realPath, opts.workspaceRoots ?? [])) return fail("workspace-local-executable-refused");

  const provenance = validateProvenance(realPath, platform);
  if (provenance.reasonCode !== "ok") return fail(provenance.reasonCode);

  return { reasonCode: "ok", realPath, provenance: provenance.provenance };
}

/** Expand a PATH directory + id into the candidate filenames to try. */
function candidateNames(id: TrustedExecutableId, platform: NodeJS.Platform): string[] {
  if (platform !== "win32") return [id];
  return [id, ...WINDOWS_EXTENSIONS.map((ext) => id + ext)];
}

/**
 * Resolve one approved executable to a trusted absolute path.
 *
 * PATH is treated as a list of SUGGESTIONS, not an authority: each directory is
 * tried in order, but a candidate that fails validation is SKIPPED and the
 * search continues. A hostile entry prepended to PATH therefore cannot win — it
 * is refused, and the genuine executable further down PATH is still found.
 */
export function resolveTrustedExecutable(id: TrustedExecutableId, opts: ResolveOptions = {}): ExecutableResolution {
  if (!TRUSTED_EXECUTABLE_IDS.includes(id)) return { ok: false, value: null, reasonCode: "unknown-executable-id" };
  const platform = opts.platform ?? process.platform;

  // npm/npx: run the JS entry with the CURRENT node binary. `process.execPath`
  // is absolute and cannot be shadowed, and this avoids the EINVAL that makes
  // spawning npm.cmd with shell:false impossible on modern Node.
  if (id === "npm" || id === "npx") {
    const script = (opts.cliScriptLookup ?? findNodeCliScript)(id);
    // NO FALL-THROUGH. If the CLI entry point cannot be located, npm/npx are
    // refused here and now.
    //
    // The previous code fell through to a PATH search, which on Windows could
    // select `npm.cmd`. That is wrong twice over. A `.cmd` shim is a mutable
    // batch file that PATH happened to find — exactly the untrusted-toolchain
    // problem this module exists to prevent. And Node >= 18.20.2 refuses
    // .cmd/.bat with `shell: false` (the CVE-2024-27980 fix), so the apparent
    // safety was really a spawn-time EINVAL: relying on a downstream crash as
    // the refusal mechanism means the trust decision was never actually made.
    if (!script) return { ok: false, value: null, reasonCode: "node-cli-script-unavailable" };
    {
      // §38: BOTH artifacts are executed code and both are validated. Before
      // S-9 this branch checked neither: `findNodeCliScript` did an `existsSync`
      // and a LEXICAL `resolve`, so the CLI script was never canonicalised,
      // never lstat-ed for symlink substitution, never checked for regular-file
      // status, never subjected to `workspaceRoots` (measured: a call with
      // `workspaceRoots` covering the node directory still resolved), and never
      // sealed. "Node itself is absolute" says nothing about the JS file that
      // node is told to run.
      const validatedScript = validateTrustedFile(script, opts, platform);
      if (validatedScript.reasonCode !== "ok") return { ok: false, value: null, reasonCode: validatedScript.reasonCode };

      const validatedNode = validateTrustedFile(process.execPath, opts, platform);
      if (validatedNode.reasonCode !== "ok") return { ok: false, value: null, reasonCode: validatedNode.reasonCode };

      // The node binary is sealed FIRST and the script LAST, so the pin and the
      // reported hash refer to the CLI script — the artifact a caller means when
      // it pins "npm".
      const sealed = establishIdentity([validatedNode.realPath, validatedScript.realPath], opts);
      if (!sealed.ok) return { ok: false, value: null, reasonCode: sealed.reasonCode };

      // Both halves must be provable; the weaker of the two is reported.
      const provenance: ExecutableProvenance = validatedNode.provenance === "posix-owner-verified" && validatedScript.provenance === "posix-owner-verified" ? "posix-owner-verified" : "unprovable-on-platform";

      // npm/npx execute TWO files, so authorization needs an identity for both.
      const npmAuthorization = decideExecutionAuthorization(provenance, sealed.identity, opts);

      const resolved = {
        ok: true as const,
        reasonCode: "ok" as const,
        value: { id, command: validatedNode.realPath, prefixArgs: [validatedScript.realPath], realPath: validatedScript.realPath, basename: basename(validatedScript.realPath), version: "", hash: sealed.identity[sealed.identity.length - 1].sha256, identity: sealed.identity, provenance, executionAuthorized: npmAuthorization.authorized, authorizationReason: npmAuthorization.reason },
      };
      return maybeProbe(resolved, opts);
    }
  }

  const rawPath = opts.searchPath ?? process.env.PATH ?? process.env.Path ?? "";
  const dirs = rawPath.split(delimiter).filter((d) => d.trim().length > 0);
  let lastReason: ExecutableReasonCode = "executable-not-found";

  for (const dir of dirs) {
    // A relative PATH entry is never trusted: it resolves against the CWD, which
    // for a verification run is the untrusted generated project.
    if (!isAbsolute(dir)) {
      lastReason = "relative-path-refused";
      continue;
    }
    // CANONICALIZE THE DIRECTORY FIRST. macOS aliases /var -> /private/var (and
    // /tmp -> /private/tmp), so a candidate built from a lexical directory has a
    // realpath that differs from itself for a reason that has nothing to do with
    // the executable. Comparing those two below then classified every ordinary
    // macOS temp-dir executable as `symlink-executable-refused`, which both hid
    // the real reason (workspace-local, basename mismatch) and would have
    // refused legitimate tools. Canonicalizing the DIRECTORY leaves the
    // subsequent comparison sensitive to exactly one thing: whether the
    // executable FILE itself is a link.
    let realDir: string;
    try {
      realDir = realpathSync(dir);
    } catch {
      continue; // a PATH entry that does not exist is simply skipped
    }
    for (const name of candidateNames(id, platform)) {
      const candidate = join(realDir, name);
      if (!existsSync(candidate)) continue;
      const validated = validateCandidate(id, candidate, opts);
      if (validated.ok) return maybeProbe(validated, opts);
      // Record WHY and keep searching — a hostile shadow must not end the search.
      lastReason = validated.reasonCode;
    }
  }
  return { ok: false, value: null, reasonCode: lastReason };
}

/**
 * Optionally attach a bounded version token by running the executable's own
 * `--version`.
 *
 * A VERSION PROBE IS EXECUTION, so it can never be part of deciding whether a
 * candidate is trustworthy. Measured before S-9: planting an inert file named
 * `docker.exe` on a search path and asking for `probeVersion: true` changed the
 * result from `ok` to `version-probe-failed` — proof that discovery had
 * attempted to create a process from a file nothing had vouched for.
 *
 * This function is now reachable ONLY through a successful resolution, i.e.
 * after canonical path, link, regular-file, basename, workspace-exclusion,
 * provenance and identity checks have all passed. It then re-proves the sealed
 * identity one more time, because the gap between "trusted" and "spawned" is
 * exactly where a replacement would be inserted.
 */
function maybeProbe(res: Extract<ExecutableResolution, { ok: true }>, opts: ResolveOptions): ExecutableResolution {
  if (!opts.probeVersion) return res;

  // §38: DISCOVERY IS NOT AUTHORIZATION. A resolution that nobody vouched for
  // may be reported, but it may never be run.
  if (!res.value.executionAuthorized) return { ok: false, value: null, reasonCode: res.value.authorizationReason };

  // TOCTOU: the last thing before the process is created.
  const stillTrusted = revalidateResolvedExecutable(res.value, opts.platform ?? process.platform);
  if (stillTrusted !== "ok") return { ok: false, value: null, reasonCode: stillTrusted };

  const args = [...res.value.prefixArgs, "--version"];
  const run =
    opts.processRunner ??
    ((command: string, argv: readonly string[]) => {
      const out = spawnSync(command, [...argv], { shell: false, input: "", timeout: 15000, killSignal: "SIGKILL", maxBuffer: 8192, windowsHide: true, env: buildSafeChildEnv(), encoding: "utf8" });
      return { status: typeof out.status === "number" ? out.status : null, stdout: typeof out.stdout === "string" ? out.stdout : "", failed: Boolean(out.error) };
    });

  const out = run(res.value.command, args);
  if (out.failed || out.status !== 0) return { ok: false, value: null, reasonCode: "version-probe-failed" };
  const firstLine = out.stdout.split(/\r?\n/)[0] ?? "";
  const version = firstLine.replace(/[^A-Za-z0-9 ._+-]/g, "").slice(0, 40);
  return { ok: true, reasonCode: "ok", value: { ...res.value, version } };
}

/** Fixed argument templates. Never built from mission text. */
export const VERIFICATION_ARGUMENT_TEMPLATES: Readonly<Record<string, { readonly id: TrustedExecutableId; readonly args: readonly string[] }>> = {
  typecheck: { id: "npx", args: ["tsc", "--noEmit"] },
  test: { id: "npm", args: ["test"] },
  build: { id: "npm", args: ["run", "build"] },
  lint: { id: "npm", args: ["run", "lint"] },
};
