/**
 * frozenEvidenceIntegrityTests — a frozen bundle must be immutable in every part
 * a decision depends on, and its digest must distinguish the states that decide.
 *
 * THE DEFECT THESE LOCK DOWN. `Object.freeze` is shallow. Everything that reached
 * a frozen bundle through the `...draft` spread kept its original reference and
 * stayed mutable, so `bundle.verification.finalStatus = "VERIFIED"` succeeded
 * silently on a bundle that had frozen as VERIFICATION_BLOCKED. That flipped
 * `isVerifiedCandidate` from false to true and moved the court from SELECT_CLAUDE
 * to MERGE — while the stored AND recomputed fingerprints stayed identical, so no
 * integrity check could observe it. Verification evidence was also absent from
 * the canonical projection, so a VERIFIED and a VERIFICATION_BLOCKED bundle with
 * the same files shared one fingerprint.
 *
 * Deterministic: no fs, no child_process, no network, no wall clock.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { freezeBundle } from "../twin/colonyForge";
import { isVerifiedCandidate, bundleCanonicalProjection, fnv1a } from "../twin/twinColonyTypes";
import type { ColonyEvidenceBundle, TwinCandidateVerificationEvidence } from "../twin/twinColonyTypes";
import { judgeTwinBundles } from "../twin/namolaCourt";
import { evaluateHardRejections } from "../twin/namolaSovereignCourt";
import { validateFrozenBundle } from "../twin/frozenBundleValidator";
import { SilentWitness } from "../twin/silentWitness";

const CONTRACT = { criteria: ["works"], requireIndependentReview: true, requireFrozenBundle: true } as const;

function evidence(status: TwinCandidateVerificationEvidence["finalStatus"]): TwinCandidateVerificationEvidence {
  return {
    finalStatus: status,
    verificationRounds: 1,
    repairAttempts: 1,
    filesAppliedByRepair: 1,
    sandboxBackendId: status === "VERIFICATION_BLOCKED" ? "none" : "container",
    sandboxVerified: status !== "VERIFICATION_BLOCKED",
    stopReason: null,
    stageReceipts: [{ attempt: 0, stage: "typecheck", commandId: "typecheck", status: status === "VERIFIED" ? "PASS" : "BLOCKED", safeReasonCode: null, outputLineCount: 0, realProcessExecutions: 1 }],
    repairReceipts: [{ attempt: 1, antId: "ant-impl-repair-1", ok: true, realProcessExecution: false, filesProposed: 1, filesApplied: 1 }],
    workspaceFingerprint: "tw-ws",
  };
}

function draftFor(colonyId: "claude-forge" | "codex-crucible", relPath: string, version2?: TwinCandidateVerificationEvidence["finalStatus"]) {
  const artifact = { relativePath: relPath, content: "export const x = 1;", purpose: "p", acceptanceCriteriaCovered: ["works"] };
  return {
    colonyId, missionId: "m", culture: colonyId === "claude-forge" ? ("architecture-first" as const) : ("implementation-first" as const),
    workspacePath: `workspaces/namola-twin/m/${colonyId}`,
    architecture: { architectureSummary: "s", filePlan: [relPath], acceptanceMapping: ["covers works"], interfaceDecisions: [], risks: [] },
    artifacts: [artifact],
    artifactManifest: [{ relativePath: relPath, bytes: artifact.content.length, fingerprint: "fp" }],
    reviews: [{ reviewerAntId: "r", authorAntId: "a", decision: "approve" as const, findings: ["ok"], securityFindings: [], selfReview: false }],
    testEvidence: { testsProposed: 1, independentReviews: 1, artifactCount: 1 },
    securityEvidence: { findings: [], passed: true },
    performanceEvidence: [{ check: "size", observed: 1, budget: 10, withinBudget: true }],
    riskRegister: ["r"], failureRegister: [], uncertaintyRegister: ["u"], minorityReports: [],
    providerReceipts: [{ antId: "a", providerId: "claude", role: "implementation", ok: true, real: true }],
    costReport: { providerCalls: 3, realProviderCalls: 3 },
    reproductionInstructions: ["npx.cmd tsc --noEmit"],
    ...(version2 ? { evidenceVersion: 2 as const, verification: evidence(version2) } : {}),
  };
}

const v2Bundle = (colonyId: "claude-forge" | "codex-crucible", relPath: string, status: TwinCandidateVerificationEvidence["finalStatus"]) => freezeBundle(draftFor(colonyId, relPath, status));
const v1Bundle = (colonyId: "claude-forge" | "codex-crucible", relPath: string) => freezeBundle(draftFor(colonyId, relPath));

// 1-6: every layer of a v2 bundle is actually frozen.
test("1-6: a frozen v2 bundle is frozen at every verification layer", () => {
  const b = v2Bundle("claude-forge", "src/a.ts", "VERIFICATION_BLOCKED");
  assert.equal(Object.isFrozen(b), true, "1. top-level bundle");
  assert.equal(Object.isFrozen(b.verification), true, "2. verification object");
  assert.equal(Object.isFrozen(b.verification?.stageReceipts), true, "3. stageReceipts array");
  assert.equal(b.verification?.stageReceipts.every((r) => Object.isFrozen(r)), true, "4. each stage receipt");
  assert.equal(Object.isFrozen(b.verification?.repairReceipts), true, "5. repairReceipts array");
  assert.equal(b.verification?.repairReceipts.every((r) => Object.isFrozen(r)), true, "6. each repair receipt");
});

test("1-6b: the other decision-relevant structures are frozen too", () => {
  // These all reached the bundle through the spread and were mutable, so the
  // object claimed `frozen: true` while its own evidence could still be edited.
  const b = v2Bundle("claude-forge", "src/a.ts", "VERIFIED");
  for (const [name, value] of [
    ["testEvidence", b.testEvidence], ["costReport", b.costReport], ["riskRegister", b.riskRegister],
    ["failureRegister", b.failureRegister], ["uncertaintyRegister", b.uncertaintyRegister],
    ["minorityReports", b.minorityReports], ["reproductionInstructions", b.reproductionInstructions],
    ["architecture.filePlan", b.architecture.filePlan], ["architecture.risks", b.architecture.risks],
    ["artifacts[0].acceptanceCriteriaCovered", b.artifacts[0].acceptanceCriteriaCovered],
    ["reviews[0].findings", b.reviews[0].findings], ["securityEvidence.findings", b.securityEvidence.findings],
  ] as const) {
    assert.equal(Object.isFrozen(value), true, `${name} must be frozen`);
  }
});

test("7: finalStatus cannot mutate after freeze", () => {
  const b = v2Bundle("claude-forge", "src/a.ts", "VERIFICATION_BLOCKED");
  assert.equal(isVerifiedCandidate(b), false, "blocked before the attempt");
  assert.throws(() => {
    (b.verification as { finalStatus: string }).finalStatus = "VERIFIED";
  }, TypeError, "the assignment must be refused, not silently dropped");
  assert.equal(b.verification?.finalStatus, "VERIFICATION_BLOCKED", "the value is unchanged");
  assert.equal(isVerifiedCandidate(b), false, "and the candidate is still not verified");
});

test("8: verification evidence cannot be appended after freeze", () => {
  const b = v2Bundle("claude-forge", "src/a.ts", "VERIFICATION_BLOCKED");
  const stages = b.verification?.stageReceipts.length ?? 0;
  const repairs = b.verification?.repairReceipts.length ?? 0;
  assert.throws(() => (b.verification?.stageReceipts as unknown as unknown[]).push({}), TypeError);
  assert.throws(() => (b.verification?.repairReceipts as unknown as unknown[]).push({}), TypeError);
  assert.throws(() => {
    (b.verification?.stageReceipts[0] as { status: string }).status = "PASS";
  }, TypeError, "an individual receipt is sealed too");
  assert.equal(b.verification?.stageReceipts.length, stages);
  assert.equal(b.verification?.repairReceipts.length, repairs);
});

test("9: a court verdict cannot be changed through post-freeze verification mutation", () => {
  const witness = new SilentWitness().report();
  const good = v2Bundle("claude-forge", "src/a.ts", "VERIFIED");
  const bad = v2Bundle("codex-crucible", "src/b.ts", "VERIFICATION_BLOCKED");
  const courtInput = { claude: good, codex: bad, witness, admittedFindings: [], dominanceDecisions: [], residualUncertainty: [], acceptance: ["works"], budget: { maxMergeComponents: 8 } };

  const before = judgeTwinBundles(good, bad, witness, CONTRACT);
  const beforeGate = evaluateHardRejections(courtInput).find((c) => c.id === "no-unverified-v2-candidate")?.passed;
  assert.equal(before.decision, "SELECT_CLAUDE");
  assert.equal(beforeGate, false);
  // The blocked candidate is structurally VALID — that is precisely why the
  // verdict must not be reachable by editing its evidence.
  assert.equal(validateFrozenBundle(bad).valid, true);

  assert.throws(() => {
    (bad.verification as { finalStatus: string }).finalStatus = "VERIFIED";
  }, TypeError);

  const after = judgeTwinBundles(good, bad, witness, CONTRACT);
  const afterGate = evaluateHardRejections(courtInput).find((c) => c.id === "no-unverified-v2-candidate")?.passed;
  assert.equal(after.decision, before.decision, "the verdict is unchanged");
  assert.equal(after.reason, before.reason);
  assert.deepEqual(after.codexScore.disqualifiers, ["candidate-not-verified"]);
  assert.equal(afterGate, false, "the merge gate stays closed");
});

test("10: v1 projection and fingerprints are byte-identical to their historical form", () => {
  const d = draftFor("claude-forge", "src/a.ts");
  // The historical projection, restated literally. If the production projection
  // ever drifts for v1, this fails — extending v2 coverage must not restate an
  // old bundle's digest.
  const historical = JSON.stringify({
    colonyId: d.colonyId, missionId: d.missionId, culture: d.culture, workspacePath: d.workspacePath,
    filePlan: d.architecture.filePlan,
    artifacts: d.artifacts.map((a) => ({ p: a.relativePath, c: a.content.length })),
    manifest: d.artifactManifest.map((m) => ({ p: m.relativePath, b: m.bytes, f: m.fingerprint })),
    reviews: d.reviews.map((r) => ({ d: r.decision, self: r.selfReview })),
    security: { passed: d.securityEvidence.passed, findings: d.securityEvidence.findings.length },
    performance: d.performanceEvidence.map((p) => ({ c: p.check, ok: p.withinBudget })),
    risk: d.riskRegister.length, uncertainty: d.uncertaintyRegister.length,
    reproduction: d.reproductionInstructions, artifactCount: d.artifacts.length,
  });
  assert.equal(bundleCanonicalProjection(d), historical, "v1 projection must not change");
  const frozen = v1Bundle("claude-forge", "src/a.ts");
  assert.equal(frozen.fingerprint, fnv1a(historical), "v1 fingerprint must not change");
  assert.equal(frozen.evidenceVersion, undefined);
  assert.equal(isVerifiedCandidate(frozen), false, "a v1 bundle is unexamined, never verified");
  assert.equal(validateFrozenBundle(frozen).valid, false, "v1 with real provider calls stays disqualified");
});

test("11: v2 bundles differing only in verification verdict have DISTINCT fingerprints", () => {
  const verified = v2Bundle("claude-forge", "src/a.ts", "VERIFIED");
  const blockedBundle = v2Bundle("claude-forge", "src/a.ts", "VERIFICATION_BLOCKED");
  assert.notEqual(verified.fingerprint, blockedBundle.fingerprint, "the digest must distinguish the two states it most needs to");

  // Receipts are covered too, so evidence cannot be edited without moving the digest.
  const extraReceipt = { ...draftFor("claude-forge", "src/a.ts", "VERIFIED") };
  const withExtra = freezeBundle({
    ...extraReceipt,
    verification: { ...evidence("VERIFIED"), stageReceipts: [...evidence("VERIFIED").stageReceipts, { attempt: 1, stage: "test", commandId: "test", status: "PASS", safeReasonCode: null, outputLineCount: 3, realProcessExecutions: 1 }] },
  });
  assert.notEqual(withExtra.fingerprint, verified.fingerprint, "an added stage receipt changes the digest");

  // And the recomputed digest still matches, so the validator agrees.
  assert.equal(fnv1a(bundleCanonicalProjection(verified)), verified.fingerprint);
  assert.equal(validateFrozenBundle(verified).fingerprintMatches, true);
});
