/**
 * windowsDockerTrustPinTests — the Windows container-runtime trust bootstrap and
 * the capability-report truthfulness repair (SANDBOX-R0E), made independent of
 * host Docker state (SANDBOX-R0N).
 *
 * WHY THE PIN EXISTS. `decideExecutionAuthorization` grants execution only on
 * `posix-owner-verified` provenance, which win32 can never reach: ownership is
 * synthesised there, so POSIX logic would be fabricated evidence. Without an
 * externally supplied identity the verified sandbox was unreachable on Windows
 * no matter how correctly Docker was installed.
 *
 * WHY THE PIN ALSO SELECTS. Docker Desktop ships TWO files named for docker in
 * one directory: the signed `docker.exe`, and a small `#!/usr/bin/env sh` WSL
 * shim that delegates into WSL to a binary this process never measures. On
 * win32 `candidateNames` yields the EXTENSIONLESS name first, so an unpinned
 * PATH walk reaches the SHIM first. The pin must land on the signed binary,
 * because pinning the shim would end the trust chain in unmeasured bytes.
 *
 * THE R0N DEFECT. Four tests asserted against whatever Docker (and, in one
 * case, whatever `claude`) happened to be installed on the machine running
 * them. On GitHub `windows-latest` a Docker IS present but is a different build
 * than the approved one, and `claude` is absent, so the suite failed for
 * reasons that say nothing about Namla's security properties.
 *
 * THE SPLIT THIS FILE NOW MAKES. Every SECURITY INVARIANT - what the pin means,
 * what it refuses, what it selects, and that the approved digest is exactly the
 * reviewed value - is HERMETIC: proven from deterministic fixture bytes, and it
 * runs and passes on a host with no Docker at all. Only assertions that are
 * genuinely ABOUT this machine's installed Docker are prerequisite-gated, and
 * they state which prerequisite was missing rather than skipping vaguely.
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
 * The reviewed Windows Docker trust root, written out INDEPENDENTLY of the
 * production constant so the two must agree. If someone edits the production
 * allowlist, this test is what turns red - on any host, with or without Docker.
 */
const REVIEWED_DOCKER_SHA256 = "00ffff945b67c65aae98dd980621a80ee135ed4e0931b33ca03687caee019713";

const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

/** A scratch directory holding a file named like a runtime executable. */
function fakeRuntimeDir(name: string, content: string): { readonly dir: string; readonly digest: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "namla-pin-")));
  writeFileSync(join(dir, name), content, "utf8");
  return { dir, digest: sha256(content) };
}

/**
 * WHAT THIS HOST ACTUALLY HAS, decided BEFORE any security assertion.
 *
 * Three outcomes, never collapsed into one:
 *
 *   no-candidate           nothing named docker resolves at all. An integration
 *                          assertion has no subject, so it skips.
 *   candidate-not-approved a docker resolves but its bytes are NOT the reviewed
 *                          build - an ordinary CI runner, or a different Docker
 *                          Desktop version. The integration assertion has no
 *                          subject either, but this is a DIFFERENT fact and is
 *                          named as such, with the observed digest recorded.
 *   approved-present       the reviewed bytes are here; integration runs.
 *
 * This is deliberately NOT a try/catch around the assertion: eligibility comes
 * from an independent probe, so a failing security assertion can never become
 * a skip. Test 12 proves the refusal that this classification must never hide.
 */
type DockerPrerequisite =
  | { readonly kind: "no-candidate" }
  | { readonly kind: "candidate-not-approved"; readonly basename: string; readonly digest: string }
  | { readonly kind: "approved-present"; readonly digest: string };

function approvedDockerPrerequisite(): DockerPrerequisite {
  const unpinned = resolveTrustedExecutable("docker", { workspaceRoots: [] });
  if (!unpinned.ok) return { kind: "no-candidate" };
  const pinned = resolveRuntimeExecutableUnderPin("docker", []);
  if (pinned.ok) return { kind: "approved-present", digest: pinned.value.identity[0].sha256.toLowerCase() };
  return { kind: "candidate-not-approved", basename: unpinned.value.basename, digest: unpinned.value.identity[0].sha256.toLowerCase() };
}

