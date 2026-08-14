// Focused feature demo — proves the C2-A authority/admission contracts.
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoC2AuthorityContracts: exercises the Capability C2-A contracts against a
 * table of valid and refusal/blocked cases. Everything here is DATA ONLY: no
 * file is written, no fs is imported, no grant is consumed, and no permit is
 * minted from a production runtime path (the demo mints via the trusted
 * bootstrap directly, which is the only approved minting location).
 *
 * It proves: a genuine trusted permit + consistent contracts yields a
 * candidate-ready state; a forged object-literal permit is refused; the
 * strict C2 policy, exact-byte checks, C0 approval, and injected C1 boundary
 * findings all refuse/block correctly; the exact-byte fingerprint changes
 * when the bytes change; and the non-mutating ProjectFileCreator never
 * reports a write. Raw paths and raw content never enter the output.
 *
 * Special code units (BOM/NUL/CR/control/surrogates) are built with
 * String.fromCharCode(...) so this source file stays pure ASCII.
 */

import { fingerprint } from "../core/redaction";
import { ReceiptLog } from "../core/receiptLog";
import type { CodeProposal } from "../generation/codeProposal";
import type { SafetyDecision } from "../types/safetyTypes";
import type {
  ConsumedApprovalState,
  CreateOperationDescriptor,
  HumanApprovalGrant,
} from "../application/createCapabilityTypes";
import type { CreateTargetInspection } from "../application/createTargetInspectionTypes";
import { computeIntegrityFingerprint } from "../application/proposalIntegrity";
import { prepareExactUtf8Content } from "../application/exactContentBytes";
import {
  WriteAttemptAdmissionInput,
  evaluateWriteAttemptAdmission,
} from "../application/writeAttemptAdmission";
import { prepareCreationAttempt } from "../application/projectFileCreator";
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
  const proposalId = `proposal-c2a-${idSuffix}`;
  const proposalReceiptId = `receipt-c2a-${idSuffix}-proposal`;
  const reviewVerdict = "clean";
  const reviewReceiptId = `receipt-c2a-${idSuffix}-review`;

  const proposal: CodeProposal = {
    proposalId,
    missionId: "mission-c2a-demo",
    taskId: `ptask-c2a-${idSuffix}`,
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
    grantId: `grant-c2a-${idSuffix}`,
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

function inspection(
  path: string,
  overrides: Partial<CreateTargetInspection> = {}
): CreateTargetInspection {
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
    inspectionReceiptId: "receipt-synthetic-c2a-inspection",
    reasonCodes: ["target-inspection-clean"],
    ...overrides,
  };
}

const trustedPermit = createTrustedC2WriteAuthorityPermit({
  bootstrapKind: "trusted-one-shot",
  scope: "create-one-generated-markdown",
  acknowledgement: "c2a-contracts-only-no-write",
});

const forgedLiteralPermit: unknown = {
  scope: "create-one-generated-markdown",
  directory: "docs/generated/",
  extension: ".md",
  maxBytes: 65536,
  authorityVersion: 1,
  bootstrapKind: "trusted-one-shot",
};

const wrongScopeForgedPermit: unknown = {
  scope: "create-many-project-files",
  directory: "docs/generated/",
  extension: ".md",
  maxBytes: 65536,
  authorityVersion: 1,
  bootstrapKind: "trusted-one-shot",
};

type PermitKind = "trusted" | "forged" | "wrong-scope" | "missing";

interface Case {
  id: string;
  permitKind: PermitKind;
  expectedStatus: "candidate-ready-for-c2b-review" | "refused" | "blocked";
  expectedReason: string;
  expectedUnderlying?: string;
  creatorCheck?: boolean;
  assemble: () => Omit<WriteAttemptAdmissionInput, "permit">;
}

function asProposal(proposal: CodeProposal, overrides: Record<string, unknown>): CodeProposal {
  return { ...(proposal as unknown as Record<string, unknown>), ...overrides } as unknown as CodeProposal;
}
function asDescriptor(
  descriptor: CreateOperationDescriptor,
  overrides: Record<string, unknown>
): CreateOperationDescriptor {
  return { ...(descriptor as unknown as Record<string, unknown>), ...overrides } as unknown as CreateOperationDescriptor;
}

