/**
 * windowsDockerTrustPinTests — the Windows container-runtime trust bootstrap and
 * the capability-report truthfulness repair (SANDBOX-R0E).
 *
 * WHY THE PIN EXISTS. `decideExecutionAuthorization` grants execution only on
 * `posix-owner-verified` provenance, which win32 can never reach: ownership is
 * synthesised there, so POSIX logic would be fabricated evidence. Without an
 * externally supplied identity the verified sandbox was unreachable on Windows
 * no matter how correctly Docker was installed.
 *
 * WHY THE PIN ALSO SELECTS. Docker Desktop ships TWO files named for docker in
 * one directory: the signed `docker.exe`, and a small `#!/usr/bin/env sh` WSL
 * shim that delegates into WSL to a binary this process never measures. An
 * unpinned PATH walk reaches the SHIM first. These tests assert the pin lands on
 * the signed binary, because pinning the shim would end the trust chain in
 * unmeasured bytes.
 *
 * Platform-sensitive cases skip honestly off win32 rather than asserting a
 * fabricated result.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { resolveTrustedExecutable } from "../cognitive/trustedExecutableRegistry";
import { detectContainerRuntime } from "../cognitive/sandboxPolicy";
import { approvedRuntimeExecutableDigests, resolveRuntimeExecutableUnderPin, WINDOWS_APPROVED_RUNTIME_EXECUTABLES, DockerContainerSandboxBackend } from "../cognitive/containerSandboxBackend";
import { composeVerificationSandbox } from "../cognitive/verificationSandbox";

const IS_WIN = process.platform === "win32";

/**
 * Is a Docker candidate present on this host AT ALL?
 *
 * Deliberately UNPINNED. The skip guards below must key on "this host has no
 * Docker", never on "the pinned resolve failed" - otherwise a corrupted or
 * wrong approved digest would silently turn these tests into skips instead of
 * failures, and the suite would stop being sensitive to the very value it
 * exists to protect. Measured: with one hex digit of the approved digest
 * changed, the pinned resolve fails, and a pin-keyed guard reported 7 passed /
 * 0 failed while three cases quietly vanished.
 */
function dockerCandidatePresent(): boolean {
  return resolveTrustedExecutable("docker", { workspaceRoots: [] }).ok;
}
const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

/** A scratch directory holding a file named like a runtime executable. */
function fakeRuntimeDir(name: string, content: string): { readonly dir: string; readonly digest: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "namla-pin-")));
  writeFileSync(join(dir, name), content, "utf8");
  return { dir, digest: sha256(content) };
}

// ---------------------------------------------------------------------------
// 1. Windows + exact approved digest => execution authorization succeeds.
// ---------------------------------------------------------------------------
test("1: the approved Windows Docker digest authorizes execution", (t) => {
  if (!IS_WIN) return t.skip("win32-only: POSIX authorizes through owner provenance, not a pin");
  const pins = approvedRuntimeExecutableDigests("docker", "win32");
  assert.equal(pins.length >= 1, true, "an approved digest must be declared");
  if (!dockerCandidatePresent()) return t.skip("no Docker candidate on this host");
  const r = resolveRuntimeExecutableUnderPin("docker", []);
  assert.equal(r.ok, true, `Docker is present, so the approved digest must resolve (got ${r.reasonCode})`);
  assert.equal(r.value.executionAuthorized, true, "the approved digest must authorize execution");
  assert.equal(r.value.authorizationReason, "ok");
  // The pin is compared against the bytes actually measured.
  assert.equal(pins.includes(r.value.identity[0].sha256.toLowerCase()), true, "the measured digest is one of the approved digests");
  // Provenance is NOT upgraded by pinning: the platform still cannot prove owner.
  assert.equal(r.value.provenance, "unprovable-on-platform", "a pin substitutes for owner proof, it does not fabricate one");
});

// ---------------------------------------------------------------------------
// 7. The extensionless WSL shim is NOT what the pin authorizes.
// ---------------------------------------------------------------------------
test("7: the approved digest selects the signed docker.exe, never the WSL shim", (t) => {
  if (!IS_WIN) return t.skip("win32-only");
  if (!dockerCandidatePresent()) return t.skip("no Docker candidate on this host");
  const r = resolveRuntimeExecutableUnderPin("docker", []);
  assert.equal(r.ok, true, `Docker is present, so the approved digest must resolve (got ${r.reasonCode})`);
  assert.equal(r.value.basename, "docker.exe", "the selected artifact must be the PE binary");
  assert.notEqual(r.value.identity[0].sizeBytes, 1359, "the 1359-byte sh shim must never be the selected artifact");
  assert.equal(r.value.identity.length, 1, "docker is a single-artifact resolution");
  // An UNPINNED resolution is what reaches the shim first - which is exactly why
  // the pin is required, and why it must not be dropped.
  const unpinned = resolveTrustedExecutable("docker", { workspaceRoots: [] });
  if (unpinned.ok && unpinned.value.basename !== "docker.exe") {
    assert.equal(unpinned.value.executionAuthorized, false, "an unpinned shim resolution must never be authorized");
  }
});

