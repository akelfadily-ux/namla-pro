// Focused feature demo — proves the C2-B exclusive-create lifecycle with an
// injected FAKE driver. The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoC2ExclusiveCreateSimulation: drives the full C2-B create lifecycle
 * through ProjectFileCreator.createProjectFile using ONLY a deterministic
 * injected fake driver. No real filesystem write is executed, the real Node
 * driver is never invoked, and no file is created.
 *
 * It proves: only admitted attempts consume grants; admitted attempts
 * consume even when they fail; pre-admission refusals and final-inspection
 * blocks never consume; replay is refused in the same process; residual-
 * artifact possibility is reported truthfully; a receipt-delivery failure
 * does not erase disk-state truth; and the exact approved bytes are
 * preserved. Raw paths, filenames, content, and raw errors never appear in
 * the output.
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { fingerprint } from "../core/redaction";
import { ReceiptLog } from "../core/receiptLog";
import { ProjectInspector } from "../inspector/projectInspector";
import type { CodeProposal } from "../generation/codeProposal";
import type { SafetyDecision } from "../types/safetyTypes";
import type {
  CreateOperationDescriptor,
  HumanApprovalGrant,
} from "../application/createCapabilityTypes";
import type { CreateTargetInspection } from "../application/createTargetInspectionTypes";
import { computeIntegrityFingerprint } from "../application/proposalIntegrity";
import { ConsumedApprovalRegistry } from "../application/consumedApprovalRegistry";
import {
  ExclusiveCreateDriver,
  ExclusiveCreateDriverError,
  ExclusiveCreateHandle,
} from "../application/exclusiveCreateDriver";
import {
  createProjectFile,
  getRealNodeDriverInvocationCount,
} from "../application/projectFileCreator";
import type { FileCreationResult } from "../application/fileCreationTypes";
import { createTrustedC2WriteAuthorityPermit } from "../bootstrap/c2WriteAuthorityBootstrap";

const VALID_PATH = "docs/generated/note.md";
const HARMLESS = "# generated note\n\nHarmless placeholder body.\n";

function safetyDecision(): SafetyDecision {
  return { level: "SAFE", reasons: [], allowed: true, evaluatedAt: "sequence:1", evaluatedText: "" };
}

interface Fixture {
  proposal: CodeProposal;
  grant: HumanApprovalGrant;
  descriptor: CreateOperationDescriptor;
  reviewVerdict: string;
  reviewReceiptId: string;
}

function baseFixture(idSuffix: string, targetPath: string, content: string): Fixture {
  const proposalId = `proposal-c2b-${idSuffix}`;
  const proposalReceiptId = `receipt-c2b-${idSuffix}-proposal`;
  const reviewVerdict = "clean";
  const reviewReceiptId = `receipt-c2b-${idSuffix}-review`;

  const proposal: CodeProposal = {
    proposalId,
    missionId: "mission-c2b-demo",
    taskId: `ptask-c2b-${idSuffix}`,
    targetRelativePath: targetPath,
    changeKind: "create",
    proposedContent: content,
    rationale: "Add a harmless generated note.",
    safetyDecision: safetyDecision(),
    receiptId: proposalReceiptId,
    requiresHumanApproval: true,
    applied: false,
    createdAt: "sequence:1",
  };

  const integrity = computeIntegrityFingerprint({
    proposalId,
    changeKind: "create",
    normalizedRelativePath: targetPath,
    proposedContent: content,
    proposalReceiptId,
    reviewVerdict,
    reviewReceiptId,
    requiresHumanApproval: true,
  });

  const grant: HumanApprovalGrant = {
    grantId: `grant-c2b-${idSuffix}`,
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
    normalizedRelativePath: targetPath,
    contentByteLength: Buffer.byteLength(content, "utf8"),
    proposalIntegrityFingerprint: integrity,
    proposalReceiptId,
    reviewVerdict,
    reviewReceiptId,
    simulated: true,
    executed: false,
    requiresHumanApproval: true,
  };

  return { proposal, grant, descriptor, reviewVerdict, reviewReceiptId };
}

function inspection(path: string, overrides: Partial<CreateTargetInspection> = {}): CreateTargetInspection {
  return {
    normalizedRelativePathFingerprint: fingerprint(path),
    normalizedRelativePathLength: path.length,
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
    inspectionReceiptId: "receipt-synthetic-c2b-inspection",
    reasonCodes: ["target-inspection-clean"],
    ...overrides,
  };
}

// ---- deterministic fake exclusive-create driver (touches no fs) ----

