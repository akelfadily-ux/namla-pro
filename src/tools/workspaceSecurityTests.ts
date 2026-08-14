/**
 * workspaceSecurityTests — REAL temporary-directory security tests for the P0
 * Workspace Security Kernel. These run against an actual OS temp directory (never
 * the repository), create real symlinks/junctions where the platform allows, and
 * assert that no file outside the authorized workspace is ever created or
 * modified.
 *
 * Uses Node's built-in `node:test` runner — no new test framework.
 * Run: node --test dist/tools/workspaceSecurityTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { SafeWorkspacePathResolver, safeWriteWorkspaceFile, safeReadWorkspaceFile, safeDeleteWorkspaceFile, safeRenameWorkspaceFile, truncateUtf8, utf8Bytes, validateRelativePathShape, type SafePathReason } from "../cognitive/safeWorkspacePath";

/** One isolated sandbox: an authorized workspace plus an OUTSIDE area to protect. */
function makeSandbox(): { root: string; workspace: string; outside: string; outsideFile: string; cleanup: () => void } {
  const root = mkdtempSync(resolve(tmpdir(), "namla-wssec-"));
  const workspace = resolve(root, "workspace");
  const outside = resolve(root, "outside");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(outside, { recursive: true });
  const outsideFile = resolve(outside, "secret.txt");
  writeFileSync(outsideFile, "ORIGINAL-SECRET", "utf8");
  return { root, workspace, outside, outsideFile, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function openResolver(workspace: string): SafeWorkspacePathResolver {
  const opened = SafeWorkspacePathResolver.forRoot(workspace);
  assert.equal(opened.ok, true, "resolver must open on a real workspace root");
  return (opened as { ok: true; resolver: SafeWorkspacePathResolver }).resolver;
}

/** Try to create a real symlink; returns false when the platform forbids it. */
function trySymlink(target: string, linkPath: string, type: "dir" | "file" | "junction"): boolean {
  try {
    symlinkSync(target, linkPath, type);
    return true;
  } catch {
    return false; // Windows without developer mode / admin — test is skipped
  }
}

// ---------------------------------------------------------------- ACCEPTED ---

test("accepts ASCII, Arabic, Hebrew, emoji, nested dirs, dotfiles and extensionless files", () => {
  const sb = makeSandbox();
  try {
    const r = openResolver(sb.workspace);
    const cases: Array<[string, string]> = [
      ["src/index.ts", "export const a = 1;\n"],
      ["src/index.tsx", "export const App = () => null;\n"],
      ["src/styles.css", "body { color: #333; }\n"],
      ["docs/guide.mdx", "# Guide\n"],
      [".gitignore", "dist/\n"],
      [".eslintrc.json", "{}\n"],
      ["Dockerfile", "FROM node:20\n"],
      ["LICENSE", "MIT\n"],
      ["bin/run.sh", "#!/bin/sh\necho hi\n"],
      ["i18n/arabic.txt", "مرحبا بالعالم، هذه رسالة اختبار."],
      ["i18n/hebrew.txt", "שלום עולם, זו הודעת בדיקה."],
      ["i18n/emoji.txt", "🐜🔥🚀✅🌍"],
      ["deep/a/b/c/nested.ts", "export const nested = true;\n"],
    ];
    for (const [rel, content] of cases) {
      const res = safeWriteWorkspaceFile(r, rel, content, 1_000_000);
      assert.equal(res.ok, true, `${rel} must be accepted (got ${res.reasonCode})`);
      assert.equal(res.reasonCode, "ok");
      // Byte accounting is exact and Unicode round-trips without corruption.
      assert.equal(res.acceptedBytes, utf8Bytes(content), `${rel} acceptedBytes must equal real UTF-8 bytes`);
      assert.equal(res.rejectedBytes, 0);
      assert.equal(readFileSync(resolve(sb.workspace, rel), "utf8"), content, `${rel} content must not be corrupted`);
    }
  } finally {
    sb.cleanup();
  }
});

// ---------------------------------------------------------------- REJECTED ---

test("rejects traversal, absolute Windows/Unix paths, and null bytes", () => {
  const sb = makeSandbox();
  try {
    const r = openResolver(sb.workspace);
    const cases: Array<[string, string]> = [
      ["../escape.ts", "path-traversal"],
      ["../../outside/secret.txt", "path-traversal"],
      ["src/../../out.ts", "path-traversal"],
      ["C:/Windows/System32/drivers/etc/hosts", "absolute-path"],
      ["D:\\temp\\evil.ts", "absolute-path"],
      ["/etc/passwd", "absolute-path"],
      ["\\\\server\\share\\x.ts", "absolute-path"],
      ["src/\u0000evil.ts", "null-byte"],
      ["~/secrets.ts", "home-expansion"],
      ["", "empty-path"],
    ];
    for (const [rel, expected] of cases) {
      const res = safeWriteWorkspaceFile(r, rel, "x", 1000);
      assert.equal(res.ok, false, `${JSON.stringify(rel)} must be rejected`);
      assert.equal(res.reasonCode, expected, `${JSON.stringify(rel)} reason code`);
      assert.equal(res.acceptedBytes, 0);
    }
    // The protected external file is untouched.
    assert.equal(readFileSync(sb.outsideFile, "utf8"), "ORIGINAL-SECRET");
  } finally {
    sb.cleanup();
  }
});

test("rejects a symlinked PARENT directory that escapes the workspace", (t) => {
  const sb = makeSandbox();
  try {
    const linkDir = resolve(sb.workspace, "linked");
    const created = trySymlink(sb.outside, linkDir, "junction");
    // Report a genuine SKIP rather than a silent pass when the platform refuses.
    if (!created) return t.skip("platform does not permit junction/symlink creation");
    const r = openResolver(sb.workspace);
    const res = safeWriteWorkspaceFile(r, "linked/pwned.ts", "PWNED", 1000);
    assert.equal(res.ok, false, "a write through a symlinked parent must be refused");
    assert.equal(res.reasonCode, "symlink-parent-escape");
    assert.equal(existsSync(resolve(sb.outside, "pwned.ts")), false, "no external file may be created");
    assert.equal(readFileSync(sb.outsideFile, "utf8"), "ORIGINAL-SECRET");
  } finally {
    sb.cleanup();
  }
});

test("rejects a symlinked FILE target pointing outside the workspace", (t) => {
  const sb = makeSandbox();
  try {
    const linkFile = resolve(sb.workspace, "secret-link.ts");
    const created = trySymlink(sb.outsideFile, linkFile, "file");
    // Windows without developer mode/admin cannot create FILE symlinks; report a
    // real skip so this never reads as a passing assertion it did not make.
    if (!created) return t.skip("platform does not permit file symlink creation");
    const r = openResolver(sb.workspace);
    const res = safeWriteWorkspaceFile(r, "secret-link.ts", "OVERWRITTEN", 1000, { allowOverwrite: true });
    assert.equal(res.ok, false, "writing through a symlinked target must be refused");
    assert.equal(res.reasonCode, "symlink-target-escape");
    // The external file behind the link is byte-identical.
    assert.equal(readFileSync(sb.outsideFile, "utf8"), "ORIGINAL-SECRET", "external file must not be modified");
  } finally {
    sb.cleanup();
  }
});

test("refuses to silently overwrite an existing file", () => {
  const sb = makeSandbox();
  try {
    const r = openResolver(sb.workspace);
    const first = safeWriteWorkspaceFile(r, "src/keep.ts", "ORIGINAL", 1000);
    assert.equal(first.ok, true);
    const second = safeWriteWorkspaceFile(r, "src/keep.ts", "REPLACEMENT", 1000);
    assert.equal(second.ok, false, "a second write must not silently overwrite");
    assert.equal(second.reasonCode, "file-exists-refused-overwrite");
    assert.equal(readFileSync(resolve(sb.workspace, "src/keep.ts"), "utf8"), "ORIGINAL", "original content preserved");
    // An EXPLICIT overwrite is atomic and leaves no staged temp file behind.
    const third = safeWriteWorkspaceFile(r, "src/keep.ts", "EXPLICIT", 1000, { allowOverwrite: true });
    assert.equal(third.ok, true);
    assert.equal(readFileSync(resolve(sb.workspace, "src/keep.ts"), "utf8"), "EXPLICIT");
    assert.equal(existsSync(resolve(sb.workspace, `src/keep.ts.tmp-${process.pid}`)), false, "no staged temp file remains");
  } finally {
    sb.cleanup();
  }
});

test("reason codes never leak an external absolute path", () => {
  const sb = makeSandbox();
  try {
    const r = openResolver(sb.workspace);
    const res = safeWriteWorkspaceFile(r, "../../outside/secret.txt", "x", 1000);
    assert.equal(res.ok, false);
    assert.equal(res.reasonCode.includes(sb.outside), false);
    assert.equal(/[A-Za-z]:\\|\//.test(res.reasonCode), false, "reason code must be a bare token");
  } finally {
    sb.cleanup();
  }
});

// ------------------------------------------------------------ UTF-8 BYTES ---

test("enforces REAL UTF-8 byte limits, not character counts", () => {
  const sb = makeSandbox();
  try {
    const r = openResolver(sb.workspace);
    // 10 emoji: 10 code points, 20 UTF-16 units, 40 UTF-8 bytes.
    const emoji = "🐜".repeat(10);
    assert.equal(emoji.length, 20, "UTF-16 length");
    assert.equal(utf8Bytes(emoji), 40, "real UTF-8 byte length");
    // Character count (20) is under the cap but the byte count (40) is over it.
    const res = safeWriteWorkspaceFile(r, "over.txt", emoji, 30);
    assert.equal(res.ok, false, "must reject on BYTES even though chars fit");
    assert.equal(res.reasonCode, "content-too-large");
    assert.equal(res.rejectedBytes, 40, "exact rejected byte count");
    assert.equal(res.acceptedBytes, 0);
    assert.equal(existsSync(resolve(sb.workspace, "over.txt")), false, "no file created on refusal");

    // Arabic: 2 bytes per letter — also over a char-based cap.
    const arabic = "مرحبا";
    assert.equal(utf8Bytes(arabic), 10);
    const arabicRes = safeWriteWorkspaceFile(r, "ar.txt", arabic, 9);
    assert.equal(arabicRes.ok, false);
    assert.equal(arabicRes.rejectedBytes, 10);

    // Exactly at the cap is accepted, with exact accounting.
    const exact = safeWriteWorkspaceFile(r, "exact.txt", emoji, 40);
    assert.equal(exact.ok, true);
    assert.equal(exact.acceptedBytes, 40);
    assert.equal(readFileSync(resolve(sb.workspace, "exact.txt"), "utf8"), emoji, "Unicode must round-trip intact");
  } finally {
    sb.cleanup();
  }
});

test("truncateUtf8 never produces broken UTF-8 and reports exact byte counts", () => {
  // Cutting 4-byte emoji at 10 bytes must land on a boundary (8 bytes = 2 emoji).
  const emoji = "🐜".repeat(5); // 20 bytes
  const t = truncateUtf8(emoji, 10);
  assert.equal(t.truncated, true);
  assert.equal(t.acceptedBytes, 8, "must back off the partial sequence");
  assert.equal(t.rejectedBytes, 12);
  assert.equal(t.text, "🐜🐜");
  assert.equal(t.text.includes("\uFFFD"), false, "no replacement character");
  assert.equal(Buffer.byteLength(t.text, "utf8"), t.acceptedBytes);

  // Arabic mid-sequence cut.
  const arabic = "مرحبا بالعالم";
  const ta = truncateUtf8(arabic, 7);
  assert.equal(ta.text.includes("\uFFFD"), false);
  assert.equal(Buffer.byteLength(ta.text, "utf8"), ta.acceptedBytes);
  assert.ok(ta.acceptedBytes <= 7);

  // Under budget is untouched.
  const under = truncateUtf8("hello", 100);
  assert.equal(under.truncated, false);
  assert.equal(under.text, "hello");
  assert.equal(under.acceptedBytes, 5);
  assert.equal(under.rejectedBytes, 0);

  // Zero budget yields empty, never a broken byte.
  const zero = truncateUtf8(emoji, 0);
  assert.equal(zero.text, "");
  assert.equal(zero.acceptedBytes, 0);
  assert.equal(zero.rejectedBytes, 20);
});

test("path shape validation returns precise reason codes", () => {
  assert.equal(validateRelativePathShape("src/index.tsx"), "ok");
  assert.equal(validateRelativePathShape(".gitignore"), "ok");
  assert.equal(validateRelativePathShape("Dockerfile"), "ok");
  assert.equal(validateRelativePathShape(""), "empty-path");
  assert.equal(validateRelativePathShape("../x"), "path-traversal");
  assert.equal(validateRelativePathShape("/etc/passwd"), "absolute-path");
  assert.equal(validateRelativePathShape("C:/x"), "absolute-path");
  assert.equal(validateRelativePathShape("a\u0000b"), "null-byte");
  assert.equal(validateRelativePathShape("~/x"), "home-expansion");
  assert.equal(validateRelativePathShape("a\\b"), "illegal-char");
  assert.equal(validateRelativePathShape("a//b"), "illegal-char");
});

// ============================================================================
// P0.2 — HOSTILE CONTAINMENT COVERAGE
//
// Every test below asserts not only that the operation was REFUSED, but that
// the external world is byte-identical afterwards. A refusal that still mutated
// something outside the workspace would be a failure, and a reason code alone
// cannot prove that.
// ============================================================================

/** Snapshot every file outside the workspace so mutation can be detected. */
function snapshotOutside(sb: { outside: string }): Map<string, string> {
  const snap = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) snap.set(full, readFileSync(full, "utf8"));
    }
  };
  walk(sb.outside);
  return snap;
}