// ---------------------------------------------------------------------------
// 2 + 3. Modified bytes / wrong digest => refused.
// ---------------------------------------------------------------------------
test("2/3: same path and name but different bytes is refused, and a wrong digest is refused", (t) => {
  if (!IS_WIN) return t.skip("win32-only: this asserts the pin path, which POSIX does not take");
  const original = fakeRuntimeDir("docker.exe", "original-runtime-bytes");
  // Correct digest for these exact bytes resolves.
  const ok = resolveTrustedExecutable("docker", { workspaceRoots: [], searchPath: original.dir, expectedSha256: original.digest });
  assert.equal(ok.ok, true, "the exact digest of the file present must resolve");
  assert.equal(ok.value.executionAuthorized, true);

  // 2. Same path, same name, DIFFERENT bytes -> refused.
  writeFileSync(join(original.dir, "docker.exe"), "tampered-runtime-bytes", "utf8");
  const tampered = resolveTrustedExecutable("docker", { workspaceRoots: [], searchPath: original.dir, expectedSha256: original.digest });
  assert.equal(tampered.ok, false, "modified bytes under the same name must be refused");
  assert.equal(tampered.reasonCode, "hash-mismatch");

  // 3. Wrong expected digest against untouched bytes -> refused.
  const wrong = resolveTrustedExecutable("docker", { workspaceRoots: [], searchPath: original.dir, expectedSha256: sha256("something-else-entirely") });
  assert.equal(wrong.ok, false, "a digest that matches nothing present must be refused");
  assert.equal(wrong.reasonCode, "hash-mismatch");
});

// ---------------------------------------------------------------------------
// 4. Windows + no pin + unprovable provenance => still refused.
// ---------------------------------------------------------------------------
test("4: on Windows an unpinned runtime is never authorized", (t) => {
  if (!IS_WIN) return t.skip("win32-only");
  const fake = fakeRuntimeDir("docker.exe", "unpinned-runtime-bytes");
  const r = resolveTrustedExecutable("docker", { workspaceRoots: [], searchPath: fake.dir });
  assert.equal(r.ok, true, "it resolves - discovery is not authorization");
  assert.equal(r.value.executionAuthorized, false, "no pin means no execution authority on win32");
  assert.equal(r.value.authorizationReason, "executable-provenance-unprovable");
  assert.equal(r.value.provenance, "unprovable-on-platform");
});

// ---------------------------------------------------------------------------
// 5. POSIX behaviour is untouched.
// ---------------------------------------------------------------------------
test("5: POSIX introduces no pin, so owner provenance remains the authority", () => {
  for (const platform of ["linux", "darwin", "freebsd"] as const) {
    assert.deepEqual(approvedRuntimeExecutableDigests("docker", platform), [], `${platform} must carry no pin`);
    assert.deepEqual(approvedRuntimeExecutableDigests("podman", platform), [], `${platform} must carry no pin`);
  }
  // The allowlist is win32-scoped by construction, not by accident.
  assert.equal(approvedRuntimeExecutableDigests("docker", "win32").length >= 1, true);
});

// ---------------------------------------------------------------------------
// 6. No other executable inherits Docker's trust.
// ---------------------------------------------------------------------------
test("6: an arbitrary executable does not inherit Docker trust", (t) => {
  if (!IS_WIN) return t.skip("win32-only");
  // podman has no reviewed digest, so it authorizes nothing.
  assert.deepEqual(approvedRuntimeExecutableDigests("podman", "win32"), [], "podman must carry no approved digest");
  assert.deepEqual(WINDOWS_APPROVED_RUNTIME_EXECUTABLES.podman, [], "podman allowlist must be empty");
  // Docker's digest applied to a differently-named executable resolves nothing:
  // the pin is scoped by id, and the bytes will not match anyway.
  const dockerPin = approvedRuntimeExecutableDigests("docker", "win32")[0];
  const claude = resolveTrustedExecutable("claude", { workspaceRoots: [], expectedSha256: dockerPin });
  assert.equal(claude.ok, false, "Docker's digest must not authorize a different executable");
  assert.equal(claude.reasonCode, "hash-mismatch");
});

