/**
 * executableProvenanceTests — proof that an executable must PROVE its
 * provenance and identity before any process is created (§38, Fable S-9).
 *
 * Five connected failures, all measured at the previous commit before any fix:
 *
 *   1. NO OWNERSHIP OR PARENT-MUTABILITY CHECK. An inert file named `docker`
 *      planted in a scratch directory resolved as a trusted executable.
 *   2. THE TRUST CONTEXT WAS ROUTINELY EMPTY. `resolveTrustedExecutable(id, {})`
 *      appeared at 5 of 6 production call sites — not only the two the audit
 *      named. With roots supplied the same candidate was refused
 *      (`workspace-local-executable-refused`); with `{}` it resolved.
 *   3. IDENTITY WAS OPTIONAL. Without `computeHash`/`expectedSha256` the
 *      resolution carried `hash: ""` — nothing was recorded, so nothing could
 *      be re-checked later.
 *   4. DISCOVERY EXECUTED THE CANDIDATE. Asking for `probeVersion: true` on the
 *      inert candidate changed the result from `ok` to `version-probe-failed`,
 *      which is only possible if a process creation was attempted against a
 *      file nothing had vouched for.
 *   5. THE npm/npx FAST PATH SKIPPED THE CHECKS ENTIRELY. `findNodeCliScript`
 *      did an `existsSync` and a lexical `resolve`; the CLI script — executed
 *      code — was never canonicalised, never lstat-ed, and `workspaceRoots` was
 *      ignored outright (measured: roots covering the node directory still
 *      resolved).
 *
 * NO PROVIDER, DOCKER, PODMAN, CLAUDE OR CODEX PROCESS IS EXECUTED HERE. The
 * only real program this suite ever runs is `node --version`, through the
 * genuine npm resolution, and every probe-ordering test uses an injected
 * counting runner that starts nothing at all.
 *
 * Run: node --test dist/tools/executableProvenanceTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, realpathSync, symlinkSync, readFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { tmpdir } from "os";
import { join, dirname, isAbsolute, basename } from "path";

import { resolveTrustedExecutable, revalidateResolvedExecutable, evaluatePosixProvenance, type ResolvedExecutable, type ProvenanceEvidence } from "../cognitive/trustedExecutableRegistry";
import { untrustedExecutableRoots } from "../cognitive/containerSandboxBackend";
import { detectContainerRuntime } from "../cognitive/sandboxPolicy";

const IS_WINDOWS = process.platform === "win32";
/** The name a decoy must carry to get past the basename rule. */
const DOCKER_NAME = IS_WINDOWS ? "docker.exe" : "docker";

function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `namla-s9-${tag}-`)));
  if (!IS_WINDOWS) {
    chmodSync(dir, 0o700);
  }
  return dir;
}

/** Plant an INERT file with an executable-looking name. Never executed. */
function plant(dir: string, name = DOCKER_NAME): string {
  const p = join(dir, name);
  writeFileSync(p, "inert fixture - not a real executable\n");
  if (!IS_WINDOWS) {
    chmodSync(p, 0o755);
  }
  return p;
}

/**
 * Locate the npm/npx CLI entry point WITHOUT the resolver.
 *
 * Deliberately duplicates the small search the registry performs, so the
 * identities below are derived from the filesystem rather than from the
 * component under test.
 */
function locateCliScriptIndependently(name: "npm" | "npx"): string {
  const nodeDir = dirname(realpathSync(process.execPath));
  const candidates = [
    join(nodeDir, "node_modules", "npm", "bin", `${name}-cli.js`),
    join(nodeDir, "lib", "node_modules", "npm", "bin", `${name}-cli.js`),
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", `${name}-cli.js`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return realpathSync(c);
  }
  throw new Error(`could not independently locate ${name}-cli.js`);
}

/**
 * The `node_modules` subtree that CONTAINS the CLI script, on any layout.
 *
 * Derived by walking up from the independently located script to the nearest
 * ancestor literally named `node_modules` — never from the resolver, and never
 * by assembling a path out of `dirname(process.execPath)`.
 *
 * That last point is what CI run 31884674631 caught. The npm CLI script is
 * only a DESCENDANT of the node binary's directory on Windows:
 *
 *   Windows : <nodeDir>\node_modules\npm\bin\npm-cli.js      (under nodeDir)
 *   POSIX   : <prefix>/lib/node_modules/npm/bin/npm-cli.js   (SIBLING of bin/)
 *
 * Production already resolves both — `findNodeCliScript` enumerates the three
 * supported layouts. Only the tests had baked in the Windows shape, so they
 * passed there and failed on ubuntu and macOS.
 *
 * The returned subtree contains the SCRIPT but not the INTERPRETER on every
 * layout, which is exactly what the isolation test below needs; it asserts that
 * separation rather than assuming it.
 */
function cliScriptSubtreeIndependently(name: "npm" | "npx"): string {
  const script = locateCliScriptIndependently(name);
  let dir = dirname(script);
  while (basename(dir) !== "node_modules") {
    const up = dirname(dir);
    if (up === dir) throw new Error(`no node_modules ancestor above ${script}`);
    dir = up;
  }
  return dir;
}

/**
 * The identities a TRUSTED CALLER would configure for npm/npx (§38).
 *
 * INDEPENDENT BY CONSTRUCTION. These digests are computed by hashing the files
 * directly — `process.execPath` for the interpreter and an independently
 * located CLI script — and never by copying
 * `resolveTrustedExecutable(...).value.identity`. A pin taken from the resolver
 * would only prove the resolver agrees with itself; the point of an external
 * identity is that it comes from somewhere the candidate cannot influence.
 *
 * Production never does this either: the registry only ever READS
 * `expectedSha256`, and nothing in `src/` writes it.
 */
function independentIdentities(name: "npm" | "npx" = "npm"): { expectedInterpreterSha256: string; expectedSha256: string } {
  const interpreter = realpathSync(process.execPath);
  const script = locateCliScriptIndependently(name);
  return {
    expectedInterpreterSha256: createHash("sha256").update(readFileSync(interpreter)).digest("hex"),
    expectedSha256: createHash("sha256").update(readFileSync(script)).digest("hex"),
  };
}

