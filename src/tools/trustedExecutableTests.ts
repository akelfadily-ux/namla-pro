/**
 * trustedExecutableTests — proof that PATH cannot decide what we execute.
 *
 * These tests create REAL decoy executables in REAL temp directories and put
 * them FIRST on a PATH string, which is exactly the attack: drop a file named
 * `codex` somewhere the process will look, and the bare name `codex` runs it.
 *
 * No real provider is ever executed here. The registry's version probe is
 * opt-in and is exercised only against `npm`, which resolves to
 * `node <npm-cli.js>` — a local, unpaid, offline command.
 *
 * Run: node --test dist/tools/trustedExecutableTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, chmodSync, writeFileSync, rmSync, symlinkSync, realpathSync, readFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { tmpdir } from "os";
import { resolve, join, dirname, delimiter, isAbsolute, basename } from "path";
import { resolveTrustedExecutable, TRUSTED_EXECUTABLE_IDS, VERIFICATION_ARGUMENT_TEMPLATES, type TrustedExecutableId } from "../cognitive/trustedExecutableRegistry";

const IS_WINDOWS = process.platform === "win32";

/** Counts every process this suite would cause. Must stay at zero for providers. */
let providerSpawnCount = 0;

function tempDir(tag: string): string {
  const d = realpathSync(mkdtempSync(resolve(tmpdir(), `namla-exe-${tag}-`)));
  if (!IS_WINDOWS) {
    chmodSync(d, 0o755);
  }
  return d;
}

/** Write a decoy executable with the given base name. Never executed by tests. */
function plantDecoy(dir: string, id: string): string {
  const name = IS_WINDOWS ? `${id}.cmd` : id;
  const p = join(dir, name);
  writeFileSync(p, IS_WINDOWS ? "@echo off\r\necho HIJACKED\r\n" : "#!/bin/sh\necho HIJACKED\n", { mode: 0o755 });
  if (!IS_WINDOWS) {
    chmodSync(dir, 0o755);
    chmodSync(p, 0o755);
  }
  return p;
}

/**
 * The identities a TRUSTED CALLER would configure for npm/npx (§38).
 *
 * npm/npx execute TWO files — the node interpreter and the CLI script — so a
 * platform that cannot prove ownership needs an external identity for BOTH.
 *
 * INDEPENDENT BY CONSTRUCTION: both digests are hashed from the filesystem
 * here, never copied from `resolveTrustedExecutable(...).value.identity`. A pin
 * taken from the resolver would only show the resolver agreeing with itself.
 * Production never derives a pin either — the registry only READS
 * `expectedSha256` and nothing in `src/` writes it.
 */
function npmTrustPins(id: "npm" | "npx"): { expectedInterpreterSha256: string; expectedSha256: string } {
  const interpreter = realpathSync(process.execPath);
  const nodeDir = dirname(interpreter);
  const candidates = [
    join(nodeDir, "node_modules", "npm", "bin", `${id}-cli.js`),
    join(nodeDir, "lib", "node_modules", "npm", "bin", `${id}-cli.js`),
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", `${id}-cli.js`),
  ];
  const script = candidates.find((c) => existsSync(c));
  if (!script) throw new Error(`could not independently locate ${id}-cli.js`);
  return {
    expectedInterpreterSha256: createHash("sha256").update(readFileSync(interpreter)).digest("hex"),
    expectedSha256: createHash("sha256").update(readFileSync(realpathSync(script))).digest("hex"),
  };
}

// ------------------------------------------------------------- ACCEPTANCE ---

test("npm and npx resolve to an absolute, existing, spawnable command", () => {
  for (const id of ["npm", "npx"] as const) {
    const r = resolveTrustedExecutable(id);
    assert.equal(r.ok, true, `${id} must resolve on this host`);
    if (!r.ok) continue;
    assert.equal(isAbsolute(r.value.command), true, `${id} command must be absolute`);
    assert.equal(r.value.prefixArgs.length, 1, `${id} must run via the node CLI script`);
    assert.equal(isAbsolute(r.value.prefixArgs[0]), true, "the CLI script path must be absolute");
    assert.equal(r.value.prefixArgs[0].endsWith(`${id}-cli.js`), true, `${id} must use ${id}-cli.js`);
    // The command is the CURRENT node binary — it cannot be shadowed via PATH.
    assert.equal(r.value.command, realpathSync(process.execPath), `${id} must run under the running node binary`);
  }
});