// ---------------------------------------------------------------------------
// 8 + 9. Capability-report truthfulness.
// ---------------------------------------------------------------------------
test("8: a detected-but-unauthorized runtime is NOT reported as absent", (t) => {
  if (!IS_WIN) return t.skip("win32-only: the unauthorized state is a win32 provenance outcome");
  const fake = fakeRuntimeDir("docker.exe", "detected-but-unpinned-bytes");
  const report = detectContainerRuntime({ probe: true, searchPath: fake.dir });
  assert.equal(report.backendId, "docker", "a resolvable candidate must be reported as found");
  assert.notEqual(report.detectionDetail, "no container runtime found", "the false absence claim must not reappear");
  assert.equal(report.detectionMethod, "executable-probe");
  assert.equal(report.capabilityState, "available-unverified");
  // The correction is OBSERVATION ONLY: nothing here is usable as a sandbox.
  assert.equal(report.verified, false);
  assert.equal(report.safeReasonCode, "sandbox-capability-unverified");
  assert.equal(Object.values(report.claims).some((c) => c === true), false, "a detected binary claims no isolation property");
});

test("9: a genuinely absent runtime still reports absence", () => {
  const empty = realpathSync(mkdtempSync(join(tmpdir(), "namla-empty-")));
  const report = detectContainerRuntime({ probe: true, searchPath: empty });
  assert.equal(report.backendId, "none");
  assert.equal(report.capabilityState, "unavailable");
  assert.equal(report.available, false);
  assert.equal(report.detectionMethod, "not-detected");
  assert.equal(report.detectionDetail, "no container runtime found", "genuine absence must still say so");
  assert.equal(report.safeReasonCode, "sandbox-runtime-unavailable");
});

// ---------------------------------------------------------------------------
// 10. Invalid trust => no executor.
// ---------------------------------------------------------------------------
test("10: composeVerificationSandbox refuses a workspace outside its authorized roots", () => {
  // ORIGINALLY this asserted the executor was always null, which was true only
  // because isolation could not yet be established on this host. Once the
  // Windows repairs let isolation genuinely VERIFY, that assertion started
  // failing - it had encoded a host STATE as if it were an invariant. The real
  // invariant, true on any host, is that an input which fails mount validation
  // yields no executor.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "namla-ws-")));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "namla-outside-")));
  const probe = join(root, "probe");
  mkdirSync(probe, { recursive: true });
  const executor = composeVerificationSandbox({ workspaceHostPath: outside, authorizedMountRoots: [root], probeWorkspaceHostPath: probe });
  assert.equal(executor, null, "a workspace outside the authorized roots can never yield an executor");
  // And an empty root list authorizes nothing, whatever the workspace is.
  assert.equal(composeVerificationSandbox({ workspaceHostPath: join(root, "ws"), authorizedMountRoots: [], probeWorkspaceHostPath: probe }), null);
});

// ---------------------------------------------------------------------------
// 11. Correct trust makes the real isolation path REACHABLE.
// ---------------------------------------------------------------------------
test("11: with the approved pin, verifyIsolation gets past the authorization gate", (t) => {
  if (!IS_WIN) return t.skip("win32-only: POSIX never had the authorization blocker");
  if (!dockerCandidatePresent()) return t.skip("no Docker candidate on this host");
  const r = resolveRuntimeExecutableUnderPin("docker", []);
  assert.equal(r.ok && r.value.executionAuthorized, true, `Docker is present, so the approved pin must authorize it (got ${r.reasonCode})`);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "namla-iso-")));
  const ws = join(root, "workspace");
  const probe = join(root, "probe");
  mkdirSync(ws, { recursive: true });
  mkdirSync(probe, { recursive: true });
  const backend = new DockerContainerSandboxBackend({ probeWorkspaceHostPath: probe, authorizedMountRoots: [root, probe] });
  const iso = backend.verifyIsolation();
  // REACHABLE is the claim, not SUCCEEDS. The authorization gate must no longer
  // be the thing that stops it; a later isolation guarantee may still refuse,
  // and that refusal is a different, honestly-named fact.
  assert.notEqual(iso.detectionDetail, "runtime not authorized for execution", "the authorization gate must no longer be the blocker");
  assert.notEqual(iso.detectionDetail, "runtime not resolvable", "the runtime must resolve");
  // Whatever the outcome, an unverified result may never claim isolation.
  if (!iso.verified) {
    assert.equal(Object.values(iso.claims).some((c) => c === true), false, "an unverified report claims nothing");
  }
});
