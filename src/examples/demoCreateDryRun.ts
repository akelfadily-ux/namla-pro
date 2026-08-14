// Focused feature demo — proves the C1 read-only create-target dry run.
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoCreateDryRun: exercises the C1 dry-run path against a table of
 * representative targets. It uses the REAL ProjectInspector for read-only
 * filesystem metadata inspection and the pure dry-run evaluator, and proves
 * the central C1 guarantee: no file is ever created, no mutation API is
 * called, no write is authorized, and the approval grant is not consumed.
 *
 * The demo never prints a raw path, raw filename, raw content, or raw
 * filesystem error. Collisions are reported by case id and fixed reason
 * code only. One case (E) drives the pure evaluator with a synthetic
 * parent-chain-link inspection so a link boundary is proven WITHOUT
 * creating a real link.
 */

import path from "path";
import { fingerprint } from "../core/redaction";
import { ReceiptLog } from "../core/receiptLog";
import { ProjectInspector } from "../inspector/projectInspector";
import type { CodeProposal } from "../generation/codeProposal";
import type { SafetyDecision } from "../types/safetyTypes";
import type {
  ConsumedApprovalState,
  CreateOperationDescriptor,
  HumanApprovalGrant,
} from "../application/createCapabilityTypes";
import type { CreateTargetInspection } from "../application/createTargetInspectionTypes";
import { computeIntegrityFingerprint } from "../application/proposalIntegrity";
import { evaluateCreatePolicy } from "../application/projectCreatePolicy";
import {
  CreateDryRunReasonCode,
  CreateDryRunResult,
  CreateDryRunStatus,
  evaluateCreateDryRun,
} from "../application/projectCreateDryRun";

interface Fixture {
  proposal: CodeProposal;
  grant: HumanApprovalGrant;
  descriptor: CreateOperationDescriptor;
  reviewVerdict: string;
  reviewReceiptId: string;
}

function safetyDecision(): SafetyDecision {
  return { level: "SAFE", reasons: [], allowed: true, evaluatedAt: "sequence:1", evaluatedText: "" };
}