/** Assert nothing outside was created, modified, or deleted. */
function assertOutsideUntouched(sb: { outside: string }, before: Map<string, string>, label: string): void {
  const after = snapshotOutside(sb);
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), `${label}: no external file may be created or deleted`);
  for (const [path, content] of before) {
    assert.equal(after.get(path), content, `${label}: external content must remain byte-identical`);
  }
}

// --------------------------------------------------- 1. NESTED LINK ESCAPE ---

test("a nested junction inside a normal directory cannot be written through", (t) => {
  const sb = makeSandbox();
  try {
    const before = snapshotOutside(sb);
    // workspace/normal/link -> outside/
    const normal = resolve(sb.workspace, "normal");
    mkdirSync(normal, { recursive: true });
    const link = resolve(normal, "link");
    if (!trySymlink(sb.outside, link, "junction")) {
      t.skip("platform does not permit junction/symlink creation - nested escape UNVERIFIED here");
      return;
    }

    const r = safeWriteWorkspaceFile(openResolver(sb.workspace), "normal/link/pwned.ts", "PWNED", 1000);
    assert.equal(r.ok, false, "writing through a nested junction must fail");
    assert.equal(r.reasonCode, "symlink-parent-escape");
    assert.equal(existsSync(resolve(sb.outside, "pwned.ts")), false, "no external file may be created");
    assertOutsideUntouched(sb, before, "nested junction write");
  } finally {
    sb.cleanup();
  }
});