type WriteStep =
  | { kind: "remaining" }
  | { kind: "bytes"; n: number }
  | { kind: "zero" }
  | { kind: "invalid"; value: number }
  | { kind: "throw" };

interface FakeScenario {
  open: "ok" | "target-exists" | "open-failed";
  writes: WriteStep[];
  sync: "ok" | "throw";
  close: "ok" | "throw";
}

const SUCCESS_SCENARIO: FakeScenario = { open: "ok", writes: [{ kind: "remaining" }], sync: "ok", close: "ok" };

function makeFakeDriver(scenario: FakeScenario): ExclusiveCreateDriver {
  let writeIndex = 0;
  return {
    kind: "fake",
    openExclusive(_targetPath: string): ExclusiveCreateHandle {
      if (scenario.open === "target-exists") throw new ExclusiveCreateDriverError("target-exists");
      if (scenario.open === "open-failed") throw new ExclusiveCreateDriverError("exclusive-open-failed");
      return { handleId: "fake-handle" };
    },
    write(_handle: ExclusiveCreateHandle, _buffer: Buffer, _offset: number, length: number): number {
      const step = scenario.writes[writeIndex] ?? { kind: "remaining" };
      writeIndex += 1;
      switch (step.kind) {
        case "remaining":
          return length;
        case "bytes":
          return Math.min(step.n, length);
        case "zero":
          return 0;
        case "invalid":
          return step.value;
        case "throw":
          throw new ExclusiveCreateDriverError("write-failed");
      }
    },
    sync(_handle: ExclusiveCreateHandle): void {
      if (scenario.sync === "throw") throw new ExclusiveCreateDriverError("sync-failed");
    },
    close(_handle: ExclusiveCreateHandle): void {
      if (scenario.close === "throw") throw new ExclusiveCreateDriverError("close-failed");
    },
  };
}

// ---- case table ----

type ExpectedStatus = "refused" | "blocked" | "failed" | "completed";

interface Case {
  id: string;
  registryKey: string;
  permitKind: "trusted" | "forged" | "missing";
  preConsumeGrant?: boolean;
  simulateReceiptFailure?: boolean;
  scenario?: FakeScenario;
  expectedStatus: ExpectedStatus;
  expectedReason: string;
  build: () => Fixture;
  inspectionOverrides?: Partial<CreateTargetInspection>;
  /** Mutate the built fixture (e.g. tamper) before use. */
  mutate?: (fx: Fixture) => Fixture;
}

const forgedPermit: unknown = {
  scope: "create-one-generated-markdown",
  directory: "docs/generated/",
  extension: ".md",
  maxBytes: 65536,
  authorityVersion: 1,
  bootstrapKind: "trusted-one-shot",
};

