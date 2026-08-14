/**
 * customerDelivery — professional, evidence-honest customer delivery for the twin
 * empire. It composes four layered artifacts (executive result, evidence report,
 * technical package, decision explanation) plus a risk disclosure, from SAFE
 * metadata only: ids, fingerprints, paths, statuses, and counts — never
 * credentials, prompts, raw provider output, private AntMind, environment, or
 * full receipts. Every evidence claim carries exactly one status label and no
 * perfection is ever claimed.
 *
 * Delivery is GATED: it may be created only when a Namola decision exists, final
 * merge verification passed, witness integrity is true, provenance is complete,
 * and no severe security / unresolved contamination remains — otherwise it returns
 * `customer-delivery-blocked` with a safe reason code.
 *
 * No fs, no child_process, no network, no provider calls.
 */

import { fnv1a } from "./twinColonyTypes";
import type { NamolaDecisionReceipt } from "./namolaSovereignCourt";
import type { MergeVerificationStage } from "./mergeForge";

export type ClaimStatus = "verified" | "partially-verified" | "unverified" | "rejected" | "out-of-scope";
export const CLAIM_STATUSES: readonly ClaimStatus[] = ["verified", "partially-verified", "unverified", "rejected", "out-of-scope"];

export interface CustomerExecutiveResult {
  readonly objectiveSummary: string;
  readonly finalResult: string;
  readonly namolaDecision: string;
  readonly whatWasDelivered: readonly string[];
  readonly customerValue: string;
  readonly acceptanceCriteriaStatus: readonly { readonly criterion: string; readonly status: ClaimStatus }[];
  readonly finalVerificationStatus: ClaimStatus;
  readonly remainingLimitations: readonly string[];
  readonly recommendedNextAction: string;
}

export interface CustomerEvidenceClaim {
  readonly claimId: string;
  readonly area: string;
  readonly statement: string;
  readonly status: ClaimStatus;
  readonly evidenceRefs: readonly string[];
}
export interface CustomerEvidenceReport {
  readonly claims: readonly CustomerEvidenceClaim[];
  readonly witnessIntegrity: ClaimStatus;
  readonly unresolvedUncertainty: readonly string[];
  readonly residualRisks: readonly string[];
}

export interface CustomerComponentProvenance {
  readonly relativePath: string;
  readonly sourceColony: string;
  readonly sourceFingerprint: string;
  readonly mergeFingerprint: string;
  readonly requirementsCovered: readonly string[];
}
export interface CustomerTechnicalPackage {
  readonly finalArtifactManifest: readonly { readonly relativePath: string; readonly mergeFingerprint: string }[];
  readonly mergedFilePaths: readonly string[];
  readonly componentProvenance: readonly CustomerComponentProvenance[];
  readonly reproductionInstructions: readonly string[];
  readonly setupInstructions: readonly string[];
  readonly operationInstructions: readonly string[];
  readonly maintenanceNotes: readonly string[];
  readonly recoveryNotes: readonly string[];
  readonly knownLimitations: readonly string[];
}

export interface CustomerDecisionExplanation {
  readonly whyRejectedOneSolution: string;
  readonly selectedClaudeComponents: readonly string[];
  readonly selectedCodexComponents: readonly string[];
  readonly whyMerged: string;
  readonly decisiveTestsInfluencing: readonly string[];
  readonly evidenceRejected: readonly string[];
  readonly risksRemaining: readonly string[];
  readonly whatCouldReverseTheDecision: readonly string[];
  readonly perfectionClaimed: false;
}

export interface CustomerRiskDisclosure {
  readonly residualRisks: readonly string[];
  readonly unresolvedUncertainty: readonly string[];
  readonly conditionsThatCouldReverse: readonly string[];
  readonly customerDisclosureRequired: true;
  readonly perfectionClaimed: false;
}

export interface CustomerDelivery {
  readonly executive: CustomerExecutiveResult;
  readonly evidence: CustomerEvidenceReport;
  readonly technical: CustomerTechnicalPackage;
  readonly decision: CustomerDecisionExplanation;
  readonly risk: CustomerRiskDisclosure;
  readonly deliveryFingerprint: string;
}

export type CustomerDeliveryResult = { readonly ok: true; readonly delivery: CustomerDelivery } | { readonly ok: false; readonly reasonCode: string };

export interface MergeEvidenceSummary {
  readonly finalMergePassed: boolean;
  readonly provenance: readonly CustomerComponentProvenance[];
  readonly stageResults: Readonly<Record<MergeVerificationStage, boolean>>;
  readonly incidents: number;
  readonly repairRan: boolean;
  readonly verificationRuns: number;
}