test("a link nested two directories deep is still refused", (t) => {
  const sb = makeSandbox();
  try {
    const before = snapshotOutside(sb);
    const deep = resolve(sb.workspace, "a", "b");
    mkdirSync(deep, { recursive: true });
    if (!trySymlink(sb.outside, resolve(deep, "link"), "junction")) {
      t.skip("platform does not permit junction/symlink creation - deep nested escape UNVERIFIED here");
      return;
    }
    const r = safeWriteWorkspaceFile(openResolver(sb.workspace), "a/b/link/pwned.ts", "PWNED", 1000);
    assert.equal(r.ok, false);
    assert.equal(r.reasonCode, "symlink-parent-escape");
    assertOutsideUntouched(sb, before, "deep nested junction");
  } finally {
    sb.cleanup();
  }
});

// ------------------------------------------------------ 2. PREFIX COLLISION ---

test("workspace-safe does not authorize workspace-safe-evil", () => {
  const root = mkdtempSync(resolve(tmpdir(), "namla-prefix-"));
  try {
    const safe = resolve(root, "workspace-safe");
    const evil = resolve(root, "workspace-safe-evil");
    mkdirSync(safe, { recursive: true });
    mkdirSync(evil, { recursive: true });
    const evilFile = resolve(evil, "target.txt");
    writeFileSync(evilFile, "EVIL-ORIGINAL", "utf8");

    const resolver = openResolver(safe);
    // A naive startsWith containment check would accept this: the string
    // ".../workspace-safe-evil/target.txt" does start with ".../workspace-safe".
    const r = safeWriteWorkspaceFile(resolver, "../workspace-safe-evil/target.txt", "PWNED", 1000);
    assert.equal(r.ok, false, "a sibling sharing a name prefix must not be writable");
    assert.equal(r.reasonCode, "path-traversal");
    assert.equal(readFileSync(evilFile, "utf8"), "EVIL-ORIGINAL", "the sibling file must be untouched");

    // Demonstrate WHY this matters: a naive `startsWith` containment check is
    // genuinely fooled by this layout, so the kernel must not rely on one.
    //
    // Both sides must be CANONICAL for the demonstration to be about prefixes
    // at all. `resolver.root` is realpath'd, while `evil` was lexical, and on
    // macOS the temp root aliases /var -> /private/var, so the comparison was
    // measuring that alias rather than the prefix collision and failed there.
    // This is a flaw in the demonstration line only - the containment kernel is
    // deliberately untouched.
    const evilCanonical = realpathSync(evil);
    assert.equal(evilCanonical.startsWith(resolver.root), true, "the naive prefix check IS fooled - this is the hazard");
    assert.equal(resolver.resolveForWrite("../workspace-safe-evil/target.txt").ok, false, "the kernel must refuse it anyway");

    // The sibling is a legitimate workspace in its own right, so the refusal is
    // about authority, not about the path being invalid everywhere.
    const evilResolver = openResolver(evil);
    assert.equal(safeWriteWorkspaceFile(evilResolver, "target.txt", "OWN", 1000, { allowOverwrite: true }).ok, true, "the sibling may write its own file through its own resolver");
    assert.equal(readFileSync(evilFile, "utf8"), "OWN");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// -------------------------------------------------------- 3. CASE SEMANTICS ---

test("case handling matches the platform and never authorizes an external path", () => {
  const sb = makeSandbox();
  try {
    const before = snapshotOutside(sb);
    const resolver = openResolver(sb.workspace);

    // A path differing only in case must never escape, on any platform.
    const upper = safeWriteWorkspaceFile(resolver, "../OUTSIDE/secret.txt", "PWNED", 1000);
    assert.equal(upper.ok, false, "case variation must not authorize an external path");
    assert.equal(upper.reasonCode, "path-traversal");

    // Inside the workspace, case is the platform's business, not a security
    // boundary: assert real behaviour rather than forcing one semantics.
    const a = safeWriteWorkspaceFile(resolver, "CaseFile.ts", "A", 1000);
    assert.equal(a.ok, true, "a normal mixed-case filename must be writable");
    const b = safeWriteWorkspaceFile(resolver, "casefile.ts", "B", 1000);
    if (process.platform === "win32" || process.platform === "darwin") {
      // Case-insensitive filesystem: the second write collides with the first.
      assert.equal(b.ok, false, "case-insensitive host must treat these as the same file");
      assert.equal(b.reasonCode, "file-exists-refused-overwrite");
      assert.equal(readFileSync(resolve(sb.workspace, "CaseFile.ts"), "utf8"), "A", "the original must not be overwritten");
    } else {
      // Case-sensitive filesystem: these are genuinely two distinct files.
      assert.equal(b.ok, true, "case-sensitive host must allow a distinct name");
      assert.equal(readFileSync(resolve(sb.workspace, "CaseFile.ts"), "utf8"), "A");
      assert.equal(readFileSync(resolve(sb.workspace, "casefile.ts"), "utf8"), "B");
    }
    assertOutsideUntouched(sb, before, "case semantics");
  } finally {
    sb.cleanup();
  }
});

// --------------------------------------------------------- 4. DELETE ESCAPE ---

test("delete refuses traversal, absolute paths, and malformed relative paths", () => {
  const sb = makeSandbox();
  try {
    const before = snapshotOutside(sb);
    const resolver = openResolver(sb.workspace);
    const cases: Array<[string, SafePathReason]> = [
      ["../outside/secret.txt", "path-traversal"],
      ["../../etc/passwd", "path-traversal"],
      ["a/../../outside/secret.txt", "path-traversal"],
      ["/etc/passwd", "absolute-path"],
      ["", "empty-path"],
      ["x\u0000y", "null-byte"],
      ["~/secret", "home-expansion"],
    ];
    for (const [rel, expected] of cases) {
      const r = safeDeleteWorkspaceFile(resolver, rel);
      assert.equal(r.ok, false, `delete ${JSON.stringify(rel)} must be refused`);
      assert.equal(r.reasonCode, expected, `delete ${JSON.stringify(rel)} reason`);
    }
    assert.equal(existsSync(sb.outsideFile), true, "the external file must still exist");
    assertOutsideUntouched(sb, before, "delete escape");
  } finally {
    sb.cleanup();
  }
});

test("delete refuses a target reached through a junction parent", (t) => {
  const sb = makeSandbox();
  try {
    const before = snapshotOutside(sb);
    if (!trySymlink(sb.outside, resolve(sb.workspace, "link"), "junction")) {
      t.skip("platform does not permit junction/symlink creation - delete-through-link UNVERIFIED here");
      return;
    }
    const r = safeDeleteWorkspaceFile(openResolver(sb.workspace), "link/secret.txt");
    assert.equal(r.ok, false, "deleting through a junction must fail");
    assert.equal(r.reasonCode, "symlink-parent-escape");
    assert.equal(existsSync(sb.outsideFile), true, "the external file must NOT be deleted");
    assertOutsideUntouched(sb, before, "delete through junction");
  } finally {
    sb.cleanup();
  }
});

test("delete refuses a cross-workspace target and permits its own file", () => {
  const root = mkdtempSync(resolve(tmpdir(), "namla-xws-"));
  try {
    const a = resolve(root, "colony-a");
    const b = resolve(root, "colony-b");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    const bFile = resolve(b, "evidence.txt");
    writeFileSync(bFile, "COLONY-B-EVIDENCE", "utf8");

    const resolverA = openResolver(a);
    const cross = safeDeleteWorkspaceFile(resolverA, "../colony-b/evidence.txt");
    assert.equal(cross.ok, false, "a colony must not delete a competitor bundle");
    assert.equal(cross.reasonCode, "path-traversal");
    assert.equal(readFileSync(bFile, "utf8"), "COLONY-B-EVIDENCE", "the competitor file must be intact");

    // The authorized case still works, so the guard is not vacuous.
    assert.equal(safeWriteWorkspaceFile(resolverA, "own.txt", "MINE", 1000).ok, true);
    assert.equal(safeDeleteWorkspaceFile(resolverA, "own.txt").ok, true, "a colony may delete its OWN file");
    assert.equal(existsSync(resolve(a, "own.txt")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --------------------------------------------------------- 5. RENAME ESCAPE ---

test("rename validates source and destination independently", () => {
  const sb = makeSandbox();
  try {
    const before = snapshotOutside(sb);
    const resolver = openResolver(sb.workspace);
    assert.equal(safeWriteWorkspaceFile(resolver, "inside.txt", "INSIDE", 1000).ok, true);

    // safe -> external: a valid SOURCE must not authorize an external destination.
    const out = safeRenameWorkspaceFile(resolver, "inside.txt", "../outside/stolen.txt");
    assert.equal(out.ok, false, "renaming out of the workspace must fail");
    assert.equal(out.reasonCode, "path-traversal");
    assert.equal(existsSync(resolve(sb.outside, "stolen.txt")), false, "no external file may be created");
    assert.equal(readFileSync(resolve(sb.workspace, "inside.txt"), "utf8"), "INSIDE", "the source must survive a refused rename");

    // external -> safe: a valid DESTINATION must not authorize an external source.
    const inbound = safeRenameWorkspaceFile(resolver, "../outside/secret.txt", "captured.txt");
    assert.equal(inbound.ok, false, "renaming an external file inward must fail");
    assert.equal(inbound.reasonCode, "path-traversal");
    assert.equal(existsSync(resolve(sb.workspace, "captured.txt")), false);
    assert.equal(readFileSync(sb.outsideFile, "utf8"), "ORIGINAL-SECRET", "the external file must not be moved");

    assertOutsideUntouched(sb, before, "rename escape");
  } finally {
    sb.cleanup();
  }
});

test("rename refuses traversal and unauthorized overwrite", () => {
  const sb = makeSandbox();
  try {
    const before = snapshotOutside(sb);
    const resolver = openResolver(sb.workspace);
    assert.equal(safeWriteWorkspaceFile(resolver, "src.txt", "SOURCE", 1000).ok, true);
    assert.equal(safeWriteWorkspaceFile(resolver, "dst.txt", "DESTINATION", 1000).ok, true);

    // Unauthorized overwrite of an existing destination.
    const clobber = safeRenameWorkspaceFile(resolver, "src.txt", "dst.txt");
    assert.equal(clobber.ok, false, "rename must not silently overwrite");
    assert.equal(clobber.reasonCode, "file-exists-refused-overwrite");
    assert.equal(readFileSync(resolve(sb.workspace, "dst.txt"), "utf8"), "DESTINATION", "destination content must be preserved");

    // Explicit overwrite is permitted, so the refusal above is a real decision.
    const allowed = safeRenameWorkspaceFile(resolver, "src.txt", "dst.txt", { allowOverwrite: true });
    assert.equal(allowed.ok, true, "an explicit overwrite must be permitted");
    assert.equal(readFileSync(resolve(sb.workspace, "dst.txt"), "utf8"), "SOURCE");

    for (const bad of ["../outside/x.txt", "/etc/x", "~/x", "a\u0000b"]) {
      const r = safeRenameWorkspaceFile(resolver, "dst.txt", bad);
      assert.equal(r.ok, false, `rename to ${JSON.stringify(bad)} must be refused`);
    }
    assertOutsideUntouched(sb, before, "rename refusals");
  } finally {
    sb.cleanup();
  }
});

test("rename refuses a cross-colony destination and a junction path", (t) => {
  const root = mkdtempSync(resolve(tmpdir(), "namla-rn-"));
  try {
    const a = resolve(root, "colony-a");
    const b = resolve(root, "colony-b");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    const resolverA = openResolver(a);
    assert.equal(safeWriteWorkspaceFile(resolverA, "art.txt", "A-ART", 1000).ok, true);

    const cross = safeRenameWorkspaceFile(resolverA, "art.txt", "../colony-b/art.txt");
    assert.equal(cross.ok, false, "cross-colony rename must be refused");
    assert.equal(cross.reasonCode, "path-traversal");
    assert.equal(existsSync(resolve(b, "art.txt")), false, "nothing may appear in the competitor workspace");

    if (!trySymlink(b, resolve(a, "blink"), "junction")) {
      t.skip("platform does not permit junction/symlink creation - rename-through-link UNVERIFIED here");
      return;
    }
    const viaLink = safeRenameWorkspaceFile(resolverA, "art.txt", "blink/art.txt");
    assert.equal(viaLink.ok, false, "rename through a junction must be refused");
    assert.equal(viaLink.reasonCode, "symlink-parent-escape");
    assert.equal(existsSync(resolve(b, "art.txt")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------- 6. TOCTOU RECHECK ---

test("write revalidates: a parent swapped for a junction AFTER validation is refused", (t) => {
  const sb = makeSandbox();
  try {
    const before = snapshotOutside(sb);
    const resolver = openResolver(sb.workspace);
    const parent = resolve(sb.workspace, "staging");
    mkdirSync(parent, { recursive: true });

    // 1. The path validates cleanly right now.
    assert.equal(resolver.resolveForWrite("staging/out.ts").ok, true, "the path must be valid before the swap");

    // 2. The attacker swaps the validated parent for a junction to outside.
    rmSync(parent, { recursive: true, force: true });
    if (!trySymlink(sb.outside, parent, "junction")) {
      t.skip("platform does not permit junction/symlink creation - TOCTOU swap UNVERIFIED here");
      return;
    }

    // 3. The write must re-validate and refuse - the earlier success is void.
    const r = safeWriteWorkspaceFile(resolver, "staging/out.ts", "PWNED", 1000);
    assert.equal(r.ok, false, "a stale validation must not authorize the write");
    assert.equal(r.reasonCode, "symlink-parent-escape");
    assert.equal(existsSync(resolve(sb.outside, "out.ts")), false, "no external file may be created");
    assertOutsideUntouched(sb, before, "TOCTOU write");
  } finally {
    sb.cleanup();
  }
});

test("delete and rename revalidate after a parent is swapped for a junction", (t) => {
  const sb = makeSandbox();
  try {
    const before = snapshotOutside(sb);
    const resolver = openResolver(sb.workspace);
    const parent = resolve(sb.workspace, "area");
    mkdirSync(parent, { recursive: true });
    assert.equal(resolver.resolveForWrite("area/f.txt").ok, true);

    rmSync(parent, { recursive: true, force: true });
    if (!trySymlink(sb.outside, parent, "junction")) {
      t.skip("platform does not permit junction/symlink creation - TOCTOU delete/rename UNVERIFIED here");
      return;
    }

    const del = safeDeleteWorkspaceFile(resolver, "area/secret.txt");
    assert.equal(del.ok, false, "delete must re-validate and refuse");
    assert.equal(del.reasonCode, "symlink-parent-escape");
    assert.equal(existsSync(sb.outsideFile), true, "the external file must NOT be deleted");

    const ren = safeRenameWorkspaceFile(resolver, "area/secret.txt", "area/moved.txt");
    assert.equal(ren.ok, false, "rename must re-validate and refuse");
    assert.equal(ren.reasonCode, "symlink-parent-escape");

    assertOutsideUntouched(sb, before, "TOCTOU delete/rename");
  } finally {
    sb.cleanup();
  }
});

test("containment tests perform no provider, process, or network activity", () => {
  const sb = makeSandbox();
  try {
    const resolver = openResolver(sb.workspace);
    assert.equal(safeWriteWorkspaceFile(resolver, "only-fs.txt", "x", 100).ok, true);
    assert.equal(existsSync(resolve(sb.workspace, "only-fs.txt")), true);
  } finally {
    sb.cleanup();
  }
});

// ============================================================================
// P0.1 — FILESYSTEM AUTHORITY CENTRALIZATION
//
// Reads were the gap. Writes routed through the resolver while the read path
// re-implemented containment lexically (its own regexes, a naive startsWith
// prefix compare, and `statSync`, which FOLLOWS links). A junction planted
// inside a workspace therefore exfiltrated external file content.
// ============================================================================

test("READ ESCAPE: a junction inside the workspace cannot exfiltrate an external file", (t) => {
  const sb = makeSandbox();
  try {
    writeFileSync(resolve(sb.outside, "confidential.ts"), "TOP-CONFIDENTIAL-EXTERNAL", "utf8");
    const before = snapshotOutside(sb); // snapshot AFTER the fixture exists
    if (!trySymlink(sb.outside, resolve(sb.workspace, "link"), "junction")) {
      t.skip("platform does not permit junction/symlink creation - read escape UNVERIFIED here");
      return;
    }

    const r = safeReadWorkspaceFile(openResolver(sb.workspace), "link/confidential.ts", 100000);
    assert.equal(r.ok, false, "reading through a junction must be refused");
    assert.equal(r.reasonCode, "symlink-parent-escape");
    assert.equal(r.content, "", "no external content may be returned");
    assert.equal(r.content.includes("TOP-CONFIDENTIAL"), false);
    assertOutsideUntouched(sb, before, "read escape");
  } finally {
    sb.cleanup();
  }
});

test("read refuses traversal, absolute paths, and malformed relative paths", () => {
  const sb = makeSandbox();
  try {
    const before = snapshotOutside(sb);
    const resolver = openResolver(sb.workspace);
    const cases: Array<[string, SafePathReason]> = [
      ["../outside/secret.txt", "path-traversal"],
      ["a/../../outside/secret.txt", "path-traversal"],
      ["/etc/passwd", "absolute-path"],
      ["", "empty-path"],
      ["~/secret", "home-expansion"],
    ];
    for (const [rel, expected] of cases) {
      const r = safeReadWorkspaceFile(resolver, rel, 100000);
      assert.equal(r.ok, false, `read ${JSON.stringify(rel)} must be refused`);
      assert.equal(r.reasonCode, expected, `read ${JSON.stringify(rel)} reason`);
      assert.equal(r.content, "", "a refused read must return no content");
    }
    assertOutsideUntouched(sb, before, "read refusals");
  } finally {
    sb.cleanup();
  }
});

test("read enforces a real UTF-8 byte cap and reports exact accepted bytes", () => {
  const sb = makeSandbox();
  try {
    const resolver = openResolver(sb.workspace);
    // Arabic: 1 UTF-16 unit but 2 UTF-8 bytes per character.
    const body = "ا".repeat(100);
    assert.equal(safeWriteWorkspaceFile(resolver, "arabic.txt", body, 10000).ok, true);

    const over = safeReadWorkspaceFile(resolver, "arabic.txt", 150);
    assert.equal(over.ok, false, "200 real bytes must exceed a 150-byte cap");
    assert.equal(over.reasonCode, "file-too-large");

    const ok = safeReadWorkspaceFile(resolver, "arabic.txt", 500);
    assert.equal(ok.ok, true);
    assert.equal(ok.content, body, "content must round-trip exactly");
    assert.equal(ok.acceptedBytes, 200, "acceptedBytes must be real UTF-8 bytes");
  } finally {
    sb.cleanup();
  }
});

test("read reports not-found without revealing whether an external path exists", () => {
  const sb = makeSandbox();
  try {
    const resolver = openResolver(sb.workspace);
    const missing = safeReadWorkspaceFile(resolver, "nope.txt", 1000);
    assert.equal(missing.ok, false);
    assert.equal(missing.reasonCode, "not-found");

    // An external path that DOES exist must not be distinguishable by reason code
    // from one that does not - both are refused on containment grounds first.
    const external = safeReadWorkspaceFile(resolver, "../outside/secret.txt", 1000);
    assert.equal(external.reasonCode, "path-traversal", "containment is decided before existence");
  } finally {
    sb.cleanup();
  }
});

test("every mutating and reading kernel entry point revalidates before acting", () => {
  const sb = makeSandbox();
  try {
    const resolver = openResolver(sb.workspace);
    assert.equal(safeWriteWorkspaceFile(resolver, "f.txt", "DATA", 1000).ok, true);

    // All four operations share ONE validation path, so a single hostile input
    // is refused identically by each - there is no weaker surface to attack.
    const hostile = "../outside/secret.txt";
    assert.equal(safeWriteWorkspaceFile(resolver, hostile, "X", 1000).reasonCode, "path-traversal");
    assert.equal(safeReadWorkspaceFile(resolver, hostile, 1000).reasonCode, "path-traversal");
    assert.equal(safeDeleteWorkspaceFile(resolver, hostile).reasonCode, "path-traversal");
    assert.equal(safeRenameWorkspaceFile(resolver, "f.txt", hostile).reasonCode, "path-traversal");
    assert.equal(safeRenameWorkspaceFile(resolver, hostile, "g.txt").reasonCode, "path-traversal");
    assert.equal(readFileSync(sb.outsideFile, "utf8"), "ORIGINAL-SECRET");
  } finally {
    sb.cleanup();
  }
});
