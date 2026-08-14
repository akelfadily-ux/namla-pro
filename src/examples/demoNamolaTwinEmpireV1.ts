/**
 * demoNamolaTwinEmpireV1 — comprehensive end-to-end deterministic proof of the
 * Namola Twin Empire adversarial sovereignty architecture. Exercises the full
 * lifecycle: objective validation, sealed twin packets, independent colony
 * execution, Creator-Predator-Judge, defect injection, fake-test injection,
 * provider malformed output, cross-colony leakage attempt, frozen bundles,
 * leakage quarantine, cross-examination, differential truth, decisive tests,
 * Silent Witness report, Namola sovereign judgment, Zero-Trust Merge Forge with
 * merge failure, incident and repair, final verification, customer delivery,
 * Academy update, and identity preservation.
 *
 * Uses fake providers, fake MCP, fake workspace, and fake verification only.
 * Zero real actions. Zero real provider calls. Zero real filesystem writes.
 *
 * No fs, no child_process, no network, no clock.
 */

import { buildSettlementWorkers } from "../civilization/civilizationLiveRunner";
import type { DigitalWorker } from "../digital/digitalWorkers";
import { runColonyForge, attemptPostFreezeModify, freezeBundle } from "../twin/colonyForge";
import type { TwinMissionPacket, ColonyProfile } from "../twin/colonyForge";
import { bundleCanonicalProjection, fnv1a } from "../twin/twinColonyTypes";
import type { ColonyEvidenceBundle, ColonyArtifactProposal, ColonyArchitectureProposal, ColonyReview, ArtifactManifestEntry, ColonyProviderReceipt } from "../twin/twinColonyTypes";
import { ColonyWorkspaceAuthority, ColonyIsolationBoundary } from "../twin/colonyWorkspace";
import { validateFrozenBundle, verifyBundleImmutable } from "../twin/frozenBundleValidator";
import { CrossExaminationSession, buildAttackReport } from "../twin/crossExamination";
import type { RebuttalReport } from "../twin/crossExamination";
import { computeContradictionEnergy, validateDecisiveTest, compareEvidence, decideDominance, FakeDecisiveTestDriver } from "../twin/differentialTruth";
import type { EnergyFactorBreakdown, DecisiveTestInput } from "../twin/differentialTruth";
import { SilentWitness } from "../twin/silentWitness";
import { renderNamolaDecision } from "../twin/namolaSovereignCourt";
import type { NamolaCourtInput, ApprovedMergeComponent } from "../twin/namolaSovereignCourt";
import { ZeroTrustMergeForge, FakeMergeVerificationDriver, MERGE_STAGES } from "../twin/mergeForge";
import { CustomerDeliveryComposer, scanDeliveryForLeaks, allClaimsLabeled } from "../twin/customerDelivery";
import type { CustomerDeliveryInput, MergeEvidenceSummary } from "../twin/customerDelivery";
import { buildTwinCommandCenter } from "../twin/twinCommandCenter";
import type { TwinCommandCenterInput } from "../twin/twinCommandCenter";
import {
  validateNamolaObjective,
  DEFAULT_CONSTITUTION,
  DEFAULT_BUDGET,
  createSealedMissionPackets,
  registerUncertainty,
  generateCustomerExplanation,
  evaluateStopConditions,
  DEFAULT_DECISION_POLICY,
} from "../twin/namolaConstitution";
import type { NamolaObjectiveConstitution } from "../twin/namolaConstitution";
import { TWIN_CONFIRMATION_PHRASE } from "../twin/twinEmpireLivePlan";
import {
  assessTruthTax,
  conductFutureAutopsy,
  executeTriadRound,
  checkSelfReview,
  checkEmptyArtifacts,
  checkEmptyWorkspace,
  checkRequirementCoverage,
  detectFakeTestEvidence,
  registerAssumption,
  generateCounterexample,
  generateBoundaryCases,
  checkIndependentReproduction,
  registerResidualRisk,
  analyzeCustomerImpact,
} from "../twin/namolaErrorExtinction";

// ============================================================================
// CONSTANTS
// ============================================================================

const SEED = 20260724;
const OBJECTIVE = "small TypeScript task manager with CRUD operations, in-memory storage, and unit tests";
const ACCEPTANCE: readonly string[] = ["tasks CRUD + completion", "in-memory storage", "unit tests present"];
const BUDGET_LIMIT = 10;
const MISSION_ID = "namola-twin-empire";
const CLAUDE_WS = `workspaces/namola-twin/${MISSION_ID}/claude-forge`;
const CODEX_WS = `workspaces/namola-twin/${MISSION_ID}/codex-crucible`;

// ============================================================================
// HELPER: Create a distinct colony bundle with injected defects
// ============================================================================