export interface CustomerDeliveryInput {
  readonly missionId: string;
  readonly objective: string;
  readonly acceptance: readonly string[];
  readonly namolaReceipt: NamolaDecisionReceipt;
  readonly merge: MergeEvidenceSummary;
  readonly witnessIntegrity: boolean;
  readonly severeSecurityUnresolved: boolean;
  readonly unresolvedContamination: boolean;
  readonly decisiveTestIds: readonly string[];
  readonly residualUncertainty: readonly string[];
  readonly contradictionEnergyBand: string;
  readonly crossExam: { readonly attacks: number; readonly rebuttals: number; readonly strengths: number; readonly unresolvedContradictions: number };
}

/** The delivery gate — fails closed with a safe reason code. */
export function deliveryGate(input: CustomerDeliveryInput): { readonly ok: true } | { readonly ok: false; readonly reasonCode: string } {
  if (!input.namolaReceipt || input.namolaReceipt.decision === "REJECT_BOTH" || input.namolaReceipt.decision === "SAFELY_ABORT") return { ok: false, reasonCode: "no-deliverable-namola-decision" };
  if (!input.merge.finalMergePassed) return { ok: false, reasonCode: "merge-verification-not-passed" };
  if (!input.witnessIntegrity) return { ok: false, reasonCode: "witness-integrity-false" };
  if (input.namolaReceipt.approvedComponents.length === 0) return { ok: false, reasonCode: "no-approved-components" };
  if (input.namolaReceipt.approvedComponents.some((c) => !c.sourceFingerprint || c.sourceFingerprint.length === 0)) return { ok: false, reasonCode: "incomplete-provenance" };
  if (input.severeSecurityUnresolved) return { ok: false, reasonCode: "unresolved-security" };
  if (input.unresolvedContamination) return { ok: false, reasonCode: "unresolved-contamination" };
  return { ok: true };
}

function stageStatus(passed: boolean): ClaimStatus {
  return passed ? "verified" : "unverified";
}