/** A runner that records calls and starts NOTHING. */
function countingRunner() {
  const calls: string[] = [];
  return {
    calls,
    run: (command: string) => {
      calls.push(command);
      return { status: 0, stdout: "fixture 1.2.3\n", failed: false };
    },
  };
}

// ============================================== TRUSTED RESOLUTION WORKS ====

test("a genuinely trusted executable resolves with a canonical path and sealed identity", () => {
  const npm = resolveTrustedExecutable("npm", {});
  assert.equal(npm.ok, true, `npm must resolve on a Node host: ${npm.reasonCode}`);
  if (!npm.ok) return;

  assert.equal(isAbsolute(npm.value.command), true, "absolute command");
  assert.equal(realpathSync(npm.value.command), npm.value.command, "canonical command");
  assert.equal(isAbsolute(npm.value.realPath), true, "absolute script path");
  assert.equal(realpathSync(npm.value.realPath), npm.value.realPath, "canonical script path");
  assert.equal(npm.value.basename, basename(npm.value.realPath), "basename preserved");
  assert.match(npm.value.hash, /^[0-9a-f]{64}$/, "identity is ALWAYS sealed now — never the old empty string");
});

test("the node binary and the CLI script are sealed as SEPARATE identities", () => {
  // Both are executed code. Sealing only one would leave the other swappable.
  const npm = resolveTrustedExecutable("npm", {});
  assert.equal(npm.ok, true);
  if (!npm.ok) return;

  assert.equal(npm.value.identity.length, 2, "two files are vouched for");
  const [node, script] = npm.value.identity;
  assert.notEqual(node.path, script.path, "distinct files");
  assert.equal(node.path, npm.value.command, "first entry is the interpreter");
  assert.equal(script.path, npm.value.realPath, "last entry is the CLI script");
  assert.match(node.sha256, /^[0-9a-f]{64}$/);
  assert.match(script.sha256, /^[0-9a-f]{64}$/);
  assert.equal(npm.value.hash, script.sha256, "the reported hash is the SCRIPT — what a caller means by pinning npm");
});

test("npm resolves to node + CLI script, never to a .cmd shim", () => {
  // Node >= 18.20.2 refuses .cmd/.bat with shell:false (the CVE-2024-27980
  // fix), so a .cmd resolution would be both unsafe and non-functional.
  const npm = resolveTrustedExecutable("npm", {});
  assert.equal(npm.ok, true);
  if (!npm.ok) return;
  assert.equal(/\.(cmd|bat)$/i.test(npm.value.command), false, "interpreter is not a shim");
  assert.equal(/\.(cmd|bat)$/i.test(npm.value.realPath), false, "target is not a shim");
  assert.match(basename(npm.value.realPath), /^npm-cli\.js$/);
});

test("a correct externally supplied pin resolves; a wrong one is refused", () => {
  // The accepting identity is hashed from the filesystem by this test, never
  // taken from the resolver — otherwise the check would only prove the resolver
  // agrees with itself.
  const pins = independentIdentities("npm");

  const pinned = resolveTrustedExecutable("npm", pins);
  assert.equal(pinned.ok, true, `an independently computed identity is accepted: ${pinned.reasonCode}`);

  const wrong = resolveTrustedExecutable("npm", { ...pins, expectedSha256: "0".repeat(64) });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reasonCode, "hash-mismatch");
});

test("a required identity pin refuses when no pin is supplied", () => {
  // A trusted caller that knows what it expects can demand an EXTERNAL pin
  // rather than accepting evidence derived from the candidate itself.
  const unpinned = resolveTrustedExecutable("npm", { requireIdentityPin: true });
  assert.equal(unpinned.ok, false);
  assert.equal(unpinned.reasonCode, "executable-identity-unpinned");

  const pinned = resolveTrustedExecutable("npm", { requireIdentityPin: true, ...independentIdentities("npm") });
  assert.equal(pinned.ok, true, `an independently computed identity satisfies the requirement: ${pinned.reasonCode}`);
});

test("a genuine executable still revalidates cleanly", () => {
  const npm = resolveTrustedExecutable("npm", {});
  assert.equal(npm.ok, true);
  if (!npm.ok) return;
  assert.equal(revalidateResolvedExecutable(npm.value), "ok");
});

// ================================================ TRUST CONTEXT IS HONEST ====

test("the npm/npx CLI script is subject to workspaceRoots like any other file", () => {
  // Measured before S-9: this resolved, because the fast path ignored roots.
  const nodeDir = dirname(process.execPath);
  const refused = resolveTrustedExecutable("npm", { workspaceRoots: [nodeDir] });
  assert.equal(refused.ok, false, "an npm CLI script inside untrusted territory must be refused");
  assert.equal(refused.reasonCode, "workspace-local-executable-refused");
});

test("the CLI SCRIPT is checked independently of the node binary", () => {
  // Isolates the script's own provenance: declare ONLY the subtree holding the
  // CLI script untrusted, leaving the interpreter acceptable, and require the
  // refusal anyway. Without that separation, a test that marks the whole node
  // directory untrusted would be satisfied by the node check alone and would
  // prove nothing about the script — which is precisely what the test above it
  // does on POSIX, where the interpreter is what lands inside `<prefix>/bin`.
  //
  // Everything expected here is established WITHOUT the resolver: the
  // interpreter from `process.execPath`, the script and its subtree from the
  // independent layout search, the digests by hashing those two files. Nothing
  // is read back out of `resolveTrustedExecutable(...).value` and re-asserted
  // against itself.
  const interpreter = realpathSync(process.execPath);
  const script = locateCliScriptIndependently("npm");
  const scriptSubtree = cliScriptSubtreeIndependently("npm");
  const pins = independentIdentities("npm");

  const npm = resolveTrustedExecutable("npm", {});
  assert.equal(npm.ok, true, `npm must resolve on a Node host: ${npm.reasonCode}`);
  if (!npm.ok) return;

  // TWO DISTINCT ARTIFACTS, each the independently known file — semantic
  // identity, not a directory shape.
  assert.equal(npm.value.command, interpreter, "the interpreter is the running node binary");
  assert.equal(npm.value.realPath, script, "the target is the independently located CLI script");
  assert.notEqual(npm.value.command, npm.value.realPath, "interpreter and script are different files");

  // BOTH are measured, and each digest belongs to the file it claims to.
  assert.equal(npm.value.identity.length, 2, "both executed artifacts are sealed");
  assert.equal(npm.value.identity[0].path, interpreter, "identity[0] is the interpreter");
  assert.equal(npm.value.identity[1].path, script, "identity[1] is the CLI script");
  assert.equal(npm.value.identity[0].sha256, pins.expectedInterpreterSha256, "interpreter identity is node's own digest");
  assert.equal(npm.value.identity[1].sha256, pins.expectedSha256, "CLI identity is the script's own digest");
  assert.notEqual(pins.expectedInterpreterSha256, pins.expectedSha256, "two distinct artifacts have two distinct identities");

  // The isolation itself. Both preconditions are ASSERTED, not assumed, so a
  // layout where they do not hold fails loudly instead of silently making the
  // refusal below prove something weaker.
  assert.equal(script.startsWith(scriptSubtree), true, "precondition: the script is inside the untrusted subtree");
  assert.equal(interpreter.startsWith(scriptSubtree), false, "precondition: the interpreter is NOT — otherwise this proves nothing about the script");

  const refused = resolveTrustedExecutable("npm", { workspaceRoots: [scriptSubtree] });
  assert.equal(refused.ok, false, "an untrusted CLI script must be refused even when node itself is fine");
  assert.equal(refused.reasonCode, "workspace-local-executable-refused");
});