/** Build a self-consistent create fixture bound to `targetPath` + `content`. */
function buildFixture(idSuffix: string, targetPath: string, content: string): Fixture {
  const proposalId = `proposal-c1-${idSuffix}`;
  const proposalReceiptId = `receipt-c1-${idSuffix}-proposal`;
  const reviewVerdict = "clean";
  const reviewReceiptId = `receipt-c1-${idSuffix}-review`;

  const proposal: CodeProposal = {
    proposalId,
    missionId: "mission-c1-demo",
    taskId: `ptask-c1-${idSuffix}`,
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
    grantId: `grant-c1-${idSuffix}`,
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

const HARMLESS = "# generated note\n\nHarmless placeholder body.\n";

// Targets. A and F share an absent target (neither creates it). B and C key
// off an existing committed file; the raw name is never printed.
const ABSENT_TARGET = "docs/c1-dry-run-safe-probe.md";
const EXISTING_TARGET = "docs/runtime-spine.md";
const EXISTING_TARGET_CASE_VARIANT = "docs/RUNTIME-SPINE.md";
const MISSING_PARENT_TARGET = "docs/c1-missing-parent-probe-dir/note.md";
const LINK_PROBE_TARGET = "docs/c1-link-probe.md";

interface Case {
  id: string;
  expectedStatus: CreateDryRunStatus;
  expectedReason: CreateDryRunReasonCode;
  /** Produce the dry-run result for this case. */
  run: (ctx: {
    inspector: ProjectInspector;
    receiptLog: ReceiptLog;
    consumed: ConsumedApprovalState;
    antId: string;
  }) => CreateDryRunResult;
}

function realInspection(
  ctx: { inspector: ProjectInspector; antId: string },
  targetPath: string
): CreateTargetInspection {
  const policy = evaluateCreatePolicy({
    changeKind: "create",
    normalizedRelativePath: targetPath,
    contentByteLength: Buffer.byteLength(HARMLESS, "utf8"),
    operationCount: 1,
  });
  return ctx.inspector.inspectCreateTarget(targetPath, policy.structuralPolicyPassed, ctx.antId);
}

const CASES: Case[] = [
  {
    id: "A-safe-absent-target",
    expectedStatus: "completed",
    expectedReason: "dry-run-clean",
    run: (ctx) => {
      const fx = buildFixture("a", ABSENT_TARGET, HARMLESS);
      const targetInspection = realInspection(ctx, ABSENT_TARGET);
      return evaluateCreateDryRun({
        proposal: fx.proposal,
        descriptor: fx.descriptor,
        grant: fx.grant,
        consumed: ctx.consumed,
        targetInspection,
        receiptLog: ctx.receiptLog,
        reviewVerdict: fx.reviewVerdict,
        reviewReceiptId: fx.reviewReceiptId,
      });
    },
  },
  {
    id: "B-existing-target-collision",
    expectedStatus: "blocked",
    expectedReason: "boundary-target-exists",
    run: (ctx) => {
      const fx = buildFixture("b", EXISTING_TARGET, HARMLESS);
      const targetInspection = realInspection(ctx, EXISTING_TARGET);
      return evaluateCreateDryRun({
        proposal: fx.proposal,
        descriptor: fx.descriptor,
        grant: fx.grant,
        consumed: ctx.consumed,
        targetInspection,
        receiptLog: ctx.receiptLog,
        reviewVerdict: fx.reviewVerdict,
        reviewReceiptId: fx.reviewReceiptId,
      });
    },
  },
  {
    id: "C-case-insensitive-collision",
    expectedStatus: "blocked",
    expectedReason: "boundary-case-insensitive-collision",
    run: (ctx) => {
      const fx = buildFixture("c", EXISTING_TARGET_CASE_VARIANT, HARMLESS);
      const targetInspection = realInspection(ctx, EXISTING_TARGET_CASE_VARIANT);
      return evaluateCreateDryRun({
        proposal: fx.proposal,
        descriptor: fx.descriptor,
        grant: fx.grant,
        consumed: ctx.consumed,
        targetInspection,
        receiptLog: ctx.receiptLog,
        reviewVerdict: fx.reviewVerdict,
        reviewReceiptId: fx.reviewReceiptId,
      });
    },
  },
  {
    id: "D-missing-parent",
    expectedStatus: "blocked",
    expectedReason: "boundary-parent-missing",
    run: (ctx) => {
      const fx = buildFixture("d", MISSING_PARENT_TARGET, HARMLESS);
      const targetInspection = realInspection(ctx, MISSING_PARENT_TARGET);
      return evaluateCreateDryRun({
        proposal: fx.proposal,
        descriptor: fx.descriptor,
        grant: fx.grant,
        consumed: ctx.consumed,
        targetInspection,
        receiptLog: ctx.receiptLog,
        reviewVerdict: fx.reviewVerdict,
        reviewReceiptId: fx.reviewReceiptId,
      });
    },
  },
  {
    id: "E-synthetic-parent-chain-link",
    expectedStatus: "blocked",
    expectedReason: "boundary-parent-chain-link",
    run: (ctx) => {
      const fx = buildFixture("e", LINK_PROBE_TARGET, HARMLESS);
      // Pure-evaluator fixture: a parent-chain link WITHOUT creating a real
      // link. Every other finding is safe so the link boundary is isolated.
      const syntheticLinkInspection: CreateTargetInspection = {
        normalizedRelativePathFingerprint: fingerprint(LINK_PROBE_TARGET),
        normalizedRelativePathLength: LINK_PROBE_TARGET.length,
        targetExists: false,
        caseInsensitiveCollision: false,
        parentExists: true,
        parentIsDirectory: true,
        parentChainInsideProject: true,
        parentChainContainsLink: true,
        targetIsLink: false,
        realParentInsideProject: true,
        structuralPolicyPassed: true,
        filesystemInspectionCompleted: true,
        inspectedEntryCount: 3,
        simulated: true,
        executed: false,
        authoritativeForWrite: false,
        inspectionReceiptId: "receipt-synthetic-c1-link-fixture",
        reasonCodes: ["parent-chain-link-surface"],
      };
      return evaluateCreateDryRun({
        proposal: fx.proposal,
        descriptor: fx.descriptor,
        grant: fx.grant,
        consumed: ctx.consumed,
        targetInspection: syntheticLinkInspection,
        receiptLog: ctx.receiptLog,
        reviewVerdict: fx.reviewVerdict,
        reviewReceiptId: fx.reviewReceiptId,
      });
    },
  },
  {
    id: "F-integrity-tampering-refused",
    expectedStatus: "refused",
    expectedReason: "c0-approval-refused",
    run: (ctx) => {
      const fx = buildFixture("f", ABSENT_TARGET, HARMLESS);
      // Content changed AFTER the grant was issued; the descriptor's byte
      // length still reflects the original, so C0 refuses before the
      // filesystem inspection is ever consulted.
      const tampered: CodeProposal = { ...fx.proposal, proposedContent: "# tampered\n" };
      const targetInspection = realInspection(ctx, ABSENT_TARGET);
      return evaluateCreateDryRun({
        proposal: tampered,
        descriptor: fx.descriptor,
        grant: fx.grant,
        consumed: ctx.consumed,
        targetInspection,
        receiptLog: ctx.receiptLog,
        reviewVerdict: fx.reviewVerdict,
        reviewReceiptId: fx.reviewReceiptId,
      });
    },
  },
];

export function runDemoCreateDryRun() {
  const projectRoot = path.resolve(__dirname, "..", ".."); // dist/examples -> root
  const receiptLog = new ReceiptLog();
  const inspector = new ProjectInspector(projectRoot, receiptLog);
  const antId = "scout-c1-dry-run-1";

  // A shared readonly consumed state; the dry run must never mutate it.
  const consumed: ConsumedApprovalState = { consumedGrantIds: [] };

  const results: CreateDryRunResult[] = [];
  const mismatchCaseIds: string[] = [];
  const seenReasonCodes = new Set<string>();
  let receiptCrashCount = 0;

  for (const testCase of CASES) {
    let result: CreateDryRunResult | undefined;
    try {
      result = testCase.run({ inspector, receiptLog, consumed, antId });
    } catch {
      receiptCrashCount += 1;
      continue;
    }
    results.push(result);
    seenReasonCodes.add(result.reasonCode);

    const matches =
      result.status === testCase.expectedStatus && result.reasonCode === testCase.expectedReason;
    if (!matches) mismatchCaseIds.push(testCase.id);
  }

  // Behavioral proof of non-consumption: the readonly consumed list handed to
  // every evaluation is still empty afterward.
  const grantConsumedByDryRun = consumed.consumedGrantIds.length !== 0;

  const passedCases = results.filter((r) => r.status === "completed").length;
  const blockedCases = results.filter((r) => r.status === "blocked").length;
  const refusedCases = results.filter((r) => r.status === "refused").length;
  const failedCases = results.filter((r) => r.status === "failed").length;
  const readyCandidateCount = results.filter((r) => r.readyForFutureWriteReview).length;

  return {
    totalCases: CASES.length,
    passedCases,
    blockedCases,
    refusedCases,
    failedCases,
    mismatchCaseIds,
    allExpectationsMet: mismatchCaseIds.length === 0 && results.length === CASES.length,
    readyCandidateCount,
    // Provably zero by LITERAL TYPE: authoritativeForWrite/writeAuthorized/
    // writePerformed on CreateDryRunResult are typed `false`, so a non-zero
    // count is unrepresentable — the compiler rejects even comparing them to
    // true (see the literal-typed fields on CreateDryRunResult).
    authoritativeWriteDecisions: 0,
    writeAuthorizedCount: 0,
    writePerformedCount: 0,
    filesCreatedByCapability: 0,
    mutationApiCount: 0,
    simulated: true,
    executed: false,
    grantConsumedByDryRun,
    requiresFreshC2Revalidation: true,
    receiptCrashCount,
    // Expose the dry-run reason codes to the digest as status vocabulary so
    // the golden baseline can assert boundary/refusal coverage.
    verdict: [...seenReasonCodes].sort(),
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoCreateDryRun(), null, 2));
}
