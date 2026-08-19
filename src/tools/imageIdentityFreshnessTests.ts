/**
 * imageIdentityFreshnessTests — S-15. Proof that container verification is
 * bound to an IMMUTABLE image identity, and that verification evidence cannot
 * outlive the image it was about.
 *
 * THE DEFECT. The approved reference is `namla-sandbox:v1` — a name and a TAG.
 * `IMAGE_DIGEST` is empty and `REQUIRE_PINNED_IMAGE` is false, so nothing was
 * digest-pinned, and the CI job builds that exact tag with `docker build`. Four
 * things followed:
 *
 *   1. `imageAvailable()` ran `docker image inspect <tag>` and returned only
 *      `out.status === 0`. The one command that could have said WHICH image was
 *      present threw its output away, so no identity was ever recorded.
 *   2. `buildContainerRunArgs` pushed the TAG, so the daemon re-resolved the
 *      name at run time — after verification had finished.
 *   3. `lastVerification` was cached with NO invalidation. `execute()` gated on
 *      `capabilityState === "available-and-verified"` and never looked again.
 *   4. `detectCapability()` returned that cached verified report to ANY caller,
 *      forever, without re-checking the image at all.
 *
 * Together: isolation could be proven against image A, the tag rebuilt to image
 * B, and B then executed — or merely REPORTED as verified — under A's evidence.
 *
 * THE IDENTITY MODEL, and why it is not a matter of taste. `docker image
 * inspect` reports two different digests:
 *
 *   Id              digest of the image CONFIG blob = the LOCAL IMAGE ID. Every
 *                   locally present image has one, `docker build` included.
 *                   A bare `sha256:<hex>` argument is parsed as an image ID, so
 *                   this is the value that can actually be RUN.
 *   RepoDigests[n]  `repository@sha256:<hex>` = digest of the MANIFEST, as a
 *                   registry addresses it. Present only after a push or pull.
 *
 * The manifest is a document that contains the config digest as a field, so
 * hashing it cannot produce that same value — the two digests are necessarily
 * different strings for one image. Therefore stripping `repository@` and
 * running the remainder addresses NOTHING locally, and preferring the repo
 * digest would make the identity string change when a push happens with the
 * content untouched. So `localImageId` is the single canonical content identity
 * and the execution reference; `repoDigest` is optional provenance, kept whole.
 *
 * NOTHING REAL RUNS HERE. No container is started and no runtime is required —
 * this host has neither docker nor podman. Identity parsing and the freshness
 * gate are pure, and the backend paths under test refuse before any spawn.
 *
 * Run: node --test dist/tools/imageIdentityFreshnessTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import {
  parseImageIdentity,
  sameImageIdentity,
  imageExecutionReference,
  freshVerificationReport,
  approvedImageReference,
  imageIsPinned,
  buildContainerRunArgs,
  DockerContainerSandboxBackend,
  IMAGE_REPOSITORY,
  IMAGE_TAG,
  CONTAINER_WORKSPACE_MOUNT,
  type ContainerRunSpec,
  type ImageIdentityResolution,
  type ResolvedImageIdentity,
} from "../cognitive/containerSandboxBackend";
import { NO_ISOLATION_CLAIMS, type SandboxCapabilityReport } from "../cognitive/sandboxPolicy";
import { validateMountSource, type CanonicalMountSource } from "../cognitive/safeMountSource";

const BACKEND_SRC = readFileSync("src/cognitive/containerSandboxBackend.ts", "utf8");

/** Config digests: the local image IDs of two DIFFERENT images. */
const ID_A = `sha256:${"a".repeat(64)}`;
const ID_B = `sha256:${"b".repeat(64)}`;
/** A MANIFEST digest — a different value from either config digest above. */
const MANIFEST_A = `sha256:${"c".repeat(64)}`;

/** `docker image inspect` output shape, with only the fields that matter. */
function inspectJson(over: { Id?: unknown; RepoDigests?: unknown } = {}): string {
  return JSON.stringify([{ Id: ID_A, RepoDigests: [], ...over }]);
}

/** The identity of a locally built image: an Id, and no registry provenance. */
function localIdentity(localImageId: string, repoDigest: string | null = null): ResolvedImageIdentity {
  return { localImageId, repoDigest };
}

function resolved(identity: ResolvedImageIdentity): ImageIdentityResolution {
  return { ok: true, identity, reasonCode: "ok" };
}

const UNRESOLVED: ImageIdentityResolution = { ok: false, identity: null, reasonCode: "sandbox-image-unavailable" };

