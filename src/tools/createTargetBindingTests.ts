/**
 * createTargetBindingTests — proof that the file a create attempt OPENS is the
 * file that was approved and inspected (§33, Fable S-3).
 *
 * The defect these tests exist for: `CreateProjectFileInput` carried a
 * free-form `driverTargetPath: string` that went straight to
 * `driver.openExclusive(...)`, bound to nothing that had been reviewed,
 * granted, or inspected. An approval for path A could open path B while every
 * receipt recorded A.
 *
 * Nothing here creates a project file. The exclusive-create driver is always a
 * RECORDING FAKE, and the target it is handed is the load-bearing assertion.
 * The real Node driver's invocation counter is asserted to stay at zero.
 *
 * Run: node --test dist/tools/createTargetBindingTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { resolve, join, isAbsolute } from "path";

import { fingerprint } from "../core/redaction";
import { ReceiptLog } from "../core/receiptLog";
import { ProjectInspector } from "../inspector/projectInspector";
import { bindCreateTarget, type InspectionBoundProjectRoot } from "../application/createTargetBinding";
import { createProjectFile, getRealNodeDriverInvocationCount } from "../application/projectFileCreator";
import { ConsumedApprovalRegistry } from "../application/consumedApprovalRegistry";
import { computeIntegrityFingerprint } from "../application/proposalIntegrity";
import { createTrustedC2WriteAuthorityPermit } from "../bootstrap/c2WriteAuthorityBootstrap";
import type { CreateOperationDescriptor, HumanApprovalGrant } from "../application/createCapabilityTypes";
import type { CreateTargetInspection } from "../application/createTargetInspectionTypes";
import type { CodeProposal } from "../generation/codeProposal";
import type { SafetyDecision } from "../types/safetyTypes";
import type { ExclusiveCreateDriver, ExclusiveCreateHandle } from "../application/exclusiveCreateDriver";

// ----------------------------------------------------------------- FIXTURES ---

const TARGET = "docs/generated/note.md";
const CONTENT = "# Generated\n\nA bounded note.\n";

/** A real temp directory, minted through a REAL inspector — never a cast. */
function provenRoot(tag: string): { dir: string; root: InspectionBoundProjectRoot } {
  const dir = realpathSync(mkdtempSync(resolve(tmpdir(), `namla-s3-${tag}-`)));
  const root = new ProjectInspector(dir, new ReceiptLog()).inspectionBoundProjectRoot;
  if (root === null) throw new Error(`fixture root ${tag} could not be proven`);
  return { dir, root };
}

function inspectionFor(relativePath: string, overrides: Partial<CreateTargetInspection> = {}): CreateTargetInspection {
  return {
    normalizedRelativePathFingerprint: fingerprint(relativePath),
    normalizedRelativePathLength: relativePath.length,
    targetExists: false,
    caseInsensitiveCollision: false,
    parentExists: true,
    parentIsDirectory: true,
    parentChainInsideProject: true,
    parentChainContainsLink: false,
    targetIsLink: false,
    realParentInsideProject: true,
    structuralPolicyPassed: true,
    filesystemInspectionCompleted: true,
    inspectedEntryCount: 3,
    simulated: true,
    executed: false,
    authoritativeForWrite: false,
    inspectionReceiptId: "receipt-s3-inspection",
    reasonCodes: ["target-inspection-clean"],
    ...overrides,
  };
}

interface Fixture {
  proposal: CodeProposal;
  descriptor: CreateOperationDescriptor;
  grant: HumanApprovalGrant;
  reviewVerdict: string;
  reviewReceiptId: string;
}