/** An explicit, prerequisite-specific skip reason, visible in P0 output. */
function skipReason(p: DockerPrerequisite): string {
  if (p.kind === "no-candidate") return "integration: no Docker candidate resolves on this host";
  if (p.kind === "approved-present") return "integration: prerequisite satisfied, the reviewed Docker build is present on this host";
  return "integration: approved Docker Desktop executable not present on this host (found " + p.basename + " with digest " + p.digest.slice(0, 12) + ", which is not the reviewed build)";
}

// ---------------------------------------------------------------------------
// P. THE TRUST ROOT ITSELF. Hermetic, every platform, no Docker required.
//    This is what keeps CI protecting the approved digest.
// ---------------------------------------------------------------------------
test("P: the approved Windows Docker digest is exactly the reviewed value", () => {
  const entries = WINDOWS_APPROVED_RUNTIME_EXECUTABLES.docker;
  assert.equal(entries.length, 1, "exactly one reviewed Docker build is approved");
  assert.equal(entries[0].sha256.toLowerCase(), REVIEWED_DOCKER_SHA256, "the approved Docker digest must not change without review");
  assert.equal(approvedRuntimeExecutableDigests("docker", "win32")[0], REVIEWED_DOCKER_SHA256);
});

test("P2: the trust root is win32-scoped, docker-scoped, frozen and non-overridable", () => {
  for (const platform of ["linux", "darwin", "freebsd", "openbsd", "aix"] as const) {
    assert.deepEqual(approvedRuntimeExecutableDigests("docker", platform), [], platform + " must carry no pin");
  }
  assert.deepEqual(approvedRuntimeExecutableDigests("podman", "win32"), [], "podman must carry no approved digest");
  assert.deepEqual(WINDOWS_APPROVED_RUNTIME_EXECUTABLES.podman, [], "podman allowlist must be empty");
  assert.equal(Object.isFrozen(WINDOWS_APPROVED_RUNTIME_EXECUTABLES), true, "the allowlist must be frozen");
  assert.equal(Object.isFrozen(WINDOWS_APPROVED_RUNTIME_EXECUTABLES.docker), true, "the docker entry list must be frozen");
  assert.equal(Object.isFrozen(WINDOWS_APPROVED_RUNTIME_EXECUTABLES.docker[0]), true, "each approved entry must be frozen");
  const injected = ["NAMLA_DOCKER_SHA256", "NAMLA_APPROVED_DOCKER", "DOCKER_SHA256", "NAMLA_RUNTIME_PIN"];
  const saved: Record<string, string | undefined> = {};
  for (const k of injected) {
    saved[k] = process.env[k];
    process.env[k] = "deadbeef";
  }
  try {
    assert.equal(approvedRuntimeExecutableDigests("docker", "win32")[0], REVIEWED_DOCKER_SHA256, "no environment variable may change the trust root");
  } finally {
    for (const k of injected) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

// ---------------------------------------------------------------------------
// 1a. HERMETIC: an exact digest authorizes execution on win32.
// ---------------------------------------------------------------------------
test("1a: an exact approved digest authorizes execution on win32 (hermetic)", (t) => {
  if (!IS_WIN) return t.skip("win32-only: POSIX authorizes through owner provenance, not a pin");
  assert.equal(approvedRuntimeExecutableDigests("docker", "win32").length >= 1, true, "an approved digest must be declared");
  const fixture = fakeRuntimeDir("docker.exe", "approved-runtime-bytes-r0n");
  const r = resolveTrustedExecutable("docker", { workspaceRoots: [], searchPath: fixture.dir, expectedSha256: fixture.digest });
  assert.equal(r.ok, true, "the exact digest of the file present must resolve (got " + r.reasonCode + ")");
  assert.equal(r.value.executionAuthorized, true, "an exact digest match must authorize execution");
  assert.equal(r.value.authorizationReason, "ok");
  assert.equal(r.value.identity[0].sha256.toLowerCase(), fixture.digest, "the pin is compared against the bytes actually measured");
  assert.equal(r.value.provenance, "unprovable-on-platform", "a pin substitutes for owner proof, it does not fabricate one");
});

// ---------------------------------------------------------------------------
// 1b. INTEGRATION: this machine's installed Docker is the reviewed build.
// ---------------------------------------------------------------------------
test("1b: the reviewed Docker build on this host authorizes execution (integration)", (t) => {
  if (!IS_WIN) return t.skip("win32-only");
  const pre = approvedDockerPrerequisite();
  if (pre.kind !== "approved-present") return t.skip(skipReason(pre));
  const r = resolveRuntimeExecutableUnderPin("docker", []);
  assert.equal(r.ok, true, "the reviewed build is present, so the pin must resolve (got " + r.reasonCode + ")");
  assert.equal(r.value.executionAuthorized, true, "the approved digest must authorize execution");
  assert.equal(r.value.authorizationReason, "ok");
  assert.equal(approvedRuntimeExecutableDigests("docker", "win32").includes(r.value.identity[0].sha256.toLowerCase()), true, "the measured digest is one of the approved digests");
  assert.equal(r.value.provenance, "unprovable-on-platform");
});

// ---------------------------------------------------------------------------
// 2 + 3. Modified bytes / wrong digest => refused. Already hermetic.
// ---------------------------------------------------------------------------
test("2/3: same path and name but different bytes is refused, and a wrong digest is refused", (t) => {
  if (!IS_WIN) return t.skip("win32-only: this asserts the pin path, which POSIX does not take");
  const original = fakeRuntimeDir("docker.exe", "original-runtime-bytes");
  const ok = resolveTrustedExecutable("docker", { workspaceRoots: [], searchPath: original.dir, expectedSha256: original.digest });
  assert.equal(ok.ok, true, "the exact digest of the file present must resolve");
  assert.equal(ok.value.executionAuthorized, true);

  writeFileSync(join(original.dir, "docker.exe"), "tampered-runtime-bytes", "utf8");
  const tampered = resolveTrustedExecutable("docker", { workspaceRoots: [], searchPath: original.dir, expectedSha256: original.digest });
  assert.equal(tampered.ok, false, "modified bytes under the same name must be refused");
  assert.equal(tampered.reasonCode, "hash-mismatch");

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
    assert.deepEqual(approvedRuntimeExecutableDigests("docker", platform), [], platform + " must carry no pin");
    assert.deepEqual(approvedRuntimeExecutableDigests("podman", platform), [], platform + " must carry no pin");
  }
  assert.equal(approvedRuntimeExecutableDigests("docker", "win32").length >= 1, true);
});

// ---------------------------------------------------------------------------
// 6. No other executable inherits Docker's trust. HERMETIC (R0N): this used to
//    resolve the real `claude` binary, which is absent on a CI runner and made
//    the test report `executable-not-found` instead of the refusal it means.
// ---------------------------------------------------------------------------
test("6: an arbitrary executable does not inherit Docker trust (hermetic)", (t) => {
  if (!IS_WIN) return t.skip("win32-only");
  const dockerPin = approvedRuntimeExecutableDigests("docker", "win32")[0];

  const arbitrary = fakeRuntimeDir("docker.exe", "some-unrelated-executable-bytes");
  const r = resolveTrustedExecutable("docker", { workspaceRoots: [], searchPath: arbitrary.dir, expectedSha256: dockerPin });
  assert.equal(r.ok, false, "Docker's digest must not authorize bytes that are not Docker");
  assert.equal(r.reasonCode, "hash-mismatch", "and it must be refused for the reason that is true: the bytes differ");

  assert.deepEqual(approvedRuntimeExecutableDigests("podman", "win32"), [], "podman must carry no approved digest");
  const podmanFixture = fakeRuntimeDir("podman.exe", "podman-like-bytes");
  const podman = resolveTrustedExecutable("podman", { workspaceRoots: [], searchPath: podmanFixture.dir, expectedSha256: dockerPin });
  assert.equal(podman.ok, false, "Docker's digest must not authorize a different runtime id");
  assert.equal(podman.reasonCode, "hash-mismatch");
});

// ---------------------------------------------------------------------------
// 7a. HERMETIC candidate selection: the extensionless shim and the PE binary
//     live in ONE directory with different bytes, exactly as Docker Desktop
//     ships them, and the pin must decide which one is selected - not the name
//     order, which puts the shim first.
// ---------------------------------------------------------------------------
test("7a: a pin selects by digest identity, never by basename order (hermetic)", (t) => {
  if (!IS_WIN) return t.skip("win32-only");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "namla-pin-")));
  const shimBytes = "#!/usr/bin/env sh\nexec wsl docker\n";
  const exeBytes = "MZ-pretend-portable-executable-bytes-r0n";
  writeFileSync(join(dir, "docker"), shimBytes, "utf8");
  writeFileSync(join(dir, "docker.exe"), exeBytes, "utf8");
  const shimDigest = sha256(shimBytes);
  const exeDigest = sha256(exeBytes);
  assert.notEqual(shimDigest, exeDigest, "the two artifacts must be distinguishable");

  const unpinned = resolveTrustedExecutable("docker", { workspaceRoots: [], searchPath: dir });
  assert.equal(unpinned.ok, true);
  assert.equal(unpinned.value.basename, "docker", "unpinned selection reaches the extensionless candidate first");
  assert.equal(unpinned.value.executionAuthorized, false, "and it is never authorized, because nothing vouched for it");

  const toExe = resolveTrustedExecutable("docker", { workspaceRoots: [], searchPath: dir, expectedSha256: exeDigest });
  assert.equal(toExe.ok, true, "the pin must find the matching artifact past the shim (got " + toExe.reasonCode + ")");
  assert.equal(toExe.value.basename, "docker.exe", "the pin must select the PE binary, not the shim");
  assert.equal(toExe.value.executionAuthorized, true);
  assert.equal(toExe.value.identity[0].sha256.toLowerCase(), exeDigest);

  const toShim = resolveTrustedExecutable("docker", { workspaceRoots: [], searchPath: dir, expectedSha256: shimDigest });
  assert.equal(toShim.ok, true, "the shim's own digest does match the shim");
  assert.equal(toShim.value.basename, "docker", "a shim pin selects the shim");
  assert.notEqual(toShim.value.identity[0].sha256.toLowerCase(), exeDigest, "a shim pin must never yield the PE binary's identity");
});

