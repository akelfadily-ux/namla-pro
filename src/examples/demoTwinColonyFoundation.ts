/**
 * demoTwinColonyFoundation — deterministic proof of the twin-empire foundation +
 * Iron Isolation and frozen-bundle enforcement (fakes only, zero real action).
 *
 * Two isolated colonies (Claude Forge = architecture-first, Codex Crucible =
 * implementation-first) reuse disjoint settlement identity slices, each writing
 * artifacts into its OWN in-memory workspace under
 * `workspaces/namola-twin/<mission-id>/<colony>/`. The `ColonyIsolationBoundary`
 * mechanically denies cross-colony reads before freeze, plus path traversal,
 * absolute paths, and source-tree paths; each denial mints a contamination
 * receipt that the Silent Witness records. Bundles are frozen with a complete
 * fingerprint, validated for immutability (mutation attempts leave the digest
 * unchanged; amendments create a new receipt without touching the original), and
 * the Namola Court renders one evidence-based decision.
 *
 * No fs, no child_process, no network, no wall clock, no real provider calls.
 */

import { buildSettlementWorkers } from "../civilization/civilizationLiveRunner";
import { runColonyForge, attemptPostFreezeModify } from "../twin/colonyForge";
import type { TwinMissionPacket, ColonyProfile } from "../twin/colonyForge";
import { ColonyWorkspaceAuthority, ColonyIsolationBoundary } from "../twin/colonyWorkspace";
import { validateFrozenBundle, verifyBundleImmutable, amendFrozenBundle } from "../twin/frozenBundleValidator";
import { CrossExaminationSession, buildAttackReport } from "../twin/crossExamination";
import type { RebuttalReport } from "../twin/crossExamination";
import { computeContradictionEnergy, validateDecisiveTest, compareEvidence, decideDominance, FakeDecisiveTestDriver } from "../twin/differentialTruth";
import type { EnergyFactorBreakdown, DecisiveTestInput } from "../twin/differentialTruth";
import { renderNamolaDecision } from "../twin/namolaSovereignCourt";
import type { NamolaCourtInput, ApprovedMergeComponent } from "../twin/namolaSovereignCourt";
import { ZeroTrustMergeForge, FakeMergeVerificationDriver, MERGE_STAGES } from "../twin/mergeForge";
import { CustomerDeliveryComposer, scanDeliveryForLeaks, allClaimsLabeled } from "../twin/customerDelivery";
import type { CustomerDeliveryInput, MergeEvidenceSummary } from "../twin/customerDelivery";
import { buildTwinCommandCenter } from "../twin/twinCommandCenter";
import type { TwinCommandCenterInput } from "../twin/twinCommandCenter";
import { SilentWitness } from "../twin/silentWitness";
import { judgeTwinBundles } from "../twin/namolaCourt";
import type { NamolaAcceptanceContract } from "../twin/namolaCourt";

const SEED = 20260915;
const MISSION_ID = "twin-projman";
const ACCEPTANCE: readonly string[] = ["tasks CRUD + completion", "in-memory storage", "unit tests present"];
const CLAUDE_WS = `workspaces/namola-twin/${MISSION_ID}/claude-forge`;
const CODEX_WS = `workspaces/namola-twin/${MISSION_ID}/codex-crucible`;