/** A cached capability report in a given state, shaped like a real one. */
function cachedReport(capabilityState: SandboxCapabilityReport["capabilityState"]): SandboxCapabilityReport {
  const verified = capabilityState === "available-and-verified";
  return {
    backendId: "docker",
    capabilityState,
    available: capabilityState !== "unavailable",
    verified,
    detectionMethod: verified ? "isolation-probe" : "executable-probe",
    detectionDetail: verified ? "all isolation properties verified in a real container" : "detected",
    claims: NO_ISOLATION_CLAIMS,
    safeReasonCode: verified ? "ok" : "sandbox-capability-unverified",
  };
}

/**
 * A canonical mount source, produced by the real validator rather than cast —
 * the brand exists precisely so an unchecked path cannot reach argv.
 */
function canonicalSource(): CanonicalMountSource {
  const v = validateMountSource(process.cwd(), [process.cwd()], "workspace");
  assert.equal(v.ok, true, "the repository root must validate as a mount source");
  return (v as { ok: true; canonicalPath: CanonicalMountSource }).canonicalPath;
}

function runSpec(imageRef: string, over: Partial<ContainerRunSpec> = {}): ContainerRunSpec {
  return {
    workspaceHostPath: canonicalSource(),
    sourceHostPath: null,
    probeHostPath: null,
    imageRef,
    cpuLimit: 1,
    memoryLimitMb: 512,
    pidLimit: 64,
    timeoutSeconds: 60,
    networkMode: "none",
    containerName: "namla-s15-test",
    userIdentity: { uid: 1001, gid: 1001 },
    command: ["node", "--version"],
    ...over,
  };
}

/** The source text of ONE method body, for structural wiring assertions. */
function methodBody(signature: string): string {
  const start = BACKEND_SRC.indexOf(signature);
  assert.notEqual(start, -1, `method not found: ${signature}`);
  const rest = BACKEND_SRC.slice(start);
  // Methods here are indented two spaces, so the closing brace is the first
  // line that is exactly "  }".
  const end = rest.indexOf("\n  }");
  assert.notEqual(end, -1, `method end not found: ${signature}`);
  return rest.slice(0, end);
}

// ==================================== IDENTITY IS RESOLVED, NOT ASSUMED =====

test("S15-1: a normal unchanged approved image resolves and verifies its identity", () => {
  const r = parseImageIdentity(inspectJson());
  assert.equal(r.ok, true, "a well-formed inspect resolves");
  assert.equal(r.identity?.localImageId, ID_A);
  assert.equal(r.identity?.repoDigest, null, "a locally built image has no registry provenance");
  assert.equal(r.reasonCode, "ok");

  // A registry-sourced image ALSO resolves by its local image ID; the repo
  // digest is recorded alongside it, never instead of it.
  const pushed = parseImageIdentity(inspectJson({ RepoDigests: [`${IMAGE_REPOSITORY}@${MANIFEST_A}`] }));
  assert.equal(pushed.identity?.localImageId, ID_A, "the execution identity is still the image ID");
  assert.equal(pushed.identity?.repoDigest, `${IMAGE_REPOSITORY}@${MANIFEST_A}`, "provenance is kept whole");
});

test("S15-2: the mutable tag alone is never accepted as immutable proof", () => {
  const ref = approvedImageReference();
  assert.equal(ref, `${IMAGE_REPOSITORY}:${IMAGE_TAG}`, "the approved reference is a TAG today");
  assert.equal(imageIsPinned(), false, "and it is not digest-pinned");

  // A tag can never satisfy the identity parser: it is not inspect output at
  // all, and nothing in the parser falls back to the reference.
  assert.equal(parseImageIdentity(ref).ok, false, "a tag string is not an identity");
  assert.equal(parseImageIdentity(JSON.stringify([{ Id: ref }])).ok, false, "a tag in the Id field is not a digest");
  assert.equal(parseImageIdentity(JSON.stringify([{ Id: `${IMAGE_REPOSITORY}:${IMAGE_TAG}`, RepoDigests: [`${IMAGE_REPOSITORY}:${IMAGE_TAG}`] }])).ok, false);

  // And the tag never reaches argv.
  const args = buildContainerRunArgs(runSpec(ID_A));
  assert.equal(args.includes(ref), false, "the mutable tag must not be in the run argv");
  assert.equal(args.includes(ID_A), true, "the immutable identity is");
});

test("S15-3: verification records the immutable identity it proved", () => {
  // Structural: the verified branch stores the resolved identity, and the probe
  // container is started by that identity's execution reference.
  assert.match(BACKEND_SRC, /this\.verifiedImageIdentity = imageIdentity\.identity;/, "the proven identity is recorded");
  assert.match(BACKEND_SRC, /imageRef: imageExecutionReference\(imageIdentity\.identity\),/, "the probe runs by that identity");
  assert.match(BACKEND_SRC, /get verifiedImage\(\): ResolvedImageIdentity \| null/, "and it is observable as provenance");

  // A backend that has verified nothing exposes no provenance — never a guess.
  const backend = new DockerContainerSandboxBackend({ probeWorkspaceHostPath: "" });
  assert.equal(backend.verifiedImage, null, "no verification, no identity");
});