// ---------------------------------------------------------------------------
// 7b. INTEGRATION: on this machine the approved pin lands on the signed PE
//     binary and not on the 1359-byte shim.
// ---------------------------------------------------------------------------
test("7b: the approved digest selects this host's signed docker.exe (integration)", (t) => {
  if (!IS_WIN) return t.skip("win32-only");
  const pre = approvedDockerPrerequisite();
  if (pre.kind !== "approved-present") return t.skip(skipReason(pre));
  const r = resolveRuntimeExecutableUnderPin("docker", []);
  assert.equal(r.ok, true, "the reviewed build is present, so the pin must resolve (got " + r.reasonCode + ")");
  assert.equal(r.value.basename, "docker.exe", "the selected artifact must be the PE binary");
  assert.notEqual(r.value.identity[0].sizeBytes, 1359, "the 1359-byte sh shim must never be the selected artifact");
  assert.equal(r.value.identity.length, 1, "docker is a single-artifact resolution");
  const unpinned = resolveTrustedExecutable("docker", { workspaceRoots: [] });
  if (unpinned.ok && unpinned.value.basename !== "docker.exe") {
    assert.equal(unpinned.value.executionAuthorized, false, "an unpinned shim resolution must never be authorized");
  }
});

// ---------------------------------------------------------------------------
// 8 + 9. Capability-report truthfulness. Hermetic.
// ---------------------------------------------------------------------------
test("8: a detected-but-unauthorized runtime is NOT reported as absent", (t) => {
  if (!IS_WIN) return t.skip("win32-only: the unauthorized state is a win32 provenance outcome");
  const fake = fakeRuntimeDir("docker.exe", "detected-but-unpinned-bytes");
  const report = detectContainerRuntime({ probe: true, searchPath: fake.dir });
  assert.equal(report.backendId, "docker", "a resolvable candidate must be reported as found");
  assert.notEqual(report.detectionDetail, "no container runtime found", "the false absence claim must not reappear");
  assert.equal(report.detectionMethod, "executable-probe");
  assert.equal(report.capabilityState, "available-unverified");
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
  const root = realpathSync(mkdtempSync(join(tmpdir(), "namla-ws-")));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "namla-outside-")));
  const probe = join(root, "probe");
  mkdirSync(probe, { recursive: true });
  const executor = composeVerificationSandbox({ workspaceHostPath: outside, authorizedMountRoots: [root], probeWorkspaceHostPath: probe });
  assert.equal(executor, null, "a workspace outside the authorized roots can never yield an executor");
  assert.equal(composeVerificationSandbox({ workspaceHostPath: join(root, "ws"), authorizedMountRoots: [], probeWorkspaceHostPath: probe }), null);
});