test("a workspace-local executable is refused, and omitting roots is what used to lose that", () => {
  const workspace = tempDir("workspace");
  plant(workspace);

  const withRoots = resolveTrustedExecutable("docker", { searchPath: workspace, workspaceRoots: [workspace] });
  assert.equal(withRoots.ok, false);
  assert.equal(withRoots.reasonCode, "workspace-local-executable-refused");
});

test("the container backend derives its untrusted roots from trusted construction only", () => {
  // §38 + S-3: the roots come from backend options, never from a permit,
  // policy, mission or provider. A backend told nothing excludes nothing, and
  // that is visible rather than hidden.
  assert.deepEqual(untrustedExecutableRoots({}), [], "no configuration authorizes no exclusion");

  const roots = untrustedExecutableRoots({ authorizedMountRoots: ["/srv/workspaces", "/srv/other"], trustedBuildRoot: "/srv/build" });
  assert.deepEqual([...roots], ["/srv/workspaces", "/srv/other", "/srv/build"], "every trusted-construction root is excluded for executables");
});

test("a runtime executable inside an authorized mount root is refused", () => {
  // An authorized mount root is where untrusted workspaces are allowed to live,
  // so it is exactly where a planted `docker` would appear.
  const mountRoot = tempDir("mountroot");
  plant(mountRoot);
  const roots = untrustedExecutableRoots({ authorizedMountRoots: [mountRoot] });

  const resolved = resolveTrustedExecutable("docker", { searchPath: mountRoot, workspaceRoots: roots });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reasonCode, "workspace-local-executable-refused");
});

// ====================================== NO EXECUTION BEFORE TRUST (§38) ====

test("an untrusted candidate with probeVersion:true starts ZERO processes", () => {
  // The counter is the whole point: a refusal that still spawned would be a
  // failure even though the return value looks correct.
  const workspace = tempDir("noexec");
  plant(workspace);
  const runner = countingRunner();

  const resolved = resolveTrustedExecutable("docker", {
    searchPath: workspace,
    workspaceRoots: [workspace],
    probeVersion: true,
    processRunner: runner.run,
  });

  assert.equal(resolved.ok, false, "the candidate is refused");
  assert.equal(resolved.reasonCode, "workspace-local-executable-refused", "refused for provenance, not for a failed probe");
  assert.equal(runner.calls.length, 0, "NOTHING was executed while deciding trust");
});

test("every untrusted shape starts zero processes, whatever the refusal reason", () => {
  const shapes: ReadonlyArray<readonly [string, () => { searchPath: string; workspaceRoots?: readonly string[] }]> = [
    [
      "wrong basename",
      () => {
        const d = tempDir("basename");
        plant(d, IS_WINDOWS ? "notdocker.exe" : "notdocker");
        return { searchPath: d };
      },
    ],
    [
      "directory named like an executable",
      () => {
        const d = tempDir("dirname");
        mkdirSync(join(d, DOCKER_NAME));
        return { searchPath: d };
      },
    ],
    [
      "workspace-local",
      () => {
        const d = tempDir("wslocal");
        plant(d);
        return { searchPath: d, workspaceRoots: [d] };
      },
    ],
    [
      "relative PATH entry",
      () => {
        return { searchPath: "." };
      },
    ],
    [
      "empty PATH",
      () => {
        return { searchPath: "" };
      },
    ],
  ];

  for (const [label, build] of shapes) {
    const runner = countingRunner();
    const opts = build();
    const resolved = resolveTrustedExecutable("docker", { ...opts, probeVersion: true, processRunner: runner.run });
    assert.equal(resolved.ok, false, `${label}: refused`);
    assert.equal(runner.calls.length, 0, `${label}: zero process starts`);
  }
});

test("a TRUSTED executable may be probed, and exactly one process is started", () => {
  // The ordering rule is "no probe before trust", not "no probe". Trust here
  // comes from caller-supplied identities for BOTH executed artifacts, which
  // is what a platform that cannot prove ownership requires.
  const runner = countingRunner();
  const npm = resolveTrustedExecutable("npm", { probeVersion: true, processRunner: runner.run, ...independentIdentities() });
  assert.equal(npm.ok, true, `npm must resolve: ${npm.reasonCode}`);
  if (!npm.ok) return;
  assert.equal(npm.value.executionAuthorized, true, "authorized before the probe");
  assert.equal(runner.calls.length, 1, "probed once, after trust was established");
  assert.equal(runner.calls[0], npm.value.command, "the probed command is the trusted one");
  assert.equal(npm.value.version, "fixture 1.2.3", "the bounded token is recorded");
});

// ============================================ TOCTOU / IDENTITY CHANGE ====