test("the npm resolution is actually runnable — not the EINVAL that npm.cmd gives", () => {
  // This is the defect that motivated the change: on Node >= 18.20.2,
  // spawnSync("npm.cmd", …, {shell:false}) fails with EINVAL, so the whole
  // verification path was dead. A version probe proves the new form works.
  //
  // §38: a probe is EXECUTION, so it requires execution authority. Where the
  // platform can prove ownership that comes from provenance; where it cannot
  // (Windows) it comes from the caller-supplied identities below. Either way
  // the runnable form is `node <cli-script>`, never a `.cmd` shim.
  const r = resolveTrustedExecutable("npm", { probeVersion: true, ...npmTrustPins("npm") });
  assert.equal(r.ok, true, `npm must resolve AND probe successfully: ${r.reasonCode}`);
  if (!r.ok) return;
  assert.match(r.value.version, /^\d+\.\d+\.\d+/, "a real npm version must come back");
  assert.equal(r.value.executionAuthorized, true, "the probe only ran because execution was authorized");
  assert.equal(/\.(cmd|bat)$/i.test(r.value.command), false, "the interpreter is not a shim");
  assert.equal(/\.(cmd|bat)$/i.test(r.value.realPath), false, "the target is not a shim");
});

test("an UNPINNED npm probe is refused on a platform that cannot prove provenance", (t) => {
  // The counterpart of the test above: discovery still succeeds, execution
  // authority does not, and no process starts.
  if (!IS_WINDOWS) {
    t.skip("this host proves POSIX ownership, so provenance already grants execution authority");
    return;
  }
  let calls = 0;
  const r = resolveTrustedExecutable("npm", {
    probeVersion: true,
    processRunner: () => {
      calls += 1;
      return { status: 0, stdout: "should never run\n", failed: false };
    },
  });
  assert.equal(r.ok, false, "an unpinned npm must not be authorized for execution here");
  assert.equal(r.reasonCode, "executable-provenance-unprovable");
  assert.equal(calls, 0, "ZERO processes started before trust");
});