const emptyConsumed: ConsumedApprovalState = { consumedGrantIds: [] };

/** Build a valid, fully-consistent admission assembly for a given path/content. */
function validAssembly(idSuffix: string, path = VALID_PATH, content = HARMLESS) {
  const fx = baseFixture(idSuffix, path, content);
  return {
    fx,
    input: {
      proposal: fx.proposal,
      descriptor: fx.descriptor,
      grant: fx.grant,
      consumed: emptyConsumed,
      targetInspection: inspection(path),
      reviewVerdict: fx.reviewVerdict,
      reviewReceiptId: fx.reviewReceiptId,
    } as Omit<WriteAttemptAdmissionInput, "permit">,
  };
}

// Special-character contents, built from char codes to keep the source ASCII.
const CC = (code: number): string => String.fromCharCode(code);
const CONTENT_BOM = CC(0xfeff) + "# note\n";
const CONTENT_NUL = "# note" + CC(0x00) + " end\n";
const CONTENT_CR = "# note" + CC(0x0d) + "\nend\n";
const CONTENT_CONTROL = "# note" + CC(0x07) + " end\n";
const CONTENT_HIGH_SURROGATE = "# note " + CC(0xd800) + " x\n";
const CONTENT_LOW_SURROGATE = "# note " + CC(0xdc00) + " x\n";