// ---------------------------------------------------------------------------
// 11. INTEGRATION: correct trust makes the real isolation path REACHABLE.
// ---------------------------------------------------------------------------
test("11: with the approved pin, verifyIsolation gets past the authorization gate (integration)", (t) => {
  if (!IS_WIN) return t.skip("win32-only: POSIX never had the authorization blocker");
  const pre = approvedDockerPrerequisite();
  if (pre.kind !== "approved-present") return t.skip(skipReason(pre));
  const r = resolveRuntimeExecutableUnderPin("docker", []);
  assert.equal(r.ok && r.value.executionAuthorized, true, "the reviewed build is present, so the pin must authorize it (got " + r.reasonCode + ")");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "namla-iso-")));
  const ws = join(root, "workspace");
  const probe = join(root, "probe");
  mkdirSync(ws, { recursive: true });
  mkdirSync(probe, { recursive: true });
  const backend = new DockerContainerSandboxBackend({ probeWorkspaceHostPath: probe, authorizedMountRoots: [root, probe] });
  const iso = backend.verifyIsolation();
  assert.notEqual(iso.detectionDetail, "runtime not authorized for execution", "the authorization gate must no longer be the blocker");
  assert.notEqual(iso.detectionDetail, "runtime not resolvable", "the runtime must resolve");
  if (!iso.verified) {
    assert.equal(Object.values(iso.claims).some((c) => c === true), false, "an unverified report claims nothing");
  }
});

