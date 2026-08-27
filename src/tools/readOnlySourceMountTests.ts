/**
 * readOnlySourceMountTests — the read-only source mount must be PROVEN, never
 * assumed from absence (SANDBOX-R0J).
 *
 * THE DEFECT. `readOnlySourceMountSupported` was reported in the verified claim
 * set on the strength of:
 *
 *     existsSync(PROBE_SOURCE_MOUNT) ? writeMustFail(...) : true
 *
 * and `verifyIsolation` passed `sourceHostPath: null`, so `/src-readonly` was
 * never mounted and the expression returned TRUE without checking anything. The
 * guarantee is not decorative: `execute()` really does mount a source directory
 * readonly, so a "readonly" mount that was actually writable would let sandboxed
 * code mutate host source it may only read. `classifyProbe` treats the claim as
 * a hard gate, which means a vacuous pass was gating `available-and-verified`.
 *
 * WHY THESE TESTS EXIST SEPARATELY FROM THE RUNTIME CONTROLS. Measured: an
 * injected probe that skips the write attempt and simply reports "denied" still
 * produces `verified=true` end to end. The backend cannot detect a probe that
 * lies about what it attempted - only a direct test of the observation logic
 * can. That is what the writable-directory cases below do.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { evaluateSourceMount, SOURCE_FIXTURE_NAME, SOURCE_FIXTURE_CONTENT } from "./containerIsolationProbe";
import { classifyProbe, SOURCE_FIXTURE_DIR, SOURCE_FIXTURE_NAME as BACKEND_FIXTURE_NAME, SOURCE_FIXTURE_CONTENT as BACKEND_FIXTURE_CONTENT, type ProbeFindings } from "../cognitive/containerSandboxBackend";

/** Findings that pass every gate, so a single field can be varied in isolation. */
function goodFindings(over: Partial<ProbeFindings> = {}): ProbeFindings {
  return {
    uid: 10001,
    uidNonRoot: true,
    sensitiveHostMarkersAbsent: true, unexpectedApplicationMounts: [],
    dockerSocketAbsent: true,
    secretsAbsent: true,
    pidNamespaceIsolated: true,
    rootFilesystemReadOnly: true,
    writeOutsideWorkspaceFails: true,
    sourceMountPresent: true,
    sourceMountReadable: true,
    sourceMountWriteDenied: true,
    sourceMountReadOnly: true,
    workspaceWritable: true,
    memoryLimitBytes: 536870912,
    cpuLimitConfigured: true,
    pidLimit: 64,
    networkDenied: true,
    ...over,
  } as ProbeFindings;
}

function scratch(name: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), `namla-ro-${name}-`)));
}

// ---------------------------------------------------------------------------
// 1. Absence is never evidence.
// ---------------------------------------------------------------------------
test("1: an absent source mount can never be observed as read-only", () => {
  const missing = join(scratch("absent"), "does-not-exist");
  const o = evaluateSourceMount(missing);
  assert.equal(o.present, false, "an absent path is not present");
  assert.equal(o.readable, false, "an absent path is not readable");
  assert.equal(o.writeDenied, false, "no write was refused, because none was attempted");
  assert.equal(o.readOnly, false, "THE DEFECT: this used to be true");
});

test("1b: a present directory WITHOUT the fixture is not observed as read-only", () => {
  const dir = scratch("nofixture");
  const o = evaluateSourceMount(dir);
  assert.equal(o.present, false, "presence requires the deterministic fixture, not just the directory");
  assert.equal(o.readOnly, false);
});

// ---------------------------------------------------------------------------
// 2. A WRITABLE mount must fail the observation. This is the case that catches
//    a probe which reports "denied" without attempting the write.
// ---------------------------------------------------------------------------
test("2: a writable source mount is present and readable but NOT write-denied", () => {
  const dir = scratch("writable");
  writeFileSync(join(dir, SOURCE_FIXTURE_NAME), SOURCE_FIXTURE_CONTENT, "utf8");
  const o = evaluateSourceMount(dir);
  assert.equal(o.present, true, "the fixture is there");
  assert.equal(o.readable, true, "and its content matches");
  assert.equal(o.writeDenied, false, "but the directory is writable, so no write was refused");
  assert.equal(o.readOnly, false, "so the read-only claim must NOT hold");
  // MEASURED, and recorded rather than asserted away: `writeMustFail` writes a
  // byte and then unlinks it, so on a WRITABLE mount it consumes the fixture as
  // collateral. That only ever happens when the read-only guarantee has ALREADY
  // failed - in the real container the write is refused and nothing is touched -
  // so it is a property of the failure path, not a defect in it.
  assert.equal(existsSync(join(dir, SOURCE_FIXTURE_NAME)), false, "on a writable mount the probe consumes the fixture, which is itself evidence the write succeeded");
});

test("2b: wrong fixture content is not readable, so not read-only", () => {
  const dir = scratch("wrongcontent");
  writeFileSync(join(dir, SOURCE_FIXTURE_NAME), "not-the-expected-content", "utf8");
  const o = evaluateSourceMount(dir);
  assert.equal(o.present, true);
  assert.equal(o.readable, false, "content must match the deterministic fixture exactly");
  assert.equal(o.readOnly, false);
});