const CASES: Case[] = [
  {
    id: "valid-candidate-ready",
    permitKind: "trusted",
    expectedStatus: "candidate-ready-for-c2b-review",
    expectedReason: "candidate-ready-for-c2b-review",
    assemble: () => validAssembly("valid").input,
  },
  { id: "missing-permit", permitKind: "missing", expectedStatus: "refused", expectedReason: "write-authority-permit-invalid", assemble: () => validAssembly("missing").input },
  { id: "forged-literal-permit", permitKind: "forged", expectedStatus: "refused", expectedReason: "write-authority-permit-invalid", assemble: () => validAssembly("forged").input },
  { id: "wrong-permit-scope", permitKind: "wrong-scope", expectedStatus: "refused", expectedReason: "write-authority-permit-invalid", assemble: () => validAssembly("wrongscope").input },

  // ---- strict C2 policy refusals (gate 2) ----
  { id: "wrong-directory", permitKind: "trusted", expectedStatus: "refused", expectedReason: "c2-policy-refused", expectedUnderlying: "not-in-generated-dir", assemble: () => validAssembly("wrongdir", "docs/other/note.md").input },
  { id: "nested-path", permitKind: "trusted", expectedStatus: "refused", expectedReason: "c2-policy-refused", expectedUnderlying: "nested-path", assemble: () => validAssembly("nested", "docs/generated/sub/note.md").input },
  { id: "wrong-extension", permitKind: "trusted", expectedStatus: "refused", expectedReason: "c2-policy-refused", expectedUnderlying: "disallowed-extension", assemble: () => validAssembly("ext", "docs/generated/note.txt").input },
  { id: "uppercase-filename", permitKind: "trusted", expectedStatus: "refused", expectedReason: "c2-policy-refused", expectedUnderlying: "filename-not-allowed", assemble: () => validAssembly("upper", "docs/generated/Note.md").input },
  { id: "windows-reserved-basename", permitKind: "trusted", expectedStatus: "refused", expectedReason: "c2-policy-refused", expectedUnderlying: "windows-reserved-name", assemble: () => validAssembly("reserved", "docs/generated/con.md").input },
  { id: "absolute-path", permitKind: "trusted", expectedStatus: "refused", expectedReason: "c2-policy-refused", expectedUnderlying: "absolute-path", assemble: () => validAssembly("abs", "/docs/generated/note.md").input },
  { id: "traversal", permitKind: "trusted", expectedStatus: "refused", expectedReason: "c2-policy-refused", expectedUnderlying: "path-traversal", assemble: () => validAssembly("trav", "docs/generated/../note.md").input },
  { id: "protected-filename", permitKind: "trusted", expectedStatus: "refused", expectedReason: "c2-policy-refused", expectedUnderlying: "protected-name-segment", assemble: () => validAssembly("prot", "docs/generated/token.md").input },
  { id: "oversized-content", permitKind: "trusted", expectedStatus: "refused", expectedReason: "c2-policy-refused", expectedUnderlying: "content-too-large", assemble: () => validAssembly("big", VALID_PATH, "a".repeat(65537)).input },
  { id: "bom", permitKind: "trusted", expectedStatus: "refused", expectedReason: "c2-policy-refused", expectedUnderlying: "bom-not-allowed", assemble: () => validAssembly("bom", VALID_PATH, CONTENT_BOM).input },
  { id: "nul", permitKind: "trusted", expectedStatus: "refused", expectedReason: "c2-policy-refused", expectedUnderlying: "nul-not-allowed", assemble: () => validAssembly("nul", VALID_PATH, CONTENT_NUL).input },
  { id: "carriage-return", permitKind: "trusted", expectedStatus: "refused", expectedReason: "c2-policy-refused", expectedUnderlying: "carriage-return-not-allowed", assemble: () => validAssembly("cr", VALID_PATH, CONTENT_CR).input },
  { id: "disallowed-control", permitKind: "trusted", expectedStatus: "refused", expectedReason: "c2-policy-refused", expectedUnderlying: "control-char-not-allowed", assemble: () => validAssembly("ctrl", VALID_PATH, CONTENT_CONTROL).input },
  { id: "unpaired-high-surrogate", permitKind: "trusted", expectedStatus: "refused", expectedReason: "c2-policy-refused", expectedUnderlying: "unpaired-high-surrogate", assemble: () => validAssembly("hi", VALID_PATH, CONTENT_HIGH_SURROGATE).input },
  { id: "unpaired-low-surrogate", permitKind: "trusted", expectedStatus: "refused", expectedReason: "c2-policy-refused", expectedUnderlying: "unpaired-low-surrogate", assemble: () => validAssembly("lo", VALID_PATH, CONTENT_LOW_SURROGATE).input },

  // ---- C0 approval refusals (gate 3) ----
  {
    id: "proposal-id-mismatch",
    permitKind: "trusted",
    expectedStatus: "refused",
    expectedReason: "c0-approval-refused",
    expectedUnderlying: "grant-proposal-mismatch",
    assemble: () => {
      const { fx, input } = validAssembly("pidmm");
      return { ...input, grant: { ...fx.grant, proposalId: "proposal-other" } };
    },
  },
  {
    id: "path-changed-after-approval",
    permitKind: "trusted",
    expectedStatus: "refused",
    expectedReason: "c0-approval-refused",
    expectedUnderlying: "descriptor-path-mismatch",
    assemble: () => {
      const { fx, input } = validAssembly("pathchg");
      return { ...input, proposal: { ...fx.proposal, targetRelativePath: "docs/generated/other.md" } };
    },
  },
  {
    id: "content-changed-after-approval",
    permitKind: "trusted",
    expectedStatus: "refused",
    expectedReason: "c0-approval-refused",
    expectedUnderlying: "descriptor-length-mismatch",
    assemble: () => {
      const { fx, input } = validAssembly("ctchg");
      return { ...input, proposal: { ...fx.proposal, proposedContent: "# changed body\n" } };
    },
  },
  {
    id: "review-reference-changed",
    permitKind: "trusted",
    expectedStatus: "refused",
    expectedReason: "c0-approval-refused",
    expectedUnderlying: "integrity-mismatch",
    assemble: () => {
      const { input } = validAssembly("revchg");
      return { ...input, reviewReceiptId: "receipt-c2a-revchg-review-tampered" };
    },
  },
  {
    id: "wrong-change-kind",
    permitKind: "trusted",
    expectedStatus: "refused",
    expectedReason: "c2-policy-refused",
    expectedUnderlying: "wrong-change-kind",
    assemble: () => {
      const { fx, input } = validAssembly("kind");
      return {
        ...input,
        proposal: asProposal(fx.proposal, { changeKind: "modify" }),
        descriptor: asDescriptor(fx.descriptor, { changeKind: "modify" }),
      };
    },
  },
  {
    id: "applied-true",
    permitKind: "trusted",
    expectedStatus: "refused",
    expectedReason: "c2-policy-refused",
    expectedUnderlying: "applied-not-false",
    assemble: () => {
      const { fx, input } = validAssembly("applied");
      return { ...input, proposal: asProposal(fx.proposal, { applied: true }) };
    },
  },
  {
    id: "requires-human-approval-false",
    permitKind: "trusted",
    expectedStatus: "refused",
    expectedReason: "c2-policy-refused",
    expectedUnderlying: "requires-human-approval-false",
    assemble: () => {
      const { fx, input } = validAssembly("rha");
      return { ...input, proposal: asProposal(fx.proposal, { requiresHumanApproval: false }) };
    },
  },
  {
    id: "consumed-grant",
    permitKind: "trusted",
    expectedStatus: "refused",
    expectedReason: "c0-approval-refused",
    expectedUnderlying: "grant-already-consumed",
    assemble: () => {
      const { fx, input } = validAssembly("consumed");
      return { ...input, consumed: { consumedGrantIds: [fx.grant.grantId] } };
    },
  },
  {
    id: "multiple-operation",
    permitKind: "trusted",
    expectedStatus: "refused",
    expectedReason: "c2-policy-refused",
    expectedUnderlying: "not-single-operation",
    assemble: () => ({ ...validAssembly("multi").input, operationCount: 2 }),
  },

  // ---- injected C1 boundary blocks (gates 4-5) ----
  {
    id: "incomplete-inspection",
    permitKind: "trusted",
    expectedStatus: "blocked",
    expectedReason: "inspection-incomplete",
    assemble: () => ({ ...validAssembly("incomplete").input, targetInspection: inspection(VALID_PATH, { filesystemInspectionCompleted: false, reasonCodes: ["inspection-error"] }) }),
  },
  {
    id: "target-collision",
    permitKind: "trusted",
    expectedStatus: "blocked",
    expectedReason: "boundary-target-exists",
    assemble: () => ({ ...validAssembly("collision").input, targetInspection: inspection(VALID_PATH, { targetExists: true, reasonCodes: ["target-exists"] }) }),
  },
  {
    id: "parent-link-boundary",
    permitKind: "trusted",
    expectedStatus: "blocked",
    expectedReason: "boundary-parent-chain-link",
    assemble: () => ({ ...validAssembly("link").input, targetInspection: inspection(VALID_PATH, { parentChainContainsLink: true, reasonCodes: ["parent-chain-link-surface"] }) }),
  },

  // ---- valid candidate handed to the non-mutating creator ----
  {
    id: "creator-non-mutating",
    permitKind: "trusted",
    expectedStatus: "candidate-ready-for-c2b-review",
    expectedReason: "candidate-ready-for-c2b-review",
    creatorCheck: true,
    assemble: () => validAssembly("creator").input,
  },
];