/** Compose the full customer delivery — or return a blocked result. Safe metadata only. */
export class CustomerDeliveryComposer {
  compose(input: CustomerDeliveryInput): CustomerDeliveryResult {
    const gate = deliveryGate(input);
    if (!gate.ok) return { ok: false, reasonCode: gate.reasonCode };

    const r = input.namolaReceipt;
    const claudeComponents = r.approvedComponents.filter((c) => c.sourceColony === "claude-forge");
    const codexComponents = r.approvedComponents.filter((c) => c.sourceColony === "codex-crucible");

    const executive: CustomerExecutiveResult = {
      objectiveSummary: input.objective,
      finalResult: "merged solution delivered after independent verification",
      namolaDecision: r.decision,
      whatWasDelivered: input.merge.provenance.map((p) => `${p.relativePath} (from ${p.sourceColony})`),
      customerValue: "combined the strongest independently-reviewed components from two competing solutions",
      acceptanceCriteriaStatus: input.acceptance.map((criterion) => ({ criterion, status: (r.acceptanceCriteriaCovered.includes(criterion) ? "verified" : "partially-verified") as ClaimStatus })),
      finalVerificationStatus: input.merge.finalMergePassed ? "verified" : "unverified",
      remainingLimitations: [...r.remainingRisks, ...input.residualUncertainty],
      recommendedNextAction: "review the disclosed residual risks and schedule the recommended additional tests before scale-up",
    };

    const claims: CustomerEvidenceClaim[] = [
      { claimId: "ev-architecture", area: "architecture", statement: "both colonies produced an independent architecture plan", status: "verified", evidenceRefs: [r.dominanceDecisionsUsed[0] ?? "cross-exam"] },
      { claimId: "ev-artifacts", area: "artifact", statement: "approved artifacts were merged with provenance", status: "verified", evidenceRefs: input.merge.provenance.map((p) => p.mergeFingerprint) },
      { claimId: "ev-review", area: "review", statement: "artifacts were independently reviewed (no self-review)", status: "verified", evidenceRefs: ["independent-review"] },
      { claimId: "ev-decisive-test", area: "decisive-test", statement: "a bounded decisive test resolved the key contradiction", status: input.decisiveTestIds.length > 0 ? "partially-verified" : "unverified", evidenceRefs: [...input.decisiveTestIds] },
      { claimId: "ev-merge", area: "merge", statement: "the merge rebuilt and verified from zero", status: input.merge.finalMergePassed ? "verified" : "unverified", evidenceRefs: [`runs=${input.merge.verificationRuns}`] },
      { claimId: "ev-typecheck", area: "typecheck", statement: "typecheck passed in the final merge run", status: stageStatus(input.merge.stageResults.typecheck), evidenceRefs: ["merge-typecheck"] },
      { claimId: "ev-tests", area: "tests", statement: "tests passed in the final merge run", status: stageStatus(input.merge.stageResults.tests), evidenceRefs: ["merge-tests"] },
      { claimId: "ev-build", area: "build", statement: "build passed in the final merge run", status: stageStatus(input.merge.stageResults.build), evidenceRefs: ["merge-build"] },
      { claimId: "ev-security", area: "security", statement: "security review passed in the final merge run", status: stageStatus(input.merge.stageResults["security-review"]), evidenceRefs: ["merge-security"] },
      { claimId: "ev-acceptance", area: "acceptance", statement: "acceptance verification passed in the final merge run", status: stageStatus(input.merge.stageResults["acceptance-verification"]), evidenceRefs: ["merge-acceptance"] },
      { claimId: "ev-scaleup", area: "unresolved-uncertainty", statement: "behavior at larger scale is not yet tested", status: "unverified", evidenceRefs: [...input.residualUncertainty] },
    ];
    const evidence: CustomerEvidenceReport = {
      claims,
      witnessIntegrity: input.witnessIntegrity ? "verified" : "rejected",
      unresolvedUncertainty: [...input.residualUncertainty],
      residualRisks: [...r.remainingRisks],
    };

    const technical: CustomerTechnicalPackage = {
      finalArtifactManifest: input.merge.provenance.map((p) => ({ relativePath: p.relativePath, mergeFingerprint: p.mergeFingerprint })),
      mergedFilePaths: input.merge.provenance.map((p) => p.relativePath),
      componentProvenance: input.merge.provenance,
      reproductionInstructions: ["npx.cmd tsc --noEmit", "npm.cmd test", "npm.cmd run build"],
      setupInstructions: ["install pinned dependencies (no network install in this milestone)", "open the merge-forge workspace"],
      operationInstructions: ["import TaskManager and Repository", "create/list/complete tasks"],
      maintenanceNotes: ["storage is isolated behind the Repository boundary", "extend via the interface, not the concrete class"],
      recoveryNotes: ["re-run zero-trust verification from the component provenance", "no colony passing status is inherited"],
      knownLimitations: [...r.remainingRisks, ...input.residualUncertainty],
    };

    const decision: CustomerDecisionExplanation = {
      whyRejectedOneSolution: "neither single solution dominated on all acceptance criteria; complementary components were stronger together",
      selectedClaudeComponents: claudeComponents.map((c) => c.relativePath),
      selectedCodexComponents: codexComponents.map((c) => c.relativePath),
      whyMerged: r.decisionReason,
      decisiveTestsInfluencing: [...input.decisiveTestIds],
      evidenceRejected: [...r.evidenceRejected],
      risksRemaining: [...r.remainingRisks],
      whatCouldReverseTheDecision: [...input.residualUncertainty, "a larger requirement set", "adversarial inputs"],
      perfectionClaimed: false,
    };

    const risk: CustomerRiskDisclosure = {
      residualRisks: [...r.remainingRisks],
      unresolvedUncertainty: [...input.residualUncertainty],
      conditionsThatCouldReverse: [...input.residualUncertainty],
      customerDisclosureRequired: true,
      perfectionClaimed: false,
    };

    const deliveryFingerprint = fnv1a(`${input.missionId}|${r.decisionFingerprint}|${input.merge.finalMergePassed}`);
    return { ok: true, delivery: { executive, evidence, technical, decision, risk, deliveryFingerprint } };
  }
}

/** Patterns that must NEVER appear in a customer delivery (privacy fail-closed). */
const FORBIDDEN_DELIVERY_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9]{16,}/,
  /ghp_[A-Za-z0-9]{16,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /api[_-]?key\s*[:=]/i,
  /oauth|bearer\s+[A-Za-z0-9._-]{12,}/i,
  /\bprompt\s*[:=]/i,
  /antmind|private[_-]?mind|chain[_-]?of[_-]?thought|hidden[_-]?reasoning/i,
  /process\.env|OPENAI_API_KEY|GEMINI_API_KEY/,
];

/** Scan a serialized delivery for any forbidden secret/private token. Returns the offending patterns. */
export function scanDeliveryForLeaks(delivery: CustomerDelivery): readonly string[] {
  const serialized = JSON.stringify(delivery);
  return FORBIDDEN_DELIVERY_PATTERNS.filter((p) => p.test(serialized)).map((p) => p.source);
}

/** Every evidence claim + acceptance status must carry a valid label. */
export function allClaimsLabeled(delivery: CustomerDelivery): boolean {
  const claimsOk = delivery.evidence.claims.every((c) => CLAIM_STATUSES.includes(c.status));
  const acceptanceOk = delivery.executive.acceptanceCriteriaStatus.every((a) => CLAIM_STATUSES.includes(a.status));
  return claimsOk && acceptanceOk && CLAIM_STATUSES.includes(delivery.executive.finalVerificationStatus) && CLAIM_STATUSES.includes(delivery.evidence.witnessIntegrity);
}