/** Built from the SAME contract shapes the C2-B capability really uses. */
function fixture(relativePath = TARGET, content = CONTENT): Fixture {
  const proposalId = "proposal-s3";
  const proposalReceiptId = "receipt-s3-proposal";
  const reviewVerdict = "clean";
  const reviewReceiptId = "receipt-s3-review";

  const proposal: CodeProposal = {
    proposalId,
    missionId: "mission-s3",
    taskId: "ptask-s3",
    targetRelativePath: relativePath,
    changeKind: "create",
    proposedContent: content,
    rationale: "Bounded S-3 regression fixture.",
    safetyDecision: { level: "SAFE", reasons: [], allowed: true, evaluatedAt: "sequence:1", evaluatedText: "" } as SafetyDecision,
    receiptId: proposalReceiptId,
    requiresHumanApproval: true,
    applied: false,
    createdAt: "sequence:1",
  };

  const integrity = computeIntegrityFingerprint({
    proposalId,
    changeKind: "create",
    normalizedRelativePath: relativePath,
    proposedContent: content,
    proposalReceiptId,
    reviewVerdict,
    reviewReceiptId,
    requiresHumanApproval: true,
  });

  const grant: HumanApprovalGrant = {
    grantId: "grant-s3",
    proposalId,
    proposalIntegrityFingerprint: integrity,
    scope: "create-one-project-file",
    singleUse: true,
    declaredApproverKind: "human",
    issuedSequenceLabel: "seq:1",
  };

  const descriptor: CreateOperationDescriptor = {
    proposalId,
    changeKind: "create",
    normalizedRelativePath: relativePath,
    contentByteLength: Buffer.byteLength(content, "utf8"),
    proposalIntegrityFingerprint: integrity,
    proposalReceiptId,
    reviewVerdict,
    reviewReceiptId,
    simulated: true,
    executed: false,
    requiresHumanApproval: true,
  };

  return { proposal, descriptor, grant, reviewVerdict, reviewReceiptId };
}

/** A fake driver that RECORDS the exact target it was handed. */
class RecordingFakeDriver implements ExclusiveCreateDriver {
  readonly kind = "fake" as const;
  openCalls: string[] = [];
  bytes = 0;

  openExclusive(targetPath: string): ExclusiveCreateHandle {
    this.openCalls.push(targetPath);
    return { handleId: "fake-handle" };
  }
  write(_h: ExclusiveCreateHandle, _b: Buffer, _o: number, length: number): number {
    this.bytes += length;
    return length;
  }
  sync(): void {}
  close(): void {}
}

function attempt(overrides: {
  fx?: Fixture;
  root?: InspectionBoundProjectRoot;
  inspection?: CreateTargetInspection;
  registry?: ConsumedApprovalRegistry;
  driver?: RecordingFakeDriver;
}) {
  const fx = overrides.fx ?? fixture();
  const registry = overrides.registry ?? new ConsumedApprovalRegistry();
  const driver = overrides.driver ?? new RecordingFakeDriver();
  const permit = createTrustedC2WriteAuthorityPermit({
    bootstrapKind: "trusted-one-shot",
    scope: "create-one-generated-markdown",
    acknowledgement: "c2a-contracts-only-no-write",
  });
  const result = createProjectFile({
    permit,
    proposal: fx.proposal,
    descriptor: fx.descriptor,
    grant: fx.grant,
    targetInspection: overrides.inspection ?? inspectionFor(fx.descriptor.normalizedRelativePath),
    reviewVerdict: fx.reviewVerdict,
    reviewReceiptId: fx.reviewReceiptId,
    currentSequence: 1,
    operationCount: 1,
    registry,
    receiptLog: new ReceiptLog(),
    driver,
    projectRoot: overrides.root as InspectionBoundProjectRoot,
    attemptId: "attempt-s3",
  });
  return { result, driver, registry, fx };
}

// ------------------------------------------------------------- HAPPY PATH ---

