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

import { existsSync, lstatSync, realpathSync, readFileSync } from "fs";
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
  | "version-probe-failed";

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
  /** Lowercase sha256 of the executed file, or "" when not computed. */
  readonly hash: string;
}

export type ExecutableResolution = { readonly ok: true; readonly value: ResolvedExecutable; readonly reasonCode: "ok" } | { readonly ok: false; readonly value: null; readonly reasonCode: ExecutableReasonCode };

/** Acceptable basenames per id, per platform. Nothing else may ever be executed. */
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
  /** Optional pinned sha256. When set, a mismatch refuses the executable. */
  readonly expectedSha256?: string;
  /** Injected platform, for cross-platform tests. */
  readonly platform?: NodeJS.Platform;
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
  if (isInsideWorkspace(realPath, opts.workspaceRoots ?? [])) return { ok: false, value: null, reasonCode: "workspace-local-executable-refused" };

  let hash = "";
  if (opts.computeHash || opts.expectedSha256) {
    try {
      hash = createHash("sha256").update(readFileSync(realPath)).digest("hex");
    } catch {
      return { ok: false, value: null, reasonCode: "not-a-regular-file" };
    }
    if (opts.expectedSha256 && hash.toLowerCase() !== opts.expectedSha256.toLowerCase()) return { ok: false, value: null, reasonCode: "hash-mismatch" };
  }

  return { ok: true, reasonCode: "ok", value: { id, command: realPath, prefixArgs: [], realPath, basename: base, version: "", hash } };
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
    const script = findNodeCliScript(id);
    if (script) {
      const node = realpathSync(process.execPath);
      // The fast path must honour hashing and probing exactly like the PATH
      // path — otherwise `computeHash`/`expectedSha256` would be silently
      // ignored for npm/npx, which is the same class of bug as trusting PATH.
      let hash = "";
      if (opts.computeHash || opts.expectedSha256) {
        try {
          hash = createHash("sha256").update(readFileSync(script)).digest("hex");
        } catch {
          return { ok: false, value: null, reasonCode: "not-a-regular-file" };
        }
        if (opts.expectedSha256 && hash.toLowerCase() !== opts.expectedSha256.toLowerCase()) return { ok: false, value: null, reasonCode: "hash-mismatch" };
      }
      const resolved = { ok: true as const, reasonCode: "ok" as const, value: { id, command: node, prefixArgs: [script], realPath: script, basename: basename(script), version: "", hash } };
      return maybeProbe(resolved, opts);
    }
    // Fall through to a PATH search only if the JS entry is missing.
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

/** Optionally attach a bounded version token. Runs the executable's own --version. */
function maybeProbe(res: Extract<ExecutableResolution, { ok: true }>, opts: ResolveOptions): ExecutableResolution {
  if (!opts.probeVersion) return res;
  const out = spawnSync(res.value.command, [...res.value.prefixArgs, "--version"], { shell: false, input: "", timeout: 15000, killSignal: "SIGKILL", maxBuffer: 8192, windowsHide: true, env: buildSafeChildEnv(), encoding: "utf8" });
  if (out.error || out.status !== 0) return { ok: false, value: null, reasonCode: "version-probe-failed" };
  const firstLine = (typeof out.stdout === "string" ? out.stdout : "").split(/\r?\n/)[0] ?? "";
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
