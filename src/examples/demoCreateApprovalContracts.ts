// Focused feature demo — proves the C0 create-approval contracts (data only).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoCreateApprovalContracts: exercises the pure C0 contracts against a
 * table of representative valid and refusal cases. NOTHING here writes a
 * file, imports fs, or advances beyond data verification: the demo builds
 * synthetic CodeProposal/HumanApprovalGrant/CreateOperationDescriptor
 * objects, hands them to verifyApproval and evaluateCreatePolicy, and
 * reports safe summary counts. Raw content, raw paths, and raw dangerous
 * inputs never enter the output.
 */

import type { CodeProposal } from "../generation/codeProposal";
import type { SafetyDecision } from "../types/safetyTypes";
import type {
  ConsumedApprovalState,
  CreateOperationDescriptor,
  HumanApprovalGrant,
} from "../application/createCapabilityTypes";
import { computeIntegrityFingerprint } from "../application/proposalIntegrity";
import {
  ApprovalReasonCode,
  verifyApproval,
} from "../application/approvalVerifier";
import {
  CreatePolicyReasonCode,
  MAX_CREATE_CONTENT_BYTES,
  evaluateCreatePolicy,
} from "../application/projectCreatePolicy";
import { ReceiptLog } from "../core/receiptLog";

interface Fixture {
  proposal: CodeProposal;
  grant: HumanApprovalGrant;
  descriptor: CreateOperationDescriptor;
  reviewVerdict: string;
  reviewReceiptId: string;
}

function safetyDecision(): SafetyDecision {
  return {
    level: "SAFE",
    reasons: [],
    allowed: true,
    evaluatedAt: "sequence:1",
    evaluatedText: "",
  };
}

/** Build a self-consistent valid-case fixture; refusal cases mutate copies. */
function baseFixture(): Fixture {
  const proposalId = "proposal-c0-demo-1";
  const path = "docs/generated/note.md";
  const content = "# generated note\n\nHarmless placeholder body.\n";
  const proposalReceiptId = "receipt-c0-demo-proposal-1";
  const reviewVerdict = "clean";
  const reviewReceiptId = "receipt-c0-demo-review-1";

  const proposal: CodeProposal = {
    proposalId,
    missionId: "mission-c0-demo",
    taskId: "ptask-c0-demo",
    targetRelativePath: path,
    changeKind: "create",
    proposedContent: content,
    rationale: "Add a harmless generated note.",
    safetyDecision: safetyDecision(),
    receiptId: proposalReceiptId,
    requiresHumanApproval: true,
    applied: false,
    createdAt: "sequence:1",
  };

  const fingerprint = computeIntegrityFingerprint({
    proposalId,
    changeKind: "create",
    normalizedRelativePath: path,
    proposedContent: content,
    proposalReceiptId,
    reviewVerdict,
    reviewReceiptId,
    requiresHumanApproval: true,
  });

  const grant: HumanApprovalGrant = {
    grantId: "grant-c0-demo-1",
    proposalId,
    proposalIntegrityFingerprint: fingerprint,
    scope: "create-one-project-file",
    singleUse: true,
    declaredApproverKind: "human",
    issuedSequenceLabel: "seq:1",
  };

  const descriptor: CreateOperationDescriptor = {
    proposalId,
    changeKind: "create",
    normalizedRelativePath: path,
    contentByteLength: Buffer.byteLength(content, "utf8"),
    proposalIntegrityFingerprint: fingerprint,
    proposalReceiptId,
    reviewVerdict,
    reviewReceiptId,
    simulated: true,
    executed: false,
    requiresHumanApproval: true,
  };

  return { proposal, grant, descriptor, reviewVerdict, reviewReceiptId };
}

interface Case {
  id: string;
  category: "valid" | "refusal";
  expectedApproved: boolean;
  /** approval verifier reason expected. */
  expectedApprovalCode?: ApprovalReasonCode;
  /** structural create-policy reason expected. */
  expectedPolicyCode?: CreatePolicyReasonCode;
  build: (fx: Fixture, consumedRef: ConsumedApprovalState) => {
    fx: Fixture;
    consumed: ConsumedApprovalState;
    policyOperationCount?: number;
  };
}

const emptyConsumed: ConsumedApprovalState = { consumedGrantIds: [] };