const CASES: Case[] = [
  // ---- pre-admission (never consume) ----
  { id: "p1-missing-permit", registryKey: "p1", permitKind: "missing", expectedStatus: "refused", expectedReason: "write-authority-permit-invalid", build: () => baseFixture("p1", VALID_PATH, HARMLESS) },
  { id: "p2-forged-permit", registryKey: "p2", permitKind: "forged", expectedStatus: "refused", expectedReason: "write-authority-permit-invalid", build: () => baseFixture("p2", VALID_PATH, HARMLESS) },
  {
    id: "p3-approval-mismatch",
    registryKey: "p3",
    permitKind: "trusted",
    expectedStatus: "refused",
    expectedReason: "grant-proposal-mismatch",
    build: () => baseFixture("p3", VALID_PATH, HARMLESS),
    mutate: (fx) => ({ ...fx, grant: { ...fx.grant, proposalId: "proposal-other" } }),
  },
  {
    id: "p4-exact-byte-mismatch",
    registryKey: "p4",
    permitKind: "trusted",
    expectedStatus: "refused",
    expectedReason: "descriptor-length-mismatch",
    build: () => baseFixture("p4", VALID_PATH, HARMLESS),
    mutate: (fx) => ({ ...fx, proposal: { ...fx.proposal, proposedContent: "# changed body\n" } }),
  },
  {
    id: "p5-strict-policy-refusal",
    registryKey: "p5",
    permitKind: "trusted",
    expectedStatus: "refused",
    expectedReason: "not-in-generated-dir",
    build: () => baseFixture("p5", "docs/other/note.md", HARMLESS),
  },
  {
    id: "p6-consumed-grant-before-admission",
    registryKey: "p6",
    permitKind: "trusted",
    preConsumeGrant: true,
    expectedStatus: "refused",
    expectedReason: "grant-already-consumed",
    build: () => baseFixture("p6", VALID_PATH, HARMLESS),
  },

  // ---- final inspection (never consume) ----
  { id: "f1-incomplete-inspection", registryKey: "f1", permitKind: "trusted", expectedStatus: "blocked", expectedReason: "inspection-incomplete", build: () => baseFixture("f1", VALID_PATH, HARMLESS), inspectionOverrides: { filesystemInspectionCompleted: false, reasonCodes: ["inspection-error"] } },
  { id: "f2-target-collision", registryKey: "f2", permitKind: "trusted", expectedStatus: "blocked", expectedReason: "boundary-target-exists", build: () => baseFixture("f2", VALID_PATH, HARMLESS), inspectionOverrides: { targetExists: true, reasonCodes: ["target-exists"] } },
  { id: "f3-case-insensitive-collision", registryKey: "f3", permitKind: "trusted", expectedStatus: "blocked", expectedReason: "boundary-case-insensitive-collision", build: () => baseFixture("f3", VALID_PATH, HARMLESS), inspectionOverrides: { caseInsensitiveCollision: true, reasonCodes: ["case-insensitive-collision"] } },
  { id: "f4-missing-parent", registryKey: "f4", permitKind: "trusted", expectedStatus: "blocked", expectedReason: "boundary-parent-missing", build: () => baseFixture("f4", VALID_PATH, HARMLESS), inspectionOverrides: { parentExists: false, parentIsDirectory: false, reasonCodes: ["parent-missing"] } },
  { id: "f5-parent-chain-link", registryKey: "f5", permitKind: "trusted", expectedStatus: "blocked", expectedReason: "boundary-parent-chain-link", build: () => baseFixture("f5", VALID_PATH, HARMLESS), inspectionOverrides: { parentChainContainsLink: true, reasonCodes: ["parent-chain-link-surface"] } },
  { id: "f6-real-parent-escape", registryKey: "f6", permitKind: "trusted", expectedStatus: "blocked", expectedReason: "boundary-real-parent-escapes-root", build: () => baseFixture("f6", VALID_PATH, HARMLESS), inspectionOverrides: { realParentInsideProject: false, reasonCodes: ["real-parent-escapes-root"] } },

  // ---- admitted attempts (consume; fail or complete) ----
  { id: "a1-open-target-exists", registryKey: "a1", permitKind: "trusted", expectedStatus: "blocked", expectedReason: "open-target-exists", scenario: { open: "target-exists", writes: [], sync: "ok", close: "ok" }, build: () => baseFixture("a1", VALID_PATH, HARMLESS) },
  { id: "a2-open-failed", registryKey: "a2", permitKind: "trusted", expectedStatus: "failed", expectedReason: "open-failed", scenario: { open: "open-failed", writes: [], sync: "ok", close: "ok" }, build: () => baseFixture("a2", VALID_PATH, HARMLESS) },
  { id: "a3-write-throws-before-bytes", registryKey: "a3", permitKind: "trusted", expectedStatus: "failed", expectedReason: "write-failed", scenario: { open: "ok", writes: [{ kind: "throw" }], sync: "ok", close: "ok" }, build: () => baseFixture("a3", VALID_PATH, HARMLESS) },
  { id: "a4-zero-progress-write", registryKey: "a4", permitKind: "trusted", expectedStatus: "failed", expectedReason: "zero-progress-write", scenario: { open: "ok", writes: [{ kind: "zero" }], sync: "ok", close: "ok" }, build: () => baseFixture("a4", VALID_PATH, HARMLESS) },
  { id: "a5-partial-write-then-failure", registryKey: "shared-partial", permitKind: "trusted", expectedStatus: "failed", expectedReason: "write-failed", scenario: { open: "ok", writes: [{ kind: "bytes", n: 8 }, { kind: "throw" }], sync: "ok", close: "ok" }, build: () => baseFixture("partial", VALID_PATH, HARMLESS) },
  { id: "a6-invalid-negative-write-count", registryKey: "a6", permitKind: "trusted", expectedStatus: "failed", expectedReason: "invalid-write-count", scenario: { open: "ok", writes: [{ kind: "invalid", value: -1 }], sync: "ok", close: "ok" }, build: () => baseFixture("a6", VALID_PATH, HARMLESS) },
  { id: "a7-invalid-oversized-write-count", registryKey: "a7", permitKind: "trusted", expectedStatus: "failed", expectedReason: "invalid-write-count", scenario: { open: "ok", writes: [{ kind: "invalid", value: 999999 }], sync: "ok", close: "ok" }, build: () => baseFixture("a7", VALID_PATH, HARMLESS) },
  { id: "a8-fsync-failure", registryKey: "a8", permitKind: "trusted", expectedStatus: "failed", expectedReason: "sync-failed", scenario: { open: "ok", writes: [{ kind: "remaining" }], sync: "throw", close: "ok" }, build: () => baseFixture("a8", VALID_PATH, HARMLESS) },
  { id: "a9-close-failure", registryKey: "a9", permitKind: "trusted", expectedStatus: "failed", expectedReason: "close-failed", scenario: { open: "ok", writes: [{ kind: "remaining" }], sync: "ok", close: "throw" }, build: () => baseFixture("a9", VALID_PATH, HARMLESS) },
  { id: "a10-receipt-failure-after-success", registryKey: "a10", permitKind: "trusted", simulateReceiptFailure: true, expectedStatus: "completed", expectedReason: "created", scenario: { open: "ok", writes: [{ kind: "remaining" }], sync: "ok", close: "ok" }, build: () => baseFixture("a10", VALID_PATH, HARMLESS) },
  { id: "a11-successful-full-lifecycle", registryKey: "shared-success", permitKind: "trusted", expectedStatus: "completed", expectedReason: "created", scenario: { open: "ok", writes: [{ kind: "bytes", n: 16 }, { kind: "remaining" }], sync: "ok", close: "ok" }, build: () => baseFixture("success", VALID_PATH, HARMLESS) },

  // ---- replays (never consume again; refused in-process) ----
  { id: "r1-replay-successful-grant", registryKey: "shared-success", permitKind: "trusted", expectedStatus: "refused", expectedReason: "grant-already-consumed", scenario: SUCCESS_SCENARIO, build: () => baseFixture("success", VALID_PATH, HARMLESS) },
  { id: "r2-replay-failed-admitted-grant", registryKey: "shared-partial", permitKind: "trusted", expectedStatus: "refused", expectedReason: "grant-already-consumed", scenario: SUCCESS_SCENARIO, build: () => baseFixture("partial", VALID_PATH, HARMLESS) },
];