test("S15-4: the same immutable identity remains valid", () => {
  const a = localIdentity(ID_A);
  assert.equal(sameImageIdentity(a, localIdentity(ID_A)), true);
  // Equality is over CONTENT, not object identity.
  assert.equal(sameImageIdentity(a, { ...a }), true);
});

// ================================================ STALENESS IS DETECTED =====

test("S15-5: a tag retarget after verification is detected", () => {
  // The same tag now resolves to different content: different Id, same name.
  const before = parseImageIdentity(inspectJson({ Id: ID_A }));
  const after = parseImageIdentity(inspectJson({ Id: ID_B }));
  assert.equal(before.ok && after.ok, true);
  assert.equal(sameImageIdentity(before.identity, after.identity), false, "a rebuilt tag is not the verified image");

  // And execute() compares exactly that, before building any argv.
  assert.match(BACKEND_SRC, /const currentImage = this\.resolveImageIdentity\(resolved\.value\.command\);/, "execution re-resolves");
  assert.match(BACKEND_SRC, /if \(!sameImageIdentity\(currentImage\.identity, this\.verifiedImageIdentity\)\)/, "and compares to the verified identity");
});

test("S15-6: an identity mismatch blocks execution with a reason that names it", () => {
  assert.match(BACKEND_SRC, /return blocked\("sandbox-image-identity-changed"\)/, "a mismatch blocks");
  // The reason is distinct from every neighbouring fault, so a reader is not
  // sent to the runtime, the capability, or a missing image.
  for (const wrong of ["sandbox-runtime-unavailable", "sandbox-capability-unverified", "sandbox-image-unavailable", "sandbox-image-unpinned"]) {
    assert.notEqual("sandbox-image-identity-changed", wrong);
  }
});