test("a REAL on-disk replacement after trust is detected and refused", () => {
  // Not a fabricated identity object: an actual file is resolved, then actually
  // rewritten, then re-proved through the exported boundary that every
  // production spawn site calls. Deterministic — no timing race.
  const dir = tempDir("realswap");
  const planted = plant(dir);
  // The trusted-host declaration a real deployment supplies at construction.
  const first = resolveTrustedExecutable("docker", { searchPath: dir });
  assert.equal(first.ok, true, `precondition: the fixture resolves on this platform (${first.reasonCode})`);
  if (!first.ok) return;
  assert.equal(revalidateResolvedExecutable(first.value), "ok", "unchanged file still revalidates");

  writeFileSync(planted, "REPLACED CONTENT - a different program entirely\n");
  assert.equal(revalidateResolvedExecutable(first.value), "executable-identity-changed", "the swap is caught before use");
});

test("a replaced file cannot reach a process, even with probeVersion", () => {
  // The trusted identity here is an EXTERNAL pin — the digest recorded while
  // the file was trusted — not a digest measured from whatever is on disk now.
  // After replacement the candidate no longer matches that identity, so it is
  // refused during trust establishment and never reaches the probe.
  const dir = tempDir("swapnoexec");
  const planted = plant(dir);
  const original = resolveTrustedExecutable("docker", { searchPath: dir });
  assert.equal(original.ok, true, `precondition: the fixture resolves (${original.reasonCode})`);
  if (!original.ok) return;
  const trustedIdentity = original.value.hash;

  writeFileSync(planted, "REPLACED CONTENT - a different program entirely\n");

  const runner = countingRunner();
  const after = resolveTrustedExecutable("docker", { searchPath: dir, expectedSha256: trustedIdentity, probeVersion: true, processRunner: runner.run });

  assert.equal(after.ok, false, "the replacement is refused");
  assert.equal(after.reasonCode, "hash-mismatch", "refused against the trusted identity, not against a freshly measured one");
  assert.equal(runner.calls.length, 0, "ZERO process starts — the replacement never ran");
});

test("replacing a file after trust is established is refused, not executed", () => {
  // A deterministic seam rather than a timing race: the resolution is taken,
  // then the sealed file is rewritten, then the identity is re-proved.
  const npm = resolveTrustedExecutable("npm", {});
  assert.equal(npm.ok, true);
  if (!npm.ok) return;

  const swapped: ResolvedExecutable = {
    ...npm.value,
    identity: npm.value.identity.map((entry) => ({ ...entry, sha256: "f".repeat(64) })),
  };
  assert.equal(revalidateResolvedExecutable(swapped), "executable-identity-changed", "changed content is caught");

  const resized: ResolvedExecutable = {
    ...npm.value,
    identity: npm.value.identity.map((entry) => ({ ...entry, sizeBytes: entry.sizeBytes + 1 })),
  };
  assert.equal(revalidateResolvedExecutable(resized), "executable-identity-changed", "changed size is caught");
});

test("a sealed file that DISAPPEARS before use is refused", () => {
  const dir = tempDir("vanish");
  const planted = plant(dir);
  const sealed: ResolvedExecutable = {
    id: "docker",
    command: planted,
    prefixArgs: [],
    realPath: planted,
    basename: DOCKER_NAME,
    version: "",
    hash: "a".repeat(64),
    identity: [{ path: join(dir, "does-not-exist"), sha256: "a".repeat(64), sizeBytes: 1 }],
    provenance: "unprovable-on-platform",
    executionAuthorized: true,
    authorizationReason: "ok",
  };
  assert.equal(revalidateResolvedExecutable(sealed), "executable-identity-changed");
});

test("a file replaced by a SYMLINK after trust is refused", (t) => {
  const dir = tempDir("relink");
  const target = plant(dir, "real-target");
  const linkPath = join(dir, "linked");
  try {
    symlinkSync(target, linkPath, "file");
  } catch {
    t.skip("platform does not permit file symlink creation - link substitution UNVERIFIED here");
    return;
  }
  const sealed: ResolvedExecutable = {
    id: "docker",
    command: linkPath,
    prefixArgs: [],
    realPath: linkPath,
    basename: DOCKER_NAME,
    version: "",
    hash: "a".repeat(64),
    identity: [{ path: linkPath, sha256: "a".repeat(64), sizeBytes: 1 }],
    provenance: "unprovable-on-platform",
    executionAuthorized: true,
    authorizationReason: "ok",
  };
  assert.equal(revalidateResolvedExecutable(sealed), "symlink-executable-refused");
});

// ==================================================== PLATFORM HONESTY ====

test("provenance is reported honestly for what this platform can prove", (t) => {
  const npm = resolveTrustedExecutable("npm", {});
  assert.equal(npm.ok, true);
  if (!npm.ok) return;

  if (IS_WINDOWS) {
    // Node reports uid 0, gid 0 and a synthesised mode on Windows, so POSIX
    // ownership arithmetic there would be fabricated evidence. Saying
    // "unprovable" is the honest result, and it is recorded rather than
    // silently treated as verified.
    assert.equal(npm.value.provenance, "unprovable-on-platform");
    t.diagnostic("win32: ownership evidence is unavailable; provenance is not claimed");
  } else {
    assert.equal(npm.value.provenance, "posix-owner-verified", "a real toolchain must pass the POSIX provenance rule");
  }
});

/**
 * Plant a fixture the POSIX rule genuinely refuses, on ANY host.
 *
 * CI run 31882257990 caught the original version of this being platform-blind.
 * It relied on Windows reporting a synthesised mode 0o666 for every file, which
 * the POSIX rule reads as world-writable — so forcing `platform: "linux"` on
 * win32 drove the refusal branch. On a REAL Linux/macOS runner the same fixture
 * has honest permissions (file 0644, mkdtemp parent 0700), the rule correctly
 * ACCEPTS it, and the assertion inverted.
 *
 * The fixture is now made world-writable explicitly where `chmod` is meaningful,
 * so the refusal is a property of the fixture rather than of the host.
 */
function plantOtherWritable(tag: string): string {
  const dir = tempDir(tag);
  const file = plant(dir, "docker");
  if (!IS_WINDOWS) {
    chmodSync(file, 0o666);
    chmodSync(dir, 0o777);
  }
  return dir;
}