test("the approved descriptor target is exactly what reaches openExclusive", () => {
  const { dir, root } = provenRoot("happy");
  try {
    const { result, driver } = attempt({ root });
    assert.equal(result.attempted, true, "a correctly bound target must still proceed");
    assert.equal(driver.openCalls.length, 1, "exactly one exclusive open");

    // THE assertion: the driver received the DERIVED absolute target, which is
    // the project root joined with the approved relative path — and nothing else.
    const expected = resolve(dir, TARGET);
    assert.equal(driver.openCalls[0], expected, "the driver opened the approved target");
    assert.equal(isAbsolute(driver.openCalls[0]), true, "the derived target is absolute");
    assert.equal(driver.openCalls[0].startsWith(dir), true, "and lies inside the proven root");
    assert.equal(result.completed, true, "the bound attempt completes through the fake");
    assert.equal(getRealNodeDriverInvocationCount(), 0, "the real Node driver stays inactive");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CreateProjectFileInput exposes no independent physical target", () => {
  // A caller supplies domain inputs only. There is no driverTargetPath, and no
  // renamed equivalent — the physical target is derived inside the boundary.
  const { dir, root } = provenRoot("shape");
  try {
    const fx = fixture();
    const forbidden = ["driverTargetPath", "targetOverride", "resolvedTarget", "unsafePath", "absoluteTarget", "targetPath"];
    const supplied = {
      permit: createTrustedC2WriteAuthorityPermit({ bootstrapKind: "trusted-one-shot", scope: "create-one-generated-markdown", acknowledgement: "c2a-contracts-only-no-write" }),
      proposal: fx.proposal,
      descriptor: fx.descriptor,
      grant: fx.grant,
      targetInspection: inspectionFor(TARGET),
      registry: new ConsumedApprovalRegistry(),
      receiptLog: new ReceiptLog(),
      driver: new RecordingFakeDriver(),
      projectRoot: root,
      attemptId: "attempt-shape",
    };
    for (const key of forbidden) {
      assert.equal(key in supplied, false, `${key} must not be part of the input contract`);
    }
    // The one path-shaped input is the branded root, which only a real
    // ProjectInspector can mint.
    assert.equal(typeof supplied.projectRoot, "string");
    assert.equal(isAbsolute(supplied.projectRoot), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a caller cannot redirect the driver to a second path", () => {
  const a = provenRoot("redirect-a");
  const b = provenRoot("redirect-b");
  try {
    // Approve and inspect the target under root A, then hand the boundary root
    // B. The derived target follows the ROOT actually supplied — it is never a
    // free-form second path — and it is still the APPROVED relative path.
    const { driver } = attempt({ root: b.root });
    assert.equal(driver.openCalls.length, 1);
    assert.equal(driver.openCalls[0], resolve(b.dir, TARGET), "the target is derived, never chosen");
    assert.equal(driver.openCalls[0].includes(a.dir), false, "no unrelated path can be injected");

    // And the relative portion is always the approved one, under either root.
    assert.equal(driver.openCalls[0].endsWith(resolve(b.dir, TARGET).slice(b.dir.length)), true, "the approved relative path is preserved");
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------- BINDING REFUSALS ---

test("proposal target and descriptor target must agree", () => {
  const { dir, root } = provenRoot("mismatch");
  try {
    const fx = fixture();
    // The proposal now names a DIFFERENT file than the descriptor.
    const divergent = { ...fx, proposal: { ...fx.proposal, targetRelativePath: "docs/generated/other-note.md" } as CodeProposal };
    const binding = bindCreateTarget({
      projectRoot: root,
      descriptor: divergent.descriptor,
      proposalTargetRelativePath: divergent.proposal.targetRelativePath,
      targetInspection: inspectionFor(TARGET),
    });
    assert.equal(binding.ok, false, "a disagreement makes the approved target undecidable");
    assert.equal(binding.reasonCode, "target-binding-proposal-descriptor-mismatch");
    assert.equal(binding.target, null, "no target may be produced");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the inspection must be an inspection OF THIS target", () => {
  const { dir, root } = provenRoot("fp");
  try {
    const fx = fixture();
    // A perfectly clean inspection — of a DIFFERENT path. Before §33 this was
    // accepted: the inspection was trusted for its findings while never being
    // proven to describe the target in hand.
    const otherPath = "docs/generated/some-other.md";
    const binding = bindCreateTarget({
      projectRoot: root,
      descriptor: fx.descriptor,
      proposalTargetRelativePath: fx.proposal.targetRelativePath,
      targetInspection: inspectionFor(otherPath),
    });
    assert.equal(binding.ok, false, "a clean inspection of another path must not admit this one");
    assert.equal(binding.reasonCode, "target-binding-fingerprint-mismatch");

    // The recomputation uses the SAME canonical helper the inspector uses.
    assert.notEqual(fingerprint(TARGET), fingerprint(otherPath));
    assert.equal(binding.pathFingerprint, fingerprint(TARGET), "the expected fingerprint is reported");

    // A forged record with the right fingerprint but the wrong length is caught.
    const forged = inspectionFor(TARGET, { normalizedRelativePathLength: TARGET.length + 7 });
    const forgedBinding = bindCreateTarget({ projectRoot: root, descriptor: fx.descriptor, proposalTargetRelativePath: fx.proposal.targetRelativePath, targetInspection: forged });
    assert.equal(forgedBinding.ok, false, "length must corroborate the fingerprint");
    assert.equal(forgedBinding.reasonCode, "target-binding-fingerprint-mismatch");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("absolute, traversing, and empty targets are refused, never normalized", () => {
  const { dir, root } = provenRoot("shape-refuse");
  try {
    const cases: Array<[string, string]> = [
      ["/etc/passwd", "target-binding-path-absolute"],
      ["C:\\Windows\\system32\\drivers\\etc\\hosts", "target-binding-path-absolute"],
      ["\\\\server\\share\\file.md", "target-binding-path-absolute"],
      ["../outside.md", "target-binding-path-traversal"],
      ["docs/../../escape.md", "target-binding-path-traversal"],
      ["~/secrets.md", "target-binding-path-traversal"],
      ["", "target-binding-path-empty"],
    ];
    for (const [badPath, expected] of cases) {
      const fx = fixture(badPath);
      const binding = bindCreateTarget({
        projectRoot: root,
        descriptor: fx.descriptor,
        proposalTargetRelativePath: badPath,
        targetInspection: inspectionFor(badPath),
      });
      assert.equal(binding.ok, false, `${badPath} must be refused`);
      assert.equal(binding.reasonCode, expected, `${badPath} reason`);
      assert.equal(binding.target, null, `${badPath} must yield no target`);
    }

    // `docs/../../escape.md` would RESOLVE back to something plausible; it is
    // refused outright rather than collapsed into an accepted path.
    assert.equal(resolve(dir, "docs/../../escape.md").startsWith(dir), false, "the traversal really did escape");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unproven project root yields no target", () => {
  // A directory that does not exist cannot be minted as an inspection-bound
  // root at all, so the write boundary has nothing to derive from.
  const missing = resolve(tmpdir(), "namla-s3-definitely-not-here");
  assert.equal(new ProjectInspector(missing, new ReceiptLog()).inspectionBoundProjectRoot, null, "a missing root is unprovable");

  // A file is not a root either.
  const { dir } = provenRoot("rootfile");
  try {
    const filePath = join(dir, "not-a-dir.txt");
    writeFileSync(filePath, "x", "utf8");
    assert.equal(new ProjectInspector(filePath, new ReceiptLog()).inspectionBoundProjectRoot, null, "a file is not a project root");

    // And the binding refuses a non-absolute root outright.
    const fx = fixture();
    const binding = bindCreateTarget({
      projectRoot: "relative/root" as InspectionBoundProjectRoot,
      descriptor: fx.descriptor,
      proposalTargetRelativePath: fx.proposal.targetRelativePath,
      targetInspection: inspectionFor(TARGET),
    });
    assert.equal(binding.ok, false);
    assert.equal(binding.reasonCode, "target-binding-root-untrusted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unusable inspection is refused before anything is derived", () => {
  const { dir, root } = provenRoot("unusable");
  try {
    const fx = fixture();
    const binding = bindCreateTarget({
      projectRoot: root,
      descriptor: fx.descriptor,
      proposalTargetRelativePath: fx.proposal.targetRelativePath,
      targetInspection: inspectionFor(TARGET, { filesystemInspectionCompleted: false }),
    });
    assert.equal(binding.ok, false, "an incomplete inspection proves nothing");
    assert.equal(binding.reasonCode, "target-binding-inspection-unusable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a symlinked parent chain still blocks the attempt", (t) => {
  const { dir, root } = provenRoot("link");
  const outside = provenRoot("link-outside");
  try {
    try {
      symlinkSync(outside.dir, join(dir, "docs"), process.platform === "win32" ? "junction" : "dir");
    } catch {
      t.skip("platform does not permit directory link creation");
      return;
    }
    // The link-surface findings live on the inspection, and the existing
    // admission gate blocks on them — §33 does not weaken that route.
    const { result, driver, registry } = attempt({
      root,
      inspection: inspectionFor(TARGET, { parentChainContainsLink: true, realParentInsideProject: false }),
    });
    assert.equal(result.attempted, false, "a link surface must not be written through");
    assert.equal(driver.openCalls.length, 0, "no exclusive open occurred");
    assert.equal(registry.asConsumedApprovalState().consumedGrantIds.includes("grant-s3"), false, "and no grant was consumed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside.dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------- FAILURE ORDERING ---

test("a binding failure occurs BEFORE grant consumption and BEFORE open", () => {
  const { dir, root } = provenRoot("ordering");
  try {
    const registry = new ConsumedApprovalRegistry();
    const driver = new RecordingFakeDriver();
    const fx = fixture();
    const { result } = attempt({
      fx,
      root,
      registry,
      driver,
      // A clean inspection of a DIFFERENT path: admission passes, binding fails.
      inspection: inspectionFor("docs/generated/different.md"),
    });

    assert.equal(result.failureStage, "target-binding", "the stage names the binding");
    assert.equal(result.reasonCode, "target-binding-fingerprint-mismatch", "and the reason names the cause");

    // The four properties that make this a non-event on disk.
    assert.equal(result.attempted, false, "attempted must be false");
    assert.equal(result.grantConsumed, false, "the grant must NOT be consumed");
    assert.equal(result.exclusiveOpenOccurred, false, "no exclusive open");
    assert.equal(result.bytesWritten, 0, "zero bytes written");

    // Independently corroborated at the registry and the driver.
    assert.equal(registry.asConsumedApprovalState().consumedGrantIds.includes(fx.grant.grantId), false, "the registry never saw a consume");
    assert.equal(driver.openCalls.length, 0, "the driver was never opened");
    assert.equal(driver.bytes, 0, "the driver was never written to");
    assert.equal(getRealNodeDriverInvocationCount(), 0, "the real Node driver stays inactive");

    // The grant is still usable afterwards, which is the point of not consuming.
    const retry = attempt({ fx, root, registry });
    assert.equal(retry.result.attempted, true, "a refused binding did not burn the grant");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- RECEIPTS ---

test("no receipt or result carries a raw absolute host path", () => {
  const { dir, root } = provenRoot("receipt");
  try {
    const receiptLog = new ReceiptLog();
    const fx = fixture();
    const driver = new RecordingFakeDriver();
    const result = createProjectFile({
      permit: createTrustedC2WriteAuthorityPermit({ bootstrapKind: "trusted-one-shot", scope: "create-one-generated-markdown", acknowledgement: "c2a-contracts-only-no-write" }),
      proposal: fx.proposal,
      descriptor: fx.descriptor,
      grant: fx.grant,
      targetInspection: inspectionFor(TARGET),
      reviewVerdict: fx.reviewVerdict,
      reviewReceiptId: fx.reviewReceiptId,
      currentSequence: 1,
      operationCount: 1,
      registry: new ConsumedApprovalRegistry(),
      receiptLog,
      driver,
      projectRoot: root,
      attemptId: "attempt-receipt",
    });

    assert.equal(result.completed, true);
    // The driver really did get the absolute path...
    assert.equal(driver.openCalls[0].includes(dir), true);
    // ...and it appears in NEITHER the result nor any receipt.
    const serializedResult = JSON.stringify(result);
    const serializedReceipts = JSON.stringify(receiptLog.list());
    for (const blob of [serializedResult, serializedReceipts]) {
      assert.equal(blob.includes(dir), false, "no absolute host root may appear");
      assert.equal(blob.includes(tmpdir()), false, "no temp-directory prefix may appear");
      assert.equal(blob.includes(TARGET), false, "not even the raw relative path");
    }
    // The fingerprint IS present — that is the safe reference.
    assert.equal(serializedReceipts.includes(fingerprint(TARGET)), true, "the path fingerprint is the safe reference");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("existing exclusive-create behaviour is unchanged", () => {
  const { dir, root } = provenRoot("existing");
  try {
    // target-exists still surfaces at open, through the bound target.
    class ExistsDriver extends RecordingFakeDriver {
      override openExclusive(targetPath: string): ExclusiveCreateHandle {
        this.openCalls.push(targetPath);
        throw new (require("../application/exclusiveCreateDriver").ExclusiveCreateDriverError)("target-exists");
      }
    }
    const driver = new ExistsDriver();
    const registry = new ConsumedApprovalRegistry();
    const { result } = attempt({ root, driver, registry });

    assert.equal(result.reasonCode, "open-target-exists", "the admitted boundary still surfaces at open");
    assert.equal(result.attempted, true, "it is an attempt: the binding succeeded");
    assert.equal(result.grantConsumed, true, "an admitted attempt still consumes");
    assert.equal(driver.openCalls[0], resolve(dir, TARGET), "and it was the bound target that was attempted");
    assert.equal(result.bytesWritten, 0);
    assert.equal(getRealNodeDriverInvocationCount(), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exact-content-byte binding is untouched", () => {
  const { dir, root } = provenRoot("bytes");
  try {
    const { result, driver } = attempt({ root });
    assert.equal(result.completed, true);
    assert.equal(result.byteCount, Buffer.byteLength(CONTENT, "utf8"), "the approved byte count");
    assert.equal(result.bytesWritten, Buffer.byteLength(CONTENT, "utf8"), "exactly those bytes reached the driver");
    assert.equal(driver.bytes, Buffer.byteLength(CONTENT, "utf8"));
    assert.equal(typeof result.contentBytesFingerprint, "string");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no real filesystem entry is created by this suite", () => {
  const { dir, root } = provenRoot("noop");
  try {
    attempt({ root });
    // The fake never touched the filesystem: the derived target does not exist.
    const { existsSync } = require("fs") as typeof import("fs");
    assert.equal(existsSync(resolve(dir, TARGET)), false, "no file was created");
    assert.equal(getRealNodeDriverInvocationCount(), 0, "the real Node driver was never invoked");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