// ---------------------------------------------------------------------------
// 12 + 13. SKIP TRUTHFULNESS (R0N). The eligibility rule itself is tested,
//    because an integration skip is only honest if it cannot absorb a real
//    refusal. Test 12 is the assertion that a non-approved Docker is REFUSED -
//    it runs on every win32 host, so that fact never depends on 1b/7b/11.
// ---------------------------------------------------------------------------
test("12: a non-approved Docker is refused and unauthorized, never quietly trusted", (t) => {
  if (!IS_WIN) return t.skip("win32-only");
  const notApproved = fakeRuntimeDir("docker.exe", "a-different-docker-build");
  assert.notEqual(notApproved.digest, REVIEWED_DOCKER_SHA256, "the fixture must not accidentally be the reviewed build");
  const pinned = resolveTrustedExecutable("docker", { workspaceRoots: [], searchPath: notApproved.dir, expectedSha256: REVIEWED_DOCKER_SHA256 });
  assert.equal(pinned.ok, false, "a Docker that is not the reviewed build must be refused under the pin");
  assert.equal(pinned.reasonCode, "hash-mismatch", "and refused for the true reason");
  const discovered = resolveTrustedExecutable("docker", { workspaceRoots: [], searchPath: notApproved.dir });
  assert.equal(discovered.ok, true, "the binary is still discoverable");
  assert.equal(discovered.value.executionAuthorized, false, "but it carries no execution authority");
});

test("13: the integration prerequisite reports a real state, never a blanket absence", () => {
  const pre = approvedDockerPrerequisite();
  assert.equal(["no-candidate", "candidate-not-approved", "approved-present"].includes(pre.kind), true, "the prerequisite must be one of the three named states");
  const unpinned = resolveTrustedExecutable("docker", { workspaceRoots: [] });
  assert.equal(pre.kind === "no-candidate", !unpinned.ok, "no-candidate must mean exactly that nothing resolved");
  if (pre.kind !== "no-candidate") {
    const pinned = resolveRuntimeExecutableUnderPin("docker", []);
    assert.equal(pre.kind === "approved-present", pinned.ok, "approved-present must mean exactly that the pin resolved");
  }
  const reason = skipReason(pre);
  assert.equal(reason.startsWith("integration:"), true, "a skip reason must declare it is an integration prerequisite");
  assert.equal(reason.length > 30, true, "a skip reason must be specific, not a bare word");
});