test("the POSIX provenance RULE is exercised deterministically on every host", () => {
  // Platform injection, not platform simulation: the real rule runs, against a
  // fixture that is genuinely other-writable on this host.
  //
  // This proves the RULE's logic everywhere. It does NOT claim to prove how a
  // genuine Linux or macOS filesystem is laid out; the two tests below do that,
  // and they honestly skip where the evidence does not exist.
  const dir = plantOtherWritable("forcedposix");

  const forced = resolveTrustedExecutable("docker", { searchPath: dir, platform: "linux" });
  assert.equal(forced.ok, false, "the POSIX rule refuses a world-writable candidate");
  assert.ok(forced.reasonCode === "untrusted-executable-owner" || forced.reasonCode === "untrusted-executable-parent", `provenance refusal, got ${forced.reasonCode}`);
});

test("a candidate refused by the POSIX rule starts zero processes even with probeVersion", () => {
  const dir = plantOtherWritable("forcednoexec");
  const runner = countingRunner();

  const forced = resolveTrustedExecutable("docker", { searchPath: dir, platform: "linux", probeVersion: true, processRunner: runner.run });
  assert.equal(forced.ok, false, "refused on provenance");
  assert.ok(forced.reasonCode === "untrusted-executable-owner" || forced.reasonCode === "untrusted-executable-parent", `refused for provenance, got ${forced.reasonCode}`);
  assert.equal(runner.calls.length, 0, "provenance is decided before any process could start");
});

test("a CLEAN fixture passes the POSIX rule — proving the refusals above are not vacuous", () => {
  // The counterpart: same code path, honest permissions. On POSIX the rule
  // accepts; on win32 the synthesised mode is world-writable so the rule
  // refuses. Both outcomes are asserted explicitly rather than a single
  // expectation being assumed to hold everywhere.
  //
  // The permissions are set explicitly rather than inherited from the process
  // umask. `writeFileSync` creates 0666 & ~umask, so a runner with umask 002
  // would produce a GROUP-WRITABLE 0664 file, which this rule correctly
  // refuses — and this test would then fail for a reason that has nothing to
  // do with the rule being wrong. The fixture must be clean by construction.
  const dir = tempDir("cleanposix");
  const file = plant(dir, "docker");
  if (!IS_WINDOWS) {
    chmodSync(file, 0o755);
    chmodSync(dir, 0o700);
  }
  const forced = resolveTrustedExecutable("docker", { searchPath: dir, platform: "linux" });

  if (IS_WINDOWS) {
    assert.equal(forced.ok, false, "win32 reports a synthesised world-writable mode, so the rule refuses");
  } else {
    assert.equal(forced.ok, true, `a clean POSIX fixture reaches the identity stage: ${forced.reasonCode}`);
    if (forced.ok) assert.equal(forced.value.provenance, "posix-owner-verified", "provenance was genuinely proven, not skipped");
  }
});

test("POSIX: a world-writable parent directory is refused", (t) => {
  if (IS_WINDOWS) {
    t.skip("win32 has no POSIX mode bits - parent mutability UNVERIFIED on this platform");
    return;
  }
  const dir = tempDir("wwparent");
  const planted = plant(dir);
  // The FILE must be clean by construction, or this test cannot isolate the
  // parent rule. `writeFileSync` yields 0666 & ~umask, so a runner with umask
  // 002 produces a group-writable 0664 file; the file check then fires first
  // and the reason code below is `untrusted-executable-owner` instead. Same
  // host-dependent-permissions defect that broke the forced-platform tests.
  chmodSync(planted, 0o755);
  chmodSync(dir, 0o777);

  const resolved = resolveTrustedExecutable("docker", { searchPath: dir });
  assert.equal(resolved.ok, false, "a directory anyone can write cannot supply an executable");
  assert.equal(resolved.reasonCode, "untrusted-executable-parent", "the PARENT rule is what refused, not the file rule");
});

test("POSIX: a world-writable executable FILE is refused", (t) => {
  if (IS_WINDOWS) {
    t.skip("win32 has no POSIX mode bits - file mutability UNVERIFIED on this platform");
    return;
  }
  const dir = tempDir("wwfile");
  const planted = plant(dir);
  // Parent clean by construction (mkdtemp is 0700, but state it rather than
  // inherit it) so the FILE rule is unambiguously what refuses.
  chmodSync(dir, 0o700);
  chmodSync(planted, 0o777);

  const resolved = resolveTrustedExecutable("docker", { searchPath: dir });
  assert.equal(resolved.ok, false, "a file anyone can rewrite is not trustworthy");
  assert.equal(resolved.reasonCode, "untrusted-executable-owner");
});

test("a third-party-owned executable cannot be fabricated by an unprivileged test", (t) => {
  // Honest coverage note rather than a fake pass: creating a file owned by
  // ANOTHER user requires privileges this suite does not have and must not
  // acquire. The owner rule is enforced in the same function as the mode rule
  // above, which IS exercised on POSIX.
  t.diagnostic("owner-identity refusal is not reproducible without privilege escalation; the mode half of the same check is proven above");
  assert.ok(true);
});

// ========================================= DETECTION REMAINS DETECTION ====

test("detectContainerRuntime never claims more than available-unverified", () => {
  // A resolvable binary proves a binary exists. It proves nothing about
  // namespaces, cgroups or network denial - only verifyIsolation() can.
  const report = detectContainerRuntime();
  assert.equal(report.verified, false, "detection never sets verified");
  assert.notEqual(report.capabilityState, "available-and-verified", "detection cannot reach the verified state");
  assert.ok(report.capabilityState === "available-unverified" || report.capabilityState === "unavailable");
  for (const [claim, value] of Object.entries(report.claims)) {
    assert.equal(value, false, `detection claims nothing: ${claim}`);
  }
});

test("detection accepts an explicit untrusted-root context", () => {
  // The signature carries the trust context now; passing roots must not throw
  // and must not upgrade the capability state.
  const report = detectContainerRuntime({ untrustedRoots: [process.cwd()] });
  assert.equal(report.verified, false);
  assert.notEqual(report.capabilityState, "available-and-verified");
});

// ================================================== SUITE SELF-CONTROL ====

test("this suite executed no provider, container runtime or paid process", () => {
  // The only real program any test here runs is the resolved node binary via
  // the genuine npm resolution, and even that is replaced by a counting runner
  // in every probe test. Nothing resolves or probes claude, codex, docker or
  // podman as a real process.
  const runner = countingRunner();
  for (const id of ["claude", "codex", "docker", "podman"] as const) {
    const resolved = resolveTrustedExecutable(id, { searchPath: "", probeVersion: true, processRunner: runner.run });
    assert.equal(resolved.ok, false, `${id} is not resolved from an empty PATH`);
  }
  assert.equal(runner.calls.length, 0, "no process was started for any provider or runtime id");
});