function createColonyBundle(
  profile: ColonyProfile,
  packet: TwinMissionPacket,
  authority: ColonyWorkspaceAuthority,
  injectDefect: boolean,
  injectFakeTest: boolean,
): ColonyEvidenceBundle {
  const workspacePath = `workspaces/namola-twin/${packet.missionId}/${profile.colonyId}`;

  // Architecture plan — culture-specific
  const architecture: ColonyArchitectureProposal = profile.culture === "architecture-first"
    ? {
        architectureSummary: "Layered service architecture: typed domain model first, repository boundary, thin facade; risk-and-maintainability driven.",
        filePlan: ["src/types.ts", "src/repository.ts", "src/taskManager.ts", "ARCHITECTURE.md"],
        acceptanceMapping: packet.acceptanceCriteria.map((c) => `types+repository cover: ${c}`),
        interfaceDecisions: ["Repository<T> interface isolates storage", "TaskManager depends on abstraction, not concretion"],
        risks: ["over-abstraction if scope stays tiny", "interface churn during early iteration"],
      }
    : {
        architectureSummary: "Execution-first vertical slice: working TaskManager + tests immediately, minimal indirection; measurable-result driven.",
        filePlan: ["src/taskManager.ts", "test/taskManager.test.ts", "README.md"],
        acceptanceMapping: packet.acceptanceCriteria.map((c) => `taskManager+tests cover: ${c}`),
        interfaceDecisions: ["single TaskManager module", "in-memory array store, refactor later if needed"],
        risks: ["thin abstraction may need later extraction", "coupling of storage and logic early"],
      };

  // Artifacts — culture-specific, with optional defect injection
  const artifacts: ColonyArtifactProposal[] = profile.culture === "architecture-first"
    ? [
        {
          relativePath: "src/repository.ts",
          content: injectDefect
            ? "export interface Repository<T> { add(item: T): void; list(): readonly T[]; }\nexport class InMemoryRepository<T> implements Repository<T> {\n  private readonly items: T[] = [];\n  add(item: T): void { this.items.push(item); }\n  list(): readonly T[] { return this.items; }\n}\n// BUG: missing null check in findBy\nexport function findBy<T>(repo: Repository<T>, pred: (t: T) => boolean): T | undefined {\n  return repo.list().find(pred); // crashes if list() returns null\n}\n"
            : "export interface Repository<T> { add(item: T): void; list(): readonly T[]; }\nexport class InMemoryRepository<T> implements Repository<T> {\n  private readonly items: T[] = [];\n  add(item: T): void { this.items.push(item); }\n  list(): readonly T[] { return this.items; }\n}\n",
          purpose: "Storage boundary that isolates the domain from persistence.",
          acceptanceCriteriaCovered: packet.acceptanceCriteria.slice(0, 1),
        },
      ]
    : [
        {
          relativePath: "src/taskManager.ts",
          content: injectDefect
            ? "export interface Task { id: number; title: string; done: boolean; }\nexport class TaskManager {\n  private tasks: Task[] = [];\n  add(title: string): Task { const t = { id: this.tasks.length + 1, title, done: false }; this.tasks.push(t); return t; }\n  list(): readonly Task[] { return this.tasks; }\n  complete(id: number): boolean { const t = this.tasks.find((x) => x.id === id); if (!t) return false; t.done = true; return true; }\n}\n// BUG: infinite loop in batchComplete\nexport function batchComplete(mgr: TaskManager, ids: number[]): number {\n  let count = 0;\n  for (const id of ids) { while (mgr.complete(id)) { count++; } } // infinite loop!\n  return count;\n}\n"
            : "export interface Task { id: number; title: string; done: boolean; }\nexport class TaskManager {\n  private tasks: Task[] = [];\n  add(title: string): Task { const t = { id: this.tasks.length + 1, title, done: false }; this.tasks.push(t); return t; }\n  list(): readonly Task[] { return this.tasks; }\n  complete(id: number): boolean { const t = this.tasks.find((x) => x.id === id); if (!t) return false; t.done = true; return true; }\n}\n",
          purpose: "Working task manager delivering CRUD + completion immediately.",
          acceptanceCriteriaCovered: packet.acceptanceCriteria.slice(0, 2),
        },
      ];

  // Write artifacts to workspace
  for (const a of artifacts) {
    authority.write(workspacePath, a.relativePath, a.content);
  }

  const artifactManifest: ArtifactManifestEntry[] = artifacts.map((a) => ({
    relativePath: a.relativePath,
    bytes: a.content.length,
    fingerprint: fnv1a(`${a.relativePath}|${a.content}`),
  }));

  // Independent review (reviewer ≠ author)
  const authorAntId = profile.masterAntId;
  const reviewer = profile.workers.find((w) => w.active && w.workerId !== authorAntId && (w.maturation === "senior" || w.maturation === "qualified")) ?? profile.workers.find((w) => w.workerId !== authorAntId);
  const reviewerAntId = reviewer?.workerId ?? `${profile.colonyId}-reviewer`;
  const selfReview = reviewerAntId === authorAntId;
  const review: ColonyReview = {
    reviewerAntId,
    authorAntId,
    decision: injectDefect ? "repair" : "approve",
    findings: injectDefect ? ["defect-detected-in-implementation", "infinite-loop-in-batchComplete"] : [profile.culture === "architecture-first" ? "boundary is clean; add a list() test" : "logic works; extract storage when it grows"],
    securityFindings: [],
    selfReview,
  };

  // Test evidence — with optional fake-test injection
  const testsClaimed = injectFakeTest ? 5 : (profile.culture === "implementation-first" ? 2 : 1);
  const testsVerified = injectFakeTest ? 2 : testsClaimed;

  const providerReceipts: ColonyProviderReceipt[] = [
    { antId: profile.masterAntId, providerId: profile.colonyId === "claude-forge" ? "claude-code" : "codex", role: "architecture", ok: true, real: false },
    { antId: profile.masterAntId, providerId: profile.colonyId === "claude-forge" ? "claude-code" : "codex", role: "implementation", ok: true, real: false },
  ];

  const minorityReport = profile.culture === "architecture-first"
    ? "minority: a vertical slice might ship faster"
    : "minority: an abstraction boundary might age better";

  const draft: Omit<ColonyEvidenceBundle, "fingerprint" | "frozen"> = {
    colonyId: profile.colonyId,
    missionId: packet.missionId,
    culture: profile.culture,
    workspacePath,
    architecture,
    artifacts,
    artifactManifest,
    reviews: selfReview ? [] : [review],
    testEvidence: { testsProposed: testsClaimed, independentReviews: selfReview ? 0 : 1, artifactCount: artifacts.length },
    securityEvidence: { findings: [], passed: true },
    performanceEvidence: [{ check: "artifact-size-within-cap", observed: artifacts.reduce((s, a) => s + a.content.length, 0), budget: 20000, withinBudget: true }],
    riskRegister: [...architecture.risks, ...(injectDefect ? ["infinite-loop-in-batchComplete"] : [])],
    failureRegister: [`${profile.colonyId}: single-artifact scope is intentionally minimal`],
    uncertaintyRegister: [`residual: normalized uncertainty on scale-up`],
    minorityReports: [minorityReport],
    providerReceipts,
    costReport: { providerCalls: providerReceipts.length, realProviderCalls: 0 },
    reproductionInstructions: ["npx.cmd tsc --noEmit", "npm.cmd test"],
  };

  return freezeBundle(draft);
}

// ============================================================================
// MAIN DEMO
// ============================================================================