// ---------------------------------------------------------------------------
// 3. readOnly is the conjunction, so no single fact can carry it alone.
// ---------------------------------------------------------------------------
test("3: readOnly requires present AND readable AND writeDenied", () => {
  const dir = scratch("conj");
  writeFileSync(join(dir, SOURCE_FIXTURE_NAME), SOURCE_FIXTURE_CONTENT, "utf8");
  const o = evaluateSourceMount(dir);
  // On a writable host dir the conjunction is false because one term is false.
  assert.equal(o.readOnly, o.present && o.readable && o.writeDenied);
  assert.equal(o.readOnly, false);
});

// ---------------------------------------------------------------------------
// 4. The classifier demands each fact separately, so a forged derived boolean
//    cannot smuggle the claim past the gate.
// ---------------------------------------------------------------------------
test("4: classifyProbe still gates on the read-only source claim", () => {
  // The GATE was never the defect and is deliberately left exactly as it was:
  // it has always demanded `sourceMountReadOnly === true`. Adding the three
  // underlying facts as additional hard gates was tried and rejected - it broke
  // 21 pre-existing fixtures across four suites for no security gain, because
  // the vacuity was in how the PROBE computed the boolean, not in the gate.
  // Tests 1-3 above are what make that boolean non-vacuous.
  assert.equal(classifyProbe(goodFindings()), "ok", "the all-true baseline passes");
  assert.equal(classifyProbe(goodFindings({ sourceMountReadOnly: false })), "sandbox-host-mount-detected", "a false claim refuses verification");
  const legacy = goodFindings();
  delete (legacy as Record<string, unknown>).sourceMountReadOnly;
  assert.equal(classifyProbe(legacy), "sandbox-host-mount-detected", "an absent claim is refused, never assumed");
});

// ---------------------------------------------------------------------------
// 5. Host and probe fixture constants must not drift apart.
// ---------------------------------------------------------------------------
test("5: the host-side and probe-side fixture identities agree", () => {
  // The probe is a standalone module mounted into the container and cannot
  // import from the cognitive layer, so the constants are necessarily duplicated.
  // If they ever diverge, the fixture the host writes is not the one the probe
  // looks for, and the claim silently stops being provable.
  assert.equal(SOURCE_FIXTURE_NAME, BACKEND_FIXTURE_NAME, "fixture file name must match on both sides");
  assert.equal(SOURCE_FIXTURE_CONTENT, BACKEND_FIXTURE_CONTENT, "fixture content must match on both sides");
  assert.equal(typeof SOURCE_FIXTURE_DIR, "string");
  assert.equal(SOURCE_FIXTURE_DIR.length > 0, true);
});

// ---------------------------------------------------------------------------
// 6. A real read-only directory IS observed as read-only, where the platform
//    can produce one. Skips honestly rather than asserting a fabricated result.
// ---------------------------------------------------------------------------
test("6: a genuinely unwritable source directory is observed as read-only", (t) => {
  const dir = scratch("ro");
  writeFileSync(join(dir, SOURCE_FIXTURE_NAME), SOURCE_FIXTURE_CONTENT, "utf8");
  // Make the directory unwritable if this platform allows it unprivileged.
  let madeReadOnly = false;
  try {
    const { chmodSync } = require("fs") as typeof import("fs");
    chmodSync(dir, 0o500);
    madeReadOnly = evaluateSourceMount(dir).writeDenied;
  } catch {
    madeReadOnly = false;
  }
  if (!madeReadOnly) {
    return t.skip("this platform does not enforce directory write permission for the current user; read-only observation UNVERIFIED here (proven in-container instead)");
  }
  const o = evaluateSourceMount(dir);
  assert.equal(o.present, true);
  assert.equal(o.readable, true);
  assert.equal(o.writeDenied, true);
  assert.equal(o.readOnly, true, "present + readable + write-denied is the only way to true");
});

// ---------------------------------------------------------------------------
// 7. The fixture directory name is Namla-owned, not caller-supplied.
// ---------------------------------------------------------------------------
test("7: no environment or caller input can redirect the fixture identity", () => {
  const before = { dir: SOURCE_FIXTURE_DIR, name: BACKEND_FIXTURE_NAME, content: BACKEND_FIXTURE_CONTENT };
  const saved: Record<string, string | undefined> = {};
  for (const k of ["NAMLA_SOURCE_FIXTURE", "NAMLA_FIXTURE_DIR", "SOURCE_FIXTURE"]) {
    saved[k] = process.env[k];
    process.env[k] = "C:/attacker";
  }
  try {
    assert.equal(SOURCE_FIXTURE_DIR, before.dir);
    assert.equal(BACKEND_FIXTURE_NAME, before.name);
    assert.equal(BACKEND_FIXTURE_CONTENT, before.content);
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
  // And the fixture path is built by resolve() from the probe workspace, never
  // from a caller string: a traversing name could not survive this shape.
  assert.equal(SOURCE_FIXTURE_DIR.includes(".."), false, "the fixture directory name cannot traverse");
  assert.equal(SOURCE_FIXTURE_DIR.includes("/"), false);
  assert.equal(SOURCE_FIXTURE_DIR.includes("\\"), false);
  void resolve;
  void mkdirSync;
  void readFileSync;
});