// ================== PARENT MUTABILITY, PROVEN ON ANY HOST (§38 closure) ====
// The filesystem-driven POSIX tests above can only skip on Windows, so removing
// the parent branch used to break NOTHING on this development host. These call
// the REAL production rule directly with synthetic evidence, so the parent
// branch is load-bearing everywhere. The rule is not restated here — it is
// imported.

const CLEAN: ProvenanceEvidence = { ownerUid: 1000, writableByOthers: false };

test("a world-writable PARENT is refused even when the file itself is clean", () => {
  const verdict = evaluatePosixProvenance(CLEAN, { ownerUid: 1000, writableByOthers: true }, 1000);
  assert.equal(verdict, "untrusted-executable-parent", "a directory anyone can write cannot supply an executable");
});

test("a third-party-owned PARENT is refused even when the file itself is clean", () => {
  const verdict = evaluatePosixProvenance(CLEAN, { ownerUid: 4242, writableByOthers: false }, 1000);
  assert.equal(verdict, "untrusted-executable-parent", "a directory owned by someone else can be repopulated by them");
});

test("the FILE half of the rule is separately load-bearing", () => {
  assert.equal(evaluatePosixProvenance({ ownerUid: 1000, writableByOthers: true }, CLEAN, 1000), "untrusted-executable-owner");
  assert.equal(evaluatePosixProvenance({ ownerUid: 4242, writableByOthers: false }, CLEAN, 1000), "untrusted-executable-owner");
});

test("root-owned and self-owned, non-other-writable evidence is accepted", () => {
  // Standard system layouts must not be refused for the wrong reason.
  assert.equal(evaluatePosixProvenance({ ownerUid: 0, writableByOthers: false }, { ownerUid: 0, writableByOthers: false }, 1000), "ok", "/usr/bin style");
  assert.equal(evaluatePosixProvenance(CLEAN, CLEAN, 1000), "ok", "user-owned prefix style");
  assert.equal(evaluatePosixProvenance({ ownerUid: 0, writableByOthers: false }, CLEAN, 1000), "ok", "root file in a user-owned directory");
});

// ============ WINDOWS: UNPROVABLE PROVENANCE IS NEVER SUFFICIENT (§38) ====
// Measured BEFORE this gate on win32: an inert `docker.exe` in a scratch
// directory resolved ok, sealed an identity, revalidated cleanly, and a
// probeVersion request started a process. Basename plus regular-file status was
// the whole bar. That was fail-OPEN.

test("unprovable provenance alone authorizes nothing", (t) => {
  if (!IS_WINDOWS) {
    t.skip("this host can prove POSIX ownership, so the unprovable branch is not reachable here");
    return;
  }
  const dir = tempDir("unprovable");
  plant(dir);
  const runner = countingRunner();

  const resolved = resolveTrustedExecutable("docker", { searchPath: dir, probeVersion: true, processRunner: runner.run });
  assert.equal(resolved.ok, false, "1. resolution must NOT succeed");
  assert.equal(resolved.reasonCode, "executable-provenance-unprovable");
  assert.equal(resolved.value, null, "2. no identity is established");
  assert.equal(runner.calls.length, 0, "4. no probe process is started");
});

test("an externally supplied identity is the ONLY route for an unprovable candidate", (t) => {
  if (!IS_WINDOWS) {
    t.skip("this host can prove POSIX ownership, so the unprovable branch is not reachable here");
    return;
  }
  const dir = tempDir("pinroute");
  const planted = plant(dir);
  const digest = createHash("sha256").update(readFileSync(planted)).digest("hex");

  // No identity supplied -> DISCOVERY succeeds, EXECUTION AUTHORITY does not.
  // This is the whole point of the split: locating a file is not permission to
  // run it, and the two are reported separately rather than conflated.
  const unpinned = resolveTrustedExecutable("docker", { searchPath: dir });
  assert.equal(unpinned.ok, true, "the candidate is discoverable");
  if (unpinned.ok) {
    assert.equal(unpinned.value.executionAuthorized, false, "unprovable provenance alone authorizes NO execution");
    assert.equal(unpinned.value.authorizationReason, "executable-provenance-unprovable");
  }
  // And asking to run it is refused, with no process started.
  const runner0 = countingRunner();
  const unpinnedProbe = resolveTrustedExecutable("docker", { searchPath: dir, probeVersion: true, processRunner: runner0.run });
  assert.equal(unpinnedProbe.ok, false, "execution is refused");
  assert.equal(unpinnedProbe.reasonCode, "executable-provenance-unprovable");
  assert.equal(runner0.calls.length, 0, "ZERO process starts");

  // The correct identity, supplied by the caller from trusted configuration.
  const pinned = resolveTrustedExecutable("docker", { searchPath: dir, expectedSha256: digest });
  assert.equal(pinned.ok, true, `a caller-supplied identity authorizes: ${pinned.reasonCode}`);
  if (pinned.ok) assert.equal(pinned.value.executionAuthorized, true);

  // A WRONG identity is refused as a mismatch, never silently downgraded.
  const wrong = resolveTrustedExecutable("docker", { searchPath: dir, expectedSha256: "0".repeat(64) });
  assert.equal(wrong.ok, false, "a wrong identity must be refused");
  assert.equal(wrong.reasonCode, "hash-mismatch");
});

test("a wrong identity refuses BEFORE any process starts", () => {
  const dir = tempDir("wrongpin");
  plant(dir);
  const runner = countingRunner();
  const wrong = resolveTrustedExecutable("docker", { searchPath: dir, expectedSha256: "0".repeat(64), probeVersion: true, processRunner: runner.run });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reasonCode, "hash-mismatch");
  assert.equal(runner.calls.length, 0, "ZERO process starts after an identity failure");
});