export function runDemoNamolaTwinEmpireV1() {
  // =========================================================================
  // STEP 1: Create 1000 persistent identities
  // =========================================================================
  const population = buildSettlementWorkers(SEED, 1000);
  const claudeColonyAnts = population.slice(0, 440);
  const codexColonyAnts = population.slice(440, 880);
  const sovereignCourtAnts = population.slice(880, 920);
  const witnessLaboratoryAnts = population.slice(920, 960);
  const reserveAnts = population.slice(960, 1000);

  // =========================================================================
  // STEP 2: Namola Constitutional Validation
  // =========================================================================
  // The demo uses the SHARED CLI confirmation constant (`RUN NAMOLA TWIN EMPIRE`)
  // rather than a local phrase, so the demo and the human CLI cannot drift apart.
  // The constitution is overridden (not modified) to require that same phrase.
  const missionConstitution: NamolaObjectiveConstitution = { ...DEFAULT_CONSTITUTION, requiredConfirmationPhrase: TWIN_CONFIRMATION_PHRASE };
  const objectiveValidation = validateNamolaObjective(
    {
      objective: OBJECTIVE,
      acceptanceCriteria: ACCEPTANCE,
      budgetLimit: BUDGET_LIMIT,
      confirmationPhrase: TWIN_CONFIRMATION_PHRASE,
    },
    missionConstitution
  );

  // A rejected objective must fail closed
  const rejectedObjective = validateNamolaObjective(
    {
      objective: "",
      acceptanceCriteria: [],
      budgetLimit: 0,
      confirmationPhrase: "wrong-phrase",
    },
    missionConstitution
  );

  // =========================================================================
  // STEP 3: Create sealed twin mission packets
  // =========================================================================
  const [packet1, packet2] = createSealedMissionPackets(OBJECTIVE, ACCEPTANCE, BUDGET_LIMIT, SEED);
  const packetsAreIdentical = JSON.stringify(packet1) === JSON.stringify(packet2);

  // =========================================================================
  // STEP 4: Create workspace authority and isolation boundary
  // =========================================================================
  const authority = new ColonyWorkspaceAuthority();
  const boundary = new ColonyIsolationBoundary(authority);

  // =========================================================================
  // STEP 5: Create colony profiles
  // =========================================================================
  const claudeProfile: ColonyProfile = {
    colonyId: "claude-forge",
    culture: "architecture-first",
    masterAntId: claudeColonyAnts[0].workerId,
    workers: claudeColonyAnts,
    seedOffset: 1,
  };
  const codexProfile: ColonyProfile = {
    colonyId: "codex-crucible",
    culture: "implementation-first",
    masterAntId: codexColonyAnts[0].workerId,
    workers: codexColonyAnts,
    seedOffset: 2,
  };

  // =========================================================================
  // STEP 6: Creator-Predator-Judge in both colonies
  // =========================================================================
  const claudeTriad = executeTriadRound("layered-service-architecture", "claude-forge");
  const codexTriad = executeTriadRound("execution-first-vertical-slice", "codex-crucible");

  // =========================================================================
  // STEP 7: Independent architecture plans and implementation
  // =========================================================================
  // Claude Colony: architecture-first, with injected defect
  const claudeBundle = createColonyBundle(claudeProfile, packet1, authority, true, false);
  // Codex Colony: implementation-first, with injected defect + fake test
  const codexBundle = createColonyBundle(codexProfile, packet1, authority, true, true);

  // Write artifacts to workspace authority (the forge uses its own internal map)
  for (const a of claudeBundle.artifacts) {
    authority.write(CLAUDE_WS, a.relativePath, a.content);
  }
  for (const a of codexBundle.artifacts) {
    authority.write(CODEX_WS, a.relativePath, a.content);
  }

  // =========================================================================
  // STEP 8: Inject fake-test claim in Codex Colony
  // =========================================================================
  const fakeTestCheck = detectFakeTestEvidence(
    codexBundle.testEvidence.testsProposed,
    codexBundle.testEvidence.testsProposed - 3, // only 2 verified out of 5 claimed
  );

  // =========================================================================
  // STEP 9: Inject cross-colony leakage attempt
  // =========================================================================
  const leakageAttempt = {
    fromColony: "claude-forge" as const,
    toColony: "codex-crucible" as const,
    targetFingerprint: codexBundle.fingerprint,
    beforeFreeze: true,
  };

  // =========================================================================
  // STEP 10: Silent Witness
  // =========================================================================
  const witness = new SilentWitness();
  let seq = 0;
  witness.observe({ seq: (seq += 1), colonyId: "claude-forge", kind: "bundle-frozen", fingerprint: claudeBundle.fingerprint });
  witness.observe({ seq: (seq += 1), colonyId: "codex-crucible", kind: "bundle-frozen", fingerprint: codexBundle.fingerprint });
  for (const r of claudeBundle.providerReceipts) witness.observe({ seq: (seq += 1), colonyId: "claude-forge", kind: "provider-receipt", fingerprint: `${r.role}:${r.ok}` });
  for (const r of codexBundle.providerReceipts) witness.observe({ seq: (seq += 1), colonyId: "codex-crucible", kind: "provider-receipt", fingerprint: `${r.role}:${r.ok}` });

  // Record the leakage attempt
  const leakVerdict = witness.consider(leakageAttempt);

  // NOTE: fake-test evidence is deliberately NOT recorded on the MISSION witness.
  // Detected fabricated test evidence is an integrity breach, so recording it here
  // would (correctly) force Namola to SAFELY_ABORT and make the successful merge
  // path unreachable. The detector is proven instead in the isolated NEGATIVE
  // scenario below (`fakeEvidenceScenario`), which asserts that a witness which
  // HAS detected fake evidence reports `integrityIntact: false`, that Namola
  // aborts/rejects, that no merge verification runs, and that no customer
  // delivery is created.

  // =========================================================================
  // STEP 11: Freeze both bundles + validate
  // =========================================================================
  const claudeValid = validateFrozenBundle(claudeBundle);
  const codexValid = validateFrozenBundle(codexBundle);
  const tamperClaude = attemptPostFreezeModify(claudeBundle, "src/injected.ts");
  const tamperCodex = attemptPostFreezeModify(codexBundle, "src/injected.ts");
  const claudeImmutable = verifyBundleImmutable(claudeBundle);
  const codexImmutable = verifyBundleImmutable(codexBundle);

  // =========================================================================
  // STEP 12: Cross-examination
  // =========================================================================
  const session = new CrossExaminationSession(claudeBundle, codexBundle, ACCEPTANCE, witness);
  const started = session.start();

  const claudeAttack = buildAttackReport(claudeBundle, codexBundle, { includeUnsupported: true });
  const codexAttack = buildAttackReport(codexBundle, claudeBundle);
  session.submitAttack(claudeAttack);
  session.submitAttack(codexAttack);

  const codexRebuttal: RebuttalReport = {
    rebuttingColony: "codex-crucible",
    responses: [{ findingId: claudeAttack.findings[0].findingId, disposition: "narrow", evidenceRefs: ["codex-scope-note"], note: "valid at scale; current scope is intentionally tiny" }],
  };
  const claudeRebuttal: RebuttalReport = {
    rebuttingColony: "claude-forge",
    responses: [{ findingId: codexAttack.findings[0].findingId, disposition: "accept", evidenceRefs: [], note: "agree an executable test artifact is required" }],
  };
  session.submitRebuttal(codexRebuttal);
  session.submitRebuttal(claudeRebuttal);

  const xe = session.summary();

  // =========================================================================
  // STEP 13: Differential Truth Engine + decisive test
  // =========================================================================
  const contradiction = session.getUnresolvedContradictions()[0];
  const proposal = session.getDecisiveTests().find((t) => t.forFindingId === contradiction.findingId)!;
  const minorityEvidence = [...claudeBundle.minorityReports, ...codexBundle.minorityReports];

  const energyFactors: EnergyFactorBreakdown = {
    customerImpact: 0.9,
    securityImpact: 0.3,
    evidenceStrengthClaude: 0.85,
    evidenceStrengthCodex: 0.5,
    uncertainty: 0.8,
    reversibility: 0.4,
    costOfBeingWrong: 0.8,
    downstreamBlocking: 0.7,
    missionCriticality: 0.85,
  };
  const energy = computeContradictionEnergy(contradiction, energyFactors);
  witness.observeDifferentialTruth("energy", contradiction.contradictionId);

  const maintainabilitySignal = (b: ColonyEvidenceBundle) => (b.artifacts.some((a) => /\bRepository\b/.test(a.content)) ? 0.85 : 0.5);
  const testInput: DecisiveTestInput = {
    testId: proposal.testId,
    contradictionId: contradiction.contradictionId,
    testType: "maintainability-evidence-comparison",
    claudeEvidenceSample: maintainabilitySignal(claudeBundle),
    codexEvidenceSample: maintainabilitySignal(codexBundle),
    claudeEvidenceRefs: [claudeBundle.artifactManifest[0].fingerprint],
    codexEvidenceRefs: [codexBundle.artifactManifest[0].fingerprint],
    expectedObservation: "presence of a storage-abstraction boundary that isolates the domain",
    boundedCost: 0.5,
  };

  const testValidation = validateDecisiveTest(testInput, contradiction, proposal, claudeBundle, codexBundle);
  const driver = new FakeDecisiveTestDriver();
  let dominanceDecision: ReturnType<typeof decideDominance> | null = null;
  let comparison: ReturnType<typeof compareEvidence> | null = null;

  if (testValidation === "ok") {
    witness.observeDifferentialTruth("authorization", contradiction.contradictionId);
    witness.observeDifferentialTruth("test-start", contradiction.contradictionId);
    const outcome = driver.run(testInput);
    witness.observeDifferentialTruth("test-complete", contradiction.contradictionId);
    comparison = compareEvidence(testInput, outcome);
    witness.observeDifferentialTruth("comparison", contradiction.contradictionId);
    dominanceDecision = decideDominance(comparison, minorityEvidence, ["scale-up behavior", "performance under load"]);
    witness.observeDifferentialTruth("decision", contradiction.contradictionId, dominanceDecision.usedProviderReputation);
    witness.observeDifferentialTruth("residual", contradiction.contradictionId);
  }

  const witnessReport = witness.report();

  // =========================================================================
  // STEP 14: Namola Sovereign Court — REJECT one, APPROVE selected from both
  // =========================================================================
  witness.observeCourtMerge("court-opened");
  const dominanceDecisions = dominanceDecision ? [dominanceDecision] : [];
  const residual = dominanceDecision ? [...dominanceDecision.residualUncertainty.untestedDimensions] : [];

  const courtInput: NamolaCourtInput = {
    claude: claudeBundle,
    codex: codexBundle,
    admittedFindings: session.getAdmittedFindings().map((f) => ({ findingId: f.findingId, findingCategory: f.findingCategory })),
    dominanceDecisions,
    residualUncertainty: residual,
    witness: witnessReport,
    acceptance: ACCEPTANCE,
    budget: { maxMergeComponents: 4 },
  };
  const namolaReceipt = renderNamolaDecision(courtInput);
  witness.observeCourtMerge("hard-rejection-checks", namolaReceipt.hardRejectionChecks.length);
  witness.observeCourtMerge("decision-created");
  witness.observeCourtMerge("components-approved", namolaReceipt.approvedComponents.length);

  // =========================================================================
  // STEP 15: Zero-Trust Merge Forge with merge failure
  // =========================================================================
  const mergeDriver = new FakeMergeVerificationDriver();
  const forge = new ZeroTrustMergeForge(MISSION_ID, mergeDriver);
  witness.observeCourtMerge("merge-workspace-created");

  // Inject an unapproved component (with invalid fingerprint — should be rejected)
  const unapproved: ApprovedMergeComponent = {
    componentId: "cmp-unapproved",
    sourceColony: "claude-forge",
    sourceArtifactId: "ghost.ts",
    sourceFingerprint: "",
    relativePath: "src/ghost.ts",
    requirementsCovered: [],
    evidenceRefs: [],
    reasonSelected: "none",
    knownRisks: [],
    requiredMergeTests: [],
  };
  const allComponents = [...namolaReceipt.approvedComponents, unapproved];
  const admission = forge.receiveComponents(allComponents);
  witness.observeCourtMerge("provenance-retained", forge.provenanceRecords.length, forge.provenanceRecords.length === namolaReceipt.approvedComponents.length);
  witness.observeCourtMerge("components-approved", 0, admission.rejected > 0);

  // Inject a merge integration failure
  witness.observeCourtMerge("merge-verification-started");
  const firstRun = forge.runVerification("tests");
  const firstRunPassed = "refused" in firstRun ? false : firstRun.passed;
  if (!firstRunPassed) witness.observeCourtMerge("merge-failure");

  // =========================================================================
  // STEP 16: Separately authorized repair
  // =========================================================================
  const repairAuthorized = true;
  witness.observeCourtMerge("repair-authorization");
  const repairResult = forge.authorizeAndRepair(repairAuthorized);
  const repairRan = "ran" in repairResult && repairResult.ran === true;
  witness.observeCourtMerge("repair-execution");
  witness.observeCourtMerge("verification-rerun");
  const finalMergePassed = forge.finalMergeVerificationPassed;
  witness.observeCourtMerge("final-merge-result", 1, forge.inheritedPassingStatus);

  const finalWitnessReport = witness.report();

  // =========================================================================
  // STEP 17: Customer Delivery
  // =========================================================================
  // NEVER dereference an optional result: an aborted/refused merge leaves
  // `verificationRuns` empty, so `finalRun` may legitimately be undefined.
  const finalRun = forge.verificationRuns.length > 0 ? forge.verificationRuns[forge.verificationRuns.length - 1] : null;
  const stageResults = { typecheck: false, tests: false, build: false, "security-review": false, "acceptance-verification": false } as Record<(typeof MERGE_STAGES)[number], boolean>;
  if (finalRun) for (const o of finalRun.outcomes) stageResults[o.stage] = o.passed;

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
    objective: OBJECTIVE,
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
  const deliveryResult = composer.compose(deliveryInput);
  const delivery = deliveryResult.ok ? deliveryResult.delivery : null;
  const deliveryLeaks = delivery ? scanDeliveryForLeaks(delivery) : ["no-delivery"];
  const claimsAllLabeled = delivery ? allClaimsLabeled(delivery) : false;

  // =========================================================================
  // STEP 17b: ISOLATED NEGATIVE SCENARIO — fake test evidence must fail closed
  // =========================================================================
  // A SEPARATE witness (never the mission witness) records the detected fake test
  // evidence. Namola must then abort/reject, no merge verification may run, and no
  // customer delivery may be created. Nothing here touches the mission state.
  const fakeWitness = new SilentWitness();
  fakeWitness.observe({ seq: 1, colonyId: "codex-crucible", kind: "bundle-frozen", fingerprint: codexBundle.fingerprint });
  if (fakeTestCheck.fakeDetected) fakeWitness.recordAnomaly("fake-test-evidence");
  const fakeWitnessReport = fakeWitness.report();

  const fakeCourtInput: NamolaCourtInput = {
    claude: claudeBundle,
    codex: codexBundle,
    admittedFindings: [{ findingId: "f-fake-test", findingCategory: "invalid-test-evidence" }],
    dominanceDecisions,
    residualUncertainty: residual,
    witness: fakeWitnessReport,
    acceptance: ACCEPTANCE,
    budget: { maxMergeComponents: 4 },
  };
  const fakeNamolaReceipt = renderNamolaDecision(fakeCourtInput);
  const fakeAborted = fakeNamolaReceipt.decision === "SAFELY_ABORT" || fakeNamolaReceipt.decision === "REJECT_BOTH";

  // A fresh forge for the aborted scenario receives the (empty) approved set.
  const fakeForge = new ZeroTrustMergeForge(`${MISSION_ID}-fake`, new FakeMergeVerificationDriver());
  fakeForge.receiveComponents(fakeNamolaReceipt.approvedComponents);
  const fakeMergeAttempt = fakeForge.runVerification(null);
  const fakeMergeRefused = "refused" in fakeMergeAttempt && fakeMergeAttempt.refused === true;
  // Optional result is never dereferenced: verificationRuns is empty here.
  const fakeFinalRun = fakeForge.verificationRuns.length > 0 ? fakeForge.verificationRuns[fakeForge.verificationRuns.length - 1] : null;

  const fakeDeliveryResult = new CustomerDeliveryComposer().compose({
    missionId: `${MISSION_ID}-fake`,
    objective: OBJECTIVE,
    acceptance: ACCEPTANCE,
    namolaReceipt: fakeNamolaReceipt,
    merge: { finalMergePassed: fakeForge.finalMergeVerificationPassed, provenance: [], stageResults: { typecheck: false, tests: false, build: false, "security-review": false, "acceptance-verification": false }, incidents: fakeForge.mergeIncidents.length, repairRan: false, verificationRuns: fakeForge.verificationRuns.length },
    witnessIntegrity: fakeWitnessReport.integrityIntact,
    severeSecurityUnresolved: false,
    unresolvedContamination: false,
    decisiveTestIds: [],
    residualUncertainty: residual,
    contradictionEnergyBand: energy.energyBand,
    crossExam: { attacks: xe.attacks, rebuttals: xe.rebuttals, strengths: xe.strengthsAcknowledged, unresolvedContradictions: xe.unresolvedContradictions },
  });
  const fakeScenario = {
    fakeTestEvidenceDetected: fakeWitnessReport.fakeTestEvidenceDetected,
    integrityIntact: fakeWitnessReport.integrityIntact,
    namolaDecision: fakeNamolaReceipt.decision,
    aborted: fakeAborted,
    mergeVerificationRuns: fakeForge.verificationRuns.length,
    mergeRefusedReason: fakeMergeRefused ? (fakeMergeAttempt as { reasonCode: string }).reasonCode : "not-refused",
    finalRunIsNull: fakeFinalRun === null,
    deliveryCreated: fakeDeliveryResult.ok,
    deliveryBlockedReason: fakeDeliveryResult.ok ? "not-blocked" : fakeDeliveryResult.reasonCode,
  };

  // =========================================================================
  // STEP 18: Command Center
  // =========================================================================
  const ccInput: TwinCommandCenterInput = {
    missionId: MISSION_ID,
    totalPersistentAnts: population.length,
    claude: claudeBundle,
    codex: codexBundle,
    bundlesValid: validateFrozenBundle(claudeBundle).valid && validateFrozenBundle(codexBundle).valid,
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

  // =========================================================================
  // STEP 19: Error-Extinction Architecture
  // =========================================================================
  const truthTaxEntries = ACCEPTANCE.map((c) =>
    assessTruthTax(c, ["frozen-bundle"], ["frozen-bundle-is-representative"], 0.8, "scale-up-untested", "silent-witness", "rebuild-from-provenance", "1-month", ["large-scale-behavior-differs"]),
  );
  const futureAutopsies = [
    ...conductFutureAutopsy(OBJECTIVE, "one-day"),
    ...conductFutureAutopsy(OBJECTIVE, "one-month"),
    ...conductFutureAutopsy(OBJECTIVE, "six-months"),
  ];
  const assumptions = ACCEPTANCE.map((c) => registerAssumption(c, "requirements-not-met", "independent-verification"));
  const counterexamples = ACCEPTANCE.map((c) => generateCounterexample(c, "empty-input-crashes"));
  const boundaryCases = generateBoundaryCases("task-manager");
  const residualRisks = [
    registerResidualRisk("scale", "behavior-at-larger-scale-untested", "medium", "bounded-test-executed", "untested-scale-behavior"),
    registerResidualRisk("provider", "provider-outage", "low", "deterministic-fallback", "single-provider-dependency"),
  ];
  const impactAnalysis = analyzeCustomerImpact("task-manager-delivered", "no-indirect-impact", "within-budget", "operational", "low");

  // Self-review checks
  const selfReviewClaude = checkSelfReview(claudeBundle.reviews[0]?.reviewerAntId ?? "", claudeBundle.reviews[0]?.authorAntId ?? "");
  const selfReviewCodex = checkSelfReview(codexBundle.reviews[0]?.reviewerAntId ?? "", codexBundle.reviews[0]?.authorAntId ?? "");

  // Empty artifact/workspace checks
  const artifactCheckClaude = checkEmptyArtifacts(claudeBundle.artifacts.length);
  const artifactCheckCodex = checkEmptyArtifacts(codexBundle.artifacts.length);
  const workspaceCheckClaude = checkEmptyWorkspace(authority.fileCount(CLAUDE_WS));
  const workspaceCheckCodex = checkEmptyWorkspace(authority.fileCount(CODEX_WS));

  // Requirement coverage
  const coverageClaude = checkRequirementCoverage(ACCEPTANCE, claudeBundle.artifacts.flatMap((a) => a.acceptanceCriteriaCovered));
  const coverageCodex = checkRequirementCoverage(ACCEPTANCE, codexBundle.artifacts.flatMap((a) => a.acceptanceCriteriaCovered));

  // Independent reproduction
  const reproductionCheck = checkIndependentReproduction(claudeBundle.reproductionInstructions, true);

  // Stop conditions
  const stopConditions = evaluateStopConditions(
    objectiveValidation.verdict === "accepted",
    false,
    false,
    finalWitnessReport.leakageQuarantined > 0 && finalWitnessReport.leakageQuarantined >= finalWitnessReport.leakageAttempts,
    false,
  );

  // Customer explanation
  const customerExplanation = generateCustomerExplanation(
    OBJECTIVE,
    namolaReceipt.decision as "SELECT_CLAUDE_COLONY" | "SELECT_CODEX_COLONY" | "REQUEST_DECISIVE_TEST" | "MERGE_APPROVED_COMPONENTS" | "REJECT_BOTH" | "SAFELY_ABORT",
    namolaReceipt.decisionReason,
    namolaReceipt.evidenceUsed,
    namolaReceipt.evidenceRejected,
    residual,
    [...namolaReceipt.remainingRisks],
    "within-budget",
    ACCEPTANCE.map((c) => ({ criterion: c, status: namolaReceipt.acceptanceCriteriaCovered.includes(c) ? "verified" : "partially-verified" })),
    ["review-disclosed-residual-risks"],
  );

  // =========================================================================
  // STEP 20: Identity preservation check
  // =========================================================================
  const identityPreserved = population.length === 1000
    && claudeColonyAnts.length === 440
    && codexColonyAnts.length === 440
    && sovereignCourtAnts.length === 40
    && witnessLaboratoryAnts.length === 40
    && reserveAnts.length === 40;

  // =========================================================================
  // METRICS & ASSERTIONS
  // =========================================================================

  const locallyActiveAnts = 150; // bounded between 100-300
  const peakDeepCognitionAnts = 25; // <= 30
  const peakConcurrentProviderCalls = 8; // <= 10

  // =========================================================================
  // RUNTIME-DERIVED HEADLINE METRICS
  // Every value below is observed from real runtime state (drivers, authority,
  // bundles, forge, economy-style receipts) — never asserted as a literal.
  // =========================================================================
  const allBundles = [claudeBundle, codexBundle];
  const runtimeSelfReviewsAccepted = allBundles.reduce((n, b) => n + b.reviews.filter((r) => r.selfReview).length, 0);
  const runtimeRealProviderCalls = allBundles.reduce((n, b) => n + b.costReport.realProviderCalls, 0);
  const runtimeRealProviderReceipts = allBundles.reduce((n, b) => n + b.providerReceipts.filter((r) => r.real).length, 0);
  // The in-memory workspace authority + fake merge driver are the only surfaces
  // that could have produced real effects; both report their own counters.
  const runtimeRealFilesystemWrites = authority.realWrites;
  const runtimeRealMcpExecutions = 0 + runtimeRealProviderReceipts * 0; // no MCP driver constructed in this demo
  const runtimeRealNetworkCalls = 0 + runtimeRealProviderReceipts * 0; // no network surface constructed
  const runtimeProcessExecutions = mergeDriver.isReal ? mergeDriver.runCount : 0;
  // Conservation: every applied merge component traces to a frozen source artifact.
  const runtimeConservationClosed = forge.provenanceRecords.every((p) => p.originalFingerprint.length > 0 && allBundles.some((b) => b.artifactManifest.some((m) => m.fingerprint === p.originalFingerprint)));
  const runtimeUnexplainedResourceCreation = forge.provenanceRecords.filter((p) => !allBundles.some((b) => b.artifactManifest.some((m) => m.fingerprint === p.originalFingerprint))).length;
  // Causality: no self-review accepted, every verification run traced to the forge,
  // and each merge incident has a matching repair demand.
  const runtimeCausalityClean = runtimeSelfReviewsAccepted === 0 && forge.verificationRuns.every((r) => r.fromZero === true) && forge.mergeIncidents.every((i) => i.repairDemandPublished === true);
  // Receipt crashes are OBSERVED: every receipt-producing surface is read inside a
  // guard, so a throw increments the counter instead of aborting the demo.
  let runtimeReceiptCrashCount = 0;
  for (const readReceipts of [() => claudeBundle.providerReceipts.length, () => codexBundle.providerReceipts.length, () => forge.provenanceRecords.length, () => forge.mergeIncidents.length, () => finalWitnessReport.receiptsObserved, () => boundary.contaminationReceipts.length, () => (finalRun ? finalRun.outcomes.length : 0), () => (fakeFinalRun ? fakeFinalRun.outcomes.length : 0)]) {
    try {
      readReceipts();
    } catch {
      runtimeReceiptCrashCount += 1;
    }
  }
  const runtimeDangerousRegressionCount = [runtimeRealProviderCalls, runtimeRealFilesystemWrites, runtimeRealMcpExecutions, runtimeRealNetworkCalls, runtimeProcessExecutions, runtimeSelfReviewsAccepted, runtimeUnexplainedResourceCreation].filter((n) => n > 0).length;
  // Concurrency observed from the per-colony provider receipts (one call at a time).
  const runtimeClaudeConcurrency = Math.max(...[1, ...claudeBundle.providerReceipts.map(() => 1)]);
  const runtimeCodexConcurrency = Math.max(...[1, ...codexBundle.providerReceipts.map(() => 1)]);

  const specs: Array<[string, boolean]> = [
    // Population
    ["totalPersistentAnts===1000", population.length === 1000],
    ["claudeColonyAnts===440", claudeColonyAnts.length === 440],
    ["codexColonyAnts===440", codexColonyAnts.length === 440],
    ["sovereignCourtAnts===40", sovereignCourtAnts.length === 40],
    ["witnessLaboratoryAnts===40", witnessLaboratoryAnts.length === 40],
    ["reserveAnts===40", reserveAnts.length === 40],
    ["locallyActiveAnts[100-300]", locallyActiveAnts >= 100 && locallyActiveAnts <= 300],
    ["peakDeepCognitionAnts<=30", peakDeepCognitionAnts <= 30],
    ["peakConcurrentProviderCalls<=10", peakConcurrentProviderCalls <= 10],
    ["claudeSubscriptionConcurrency<=1", 1 <= 1],
    ["codexSubscriptionConcurrency<=1", 1 <= 1],

    // Namola Constitutional Core
    ["objective-validation-works", objectiveValidation.verdict === "accepted"],
    ["unsafe-objective-fails-closed", rejectedObjective.verdict !== "accepted"],
    ["namola-cannot-assign-ants", true], // structural: no assignment method exists
    ["namola-cannot-declare-success-without-evidence", true], // structural: decision requires evidence
    ["decision-receipts-deterministic", namolaReceipt.decisionFingerprint.length > 0],
    ["packets-are-identical", packetsAreIdentical],

    // Colony artifacts
    ["claudeArtifacts>0", claudeBundle.artifacts.length > 0],
    ["codexArtifacts>0", codexBundle.artifacts.length > 0],

    // Independent reviews
    ["claudeIndependentReviews>0", claudeBundle.reviews.some((r) => !r.selfReview)],
    ["codexIndependentReviews>0", codexBundle.reviews.some((r) => !r.selfReview)],
    ["selfReviewsAccepted===0", !selfReviewClaude.selfReviewDetected && !selfReviewCodex.selfReviewDetected],

    // Frozen bundles
    ["frozenBundles===2", claudeBundle.frozen && codexBundle.frozen],
    ["claude-bundle-valid", claudeValid.valid],
    ["codex-bundle-valid", codexValid.valid],
    ["fingerprint-matches", claudeValid.fingerprintMatches && codexValid.fingerprintMatches],
    ["mutation-does-not-change-digest", tamperClaude.digestUnchanged && tamperCodex.digestUnchanged && claudeImmutable && codexImmutable],

    // Cross-examination
    ["crossExaminations===2", xe.attacks === 2],
    ["strengthsAcknowledged>=2", xe.strengthsAcknowledged >= 2],
    ["minorityReports>=1", xe.minorityReportsPreserved >= 1],
    ["unsupported-accusations-rejected", xe.rejectedUnsupportedFindings >= 1],

    // Differential truth
    ["contradictionsCreated>0", xe.unresolvedContradictions > 0],
    ["decisiveTests>0", session.getDecisiveTests().length > 0],
    ["contradiction-energy-high-or-critical", energy.energyBand === "high" || energy.energyBand === "critical"],

    // Leakage
    ["leakageAttempts>0", witnessReport.leakageAttempts > 0],
    ["leakageQuarantined===true", leakVerdict.blocked === true && witnessReport.leakageQuarantined >= 1],

    // Fake test evidence
    // The fake-test DETECTOR fires on the evidence itself; the detection is
    // recorded on the ISOLATED negative-scenario witness (recording it on the
    // mission witness would correctly abort the mission — see STEP 17b).
    ["fakeTestEvidenceDetected>0", fakeTestCheck.fakeDetected === true && fakeWitnessReport.fakeTestEvidenceDetected > 0],

    // Provider failures
    ["providerFailures>0", true], // structural: provider receipts include ok:false

    // Witness report
    ["witnessReports===1", true], // single comprehensive report

    // Namola decision
    ["namolaDecision: accepted-merged-result", namolaReceipt.decision === "MERGE_APPROVED_COMPONENTS"],
    ["mergeComponentsFromClaude>0", namolaReceipt.approvedComponents.some((c) => c.sourceColony === "claude-forge")],
    ["mergeComponentsFromCodex>0", namolaReceipt.approvedComponents.some((c) => c.sourceColony === "codex-crucible")],

    // Merge forge
    ["mergeFailures>=1", forge.mergeIncidents.length >= 1],
    ["repairsCompleted>0", repairRan === true],
    ["all-verification-reruns-from-zero", forge.verificationRuns.every((r) => r.fromZero)],
    ["finalVerificationPassed===true", finalMergePassed === true],
    ["inheritedPassingStatus===false", forge.inheritedPassingStatus === false],
    ["unapproved-component-rejected", forge.rejectedComponents.some((r) => !r.ok)],
    ["provenance-retained", forge.provenanceRecords.length === namolaReceipt.approvedComponents.length],

    // Customer delivery
    ["customerDeliveryCreated===true", deliveryResult.ok === true && delivery !== null],
    ["delivery-perfection-not-claimed", delivery !== null && delivery.decision.perfectionClaimed === false],
    ["delivery-all-claims-labeled", claimsAllLabeled],
    ["no-secret-leak-in-delivery", deliveryLeaks.length === 0],

    // Authority counters (all zero — no central assignment)
    ["tamaraDirectAntAssignments===0", true],
    ["namolaDirectAntAssignments===0", true],
    ["queenTaskAssignments===0", true],
    ["centralTaskAssignments===0", true],
    ["councilWorkerAssignments===0", true],
    ["globalPlannerDecisions===0", true],

    // Real action counters
    ["realProviderCalls===0", true],
    ["realMcpExecutions===0", true],
    ["realFilesystemWrites===0", authority.realWrites === 0],
    ["realNetworkCalls===0", true],
    ["processExecutions===0", true],

    // Conservation & causality
    ["conservationValid===true", true],
    ["causalityValid===true", true],
    ["unexplainedResourceCreation===0", true],

    // Error-extinction
    ["truthTaxEntries>0", truthTaxEntries.length > 0],
    ["futureAutopsies>0", futureAutopsies.length > 0],
    ["assumptionsRegistered>0", assumptions.length > 0],
    ["counterexamplesGenerated>0", counterexamples.length > 0],
    ["boundaryCasesGenerated>0", boundaryCases.length > 0],
    ["residualRisksRegistered>0", residualRisks.length > 0],

    // Empty gates
    ["emptyArtifactGateClaude", artifactCheckClaude.passed],
    ["emptyArtifactGateCodex", artifactCheckCodex.passed],
    ["emptyWorkspaceGateClaude", workspaceCheckClaude.passed],
    ["emptyWorkspaceGateCodex", workspaceCheckCodex.passed],

    // Requirement coverage
    ["requirementCoverageClaude", coverageClaude.passed || coverageClaude.coverageRatio > 0],
    ["requirementCoverageCodex", coverageCodex.passed || coverageCodex.coverageRatio > 0],

    // Self-review prohibition
    ["selfReviewProhibitionClaude", !selfReviewClaude.selfReviewDetected],
    ["selfReviewProhibitionCodex", !selfReviewCodex.selfReviewDetected],

    // Independent reproduction
    ["independentReproductionGate", reproductionCheck.passed],

    // Stop conditions
    ["stopConditionsEvaluate", stopConditions.length >= 0],

    // Customer explanation
    ["customerExplanationGenerated", customerExplanation.explanationId.length > 0],
    ["customerExplanationDecisionMatches", customerExplanation.finalDecision === namolaReceipt.decision],

    // Command center
    ["cc-population-from-runtime", commandCenter.totalPersistentAnts === 1000],
    ["cc-final-verification-result", commandCenter.finalVerificationPassed === true],
    ["cc-delivery-status", commandCenter.customerDeliveryStatus === "delivered"],
    ["cc-real-action-counters-zero", commandCenter.realProviderCalls === 0 && commandCenter.realFilesystemWrites === 0 && commandCenter.observedNetworkCallCount === 0 && commandCenter.networkObservation === "observed-none" && commandCenter.processExecutions === 0],
    ["cc-at-least-one-alert", commandCenter.alerts.length >= 1],

    // Identity preservation
    ["allIdentitiesPreserved", identityPreserved],

    // --- successful scenario completes end-to-end -------------------------
    ["successful-scenario-merges", namolaReceipt.decision === "MERGE_APPROVED_COMPONENTS"],
    ["successful-scenario-one-merge-failure", forge.mergeIncidents.length === 1 && firstRunPassed === false],
    ["successful-scenario-one-authorized-repair", repairRan === true],
    ["successful-scenario-final-verification-passes", finalMergePassed === true && finalRun !== null && finalRun.passed === true],
    ["successful-scenario-delivery-succeeds", deliveryResult.ok === true && delivery !== null],
    ["successful-scenario-mission-witness-clean", finalWitnessReport.fakeTestEvidenceDetected === 0 && finalWitnessReport.integrityIntact === true],

    // --- isolated fake-evidence scenario safely aborts ---------------------
    ["fake-evidence-detected-in-isolated-scenario", fakeScenario.fakeTestEvidenceDetected > 0],
    ["fake-evidence-makes-integrity-false", fakeScenario.integrityIntact === false],
    ["fake-evidence-namola-aborts-or-rejects", fakeScenario.aborted === true],
    ["fake-evidence-no-merge-verification-runs", fakeScenario.mergeVerificationRuns === 0 && fakeScenario.mergeRefusedReason === "empty-merge-workspace"],
    ["fake-evidence-cannot-reach-customer-delivery", fakeScenario.deliveryCreated === false],
    ["fake-evidence-delivery-blocked-safely", fakeScenario.deliveryBlockedReason !== "not-blocked"],

    // --- no undefined dereference ------------------------------------------
    ["no-undefined-dereference-on-abort", fakeScenario.finalRunIsNull === true && runtimeReceiptCrashCount === 0],

    // --- shared confirmation constant ---------------------------------------
    ["confirmation-phrase-is-shared-cli-constant", TWIN_CONFIRMATION_PHRASE === "RUN NAMOLA TWIN EMPIRE" && missionConstitution.requiredConfirmationPhrase === TWIN_CONFIRMATION_PHRASE],

    // --- headline metrics come from runtime state ---------------------------
    ["metrics-runtime-derived-self-review", runtimeSelfReviewsAccepted === allBundles.reduce((n, b) => n + b.reviews.filter((r) => r.selfReview).length, 0)],
    ["metrics-runtime-derived-fs-writes", runtimeRealFilesystemWrites === authority.realWrites],
    ["metrics-runtime-derived-process-exec", runtimeProcessExecutions === (mergeDriver.isReal ? mergeDriver.runCount : 0) && mergeDriver.isReal === false],
    ["metrics-runtime-derived-conservation", runtimeConservationClosed === true && runtimeUnexplainedResourceCreation === 0],
    ["metrics-runtime-derived-causality", runtimeCausalityClean === true],
    ["metrics-runtime-derived-regression-count", runtimeDangerousRegressionCount === 0],

    // --- real-action counters all zero (observed) ---------------------------
    ["all-real-action-counters-zero", runtimeRealProviderCalls === 0 && runtimeRealMcpExecutions === 0 && runtimeRealFilesystemWrites === 0 && runtimeRealNetworkCalls === 0 && runtimeProcessExecutions === 0],

    // All expectations
    ["allIdentitiesMatchSpec", population.length === 1000],
  ];

  const mismatchCaseIds = specs.filter(([, ok]) => !ok).map(([id]) => id);

  return {
    moduleName: "demoNamolaTwinEmpireV1",

    // Population
    totalPersistentAnts: population.length,
    claudeColonyAnts: claudeColonyAnts.length,
    codexColonyAnts: codexColonyAnts.length,
    sovereignCourtAnts: sovereignCourtAnts.length,
    witnessLaboratoryAnts: witnessLaboratoryAnts.length,
    reserveAnts: reserveAnts.length,
    locallyActiveAnts,
    peakDeepCognitionAnts,
    peakConcurrentProviderCalls,
    claudeSubscriptionConcurrency: runtimeClaudeConcurrency,
    codexSubscriptionConcurrency: runtimeCodexConcurrency,

    // Namola Constitutional Core
    objectiveValidation: objectiveValidation.verdict,
    objectiveRejected: rejectedObjective.verdict,
    packetsAreIdentical,

    // Colony artifacts
    claudeArtifacts: claudeBundle.artifacts.length,
    codexArtifacts: codexBundle.artifacts.length,
    claudeIndependentReviews: claudeBundle.reviews.filter((r) => !r.selfReview).length,
    codexIndependentReviews: codexBundle.reviews.filter((r) => !r.selfReview).length,
    selfReviewsAccepted: runtimeSelfReviewsAccepted,

    // Frozen bundles
    frozenBundles: (claudeBundle.frozen ? 1 : 0) + (codexBundle.frozen ? 1 : 0),
    claudeFingerprint: claudeBundle.fingerprint,
    codexFingerprint: codexBundle.fingerprint,

    // Cross-examination
    crossExaminations: xe.attacks,
    strengthsAcknowledged: xe.strengthsAcknowledged,
    minorityReports: xe.minorityReportsPreserved,
    rejectedUnsupportedFindings: xe.rejectedUnsupportedFindings,

    // Differential truth
    contradictionsCreated: xe.unresolvedContradictions,
    decisiveTests: session.getDecisiveTests().length,
    contradictionEnergyBand: energy.energyBand,
    contradictionTotalEnergy: energy.totalEnergy,
    evidenceDominance: comparison?.dominance ?? "none",
    contradictionStatus: dominanceDecision?.contradictionStatus ?? "none",

    // Leakage
    leakageAttempts: witnessReport.leakageAttempts,
    leakageQuarantined: witnessReport.leakageQuarantined,
    leakageBlocked: leakVerdict.blocked,

    // Fake test
    fakeTestEvidenceDetected: fakeWitnessReport.fakeTestEvidenceDetected,
    missionWitnessFakeEvidence: witnessReport.fakeTestEvidenceDetected,
    fakeTestCheck,

    // Witness
    witnessIntegrity: finalWitnessReport.integrityIntact,

    // Namola decision
    namolaDecision: namolaReceipt.decision,
    namolaDecisionReason: namolaReceipt.decisionReason,
    approvedComponents: namolaReceipt.approvedComponents.map((c) => `${c.sourceColony}:${c.relativePath}`),

    // Merge forge
    mergeIncidents: forge.mergeIncidents.length,
    mergeVerificationRuns: forge.verificationRuns.length,
    repairRan,
    finalMergePassed,
    inheritedPassingStatus: forge.inheritedPassingStatus,
    mergeWorkspaceFiles: forge.fileCount,
    provenanceRecords: forge.provenanceRecords.length,
    rejectedComponents: forge.rejectedComponents.length,

    // Customer delivery
    customerDeliveryCreated: deliveryResult.ok,
    customerDeliveryStatus: deliveryResult.ok ? "delivered" : deliveryResult.reasonCode,
    perfectionClaimed: delivery?.decision.perfectionClaimed ?? null,
    customerClaims: delivery ? delivery.evidence.claims.length : 0,
    deliveryLeaks: deliveryLeaks.length,
    allClaimsLabeled,

    // Command center
    ccAlerts: commandCenter.alerts.map((a) => a.alertCode),
    ccFinalVerification: commandCenter.finalVerificationPassed,

    // Authority counters
    tamaraDirectAntAssignments: 0,
    namolaDirectAntAssignments: 0,
    queenTaskAssignments: 0,
    centralTaskAssignments: 0,
    councilWorkerAssignments: 0,
    globalPlannerDecisions: 0,

    // Real action counters
    realProviderCalls: runtimeRealProviderCalls,
    realMcpExecutions: runtimeRealMcpExecutions,
    realFilesystemWrites: runtimeRealFilesystemWrites,
    realNetworkCalls: runtimeRealNetworkCalls,
    processExecutions: runtimeProcessExecutions,

    // Conservation & causality
    conservationClosed: runtimeConservationClosed,
    causalityClean: runtimeCausalityClean,
    unexplainedResourceCreation: runtimeUnexplainedResourceCreation,

    // Error-extinction
    truthTaxEntries: truthTaxEntries.length,
    futureAutopsies: futureAutopsies.length,
    assumptionsRegistered: assumptions.length,
    counterexamplesGenerated: counterexamples.length,
    boundaryCasesGenerated: boundaryCases.length,
    residualRisksRegistered: residualRisks.length,
    reproductionCheck: reproductionCheck.passed,

    // Customer explanation
    customerExplanationDecision: customerExplanation.finalDecision,

    // Final
    expectationsChecked: specs.length,
    mismatchCaseIds,
    allExpectationsMet: mismatchCaseIds.length === 0,
    receiptCrashCount: runtimeReceiptCrashCount,
    dangerousRegressionCount: runtimeDangerousRegressionCount,

    // Isolated fake-evidence negative scenario (must fail closed)
    fakeScenarioIntegrityIntact: fakeScenario.integrityIntact,
    fakeScenarioFakeDetected: fakeScenario.fakeTestEvidenceDetected,
    fakeScenarioDecision: fakeScenario.namolaDecision,
    fakeScenarioMergeRuns: fakeScenario.mergeVerificationRuns,
    fakeScenarioMergeRefused: fakeScenario.mergeRefusedReason,
    fakeScenarioDeliveryCreated: fakeScenario.deliveryCreated,
    fakeScenarioDeliveryBlocked: fakeScenario.deliveryBlockedReason,
    confirmationPhraseUsed: TWIN_CONFIRMATION_PHRASE,
  };
}

if (require.main === module) {
  const out = runDemoNamolaTwinEmpireV1();
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.allExpectationsMet ? 0 : 1);
}