test("S15-7: a missing or unresolvable identity fails closed", () => {
  for (const bad of ["", "   ", "[]", "null", "{}", "[{}]", '[{"Id":null}]', '[{"Id":123}]']) {
    const r = parseImageIdentity(bad);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} must not resolve`);
    assert.equal(r.identity, null);
    assert.equal(r.reasonCode, "sandbox-image-unavailable");
  }
  // An image with registry provenance but NO local Id is still refused: there
  // would be nothing runnable, and a manifest digest is not a substitute.
  assert.equal(parseImageIdentity(JSON.stringify([{ RepoDigests: [`${IMAGE_REPOSITORY}@${MANIFEST_A}`] }])).ok, false, "provenance alone is not an identity");

  // A null identity never matches anything, so absence cannot pass a comparison.
  assert.equal(sameImageIdentity(null, null), false, "two unknowns are not a match");
  assert.equal(sameImageIdentity(localIdentity(ID_A), null), false);
});

test("S15-8: malformed inspect output fails closed", () => {
  for (const bad of ["not json", "{", "[{", '[{"Id":"sha256:short"}]', `[{"Id":"sha256:${"g".repeat(64)}"}]`, `[{"Id":"${ID_A.toUpperCase()}"}]`, `[{"Id":"md5:${"a".repeat(32)}"}]`]) {
    const r = parseImageIdentity(bad);
    assert.equal(r.ok, false, `${bad.slice(0, 40)} must not resolve`);
    assert.equal(r.reasonCode, "sandbox-image-unavailable");
  }
  // A RepoDigest for a DIFFERENT repository proves nothing about this image and
  // must not be adopted as provenance; the local Id is unaffected either way.
  const foreign = parseImageIdentity(inspectJson({ RepoDigests: [`somewhere-else@${MANIFEST_A}`] }));
  assert.equal(foreign.identity?.localImageId, ID_A);
  assert.equal(foreign.identity?.repoDigest, null, "a foreign repo digest is ignored");
  // A malformed provenance entry is dropped, not fatal — the runnable identity
  // is the Id, and provenance is optional by construction.
  const malformed = parseImageIdentity(inspectJson({ RepoDigests: [`${IMAGE_REPOSITORY}@sha256:short`, 7, null] }));
  assert.equal(malformed.identity?.localImageId, ID_A);
  assert.equal(malformed.identity?.repoDigest, null);
});

test("S15-9: verification evidence for image A cannot authorize image B", () => {
  assert.equal(sameImageIdentity(localIdentity(ID_A), localIdentity(ID_B)), false);

  // Structural: a mismatch also DROPS the stale claim, so it cannot be reused
  // by a later call or reported by detectCapability().
  assert.match(BACKEND_SRC, /this\.invalidateVerification\(\);\s*\n\s*return blocked\("sandbox-image-identity-changed"\)/, "a mismatch invalidates the cached verification");
  assert.match(BACKEND_SRC, /private invalidateVerification\(\): void \{\s*\n\s*this\.lastVerification = null;\s*\n\s*this\.verifiedImageIdentity = null;/, "both fields are cleared together");
});

test("S15-10: execution-time re-resolution is mandatory and precedes argv", () => {
  const body = methodBody("  execute(permit: SandboxExecutionPermit): SandboxExecutionReceipt {");
  const resolveIdx = body.indexOf("const currentImage = this.resolveImageIdentity(");
  const argvIdx = body.indexOf("const args = buildContainerRunArgs({");
  assert.ok(resolveIdx > 0, "execution re-resolves the identity");
  assert.ok(resolveIdx < argvIdx, "and does so BEFORE any argv exists");
  // The argv then uses the freshly resolved identity, not the stored one and
  // not the tag — so what is checked is what runs.
  assert.match(body.slice(argvIdx), /imageRef: imageExecutionReference\(currentImage\.identity\),/);
});

test("S15-11: no implicit pull can occur", () => {
  const args = buildContainerRunArgs(runSpec(ID_A));
  assert.equal(args.includes("--pull"), true, "a pull policy is stated explicitly");
  assert.equal(args[args.indexOf("--pull") + 1], "never", "and it refuses to fetch");

  // Structurally stronger than the flag: the image is addressed by local image
  // ID, which is not a registry reference that could be fetched at all.
  const imageArg = args.find((a) => a.startsWith("sha256:"));
  assert.equal(imageArg, ID_A);
  assert.equal(imageArg?.includes("/"), false, "no registry host or path is present");
  assert.equal(imageArg?.includes("@"), false, "and no repository@digest form");

  // Identity resolution itself only ever inspects — it never pulls.
  assert.match(BACKEND_SRC, /\["image", "inspect", approvedImageReference\(\)\]/, "resolution is a local inspect");
  assert.equal(/spawnSync\([^)]*"pull"/.test(BACKEND_SRC), false, "the backend never runs a pull command");
});

test("S15-12: detection is still not verification", () => {
  const backend = new DockerContainerSandboxBackend({ probeWorkspaceHostPath: "" });
  const detected = backend.detectCapability();
  assert.notEqual(detected.capabilityState, "available-and-verified", "detection alone never verifies");
  assert.equal(detected.verified, false);
  assert.deepEqual(detected.claims, NO_ISOLATION_CLAIMS);
  // Detection performs no identity resolution and therefore asserts no
  // provenance — it cannot be mistaken for proof about an image.
  assert.equal(backend.verifiedImage, null);
});

test("S15-13: provenance is safe and immutable, and only that", () => {
  const r = parseImageIdentity(inspectJson({ RepoDigests: [`${IMAGE_REPOSITORY}@${MANIFEST_A}`] }));
  const identity = r.identity as ResolvedImageIdentity;
  // Exactly two fields, both safe: a content address and optional provenance.
  assert.deepEqual(Object.keys(identity).sort(), ["localImageId", "repoDigest"]);
  assert.match(identity.localImageId, /^sha256:[0-9a-f]{64}$/, "a content address, never a tag or a path");
  assert.match(identity.repoDigest as string, /^[a-z0-9-]+@sha256:[0-9a-f]{64}$/, "provenance keeps its repository");
});

test("S15-14: no raw inspect output leaks into the identity", () => {
  const leaky = inspectJson({
    Id: ID_A,
    Config: { Env: ["AWS_SECRET_ACCESS_KEY=abc", "TOKEN=sk-live-DEADBEEF"], Image: "/home/akel/secret" },
    GraphDriver: { Data: { UpperDir: "C:\\Users\\akel\\.docker\\overlay" } },
  } as { Id: string });
  const r = parseImageIdentity(leaky);
  assert.equal(r.ok, true);
  const serialized = JSON.stringify(r);
  for (const forbidden of ["AWS_SECRET", "sk-live", "DEADBEEF", "/home/", "C:\\", "overlay", "Env", "GraphDriver"]) {
    assert.equal(serialized.includes(forbidden), false, `identity must not carry ${forbidden}: ${serialized}`);
  }
});

test("S15-15: existing real-container success semantics remain valid", () => {
  // The approved reference still names the same repository and tag, so the CI
  // build and the local inspect are unchanged. S-15 changes WHAT is trusted as
  // evidence, not which image is approved.
  assert.equal(approvedImageReference(), `${IMAGE_REPOSITORY}:${IMAGE_TAG}`);
  assert.equal(IMAGE_REPOSITORY, "namla-sandbox");
  assert.equal(IMAGE_TAG, "v1");

  // The run argv still carries every production flag, in a shape unchanged
  // apart from the image position and the explicit pull refusal.
  const args = buildContainerRunArgs(runSpec(ID_A));
  assert.equal(args[0], "run");
  assert.equal(args.includes("--rm"), true);
  assert.equal(args.join(" ").includes("--network none"), true);
  assert.equal(args.includes("--workdir"), true);
  assert.equal(args[args.indexOf("--workdir") + 1], CONTAINER_WORKSPACE_MOUNT);
  // The command still follows the image as discrete argv entries.
  const imageIdx = args.indexOf(ID_A);
  assert.deepEqual(args.slice(imageIdx + 1), ["node", "--version"]);
});

test("S15-16: a legitimate rebuild verifies only under its NEW identity", () => {
  // A rebuild is not forbidden — it is simply a different image, and the old
  // evidence does not transfer to it. Re-verification must resolve the new
  // identity and record that one.
  const rebuilt = parseImageIdentity(inspectJson({ Id: ID_B }));
  assert.equal(rebuilt.ok, true, "the rebuilt image resolves normally");
  assert.equal(rebuilt.identity?.localImageId, ID_B);
  assert.equal(sameImageIdentity(rebuilt.identity, localIdentity(ID_A)), false, "it is not the old image");

  // verifyIsolation resolves BEFORE the probe and stores what it proved, so a
  // fresh run binds to the new identity rather than reusing the old record.
  const body = methodBody("  verifyIsolation(): SandboxCapabilityReport {");
  const resolveIdx = body.indexOf("const imageIdentity = this.resolveImageIdentity(runtime);");
  const probeIdx = body.indexOf("const out = spawnSync(runtime, args,");
  const recordIdx = body.indexOf("this.verifiedImageIdentity = imageIdentity.identity;");
  assert.ok(resolveIdx > 0 && probeIdx > resolveIdx, "identity is resolved before the probe runs");
  assert.ok(recordIdx > probeIdx, "and recorded only after the probe proved it");
});

// ============================ THE CAPABILITY-QUERY FRESHNESS GAP (S-15b) =====

test("S15-17: the freshness gate costs nothing when there is no verified claim", () => {
  // The gate runs on EVERY detectCapability() call, so it must not spend a
  // subprocess when there is no claim that could be stale. The thunk is the
  // mechanism, and this proves it stays unpulled.
  let resolves = 0;
  const count = (): ImageIdentityResolution => {
    resolves += 1;
    return resolved(localIdentity(ID_A));
  };

  for (const cached of [null, cachedReport("available-unverified"), cachedReport("unavailable")]) {
    const f = freshVerificationReport(cached, null, count);
    assert.equal(f.report, null, "an unverified cache yields no report to reuse");
    assert.equal(f.invalidate, false, "and there is nothing to invalidate");
  }
  assert.equal(resolves, 0, "no identity resolution happens without a verified claim");
});

test("S15-18: verify A, retarget to B, then detectCapability() must not report verified", () => {
  const verifiedForA = cachedReport("available-and-verified");

  // The exact sequence: isolation proved image A, the tag now resolves to B,
  // and execute() has NOT been called. The capability QUERY must still refuse.
  const stale = freshVerificationReport(verifiedForA, localIdentity(ID_A), () => resolved(localIdentity(ID_B)));
  assert.equal(stale.report, null, "stale verified evidence must not be returned");
  assert.equal(stale.invalidate, true, "and it must be dropped");

  // Unchanged content still passes, so the check is a freshness test and not a
  // blanket refusal that would make verification useless.
  const fresh = freshVerificationReport(verifiedForA, localIdentity(ID_A), () => resolved(localIdentity(ID_A)));
  assert.equal(fresh.report, verifiedForA, "an unchanged image keeps its verification");
  assert.equal(fresh.invalidate, false);

  // Unresolvable now — image removed, runtime gone, inspect malformed. Absence
  // is not proof of sameness.
  const gone = freshVerificationReport(verifiedForA, localIdentity(ID_A), () => UNRESOLVED);
  assert.equal(gone.report, null, "an unresolvable image cannot keep its verification");
  assert.equal(gone.invalidate, true);

  // A verified claim with no recorded identity is unprovable and is dropped.
  const unpaired = freshVerificationReport(verifiedForA, null, () => resolved(localIdentity(ID_A)));
  assert.equal(unpaired.report, null, "a verified claim must name the image it was about");
  assert.equal(unpaired.invalidate, true);

  // Structural: detectCapability() actually routes through this gate and acts
  // on both of its outputs, rather than reading the cache directly.
  const body = methodBody("  detectCapability(): SandboxCapabilityReport {");
  assert.match(body, /freshVerificationReport\(this\.lastVerification, this\.verifiedImageIdentity, \(\) => this\.currentImageIdentity\(\)\)/, "detection consults the freshness gate");
  assert.match(body, /if \(freshness\.invalidate\) this\.invalidateVerification\(\);/, "and drops stale evidence");
  assert.equal(body.includes("if (this.lastVerification && this.lastVerification.capabilityState ==="), false, "the unchecked cache read is gone");
});

test("S15-19: freshness may invalidate verification but can never create it", () => {
  const verifiedForA = cachedReport("available-and-verified");

  // The whole security property in one line: the ONLY report this gate can
  // return is the object it was handed. There is no input for which it
  // manufactures a verified state, so image B can never become verified by
  // being looked at — only by having its own isolation proven.
  const inputs: ReadonlyArray<[SandboxCapabilityReport | null, ResolvedImageIdentity | null, ImageIdentityResolution]> = [
    [verifiedForA, localIdentity(ID_A), resolved(localIdentity(ID_A))],
    [verifiedForA, localIdentity(ID_A), resolved(localIdentity(ID_B))],
    [verifiedForA, localIdentity(ID_B), resolved(localIdentity(ID_B))],
    [verifiedForA, null, resolved(localIdentity(ID_B))],
    [verifiedForA, localIdentity(ID_A), UNRESOLVED],
    [cachedReport("available-unverified"), localIdentity(ID_B), resolved(localIdentity(ID_B))],
    [cachedReport("unavailable"), null, UNRESOLVED],
    [null, localIdentity(ID_B), resolved(localIdentity(ID_B))],
  ];
  for (const [cached, verifiedIdentity, current] of inputs) {
    const f = freshVerificationReport(cached, verifiedIdentity, () => current);
    if (f.report !== null) {
      assert.equal(f.report, cached, "a returned report is ALWAYS the cached object, never a new one");
      assert.equal(f.invalidate, false, "a report that stands is not simultaneously dropped");
    }
    // Nothing verified may come back for an image that was not the verified one.
    if (f.report !== null && f.report.capabilityState === "available-and-verified") {
      assert.equal(sameImageIdentity(current.identity, verifiedIdentity), true, "only the SAME image keeps a verified report");
    }
  }

  // Structural: the gate contains no construction of a capability report, and
  // detection's only other source is detectContainerRuntime(), whose states are
  // `available-unverified` and `unavailable` — never verified.
  const gate = BACKEND_SRC.slice(BACKEND_SRC.indexOf("export function freshVerificationReport("));
  const gateBody = gate.slice(0, gate.indexOf("\n}"));
  assert.equal(gateBody.includes("available-and-verified\";"), false, "the gate never assigns a verified state");
  assert.equal(/report:\s*\{/.test(gateBody), false, "the gate never builds a report object");
  assert.equal((gateBody.match(/report: cached/g) ?? []).length, 1, "exactly one place returns a report, and it is the cached one");

  const detect = methodBody("  detectCapability(): SandboxCapabilityReport {");
  assert.equal(detect.includes("available-and-verified"), false, "detection names no verified state");
  assert.equal(/this\.lastVerification\s*=[^=]/.test(detect), false, "detection never writes a verification");
  assert.equal(/this\.verifiedImageIdentity\s*=[^=]/.test(detect), false, "nor an identity");
  assert.match(detect, /return detectContainerRuntime\(\);/, "the fallback is plain detection");

  // And verifyIsolation remains the only writer of the verified state.
  const writers = (BACKEND_SRC.match(/this\.lastVerification = (?!null)/g) ?? []).length;
  assert.equal(writers, 1, `exactly one non-null writer of lastVerification, found ${writers}`);
});

test("S15-20: identical content stays verified when only provenance changes", () => {
  // A push populates RepoDigests without altering one byte of the image. That
  // is a provenance change, not a content change, and must not read as a
  // retarget — a freshness check that cries wolf is one that gets relaxed.
  const beforePush = localIdentity(ID_A, null);
  const afterPush = localIdentity(ID_A, `${IMAGE_REPOSITORY}@${MANIFEST_A}`);
  assert.equal(sameImageIdentity(beforePush, afterPush), true, "same image ID means same content");
  assert.equal(sameImageIdentity(afterPush, beforePush), true, "and the rule is symmetric");

  // So a verified report survives the push.
  const verified = cachedReport("available-and-verified");
  const f = freshVerificationReport(verified, beforePush, () => resolved(afterPush));
  assert.equal(f.report, verified, "provenance metadata alone does not invalidate");
  assert.equal(f.invalidate, false);

  // Two different repo digests over the same content are still the same image.
  assert.equal(sameImageIdentity(afterPush, localIdentity(ID_A, `${IMAGE_REPOSITORY}@sha256:${"d".repeat(64)}`)), true);
});

test("S15-21: a different local image identity invalidates cached verification", () => {
  // The converse of S15-20, and the one that must never be relaxed: different
  // immutable content is never equal, whatever the provenance says.
  assert.equal(sameImageIdentity(localIdentity(ID_A), localIdentity(ID_B)), false);
  // Even when both carry the SAME repo digest — a contradiction that must
  // resolve in favour of the content identity, not the metadata.
  const sameProvenance = `${IMAGE_REPOSITORY}@${MANIFEST_A}`;
  assert.equal(sameImageIdentity(localIdentity(ID_A, sameProvenance), localIdentity(ID_B, sameProvenance)), false, "matching provenance cannot make different content equal");

  const verified = cachedReport("available-and-verified");
  const f = freshVerificationReport(verified, localIdentity(ID_A, sameProvenance), () => resolved(localIdentity(ID_B, sameProvenance)));
  assert.equal(f.report, null, "changed content drops the cached verification");
  assert.equal(f.invalidate, true);

  // Changed content AND changed provenance: still a mismatch.
  assert.equal(sameImageIdentity(localIdentity(ID_A, sameProvenance), localIdentity(ID_B, `${IMAGE_REPOSITORY}@sha256:${"e".repeat(64)}`)), false);
});

test("S15-22: RepoDigest and local image Id are never conflated", () => {
  const r = parseImageIdentity(inspectJson({ Id: ID_A, RepoDigests: [`${IMAGE_REPOSITORY}@${MANIFEST_A}`] }));
  const identity = r.identity as ResolvedImageIdentity;

  // Two separate fields holding two DIFFERENT digests of two different objects:
  // the config blob and the manifest. They are never the same value.
  assert.equal(identity.localImageId, ID_A);
  assert.equal(identity.repoDigest, `${IMAGE_REPOSITORY}@${MANIFEST_A}`);
  assert.notEqual(identity.localImageId, identity.repoDigest);

  // The repo digest keeps its repository context and is NOT reduced to a bare
  // digest. A bare manifest digest would address nothing locally, because a
  // bare `sha256:` reference is looked up as an image ID.
  assert.equal(identity.repoDigest?.startsWith("sha256:"), false, "provenance is never a bare digest");
  assert.match(identity.repoDigest as string, /^[a-z0-9-]+@sha256:[0-9a-f]{64}$/);
  assert.notEqual(identity.repoDigest, MANIFEST_A, "the repository prefix is never stripped");

  // No code path anywhere converts a repo digest into a bare execution ref.
  assert.equal(/slice\(at \+ 1\)[^)]*source: "repo-digest"/.test(BACKEND_SRC), false);
  assert.equal(BACKEND_SRC.includes('imageId: digest'), false, "the stripped-digest conversion is gone");
  assert.equal(BACKEND_SRC.includes('"repo-digest"'), false, "and so is the ambiguous single-field source tag");

  // Equality consults the content identity ONLY.
  assert.match(BACKEND_SRC, /return a\.localImageId === b\.localImageId;/, "one canonical content identity decides equality");
});

test("S15-23: the execution reference is the identity the real CI image has", () => {
  // The CI job builds the image with a local build and never pushes it, so the
  // real inspect output is an Id with an EMPTY RepoDigests array. That is the
  // shape the execution path must work on — not a hypothetical pushed image.
  const ciShape = parseImageIdentity(inspectJson({ Id: ID_A, RepoDigests: [] }));
  assert.equal(ciShape.ok, true, "the locally built shape resolves");
  const identity = ciShape.identity as ResolvedImageIdentity;
  assert.equal(identity.repoDigest, null, "a locally built image has no registry digest to run by");
  assert.equal(imageExecutionReference(identity), ID_A, "so execution addresses the local image ID");

  // The SAME execution reference is used when provenance does exist, so there
  // is exactly one execution form and no alternate mode that CI never covers.
  const pushed = parseImageIdentity(inspectJson({ Id: ID_A, RepoDigests: [`${IMAGE_REPOSITORY}@${MANIFEST_A}`] }));
  assert.equal(imageExecutionReference(pushed.identity as ResolvedImageIdentity), ID_A, "provenance never changes what is run");

  // Both call sites go through that one function — no field is picked by hand.
  const refSites = (BACKEND_SRC.match(/imageRef: imageExecutionReference\(/g) ?? []).length;
  assert.equal(refSites, 2, `verification and execution both use it, found ${refSites}`);
  assert.equal(/imageRef: [a-zA-Z.]*\.repoDigest/.test(BACKEND_SRC), false, "nothing ever runs a repo digest");

  // And the argv carries a bare image ID, which is what the daemon resolves as
  // an image ID rather than as a repository reference.
  const args = buildContainerRunArgs(runSpec(imageExecutionReference(identity)));
  const imageArg = args[args.length - 3];
  assert.equal(imageArg, ID_A);
  assert.match(imageArg, /^sha256:[0-9a-f]{64}$/);

  // CI asserts this identity against the daemon's own view of the built image,
  // so the execution form is covered by the real container job and not only by
  // this suite.
  const ci = readFileSync(".github/workflows/p0-security.yml", "utf8");
  assert.match(ci, /docker image inspect namla-sandbox:v1 --format '\{\{\.Id\}\}'/, "CI reads the real image ID");
  assert.match(ci, /r\.verifiedLocalImageId!==real/, "and asserts the receipt matches it");
});

test("S15-24: a repository digest is provenance only, never an execution path", () => {
  const identity = localIdentity(ID_A, `${IMAGE_REPOSITORY}@${MANIFEST_A}`);

  // It is recorded and reported. It is not run: the execution reference is the
  // image ID even when a repo digest is present, so `repository@sha256:…`
  // execution is never attempted and needs no independent proof.
  assert.equal(imageExecutionReference(identity), ID_A);
  assert.notEqual(imageExecutionReference(identity), identity.repoDigest);

  // Through the REAL parser, not a hand-built identity: whatever the runtime
  // reported must arrive with its repository intact, and must never become the
  // value that runs. Stripping `repository@` here would produce a bare manifest
  // digest, which addresses nothing locally.
  const parsed = parseImageIdentity(inspectJson({ RepoDigests: [`${IMAGE_REPOSITORY}@${MANIFEST_A}`] })).identity as ResolvedImageIdentity;
  assert.match(parsed.repoDigest as string, /^[a-z0-9-]+@sha256:[0-9a-f]{64}$/, "provenance survives parsing with its repository");
  assert.equal(imageExecutionReference(parsed), ID_A, "the execution reference is still the image ID");
  assert.notEqual(imageExecutionReference(parsed), parsed.repoDigest);

  // It reaches the CI receipt as its own field, distinct from the identity that
  // was executed, so a reader can never mistake one for the other.
  const receiptSrc = readFileSync("src/tools/verifyContainerSandbox.ts", "utf8");
  assert.match(receiptSrc, /verifiedLocalImageId: verifiedImage \? verifiedImage\.localImageId : null,/);
  assert.match(receiptSrc, /verifiedRepoDigest: verifiedImage \? verifiedImage\.repoDigest : null,/);

  // Provenance is never consulted by any trust decision: not by equality, not
  // by the freshness gate, not by argv construction.
  assert.equal(/sameImageIdentity[\s\S]{0,400}repoDigest/.test(BACKEND_SRC), false, "equality never reads provenance");
  const gate = BACKEND_SRC.slice(BACKEND_SRC.indexOf("export function freshVerificationReport("));
  assert.equal(gate.slice(0, gate.indexOf("\n}")).includes("repoDigest"), false, "the freshness gate never reads provenance");
  assert.equal(/buildContainerRunArgs[\s\S]{0,3000}repoDigest/.test(BACKEND_SRC), false, "argv never reads provenance");
});

test("this suite started no container and required no runtime", () => {
  const src = readFileSync("src/tools/imageIdentityFreshnessTests.ts", "utf8");
  const spawns = src
    .split("\n")
    .filter((l) => /(^|[^.\w])spawnSync\(/.test(l))
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !/\.(includes|indexOf|find|test)\(/.test(l));
  assert.equal(spawns.length, 0, `this suite spawns nothing, found ${spawns.length}`);
  for (const runtime of ["docker", "podman"]) {
    for (const verb of ["run", "build", "pull", "create"]) {
      const needle = [runtime, verb].join(" ");
      // Prose lines (the header comment explains the defect, which mentions the
      // build command) are excluded; only executable lines are checked.
      const mentions = src
        .split("\n")
        .filter((l) => l.includes(needle))
        .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.includes("[runtime, verb]"));
      assert.equal(mentions.length, 0, `must not invoke ${needle}: ${mentions.join(" | ").slice(0, 120)}`);
    }
  }
});