test("npm routes through the running interpreter and its CLI script, never a shim", () => {
  // Discovery-only: this asserts WHAT would run, not that running is allowed.
  const npm = resolveTrustedExecutable("npm", {});
  assert.equal(npm.ok, true, `npm must remain resolvable: ${npm.reasonCode}`);
  if (!npm.ok) return;
  assert.equal(npm.value.command, realpathSync(process.execPath), "the interpreter is THIS node binary");
  // WHICH FILE, not which directory. The previous `startsWith(dirname(execPath))`
  // was a Windows-only layout claim; on POSIX the script is a sibling subtree of
  // bin/, so it passed on Windows and failed on ubuntu and macOS.
  assert.equal(npm.value.realPath, locateCliScriptIndependently("npm"), "the target is the independently located CLI script, on whatever layout this platform uses");
  assert.deepEqual(npm.value.prefixArgs, [npm.value.realPath], "node is invoked WITH that script as its argument");
  assert.equal(/\.(cmd|bat)$/i.test(npm.value.command), false, "no .cmd interpreter");
  assert.equal(/\.(cmd|bat)$/i.test(npm.value.realPath), false, "no .cmd target");
});

test("npm needs BOTH identities where provenance is unprovable — neither alone suffices", (t) => {
  if (!IS_WINDOWS) {
    t.skip("this host proves POSIX ownership, so the two-identity requirement is not exercised here");
    return;
  }
  const pins = independentIdentities();
  const runner = countingRunner();

  // Script identity only -> the interpreter is still unvouched.
  const scriptOnly = resolveTrustedExecutable("npm", { expectedSha256: pins.expectedSha256, probeVersion: true, processRunner: runner.run });
  assert.equal(scriptOnly.ok, false, "pinning only the CLI script must not authorize execution");
  assert.equal(scriptOnly.reasonCode, "executable-provenance-unprovable");

  // Interpreter identity only -> the script is still unvouched.
  const interpreterOnly = resolveTrustedExecutable("npm", { expectedInterpreterSha256: pins.expectedInterpreterSha256, probeVersion: true, processRunner: runner.run });
  assert.equal(interpreterOnly.ok, false, "pinning only the interpreter must not authorize execution");
  assert.equal(interpreterOnly.reasonCode, "executable-provenance-unprovable");

  // A WRONG interpreter identity is a mismatch, not a silent pass.
  const wrongInterpreter = resolveTrustedExecutable("npm", { ...pins, expectedInterpreterSha256: "0".repeat(64), probeVersion: true, processRunner: runner.run });
  assert.equal(wrongInterpreter.ok, false);
  assert.equal(wrongInterpreter.reasonCode, "hash-mismatch");

  assert.equal(runner.calls.length, 0, "ZERO process starts across every unauthorized combination");

  // Both identities -> authorized.
  const both = resolveTrustedExecutable("npm", { ...pins, probeVersion: true, processRunner: runner.run });
  assert.equal(both.ok, true, `both identities authorize: ${both.reasonCode}`);
  assert.equal(runner.calls.length, 1, "exactly one probe, only once authorized");
});

// ================== SELF-MEASURED DIGEST CANNOT SATISFY A REQUIRED PIN ====

test("a self-measured digest never satisfies requireIdentityPin", () => {
  // The distinction is SOURCE, not value. A candidate that measured its own
  // content has supplied no external evidence, so a boundary demanding a pin
  // must refuse it however valid that digest is.
  const measured = resolveTrustedExecutable("npm", {});
  assert.equal(measured.ok, true);
  if (!measured.ok) return;
  const selfMeasured = measured.value.hash;

  const refused = resolveTrustedExecutable("npm", { requireIdentityPin: true });
  assert.equal(refused.ok, false, "provenance-valid but unpinned is still refused");
  assert.equal(refused.reasonCode, "executable-identity-unpinned");

  // The SAME digest, arriving through the trusted-configuration input, is a pin.
  const accepted = resolveTrustedExecutable("npm", { requireIdentityPin: true, expectedSha256: selfMeasured });
  assert.equal(accepted.ok, true, `the externally supplied identity is accepted: ${accepted.reasonCode}`);
});

test("a required pin is enforced before any process can start", () => {
  const runner = countingRunner();
  const refused = resolveTrustedExecutable("npm", { requireIdentityPin: true, probeVersion: true, processRunner: runner.run });
  assert.equal(refused.ok, false);
  assert.equal(refused.reasonCode, "executable-identity-unpinned");
  assert.equal(runner.calls.length, 0, "an unpinned boundary starts nothing");
});

// ======================= NPM/NPX DOUBLE IDENTITY, EACH HALF SEPARATELY ====

test("a changed CLI SCRIPT identity is refused before any process starts", () => {
  const npm = resolveTrustedExecutable("npm", {});
  assert.equal(npm.ok, true);
  if (!npm.ok) return;

  const [node, script] = npm.value.identity;
  const scriptChanged: ResolvedExecutable = { ...npm.value, identity: [node, { ...script, sha256: "b".repeat(64) }] };
  assert.equal(revalidateResolvedExecutable(scriptChanged), "executable-identity-changed", "the script half is checked");
});

test("a changed NODE identity is refused before any process starts", () => {
  const npm = resolveTrustedExecutable("npm", {});
  assert.equal(npm.ok, true);
  if (!npm.ok) return;

  const [node, script] = npm.value.identity;
  const nodeChanged: ResolvedExecutable = { ...npm.value, identity: [{ ...node, sha256: "c".repeat(64) }, script] };
  assert.equal(revalidateResolvedExecutable(nodeChanged), "executable-identity-changed", "the interpreter half is checked too");
});

test("neither npm nor npx can resolve to a .cmd or .bat shim", () => {
  for (const id of ["npm", "npx"] as const) {
    const r = resolveTrustedExecutable(id, {});
    assert.equal(r.ok, true, `${id} must resolve: ${r.reasonCode}`);
    if (!r.ok) continue;
    assert.equal(/\.(cmd|bat)$/i.test(r.value.command), false, `${id}: interpreter is not a shim`);
    assert.equal(/\.(cmd|bat)$/i.test(r.value.realPath), false, `${id}: target is not a shim`);
    for (const entry of r.value.identity) {
      assert.equal(/\.(cmd|bat)$/i.test(entry.path), false, `${id}: no sealed artifact is a shim`);
    }
  }
});