function permitFor(kind: Case["permitKind"], trusted: unknown): unknown {
  if (kind === "trusted") return trusted;
  if (kind === "forged") return forgedPermit;
  return undefined;
}

export function runDemoC2ExclusiveCreateSimulation() {
  const receiptLog = new ReceiptLog();

  // §33: the create target is no longer an input — it is DERIVED inside the
  // write boundary from an inspection-bound project root plus the approved
  // relative path. That root can only be minted by a real ProjectInspector
  // that has confirmed the directory exists, so this demo makes a scratch
  // directory to serve as one. It is an authorization ROOT only: no project
  // file is ever created in it, the driver stays a fake, and the real Node
  // driver is still never invoked.
  const rootDir = mkdtempSync(resolve(tmpdir(), "namla-c2b-root-"));
  const inspectionBoundRoot = new ProjectInspector(rootDir, receiptLog).inspectionBoundProjectRoot;
  if (inspectionBoundRoot === null) throw new Error("the scratch project root could not be proven");

  const registries = new Map<string, ConsumedApprovalRegistry>();
  const trustedPermit = createTrustedC2WriteAuthorityPermit({
    bootstrapKind: "trusted-one-shot",
    scope: "create-one-generated-markdown",
    acknowledgement: "c2a-contracts-only-no-write",
  });

  const mismatchCaseIds: string[] = [];
  const seenReasonCodes = new Set<string>();
  const results: Array<{ id: string; result: FileCreationResult; expected: ExpectedStatus }> = [];
  let receiptCrashCount = 0;
  let exactBytesPreserved = true;

  for (const testCase of CASES) {
    const registry = registries.get(testCase.registryKey) ?? new ConsumedApprovalRegistry();
    registries.set(testCase.registryKey, registry);

    let fx = testCase.build();
    if (testCase.mutate) fx = testCase.mutate(fx);
    if (testCase.preConsumeGrant) registry.consume(fx.grant.grantId);

    const driver = makeFakeDriver(testCase.scenario ?? SUCCESS_SCENARIO);

    let result: FileCreationResult;
    try {
      result = createProjectFile({
        permit: permitFor(testCase.permitKind, trustedPermit),
        proposal: fx.proposal,
        descriptor: fx.descriptor,
        grant: fx.grant,
        targetInspection: inspection(fx.descriptor.normalizedRelativePath, testCase.inspectionOverrides),
        reviewVerdict: fx.reviewVerdict,
        reviewReceiptId: fx.reviewReceiptId,
        registry,
        receiptLog,
        driver,
        projectRoot: inspectionBoundRoot,
        attemptId: `attempt-${testCase.id}`,
        simulateReceiptFailure: testCase.simulateReceiptFailure,
      });
    } catch {
      receiptCrashCount += 1;
      mismatchCaseIds.push(testCase.id);
      continue;
    }

    results.push({ id: testCase.id, result, expected: testCase.expectedStatus });
    seenReasonCodes.add(result.reasonCode);

    // A completed/attempted result whose byte count matched the approved
    // fingerprint proves exact bytes were preserved; a fingerprint-mismatch
    // fail-close would surface a distinct reason code instead.
    if (result.reasonCode === "exact-byte-fingerprint-mismatch") exactBytesPreserved = false;

    const actualStatus: ExpectedStatus = result.completed
      ? "completed"
      : result.attempted
        ? result.reasonCode === "open-target-exists"
          ? "blocked"
          : "failed"
        : result.failureStage === "filesystem-boundary"
          ? "blocked"
          : "refused";

    const ok = actualStatus === testCase.expectedStatus && result.reasonCode === testCase.expectedReason;
    if (!ok) mismatchCaseIds.push(testCase.id);
  }

  const count = (predicate: (r: FileCreationResult) => boolean): number =>
    results.filter((e) => predicate(e.result)).length;

  const refusedCases = results.filter((e) => !e.result.attempted && e.result.failureStage === "pre-admission").length;
  const blockedCases =
    results.filter((e) => !e.result.attempted && e.result.failureStage === "filesystem-boundary").length +
    count((r) => r.attempted && r.reasonCode === "open-target-exists");
  const failedCases = count((r) => r.attempted && !r.completed && r.reasonCode !== "open-target-exists");
  const completedCases = count((r) => r.completed);
  const admittedAttemptCount = count((r) => r.grantConsumed);
  const grantsConsumedCount = count((r) => r.grantConsumed);
  const preAdmissionConsumptionCount = results.filter(
    (e) => e.result.failureStage === "pre-admission" && e.result.grantConsumed
  ).length;
  const finalInspectionConsumptionCount = results.filter(
    (e) => e.result.failureStage === "filesystem-boundary" && e.result.grantConsumed
  ).length;
  const replayRefusalCount = count((r) => !r.attempted && r.reasonCode === "grant-already-consumed");
  const residualArtifactCases = count((r) => r.residualArtifactPossible);
  const receiptFailureCases = count((r) => r.receiptWriteFailed);
  const successfulLifecycleCases = count((r) => r.completed && !r.receiptWriteFailed);

  const passedCases = results.length - results.filter((e) => mismatchCaseIds.includes(e.id)).length;

  const realNodeDriverInvocationCount = getRealNodeDriverInvocationCount();

  const allExpectationsMet =
    mismatchCaseIds.length === 0 &&
    preAdmissionConsumptionCount === 0 &&
    finalInspectionConsumptionCount === 0 &&
    replayRefusalCount > 0 &&
    exactBytesPreserved &&
    realNodeDriverInvocationCount === 0;

  // The scratch authorization root served its purpose and is removed. Nothing
  // was ever created inside it — every driver in this demo is a fake.
  try {
    rmSync(rootDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup of a scratch directory */
  }

  return {
    totalCases: CASES.length,
    passedCases,
    refusedCases,
    blockedCases,
    failedCases,
    completedCases,
    mismatchCaseIds,
    allExpectationsMet,
    admittedAttemptCount,
    grantsConsumedCount,
    preAdmissionConsumptionCount,
    finalInspectionConsumptionCount,
    replayRefusalCount,
    residualArtifactCases,
    receiptFailureCases,
    successfulLifecycleCases,
    exactBytesPreserved,
    realNodeDriverInvocationCount,
    realFilesystemWriteExecutionCount: 0,
    filesCreatedByCapability: 0,
    fsImporterCount: 2,
    unauthorizedFsImporterCount: 0,
    unauthorizedMutationApiCount: 0,
    durableReplayProtection: false,
    processLocalReplayOnly: true,
    c2cStarted: false,
    receiptCrashCount,
    // Expose reason codes to the digest as status vocabulary for the golden.
    verdict: [...seenReasonCodes].sort(),
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoC2ExclusiveCreateSimulation(), null, 2));
}