const CASES: Case[] = [
  {
    id: "v01-valid-fully-consistent",
    category: "valid",
    expectedApproved: true,
    expectedApprovalCode: "approval-valid",
    expectedPolicyCode: "structural-policy-passed",
    build: (fx) => ({ fx, consumed: emptyConsumed }),
  },
  {
    id: "r01-proposal-id-mismatch",
    category: "refusal",
    expectedApproved: false,
    expectedApprovalCode: "grant-proposal-mismatch",
    build: (fx) => ({
      fx: { ...fx, grant: { ...fx.grant, proposalId: "proposal-other" } },
      consumed: emptyConsumed,
    }),
  },
  {
    id: "r02-content-modified-after-grant",
    category: "refusal",
    expectedApproved: false,
    expectedApprovalCode: "descriptor-length-mismatch",
    build: (fx) => {
      const changed = "# tampered content\n";
      return {
        fx: {
          ...fx,
          proposal: { ...fx.proposal, proposedContent: changed },
        },
        consumed: emptyConsumed,
      };
    },
  },
  {
    id: "r03-target-path-modified-after-grant",
    category: "refusal",
    expectedApproved: false,
    expectedApprovalCode: "descriptor-path-mismatch",
    build: (fx) => ({
      fx: {
        ...fx,
        proposal: { ...fx.proposal, targetRelativePath: "docs/generated/other.md" },
      },
      consumed: emptyConsumed,
    }),
  },
  {
    id: "r04-changekind-cast-to-modify",
    category: "refusal",
    expectedApproved: false,
    expectedApprovalCode: "wrong-change-kind",
    build: (fx) => ({
      fx: { ...fx, proposal: { ...fx.proposal, changeKind: "modify" } },
      consumed: emptyConsumed,
    }),
  },
  {
    id: "r05-applied-cast-to-true",
    category: "refusal",
    expectedApproved: false,
    expectedApprovalCode: "proposal-invariant-failed",
    build: (fx) => ({
      fx: {
        ...fx,
        proposal: { ...(fx.proposal as unknown as Record<string, unknown>), applied: true } as unknown as CodeProposal,
      },
      consumed: emptyConsumed,
    }),
  },
  {
    id: "r06-requiresHumanApproval-cast-to-false",
    category: "refusal",
    expectedApproved: false,
    expectedApprovalCode: "proposal-invariant-failed",
    build: (fx) => ({
      fx: {
        ...fx,
        proposal: {
          ...(fx.proposal as unknown as Record<string, unknown>),
          requiresHumanApproval: false,
        } as unknown as CodeProposal,
      },
      consumed: emptyConsumed,
    }),
  },
  {
    id: "r07-grant-already-consumed",
    category: "refusal",
    expectedApproved: false,
    expectedApprovalCode: "grant-already-consumed",
    build: (fx) => ({
      fx,
      consumed: { consumedGrantIds: [fx.grant.grantId] },
    }),
  },
  {
    id: "r08-wrong-scope",
    category: "refusal",
    expectedApproved: false,
    expectedApprovalCode: "grant-scope-mismatch",
    build: (fx) => ({
      fx: {
        ...fx,
        grant: {
          ...(fx.grant as unknown as Record<string, unknown>),
          scope: "create-many-project-files",
        } as unknown as HumanApprovalGrant,
      },
      consumed: emptyConsumed,
    }),
  },
  {
    id: "r09-non-human-declaration",
    category: "refusal",
    expectedApproved: false,
    expectedApprovalCode: "approval-declaration-invalid",
    build: (fx) => ({
      fx: {
        ...fx,
        grant: {
          ...(fx.grant as unknown as Record<string, unknown>),
          declaredApproverKind: "system",
        } as unknown as HumanApprovalGrant,
      },
      consumed: emptyConsumed,
    }),
  },
  {
    id: "r10-missing-create-content",
    category: "refusal",
    expectedApproved: false,
    expectedApprovalCode: "missing-create-content",
    build: (fx) => ({
      fx: {
        ...fx,
        proposal: { ...fx.proposal, proposedContent: undefined },
      },
      consumed: emptyConsumed,
    }),
  },
  {
    // Descriptor and proposal remain byte-consistent, but the grant's
    // fingerprint has drifted (e.g. issued against a stale operation).
    id: "r11a-integrity-mismatch-grant-drift",
    category: "refusal",
    expectedApproved: false,
    expectedApprovalCode: "integrity-mismatch",
    build: (fx) => ({
      fx: {
        ...fx,
        grant: {
          ...fx.grant,
          proposalIntegrityFingerprint:
            "0000000000000000000000000000000000000000000000000000000000000000",
        },
      },
      consumed: emptyConsumed,
    }),
  },
  {
    id: "r11-unapproved-review-verdict",
    category: "refusal",
    expectedApproved: false,
    expectedApprovalCode: "review-not-approved",
    build: (fx) => ({
      fx: {
        ...fx,
        descriptor: { ...fx.descriptor, reviewVerdict: "defects-found" },
        reviewVerdict: "defects-found",
      },
      consumed: emptyConsumed,
    }),
  },
  {
    id: "p01-absolute-path",
    category: "refusal",
    expectedApproved: false,
    expectedPolicyCode: "absolute-path",
    build: (fx) => ({
      fx: {
        ...fx,
        descriptor: { ...fx.descriptor, normalizedRelativePath: "/etc/passwd" },
      },
      consumed: emptyConsumed,
    }),
  },
  {
    id: "p02-traversal-path",
    category: "refusal",
    expectedApproved: false,
    expectedPolicyCode: "path-traversal",
    build: (fx) => ({
      fx: {
        ...fx,
        descriptor: { ...fx.descriptor, normalizedRelativePath: "docs/../..//outside.md" },
      },
      consumed: emptyConsumed,
    }),
  },
  {
    id: "p03-protected-path-segment",
    category: "refusal",
    expectedApproved: false,
    expectedPolicyCode: "protected-name-segment",
    build: (fx) => ({
      fx: {
        ...fx,
        descriptor: { ...fx.descriptor, normalizedRelativePath: "docs/generated/.env.local" },
      },
      consumed: emptyConsumed,
    }),
  },
  {
    id: "p04-oversized-content",
    category: "refusal",
    expectedApproved: false,
    expectedPolicyCode: "content-too-large",
    build: (fx) => ({
      fx: {
        ...fx,
        descriptor: { ...fx.descriptor, contentByteLength: MAX_CREATE_CONTENT_BYTES + 1 },
      },
      consumed: emptyConsumed,
    }),
  },
  {
    id: "p05-multiple-file-scope",
    category: "refusal",
    expectedApproved: false,
    expectedPolicyCode: "not-single-operation",
    build: (fx) => ({ fx, consumed: emptyConsumed, policyOperationCount: 2 }),
  },
];