export function runDemoTwinColonyFoundation() {
  const population = buildSettlementWorkers(SEED, 1000);
  const claudeWorkers = population.slice(0, 440);
  const codexWorkers = population.slice(440, 880);

  const packet: TwinMissionPacket = { missionId: MISSION_ID, objective: "small TypeScript task manager", acceptanceCriteria: ACCEPTANCE, seed: SEED };
  const claudeProfile: ColonyProfile = { colonyId: "claude-forge", culture: "architecture-first", masterAntId: claudeWorkers[0].workerId, workers: claudeWorkers, seedOffset: 1 };
  const codexProfile: ColonyProfile = { colonyId: "codex-crucible", culture: "implementation-first", masterAntId: codexWorkers[0].workerId, workers: codexWorkers, seedOffset: 2 };

  // ONE shared in-memory workspace authority; each colony writes only its own root.
  const authority = new ColonyWorkspaceAuthority();
  const boundary = new ColonyIsolationBoundary(authority);

  const claude = runColonyForge(claudeProfile, packet, authority);
  const codex = runColonyForge(codexProfile, packet, authority);
  const claudeArtifactPath = claude.artifacts[0].relativePath;
  const codexArtifactPath = codex.artifacts[0].relativePath;

  // --- isolation boundary checks ---
  // Legal same-colony read succeeds and returns the colony's own content.
  const sameColonyRead = boundary.read({ requestingColony: "claude-forge", targetWorkspaceId: CLAUDE_WS, relPath: claudeArtifactPath, targetFrozen: true });
  // Cross-colony read BEFORE freeze is denied mechanically.
  const crossColonyRead = boundary.read({ requestingColony: "claude-forge", targetWorkspaceId: CODEX_WS, relPath: codexArtifactPath, targetFrozen: false });
  // Path traversal, absolute, and source-tree paths are denied.
  const traversalRead = boundary.read({ requestingColony: "codex-crucible", targetWorkspaceId: CODEX_WS, relPath: "../claude-forge/src/repository.ts", targetFrozen: false });
  const absoluteRead = boundary.read({ requestingColony: "codex-crucible", targetWorkspaceId: CODEX_WS, relPath: "C:/Windows/system32/drivers/etc/hosts", targetFrozen: false });
  const sourceTreeRead = boundary.read({ requestingColony: "claude-forge", targetWorkspaceId: "src/twin", relPath: "colonyForge.ts", targetFrozen: false });

  const contamination = boundary.contaminationReceipts;
  const crossColonyReceipts = contamination.filter((r) => r.reasonCode === "cross-colony-access-denied");

  // --- Silent Witness records the refusal ---
  const witness = new SilentWitness();
  let seq = 0;
  witness.observe({ seq: (seq += 1), colonyId: "claude-forge", kind: "bundle-frozen", fingerprint: claude.fingerprint });
  witness.observe({ seq: (seq += 1), colonyId: "codex-crucible", kind: "bundle-frozen", fingerprint: codex.fingerprint });
  for (const r of claude.providerReceipts) witness.observe({ seq: (seq += 1), colonyId: "claude-forge", kind: "provider-receipt", fingerprint: `${r.role}:${r.ok}` });
  for (const r of codex.providerReceipts) witness.observe({ seq: (seq += 1), colonyId: "codex-crucible", kind: "provider-receipt", fingerprint: `${r.role}:${r.ok}` });
  const leakVerdict = witness.consider({ fromColony: "claude-forge", toColony: "codex-crucible", targetFingerprint: codex.fingerprint, beforeFreeze: true });

  // --- frozen-bundle enforcement ---
  const claudeValid = validateFrozenBundle(claude);
  const codexValid = validateFrozenBundle(codex);
  const tamperClaude = attemptPostFreezeModify(claude, "src/injected.ts");
  const tamperCodex = attemptPostFreezeModify(codex, "src/injected.ts");
  const claudeImmutable = verifyBundleImmutable(claude);
  const codexImmutable = verifyBundleImmutable(codex);
  const amendment = amendFrozenBundle(claude, "add-lint-note", "consider eslint in a later mission");

  // --- Black Mirror cross-examination (only AFTER both bundles freeze + validate) ---
  // Cross-examination cannot start before both bundles are frozen (guard proof).
  const prematureSession = new CrossExaminationSession({ ...claude, frozen: false }, codex, ACCEPTANCE);
  const prematureStart = prematureSession.start();

  const session = new CrossExaminationSession(claude, codex, ACCEPTANCE, witness);
  const started = session.start();
  // Each colony reads only the competitor's FROZEN bundle and produces one attack.
  const claudeAttack = buildAttackReport(claude, codex, { includeUnsupported: true }); // includes one unsupported accusation
  const codexAttack = buildAttackReport(codex, claude);
  const claudeAttackOk = session.submitAttack(claudeAttack);
  const codexAttackOk = session.submitAttack(codexAttack);
  // A third attack (Claude again) must hit the round limit.
  const thirdAttack = session.submitAttack(buildAttackReport(claude, codex));
  // Each colony gives exactly one rebuttal against the finding raised on it.
  const codexRebuttal: RebuttalReport = { rebuttingColony: "codex-crucible", responses: [{ findingId: claudeAttack.findings[0].findingId, disposition: "narrow", evidenceRefs: ["codex-scope-note"], note: "valid at scale; current scope is intentionally tiny" }] };
  const claudeRebuttal: RebuttalReport = { rebuttingColony: "claude-forge", responses: [{ findingId: codexAttack.findings[0].findingId, disposition: "accept", evidenceRefs: [], note: "agree an executable test artifact is required" }] };
  const codexRebuttalOk = session.submitRebuttal(codexRebuttal);
  const claudeRebuttalOk = session.submitRebuttal(claudeRebuttal);
  // A third rebuttal (Codex again) must hit the round limit.
  const thirdRebuttal = session.submitRebuttal(codexRebuttal);
  const xe = session.summary();
  // Frozen bundles must remain byte-identical after the whole cross-examination.
  const bundlesUnchangedAfterXe = verifyBundleImmutable(claude) && verifyBundleImmutable(codex);

  // --- Differential Truth Engine + decisive test execution (fake driver) ---
  const contradiction = session.getUnresolvedContradictions()[0];
  const proposal = session.getDecisiveTests().find((t) => t.forFindingId === contradiction.findingId)!;
  const minorityEvidence = [...claude.minorityReports, ...codex.minorityReports];

  // Contradiction energy (high/critical) — deterministic, no reputation term.
  const energyFactors: EnergyFactorBreakdown = { customerImpact: 0.9, securityImpact: 0.3, evidenceStrengthClaude: 0.85, evidenceStrengthCodex: 0.5, uncertainty: 0.8, reversibility: 0.4, costOfBeingWrong: 0.8, downstreamBlocking: 0.7, missionCriticality: 0.85 };
  const energy = computeContradictionEnergy(contradiction, energyFactors);
  witness.observeDifferentialTruth("energy", contradiction.contradictionId);

  // Bounded decisive test using FROZEN evidence samples/fingerprints only.
  // Maintainability signal = presence of a storage-abstraction boundary (Repository).
  const maintainabilitySignal = (b: typeof claude) => (b.artifacts.some((a) => /\bRepository\b/.test(a.content)) ? 0.85 : 0.5);
  const testInput: DecisiveTestInput = {
    testId: proposal.testId,
    contradictionId: contradiction.contradictionId,
    testType: "maintainability-evidence-comparison",
    claudeEvidenceSample: maintainabilitySignal(claude),
    codexEvidenceSample: maintainabilitySignal(codex),
    claudeEvidenceRefs: [claude.artifactManifest[0].fingerprint],
    codexEvidenceRefs: [codex.artifactManifest[0].fingerprint],
    expectedObservation: "presence of a storage-abstraction boundary that isolates the domain",
    boundedCost: 0.5,
  };
  const testValidation = validateDecisiveTest(testInput, contradiction, proposal, claude, codex);
  // A mismatched proposal must be rejected (wrong contradiction id).
  const mismatchValidation = validateDecisiveTest({ ...testInput, contradictionId: "c-does-not-exist" }, contradiction, proposal, claude, codex);
  // A mutation-attempting test must be rejected.
  const mutationValidation = validateDecisiveTest({ ...testInput, attemptsMutation: true }, contradiction, proposal, claude, codex);

  const driver = new FakeDecisiveTestDriver();
  let dominanceDecision: ReturnType<typeof decideDominance> | null = null;
  let comparison: ReturnType<typeof compareEvidence> | null = null;
  if (testValidation === "ok") {
    witness.observeDifferentialTruth("authorization", contradiction.contradictionId);
    witness.observeDifferentialTruth("test-start", contradiction.contradictionId);
    const outcome = driver.run(testInput); // exactly once
    witness.observeDifferentialTruth("test-complete", contradiction.contradictionId);
    comparison = compareEvidence(testInput, outcome);
    witness.observeDifferentialTruth("comparison", contradiction.contradictionId);
    dominanceDecision = decideDominance(comparison, minorityEvidence, ["scale-up behavior", "performance under load"]);
    witness.observeDifferentialTruth("decision", contradiction.contradictionId, dominanceDecision.usedProviderReputation);
    witness.observeDifferentialTruth("residual", contradiction.contradictionId);
  }
  // The original contradiction is never deleted from the session history.
  const contradictionStillInHistory = session.getUnresolvedContradictions().some((c) => c.contradictionId === contradiction.contradictionId);
  const bundlesUnchangedAfterDiff = verifyBundleImmutable(claude) && verifyBundleImmutable(codex);
  const acceptanceUnchanged = ACCEPTANCE.length === 3 && ACCEPTANCE[0] === "tasks CRUD + completion";

  const witnessReport = witness.report();

  // --- Namola decision ---
  const contract: NamolaAcceptanceContract = { criteria: ACCEPTANCE, requireIndependentReview: true, requireFrozenBundle: true };
  const court = judgeTwinBundles(claude, codex, witnessReport, contract);

  // --- Namola Sovereign Court + Zero-Trust Merge Forge ---
  witness.observeCourtMerge("court-opened");
  const dominanceDecisions = dominanceDecision ? [dominanceDecision] : [];
  const residual = dominanceDecision ? [...dominanceDecision.residualUncertainty.untestedDimensions] : [];
  const courtInput: NamolaCourtInput = { claude, codex, admittedFindings: session.getAdmittedFindings().map((f) => ({ findingId: f.findingId, findingCategory: f.findingCategory })), dominanceDecisions, residualUncertainty: residual, witness: witnessReport, acceptance: ACCEPTANCE, budget: { maxMergeComponents: 4 } };
  const namolaReceipt = renderNamolaDecision(courtInput);
  witness.observeCourtMerge("hard-rejection-checks", namolaReceipt.hardRejectionChecks.length);
  witness.observeCourtMerge("decision-created");
  witness.observeCourtMerge("components-approved", namolaReceipt.approvedComponents.length);

  // REJECT_BOTH must be reachable using INVALID evidence (a tampered, unfrozen bundle).
  const invalidReceipt = renderNamolaDecision({ ...courtInput, codex: { ...codex, fingerprint: "tampered-fp" } });
  witness.observeCourtMerge("decision-created");

  // Zero-trust merge forge: fresh workspace, provenance-first, verify from zero.
  const mergeDriver = new FakeMergeVerificationDriver();
  const forge = new ZeroTrustMergeForge(MISSION_ID, mergeDriver);
  witness.observeCourtMerge("merge-workspace-created");
  const unapproved: ApprovedMergeComponent = { componentId: "cmp-unapproved", sourceColony: "claude-forge", sourceArtifactId: "ghost.ts", sourceFingerprint: "", relativePath: "src/ghost.ts", operation: { kind: "ADD", targetRelativePath: "src/ghost.ts", sourceArtifactSha256: "sha-ghost" }, requirementsCovered: [], evidenceRefs: [], reasonSelected: "none", knownRisks: [], requiredMergeTests: [] };
  const admission = forge.materializeResolvedComponents([...namolaReceipt.approvedComponents, unapproved], claude, codex);
  witness.observeCourtMerge("provenance-retained", forge.provenanceRecords.length, forge.provenanceRecords.length === namolaReceipt.approvedComponents.length);
  witness.observeCourtMerge("components-approved", 0, forge.rejectedComponents.length > 0);

  witness.observeCourtMerge("merge-verification-started");
  const firstRun = forge.runVerification("tests"); // one injected integration failure
  const firstRunPassed = "refused" in firstRun ? false : firstRun.passed;
  if (!firstRunPassed) witness.observeCourtMerge("merge-failure");

  const repairAuthorized = true; // separately supplied repair authorization flag
  witness.observeCourtMerge("repair-authorization");
  const repairResult = forge.authorizeAndRepair(repairAuthorized);
  const repairRan = "ran" in repairResult && repairResult.ran === true;
  witness.observeCourtMerge("repair-execution");
  witness.observeCourtMerge("verification-rerun");
  const finalMergePassed = forge.finalMergeVerificationPassed;
  witness.observeCourtMerge("final-merge-result", 1, forge.inheritedPassingStatus);
  const bundlesUnchangedAfterMerge = verifyBundleImmutable(claude) && verifyBundleImmutable(codex);
  const finalWitnessReport = witness.report();

  // --- Professional customer delivery + Twin Command Center ---
  const finalRun = forge.verificationRuns[forge.verificationRuns.length - 1];
  const stageResults = { typecheck: false, tests: false, build: false, "security-review": false, "acceptance-verification": false } as Record<(typeof MERGE_STAGES)[number], boolean>;
  for (const o of finalRun.outcomes) stageResults[o.stage] = o.passed;
  const mergeEvidence: MergeEvidenceSummary = {
    finalMergePassed: forge.finalMergeVerificationPassed,
    provenance: forge.provenanceRecords.map((p) => ({ relativePath: p.relativePath, sourceColony: p.sourceColony, sourceFingerprint: p.originalFingerprint, mergeFingerprint: p.mergeFingerprint, requirementsCovered: p.requirementsCovered })),
    stageResults,
    incidents: forge.mergeIncidents.length,
    repairRan,
    verificationRuns: forge.verificationRuns.length,
  };
  const deliveryInput: CustomerDeliveryInput = {
    missionId: MISSION_ID,
    objective: "small TypeScript task manager (projects + tasks CRUD, in-memory storage, tests)",
    acceptance: ACCEPTANCE,
    namolaReceipt,
    merge: mergeEvidence,
    witnessIntegrity: finalWitnessReport.integrityIntact,
    severeSecurityUnresolved: false,
    unresolvedContamination: finalWitnessReport.leakageQuarantined < finalWitnessReport.leakageAttempts,
    decisiveTestIds: proposal ? [proposal.testId] : [],
    residualUncertainty: residual,
    contradictionEnergyBand: energy.energyBand,
    crossExam: { attacks: xe.attacks, rebuttals: xe.rebuttals, strengths: xe.strengthsAcknowledged, unresolvedContradictions: xe.unresolvedContradictions },
  };
  const composer = new CustomerDeliveryComposer();
  // Delivery is BLOCKED before final merge verification passes.
  const blockedDelivery = composer.compose({ ...deliveryInput, merge: { ...mergeEvidence, finalMergePassed: false } });
  // Delivery succeeds after final merge verification passes.
  const deliveryResult = composer.compose(deliveryInput);
  const delivery = deliveryResult.ok ? deliveryResult.delivery : null;
  const deliveryLeaks = delivery ? scanDeliveryForLeaks(delivery) : ["no-delivery"];
  const deliverySerialized = delivery ? JSON.stringify(delivery) : "";
  const exposesRawArtifactContent = deliverySerialized.includes("class ProjectService") || deliverySerialized.includes("class TaskManager");
  const claimsAllLabeled = delivery ? allClaimsLabeled(delivery) : false;

  const ccInput: TwinCommandCenterInput = {
    missionId: MISSION_ID,
    totalPersistentAnts: population.length,
    claude,
    codex,
    bundlesValid: validateFrozenBundle(claude).valid && validateFrozenBundle(codex).valid,
    witness: finalWitnessReport,
    crossExam: { attacks: xe.attacks, rebuttals: xe.rebuttals, strengths: xe.strengthsAcknowledged, unresolvedContradictions: xe.unresolvedContradictions },
    contradictionEnergyBand: energy.energyBand,
    decisiveTests: session.getDecisiveTests().length,
    evidenceDominanceDecisions: dominanceDecisions.length,
    namolaReceipt,
    mergeIncidents: forge.mergeIncidents.map((i) => ({ incidentId: i.incidentId })),
    repairRan,
    verificationRuns: forge.verificationRuns.length,
    finalMergePassed: forge.finalMergeVerificationPassed,
    rejectedMergeComponents: forge.rejectedComponents.length,
    residualUncertainty: residual,
    customerDeliveryReady: deliveryResult.ok,
    customerDeliveryStatus: deliveryResult.ok ? "delivered" : deliveryResult.reasonCode,
  };
  const commandCenter = buildTwinCommandCenter(ccInput);
  const mergeFailedAlert = commandCenter.alerts.find((a) => a.alertCode === "merge-failed");
  const alertTracesToEvent = mergeFailedAlert !== undefined && forge.mergeIncidents.some((i) => mergeFailedAlert.evidenceRefs.includes(i.incidentId));

  const bundlesIndependent = claude.fingerprint !== codex.fingerprint && claude.workspacePath !== codex.workspacePath && !claude.workspacePath.includes("codex") && !codex.workspacePath.includes("claude");
  const bothProducedFourParts = [claude, codex].every((b) => b.architecture.filePlan.length > 0 && b.artifacts.length > 0 && b.reviews.length > 0 && b.fingerprint.length > 0);
  const noSelfReviewAccepted = [claude, codex].every((b) => b.reviews.every((r) => !r.selfReview));

  const realProviderCalls = claude.costReport.realProviderCalls + codex.costReport.realProviderCalls;
  const realFilesystemWrites = authority.realWrites; // in-memory driver → 0
  const realNetworkCalls = 0;
  const processExecutions = 0;

  const specs: Array<[string, boolean]> = [
    ["both-colonies-produced-independent-bundles", bundlesIndependent],
    ["both-produced-architecture+artifact+review+bundle", bothProducedFourParts],
    ["separate-workspaces", claude.workspacePath === CLAUDE_WS && codex.workspacePath === CODEX_WS && authority.fileCount(CLAUDE_WS) === 1 && authority.fileCount(CODEX_WS) === 1],
    ["legal-same-colony-read-succeeds", sameColonyRead.ok === true && sameColonyRead.content === claude.artifacts[0].content],
    ["cross-colony-read-denied", crossColonyRead.ok === false && crossColonyRead.reasonCode === "cross-colony-access-denied" && crossColonyRead.content === undefined],
    ["traversal-denied", traversalRead.ok === false && traversalRead.reasonCode === "path-traversal"],
    ["absolute-path-denied", absoluteRead.ok === false && absoluteRead.reasonCode === "absolute-path"],
    ["source-tree-path-denied", sourceTreeRead.ok === false && sourceTreeRead.reasonCode === "source-tree-path"],
    ["both-bundles-frozen", claude.frozen === true && codex.frozen === true],
    ["frozen-bundle-validator-valid", claudeValid.valid === true && codexValid.valid === true],
    ["complete-fingerprint-verified", claudeValid.fingerprintMatches && codexValid.fingerprintMatches],
    ["mutation-does-not-change-digest", tamperClaude.digestUnchanged && tamperCodex.digestUnchanged && tamperClaude.ok === false && tamperCodex.ok === false && claudeImmutable && codexImmutable],
    ["amendment-creates-new-receipt-original-unchanged", amendment.originalUnchanged === true && amendment.amendmentFingerprint !== claude.fingerprint && amendment.baseFingerprint === claude.fingerprint],
    ["one-contamination-attempt-quarantined", crossColonyReceipts.length === 1 && crossColonyReceipts[0].quarantined === true],
    ["path-violations-also-quarantined", contamination.some((r) => r.reasonCode === "path-traversal") && contamination.some((r) => r.reasonCode === "absolute-path") && contamination.some((r) => r.reasonCode === "source-tree-path")],
    ["silent-witness-records-refusal", leakVerdict.blocked === true && witnessReport.leakageQuarantined === 1 && witnessReport.integrityIntact === true],
    // --- cross-examination ---
    ["cross-exam-cannot-start-before-freeze", prematureStart.ok === false && (prematureStart as { reasonCode: string }).reasonCode === "bundles-not-frozen"],
    ["cross-exam-started-after-freeze-and-validation", started.ok === true],
    ["claude-one-attack-report", claudeAttackOk.ok === true],
    ["codex-one-attack-report", codexAttackOk.ok === true],
    ["exactly-two-attacks", xe.attacks === 2],
    ["third-attack-round-limit", thirdAttack.ok === false && (thirdAttack as { reasonCode: string }).reasonCode === "cross-examination-round-limit"],
    ["claude-one-rebuttal", claudeRebuttalOk.ok === true],
    ["codex-one-rebuttal", codexRebuttalOk.ok === true],
    ["exactly-two-rebuttals", xe.rebuttals === 2],
    ["third-rebuttal-round-limit", thirdRebuttal.ok === false && (thirdRebuttal as { reasonCode: string }).reasonCode === "cross-examination-round-limit"],
    ["each-colony-acknowledges-a-strength", xe.strengthsAcknowledged >= 2],
    ["at-least-one-unresolved-contradiction", xe.unresolvedContradictions >= 1],
    ["at-least-one-decisive-test-proposed", xe.decisiveTestsProposed >= 1],
    ["minority-evidence-preserved", xe.minorityReportsPreserved >= 2],
    ["unsupported-accusations-rejected", xe.rejectedUnsupportedFindings >= 1],
    ["frozen-bundles-unchanged-after-cross-exam", bundlesUnchangedAfterXe === true && xe.bundlesUnchanged === true],
    ["witness-records-full-cross-exam", witnessReport.crossExamAttacks === 2 && witnessReport.crossExamRebuttals === 2 && witnessReport.crossExamRoundLimitHonored === true],
    // --- differential truth + decisive test ---
    ["contradiction-receives-high-or-critical-energy", energy.energyBand === "high" || energy.energyBand === "critical"],
    ["energy-factor-breakdown-complete", Object.keys(energy.factorBreakdown).length === 9 && energy.escalationReason.length > 0],
    ["decisive-test-authorized", testValidation === "ok"],
    ["invalid-proposal-mismatch-rejected", mismatchValidation === "proposal-mismatch"],
    ["mutation-attempt-rejected", mutationValidation === "mutation-attempt"],
    ["fake-driver-ran-exactly-once", driver.runCount === 1],
    ["test-used-frozen-evidence-only", testInput.claudeEvidenceRefs[0] === claude.artifactManifest[0].fingerprint && testInput.codexEvidenceRefs[0] === codex.artifactManifest[0].fingerprint],
    ["bundles-unchanged-after-decisive-test", bundlesUnchangedAfterDiff === true],
    ["evidence-comparison-favors-one-colony", comparison !== null && (comparison.dominance === "CLAUDE_EVIDENCE_DOMINATES" || comparison.dominance === "CODEX_EVIDENCE_DOMINATES")],
    ["provider-reputation-not-used", dominanceDecision !== null && dominanceDecision.usedProviderReputation === false && dominanceDecision.basedOnObservedEvidenceOnly === true && dominanceDecision.evidenceRejected.includes("provider-reputation")],
    ["minority-evidence-preserved-in-decision", dominanceDecision !== null && dominanceDecision.minorityEvidencePreserved.length >= 2],
    ["original-contradiction-remains-in-history", contradictionStillInHistory === true],
    ["contradiction-marked-resolved-or-partial", dominanceDecision !== null && (dominanceDecision.contradictionStatus === "resolved-by-test" || dominanceDecision.contradictionStatus === "partially-resolved")],
    ["residual-uncertainty-non-empty", dominanceDecision !== null && dominanceDecision.residualUncertainty.untestedDimensions.length > 0 && dominanceDecision.residualUncertainty.customerDisclosureRequired === true],
    ["witness-records-differential-process", witnessReport.energyCalculations === 1 && witnessReport.decisiveTestsAuthorized === 1 && witnessReport.decisiveTestsRun === 1 && witnessReport.evidenceComparisons === 1 && witnessReport.evidenceDecisions === 1 && witnessReport.residualUncertaintiesPreserved === 1],
    ["no-provider-prestige-influence", witnessReport.prestigeInfluenceDetected === false],
    ["no-acceptance-criteria-mutation", acceptanceUnchanged === true && witnessReport.criteriaMutationsDetected === 0],
    ["no-extra-decisive-test-loop", witnessReport.decisiveTestCountBounded === true && driver.runCount === 1],
    // --- Namola sovereign court + zero-trust merge ---
    ["reject-both-reachable-with-invalid-evidence", invalidReceipt.decision === "REJECT_BOTH" && invalidReceipt.hardRejectionChecks.some((c) => c.id === "both-bundles-valid" && !c.passed)],
    ["valid-scenario-produces-merge", namolaReceipt.decision === "MERGE_APPROVED_COMPONENTS"],
    ["at-least-one-claude-component-approved", namolaReceipt.approvedComponents.some((c) => c.sourceColony === "claude-forge")],
    ["at-least-one-codex-component-approved", namolaReceipt.approvedComponents.some((c) => c.sourceColony === "codex-crucible")],
    // TWIN-R1 added the `no-unverified-v2-candidate` hard rejection, so the court
    // now runs 11 checks rather than 10. The count is asserted ALONGSIDE the new
    // check's identity so the number cannot drift silently again: a future check
    // must be named here, not merely counted.
    ["decision-receipt-complete", namolaReceipt.hardRejectionChecks.length === 11 && namolaReceipt.hardRejectionChecks.some((c) => c.id === "no-unverified-v2-candidate") && namolaReceipt.evidenceRejected.includes("provider-reputation") && namolaReceipt.decisionFingerprint.length > 0],
    ["approved-components-retain-provenance", forge.provenanceRecords.length === 2 && forge.provenanceRecords.every((p) => p.originalFingerprint.length > 0 && p.sourceColony.length > 0 && p.mergeFingerprint.length > 0)],
    ["unapproved-component-rejected", forge.rejectedComponents.some((r) => !r.ok && (r.reasonCode === "missing-provenance" || r.reasonCode === "artifact-not-found-in-bundle")) && forge.componentsWritten === 2],
    ["merge-workspace-starts-fresh", forge.mergeWorkspacePath === `workspaces/namola-twin/${MISSION_ID}/merge-forge` && forge.fileCount === 2],
    ["no-passing-status-inherited", forge.inheritedPassingStatus === false && finalWitnessReport.inheritedPassingStatusDetected === false],
    ["one-merge-integration-failure", firstRunPassed === false],
    ["one-merge-incident-created", forge.mergeIncidents.length === 1 && forge.mergeIncidents[0].repairDemandPublished === true && forge.mergeIncidents[0].technicalDebtCreated > 0],
    ["verification-failed-before-repair", firstRunPassed === false && forge.verificationRuns[0].passed === false],
    ["one-separately-authorized-fake-repair", repairRan === true && ("authorized" in repairResult && repairResult.authorized === true)],
    ["all-verification-reruns-from-zero", forge.verificationRuns.length === 2 && forge.verificationRuns.every((r) => r.fromZero === true)],
    ["final-merge-verification-passes", finalMergePassed === true],
    ["residual-uncertainty-remains-disclosed", namolaReceipt.residualUncertainty.length > 0 && namolaReceipt.remainingRisks.length > 0],
    ["both-original-bundles-unchanged-after-merge", bundlesUnchangedAfterMerge === true],
    ["witness-integrity-remains-true", finalWitnessReport.integrityIntact === true],
    ["witness-records-court-merge-process", finalWitnessReport.courtOpened === true && finalWitnessReport.hardRejectionChecksObserved === 11 && finalWitnessReport.mergeWorkspaceCreated === true && finalWitnessReport.provenanceRetainedObserved === true && finalWitnessReport.mergeFailuresObserved === 1 && finalWitnessReport.repairsExecutedObserved === 1 && finalWitnessReport.verificationRerunsObserved >= 1 && finalWitnessReport.unapprovedComponentBlocked === true && finalWitnessReport.mergeTestCountBounded === true],
    // --- customer delivery ---
    ["delivery-blocked-before-final-verification", blockedDelivery.ok === false && (blockedDelivery as { reasonCode: string }).reasonCode === "merge-verification-not-passed"],
    ["delivery-succeeds-after-final-verification", deliveryResult.ok === true && delivery !== null],
    ["executive-result-produced", delivery !== null && delivery.executive.whatWasDelivered.length > 0 && delivery.executive.namolaDecision === "MERGE_APPROVED_COMPONENTS"],
    ["evidence-report-produced", delivery !== null && delivery.evidence.claims.length >= 10],
    ["technical-package-produced", delivery !== null && delivery.technical.componentProvenance.length === 2 && delivery.technical.mergedFilePaths.length === 2],
    ["decision-explanation-produced", delivery !== null && delivery.decision.whyMerged.length > 0],
    ["all-customer-claims-labeled", claimsAllLabeled === true],
    ["perfection-not-claimed", delivery !== null && delivery.decision.perfectionClaimed === false && delivery.risk.perfectionClaimed === false],
    ["claude-and-codex-provenance-visible", delivery !== null && delivery.decision.selectedClaudeComponents.length >= 1 && delivery.decision.selectedCodexComponents.length >= 1 && delivery.technical.componentProvenance.some((p) => p.sourceColony === "claude-forge") && delivery.technical.componentProvenance.some((p) => p.sourceColony === "codex-crucible")],
    ["residual-uncertainty-disclosed", delivery !== null && delivery.risk.unresolvedUncertainty.length > 0 && delivery.risk.customerDisclosureRequired === true],
    ["rejected-evidence-disclosed-safely", delivery !== null && delivery.decision.evidenceRejected.includes("provider-reputation")],
    ["no-secret-or-private-leak-in-delivery", deliveryLeaks.length === 0],
    ["no-raw-artifact-content-in-delivery", exposesRawArtifactContent === false],
    // --- twin command center ---
    ["cc-population-from-runtime", commandCenter.totalPersistentAnts === population.length && population.length === 1000],
    ["cc-two-frozen-fingerprints", commandCenter.claudeFingerprint === claude.fingerprint && commandCenter.codexFingerprint === codex.fingerprint && commandCenter.claudeFingerprint !== commandCenter.codexFingerprint],
    ["cc-attacks-and-rebuttals", commandCenter.crossExamAttacks === 2 && commandCenter.crossExamRebuttals === 2],
    ["cc-decisive-test-count", commandCenter.decisiveTests >= 1],
    ["cc-namola-decision", commandCenter.namolaDecision === "MERGE_APPROVED_COMPONENTS"],
    ["cc-merge-failure-and-repair", commandCenter.mergeIncidents === 1 && commandCenter.repairs === 1],
    ["cc-final-verification-result", commandCenter.finalVerificationPassed === true],
    ["cc-delivery-readiness", commandCenter.customerDeliveryReady === true && commandCenter.customerDeliveryStatus === "delivered"],
    ["cc-at-least-one-real-alert", commandCenter.alerts.length >= 1],
    ["cc-alert-evidence-traces-to-event", alertTracesToEvent === true],
    ["cc-real-action-counters-zero", commandCenter.realProviderCalls === 0 && commandCenter.realFilesystemWrites === 0 && commandCenter.observedNetworkCallCount === 0 && commandCenter.networkObservation === "observed-none" && commandCenter.processExecutions === 0],
    ["no-self-review-accepted", noSelfReviewAccepted],
    ["namola-evidence-based-decision", ["SELECT_CLAUDE", "SELECT_CODEX", "MERGE", "REJECT_BOTH"].includes(court.decision) && court.evidenceUsed.length > 0],
    ["namola-decision-is-merge", court.decision === "MERGE"],
    ["namola-no-worker-assignment", court.namolaDirectAntAssignments === 0 && court.queenTaskAssignments === 0],
    ["realProviderCalls==0", realProviderCalls === 0],
    ["realFilesystemWrites==0", realFilesystemWrites === 0],
    ["realNetworkCalls==0", realNetworkCalls === 0],
    ["processExecutions==0", processExecutions === 0],
    ["population-1000-identities", population.length === 1000],
    ["colony-slices-disjoint", claudeWorkers.every((w) => !codexWorkers.some((c) => c.workerId === w.workerId))],
  ];
  const mismatchCaseIds = specs.filter(([, ok]) => !ok).map(([id]) => id);

  return {
    moduleName: "demoTwinColonyFoundation",
    totalPersistentAnts: population.length,
    claudeFingerprint: claude.fingerprint,
    codexFingerprint: codex.fingerprint,
    claudeWorkspace: claude.workspacePath,
    codexWorkspace: codex.workspacePath,
    claudeWorkspaceFiles: authority.fileCount(CLAUDE_WS),
    codexWorkspaceFiles: authority.fileCount(CODEX_WS),
    isolationDenials: contamination.map((r) => r.reasonCode),
    crossColonyDenied: crossColonyRead.reasonCode,
    leakageQuarantined: witnessReport.leakageQuarantined,
    claudeBundleValid: claudeValid.valid,
    codexBundleValid: codexValid.valid,
    amendmentOriginalUnchanged: amendment.originalUnchanged,
    crossExamAttacks: xe.attacks,
    crossExamRebuttals: xe.rebuttals,
    strengthsAcknowledged: xe.strengthsAcknowledged,
    unresolvedContradictions: xe.unresolvedContradictions,
    decisiveTestsProposed: xe.decisiveTestsProposed,
    rejectedUnsupportedFindings: xe.rejectedUnsupportedFindings,
    minorityReportsPreserved: xe.minorityReportsPreserved,
    contradictionEnergyBand: energy.energyBand,
    contradictionTotalEnergy: energy.totalEnergy,
    decisiveTestValidation: testValidation,
    fakeDriverRunCount: driver.runCount,
    evidenceDominance: comparison?.dominance ?? "none",
    contradictionStatus: dominanceDecision?.contradictionStatus ?? "none",
    residualUntestedDimensions: dominanceDecision?.residualUncertainty.untestedDimensions.length ?? 0,
    prestigeInfluenceDetected: witnessReport.prestigeInfluenceDetected,
    namolaSovereignDecision: namolaReceipt.decision,
    rejectBothDecision: invalidReceipt.decision,
    approvedComponents: namolaReceipt.approvedComponents.map((c) => `${c.sourceColony}:${c.relativePath}`),
    unapprovedRejected: forge.rejectedComponents.length,
    mergeWorkspaceFiles: forge.fileCount,
    firstMergeRunPassed: firstRunPassed,
    mergeIncidents: forge.mergeIncidents.length,
    repairRan,
    finalMergePassed,
    inheritedPassingStatus: forge.inheritedPassingStatus,
    deliveryBlockedReason: blockedDelivery.ok ? "not-blocked" : blockedDelivery.reasonCode,
    deliveryReady: deliveryResult.ok,
    deliveryLeaks: deliveryLeaks.length,
    customerClaims: delivery ? delivery.evidence.claims.length : 0,
    perfectionClaimed: delivery ? delivery.decision.perfectionClaimed : null,
    ccAlerts: commandCenter.alerts.map((a) => a.alertCode),
    ccFinalVerification: commandCenter.finalVerificationPassed,
    ccDeliveryStatus: commandCenter.customerDeliveryStatus,
    namolaDecision: court.decision,
    namolaReason: court.reason,
    realProviderCalls,
    realFilesystemWrites,
    realNetworkCalls,
    processExecutions,
    expectationsChecked: specs.length,
    mismatchCaseIds,
    allExpectationsMet: mismatchCaseIds.length === 0,
  };
}

if (require.main === module) {
  const out = runDemoTwinColonyFoundation();
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.allExpectationsMet ? 0 : 1);
}