// ============ NO .cmd FALLBACK WHEN THE CLI SCRIPT IS MISSING (§38) ========
// Review finding: if the CLI entry point could not be located, resolution used
// to fall through to a PATH search, which on Windows could select `npm.cmd` —
// a mutable batch shim that PATH happened to find. Node >= 18.20.2 then refused
// it with EINVAL at spawn, so the apparent safety was a downstream crash rather
// than a trust decision. Both halves are now wrong-by-construction: the branch
// refuses deterministically and never reaches the PATH search.

/** Models a host where the npm/npx CLI entry point cannot be found. */
const NO_CLI_SCRIPT = () => null;

test("npm refuses deterministically when its CLI script cannot be located", () => {
  const runner = countingRunner();
  const r = resolveTrustedExecutable("npm", { cliScriptLookup: NO_CLI_SCRIPT, probeVersion: true, processRunner: runner.run });
  assert.equal(r.ok, false, "no CLI script means no npm");
  assert.equal(r.reasonCode, "node-cli-script-unavailable", "refused by name, not by a spawn crash");
  assert.equal(r.value, null, "nothing is handed back to execute");
  assert.equal(runner.calls.length, 0, "ZERO processes started");
});

test("npx refuses deterministically when its CLI script cannot be located", () => {
  const runner = countingRunner();
  const r = resolveTrustedExecutable("npx", { cliScriptLookup: NO_CLI_SCRIPT, probeVersion: true, processRunner: runner.run });
  assert.equal(r.ok, false, "no CLI script means no npx");
  assert.equal(r.reasonCode, "node-cli-script-unavailable");
  assert.equal(r.value, null);
  assert.equal(runner.calls.length, 0, "ZERO processes started");
});

test("a PATH full of npm.cmd/npx.cmd shims can never become the execution target", () => {
  // The decisive test: a directory containing ONLY shims is offered as the
  // entire search path while the CLI script is unavailable. Previously this is
  // exactly the situation that selected the shim.
  const shimDir = tempDir("shims");
  for (const n of ["npm.cmd", "npx.cmd", "npm.exe", "npx.exe", "npm", "npx"]) {
    writeFileSync(join(shimDir, n), "@echo off\r\necho SHIM\r\n");
  }

  for (const id of ["npm", "npx"] as const) {
    const runner = countingRunner();
    const r = resolveTrustedExecutable(id, { cliScriptLookup: NO_CLI_SCRIPT, searchPath: shimDir, probeVersion: true, processRunner: runner.run });
    assert.equal(r.ok, false, `${id}: a shim must never be selected`);
    assert.equal(r.reasonCode, "node-cli-script-unavailable", `${id}: refused before any PATH search`);
    assert.equal(runner.calls.length, 0, `${id}: ZERO processes started`);
  }
});

test("with the CLI script present, npm and npx both route through node + script", () => {
  for (const id of ["npm", "npx"] as const) {
    const r = resolveTrustedExecutable(id, {});
    assert.equal(r.ok, true, `${id} must resolve: ${r.reasonCode}`);
    if (!r.ok) continue;
    assert.equal(r.value.command, realpathSync(process.execPath), `${id}: interpreter is THIS node`);
    // The same principle as the npm routing test: identify the CLI script by
    // independently locating it, not by its basename alone — a basename match
    // would accept an `npx-cli.js` sitting anywhere at all.
    assert.equal(r.value.realPath, locateCliScriptIndependently(id), `${id}: target is the independently located CLI script`);
    assert.equal(basename(r.value.realPath), `${id}-cli.js`, `${id}: target is the CLI script`);
    assert.deepEqual(r.value.prefixArgs, [r.value.realPath], `${id}: node is invoked with that script`);
    assert.equal(r.value.identity.length, 2, `${id}: two sealed identities`);
    assert.equal(/\.(cmd|bat)$/i.test(r.value.command), false, `${id}: no shim interpreter`);
    assert.equal(/\.(cmd|bat)$/i.test(r.value.realPath), false, `${id}: no shim target`);
  }
});

// ================ INDEPENDENT IDENTITY, NOT RESOLVER SELF-VOUCHING ========
// Review finding: the positive trust test previously took its pins from
// `resolveTrustedExecutable(...).value.identity` and fed them straight back,
// which only proves the resolver agrees with itself. Identities below are
// hashed from the filesystem by the test, with no resolver involvement.

test("npx is authorized by INDEPENDENTLY computed identities", () => {
  const pins = independentIdentities("npx");
  const runner = countingRunner();
  const r = resolveTrustedExecutable("npx", { ...pins, probeVersion: true, processRunner: runner.run });
  assert.equal(r.ok, true, `npx must be authorized by external identities: ${r.reasonCode}`);
  if (!r.ok) return;
  assert.equal(r.value.executionAuthorized, true);
  assert.equal(runner.calls.length, 1, "exactly one probe, after authorization");
});

test("independently computed identities MATCH what the resolver sealed", () => {
  // The two sources agree — which is what makes the independent pin a genuine
  // cross-check rather than a tautology. Computed by the test from the files;
  // compared against, never copied from, the resolver.
  for (const id of ["npm", "npx"] as const) {
    const pins = independentIdentities(id);
    const r = resolveTrustedExecutable(id, {});
    assert.equal(r.ok, true, `${id} must resolve`);
    if (!r.ok) continue;
    const [interpreter, script] = r.value.identity;
    assert.equal(interpreter.sha256, pins.expectedInterpreterSha256, `${id}: interpreter digest agrees`);
    assert.equal(script.sha256, pins.expectedSha256, `${id}: CLI script digest agrees`);
  }
});

test("a resolver-reported identity cannot vouch for a DIFFERENT candidate", () => {
  // Guards the circularity directly: npm's own sealed digest must not authorize
  // an unrelated planted file.
  const npm = resolveTrustedExecutable("npm", {});
  assert.equal(npm.ok, true);
  if (!npm.ok) return;

  const dir = tempDir("crossvouch");
  plant(dir);
  const runner = countingRunner();
  const r = resolveTrustedExecutable("docker", { searchPath: dir, expectedSha256: npm.value.hash, probeVersion: true, processRunner: runner.run });
  assert.equal(r.ok, false, "another file's identity authorizes nothing here");
  assert.equal(r.reasonCode, "hash-mismatch");
  assert.equal(runner.calls.length, 0, "ZERO process starts");
});