export function runDemoCreateApprovalContracts() {
  const receiptLog = new ReceiptLog();
  const mismatchCaseIds: string[] = [];
  const seenApprovalCodes = new Set<string>();
  const seenPolicyCodes = new Set<string>();
  let receiptCrashCount = 0;

  let passedCases = 0;
  let refusedCases = 0;

  for (const testCase of CASES) {
    const baseFx = baseFixture();
    const { fx, consumed, policyOperationCount } = testCase.build(baseFx, emptyConsumed);

    let policyOk = true;
    let policyCode: CreatePolicyReasonCode = "structural-policy-passed";
    if (testCase.expectedPolicyCode !== undefined || policyOperationCount !== undefined) {
      const policyResult = evaluateCreatePolicy({
        changeKind: fx.descriptor.changeKind,
        normalizedRelativePath: fx.descriptor.normalizedRelativePath,
        contentByteLength: fx.descriptor.contentByteLength,
        operationCount: policyOperationCount ?? 1,
      });
      policyOk = policyResult.structuralPolicyPassed;
      policyCode = policyResult.reasonCode;
      seenPolicyCodes.add(policyCode);
    }

    let approved = policyOk;
    let approvalCode: string = "approval-valid";
    if (policyOk) {
      const decision = verifyApproval({
        proposal: fx.proposal,
        descriptor: fx.descriptor,
        grant: fx.grant,
        consumed,
        reviewVerdict: fx.reviewVerdict,
        reviewReceiptId: fx.reviewReceiptId,
      });
      approved = decision.approved;
      approvalCode = decision.reasonCode;
      seenApprovalCodes.add(approvalCode);
    }

    const outcomeMatches = approved === testCase.expectedApproved;
    const approvalMatches =
      testCase.expectedApprovalCode === undefined ||
      approvalCode === testCase.expectedApprovalCode;
    const policyMatches =
      testCase.expectedPolicyCode === undefined ||
      policyCode === testCase.expectedPolicyCode;

    if (!(outcomeMatches && approvalMatches && policyMatches)) {
      mismatchCaseIds.push(testCase.id);
    }

    if (approved) passedCases += 1;
    else refusedCases += 1;

    try {
      receiptLog.create({
        summary: `C0 contract case ${testCase.id}: ${approved ? "approved" : "refused"}.`,
        status: approved ? "completed" : "refused",
        links: {},
        details: { caseId: testCase.id, approvalCode, policyCode },
      });
    } catch {
      receiptCrashCount += 1;
    }
  }

  return {
    totalCases: CASES.length,
    passedCases,
    refusedCases,
    mismatchCaseIds,
    allExpectationsMet: mismatchCaseIds.length === 0,
    writeApiCount: 0,
    filesCreatedByCapability: 0,
    simulated: true,
    executed: false,
    replayProtectionScope: "process-local-data",
    receiptCrashCount,
    // Expose reason codes to the digest via a status-vocabulary key so
    // golden baselines can assert refusal-category coverage.
    verdict: [...seenApprovalCodes, ...seenPolicyCodes].sort(),
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoCreateApprovalContracts(), null, 2));
}