function permitFor(kind: PermitKind): unknown {
  switch (kind) {
    case "trusted":
      return trustedPermit;
    case "forged":
      return forgedLiteralPermit;
    case "wrong-scope":
      return wrongScopeForgedPermit;
    case "missing":
      return undefined;
  }
}

export function runDemoC2AuthorityContracts() {
  const receiptLog = new ReceiptLog();
  const mismatchCaseIds: string[] = [];
  const seenReasonCodes = new Set<string>();
  let receiptCrashCount = 0;

  let refusedCases = 0;
  let blockedCases = 0;
  let candidateReadyCases = 0;
  let passedCases = 0;
  let trustedPermitAcceptedCount = 0;
  let forgedPermitAcceptedCount = 0;
  let creatorNonMutatingVerified = true;

  for (const testCase of CASES) {
    const input: WriteAttemptAdmissionInput = {
      permit: permitFor(testCase.permitKind),
      ...testCase.assemble(),
    };

    const candidate = evaluateWriteAttemptAdmission(input);
    seenReasonCodes.add(candidate.reasonCode);
    if (candidate.underlyingReasonCode) seenReasonCodes.add(candidate.underlyingReasonCode);

    if (testCase.permitKind === "trusted" && candidate.authorityRecognized) trustedPermitAcceptedCount += 1;
    if ((testCase.permitKind === "forged" || testCase.permitKind === "wrong-scope") && candidate.authorityRecognized) {
      forgedPermitAcceptedCount += 1;
    }

    if (candidate.status === "refused") refusedCases += 1;
    else if (candidate.status === "blocked") blockedCases += 1;
    else if (candidate.status === "candidate-ready-for-c2b-review") candidateReadyCases += 1;

    const statusMatches = candidate.status === testCase.expectedStatus;
    const reasonMatches = candidate.reasonCode === testCase.expectedReason;
    const underlyingMatches =
      testCase.expectedUnderlying === undefined ||
      candidate.underlyingReasonCode === testCase.expectedUnderlying;

    let creatorOk = true;
    if (testCase.creatorCheck) {
      const result = prepareCreationAttempt(candidate);
      creatorOk =
        result.attempted === false &&
        result.writePerformed === false &&
        result.grantConsumed === false &&
        result.completed === false &&
        result.exclusiveOpenOccurred === false &&
        result.bytesWritten === 0 &&
        result.requiresC2BPrimitive === true &&
        result.reasonCode === "c2b-write-primitive-not-installed";
      if (!creatorOk) creatorNonMutatingVerified = false;
    }

    const ok = statusMatches && reasonMatches && underlyingMatches && creatorOk;
    if (ok) passedCases += 1;
    else mismatchCaseIds.push(testCase.id);

    try {
      receiptLog.create({
        summary: `C2-A contract case ${testCase.id}: ${candidate.status}.`,
        status:
          candidate.status === "candidate-ready-for-c2b-review"
            ? "approved"
            : candidate.status === "blocked"
              ? "blocked"
              : "refused",
        links: {},
        details: {
          caseId: testCase.id,
          reasonCode: candidate.reasonCode,
          underlyingReasonCode: candidate.underlyingReasonCode,
        },
      });
    } catch {
      receiptCrashCount += 1;
    }
  }

  // Exact-byte fingerprint changes when the bytes change (independent binding).
  const fpA = prepareExactUtf8Content("# alpha\n");
  const fpB = prepareExactUtf8Content("# bravo\n");
  const exactByteFingerprintLength = fpA.ok ? fpA.contentBytesFingerprint.length : 0;
  const exactByteFingerprintChangesWithBytes =
    fpA.ok && fpB.ok && fpA.contentBytesFingerprint !== fpB.contentBytesFingerprint;

  const allExpectationsMet =
    mismatchCaseIds.length === 0 &&
    creatorNonMutatingVerified &&
    exactByteFingerprintChangesWithBytes &&
    forgedPermitAcceptedCount === 0;

  return {
    totalCases: CASES.length,
    passedCases,
    refusedCases,
    blockedCases,
    candidateReadyCases,
    mismatchCaseIds,
    allExpectationsMet,
    trustedPermitAcceptedCount,
    forgedPermitAcceptedCount,
    runtimePermitMintCount: 0,
    grantConsumedByC2A: false,
    writeAttemptCount: 0,
    writePerformedCount: 0,
    filesCreatedByCapability: 0,
    filesystemMutationApiCount: 0,
    fsImporterCount: 1,
    exactByteFingerprintLength,
    processLocalReplayOnly: true,
    durableReplayProtection: false,
    simulated: true,
    executed: false,
    receiptCrashCount,
    // Expose reason codes to the digest as status vocabulary for the golden.
    verdict: [...seenReasonCodes].sort(),
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoC2AuthorityContracts(), null, 2));
}