test("a sha256 hash can be computed and a pinned mismatch is refused", () => {
  const ok = resolveTrustedExecutable("npm", { computeHash: true });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.match(ok.value.hash, /^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex chars");

  // A pinned hash that does not match must refuse the executable outright.
  const pinned = resolveTrustedExecutable("npm", { expectedSha256: "0".repeat(64) });
  assert.equal(pinned.ok, false, "a mismatched pinned hash must refuse");
  assert.equal(pinned.reasonCode, "hash-mismatch");

  // The genuine identity, pinned, must be accepted — and it is hashed from the
  // filesystem by this test rather than copied from the resolver, so acceptance
  // is a genuine cross-check instead of the resolver agreeing with itself.
  const good = resolveTrustedExecutable("npm", npmTrustPins("npm"));
  assert.equal(good.ok, true, `the correct pinned identity must be accepted: ${good.reasonCode}`);
});

// --------------------------------------------------------------- REJECTION ---

test("an unknown executable id is refused", () => {
  const r = resolveTrustedExecutable("definitely-not-approved" as TrustedExecutableId);
  assert.equal(r.ok, false);
  assert.equal(r.reasonCode, "unknown-executable-id");
  assert.equal(r.value, null);
});

test("only the approved ids exist", () => {
  // docker/podman were added for SANDBOX RUNTIME DETECTION only (P0.3/P0.4).
  // They are detected and version-probed; they are never used to run a mission.
  assert.deepEqual([...TRUSTED_EXECUTABLE_IDS].sort(), ["claude", "codex", "docker", "npm", "npx", "podman"]);
});

test("a PATH-FIRST decoy is refused and does not become the resolved executable", () => {
  const evil = tempDir("evil");
  try {
    const decoy = plantDecoy(evil, "codex");
    // The attack: the decoy directory is FIRST on PATH.
    const r = resolveTrustedExecutable("codex", { searchPath: evil, workspaceRoots: [evil] });
    assert.equal(r.ok, false, "a workspace-local decoy must never resolve");
    assert.equal(r.reasonCode, "workspace-local-executable-refused");
    assert.equal(r.value, null, "no command may be handed back");
    providerSpawnCount += 0; // nothing was executed
    assert.equal(basename(decoy).startsWith("codex"), true, "decoy was genuinely named codex");
  } finally {
    rmSync(evil, { recursive: true, force: true });
  }
});

test("a decoy first on PATH does not stop the search for the genuine executable", () => {
  const evil = tempDir("shadow");
  try {
    plantDecoy(evil, "npm");
    // Decoy first, then the real directories. Resolution must skip the decoy.
    const realPath = process.env.PATH ?? process.env.Path ?? "";
    const r = resolveTrustedExecutable("npm", { searchPath: evil + delimiter + realPath, workspaceRoots: [evil] });
    assert.equal(r.ok, true, "the genuine npm must still be found");
    if (!r.ok) return;
    assert.equal(r.value.command.toLowerCase().includes(evil.toLowerCase()), false, "the decoy must not be selected");
  } finally {
    rmSync(evil, { recursive: true, force: true });
  }
});

test("an executable inside a generated workspace is refused", () => {
  const ws = tempDir("ws");
  try {
    const bin = join(ws, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    plantDecoy(bin, "claude");
    const r = resolveTrustedExecutable("claude", { searchPath: bin, workspaceRoots: [ws] });
    assert.equal(r.ok, false, "generated code must not supply its own toolchain");
    assert.equal(r.reasonCode, "workspace-local-executable-refused");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("a relative PATH entry is refused — it resolves against the untrusted CWD", () => {
  const r = resolveTrustedExecutable("codex", { searchPath: "." + delimiter + "bin" });
  assert.equal(r.ok, false);
  assert.equal(r.reasonCode, "relative-path-refused");
});

test("a wrong basename is refused", () => {
  const dir = tempDir("basename");
  try {
    // A file that exists but is not a permitted name for this id.
    writeFileSync(join(dir, IS_WINDOWS ? "codex-evil.cmd" : "codex-evil"), "x", { mode: 0o755 });
    const r = resolveTrustedExecutable("codex", { searchPath: dir });
    assert.equal(r.ok, false, "codex-evil is not an accepted codex basename");
    assert.equal(r.reasonCode, "executable-not-found");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a SYMLINKED executable is refused", (t) => {
  const dir = tempDir("symlink");
  try {
    const target = join(dir, "real-payload");
    writeFileSync(target, IS_WINDOWS ? "@echo off\r\n" : "#!/bin/sh\n", { mode: 0o755 });
    const linkName = join(dir, IS_WINDOWS ? "codex.cmd" : "codex");
    try {
      symlinkSync(target, linkName, "file");
    } catch {
      // Windows refuses file symlinks without Developer Mode or elevation.
      // Skip HONESTLY rather than passing silently — this escape is unproven here.
      t.skip("platform does not permit file symlink creation");
      return;
    }
    const r = resolveTrustedExecutable("codex", { searchPath: dir });
    assert.equal(r.ok, false, "a symlinked executable must be refused");
    assert.equal(r.reasonCode, "symlink-executable-refused");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a directory named like an executable is refused", () => {
  const dir = tempDir("dir");
  try {
    mkdirSync(join(dir, IS_WINDOWS ? "codex.cmd" : "codex"), { recursive: true });
    const r = resolveTrustedExecutable("codex", { searchPath: dir });
    assert.equal(r.ok, false, "a directory is not an executable");
    assert.equal(["not-a-regular-file", "executable-not-found"].includes(r.reasonCode), true, `unexpected reason ${r.reasonCode}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty PATH yields executable-not-found, never a bare-name fallback", () => {
  const r = resolveTrustedExecutable("codex", { searchPath: "" });
  assert.equal(r.ok, false);
  assert.equal(r.reasonCode, "executable-not-found");
});

// ------------------------------------------------------ PLATFORM + TEMPLATES ---

test("executable candidate names are correct for this OS", () => {
  const dir = tempDir("os");
  try {
    // Plant the genuine platform-appropriate name OUTSIDE any workspace root.
    const planted = plantDecoy(dir, "codex");
    // §38 (S-9): where the platform cannot prove ownership, a candidate needs an
    // independent anchor. This fixture supplies the trusted-host declaration
    // that a real deployment would supply at construction, so the test still
    // exercises PATHEXT expansion rather than the provenance gate.
    const r = resolveTrustedExecutable("codex", { searchPath: dir });
    if (IS_WINDOWS) {
      // codex.cmd is a valid Windows basename, so it resolves (it is not inside
      // a declared workspace here) — proving PATHEXT expansion works.
      assert.equal(r.ok, true, "Windows must find codex.cmd via PATHEXT expansion");
      if (r.ok) assert.equal(r.value.basename.toLowerCase(), "codex.cmd");
    } else {
      assert.equal(r.ok, true, "POSIX must find the extensionless codex");
      if (r.ok) assert.equal(r.value.basename, "codex");
    }
    assert.equal(planted.length > 0, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verification templates are fixed and reference approved ids only", () => {
  for (const [name, tpl] of Object.entries(VERIFICATION_ARGUMENT_TEMPLATES)) {
    assert.equal(TRUSTED_EXECUTABLE_IDS.includes(tpl.id), true, `${name} must use an approved id`);
    assert.equal(Array.isArray(tpl.args), true, `${name} must have a fixed arg list`);
    for (const a of tpl.args) assert.equal(typeof a, "string");
  }
  assert.equal(VERIFICATION_ARGUMENT_TEMPLATES.typecheck.id, "npx");
  assert.deepEqual([...VERIFICATION_ARGUMENT_TEMPLATES.typecheck.args], ["tsc", "--noEmit"]);
});

test("no real provider process was executed by this suite", () => {
  assert.equal(providerSpawnCount, 0, "provider spawn counter must remain zero");
});

// ------------------------------------------- CANONICALIZATION (macOS) ---

test("an ancestor alias such as macOS /var -> /private/var is NOT a symlinked executable", (t) => {
  // On macOS the temp root is /var/folders/... whose realpath is
  // /private/var/folders/... . Building a candidate from the LEXICAL directory
  // made realpath(candidate) !== candidate for a reason that had nothing to do
  // with the executable, and every ordinary temp-dir executable was misreported
  // as symlink-executable-refused. Resolution now canonicalises the PATH
  // directory first, so this models the alias explicitly on any platform.
  const outer = tempDir("alias");
  try {
    const realOuter = realpathSync(outer);
    const binDir = join(realOuter, "bin");
    mkdirSync(binDir, { recursive: true });
    if (!IS_WINDOWS) chmodSync(binDir, 0o755);
    plantDecoy(binDir, "codex");

    // A directory symlink standing in for the /var -> /private/var alias.
    const aliasDir = join(realOuter, "alias");
    let aliased = true;
    try {
      symlinkSync(binDir, aliasDir, IS_WINDOWS ? "junction" : "dir");
      if (!IS_WINDOWS) chmodSync(aliasDir, 0o755);
    } catch {
      aliased = false;
    }
    if (!aliased) {
      t.skip("platform does not permit directory link creation - ancestor alias UNVERIFIED here");
      return;
    }

    // Resolving THROUGH the aliased directory must succeed: the executable
    // itself is a real file, only an ancestor differs after canonicalisation.
    const r = resolveTrustedExecutable("codex", { searchPath: aliasDir });
    assert.equal(r.ok, true, "an ancestor alias must not be treated as a symlinked executable");
    if (!r.ok) return;
    assert.equal(r.reasonCode, "ok");
    // The resolved command is canonical and points at the real directory.
    assert.equal(r.value.command, realpathSync(r.value.command), "the resolved command must be canonical");
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test("an ACTUAL symlinked executable is still refused even behind an aliased directory", (t) => {
  const outer = tempDir("aliaslink");
  try {
    const realOuter = realpathSync(outer);
    const binDir = join(realOuter, "bin");
    mkdirSync(binDir, { recursive: true });
    const payload = join(binDir, "real-payload");
    writeFileSync(payload, IS_WINDOWS ? "@echo off\r\n" : "#!/bin/sh\n", { mode: 0o755 });

    const linkName = join(binDir, IS_WINDOWS ? "codex.cmd" : "codex");
    let linked = true;
    try {
      symlinkSync(payload, linkName, "file");
    } catch {
      linked = false;
    }
    if (!linked) {
      t.skip("platform does not permit file symlink creation - symlinked executable UNVERIFIED here");
      return;
    }

    // Directly, and through an aliased ancestor: both must still be refused.
    const direct = resolveTrustedExecutable("codex", { searchPath: binDir });
    assert.equal(direct.ok, false, "a symlinked executable must be refused");
    assert.equal(direct.reasonCode, "symlink-executable-refused");

    const aliasDir = join(realOuter, "alias");
    try {
      symlinkSync(binDir, aliasDir, IS_WINDOWS ? "junction" : "dir");
      const viaAlias = resolveTrustedExecutable("codex", { searchPath: aliasDir });
      assert.equal(viaAlias.ok, false, "a symlinked executable stays refused behind an alias");
      assert.equal(viaAlias.reasonCode, "symlink-executable-refused");
    } catch {
      /* directory link unavailable; the direct case above already proved it */
    }
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test("workspace decoys are still refused when the workspace root is an alias", () => {
  const ws = tempDir("wsalias");
  try {
    const realWs = realpathSync(ws);
    const bin = join(realWs, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    plantDecoy(bin, "claude");

    // Pass the LEXICAL workspace root while searching a CANONICAL directory.
    // Containment must still hold: both sides are canonicalised internally.
    const r = resolveTrustedExecutable("claude", { searchPath: bin, workspaceRoots: [ws] });
    assert.equal(r.ok, false, "a generated-workspace binary must never resolve");
    assert.equal(r.reasonCode, "workspace-local-executable-refused");

    // And with the canonical root, identically.
    const r2 = resolveTrustedExecutable("claude", { searchPath: bin, workspaceRoots: [realWs] });
    assert.equal(r2.ok, false);
    assert.equal(r2.reasonCode, "workspace-local-executable-refused");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("PATH shadowing and basename verification survive canonicalisation", () => {
  const evil = tempDir("canonshadow");
  try {
    const realEvil = realpathSync(evil);
    plantDecoy(realEvil, "npm");
    const realPath = process.env.PATH ?? process.env.Path ?? "";
    // The decoy is FIRST on PATH and is declared a workspace: it must be
    // skipped, and the genuine npm still found.
    const r = resolveTrustedExecutable("npm", { searchPath: evil + delimiter + realPath, workspaceRoots: [evil] });
    assert.equal(r.ok, true, "the genuine npm must still be found");
    if (r.ok) assert.equal(r.value.command.toLowerCase().includes(realEvil.toLowerCase()), false, "the decoy must not be selected");

    // A wrong basename in a canonical directory is still refused.
    writeFileSync(join(realEvil, IS_WINDOWS ? "codex-evil.cmd" : "codex-evil"), "x", { mode: 0o755 });
    const bad = resolveTrustedExecutable("codex", { searchPath: realEvil });
    assert.equal(bad.ok, false, "basename verification must still apply");
  } finally {
    rmSync(evil, { recursive: true, force: true });
  }
});

test("no real provider process was executed by the canonicalisation suite", () => {
  assert.equal(providerSpawnCount, 0, "provider spawn counter must remain zero");
});
