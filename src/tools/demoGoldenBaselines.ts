/**
 * demoGoldenBaselines: one explicit semantic baseline per demo (AH2 Step 5).
 *
 * Every value below was calibrated against the demos' actual digests and
 * asserts behavior the demo genuinely proves. Deliberately NOT asserted
 * (unstable or forbidden classes): project file/folder counts and byte
 * sizes (the repo grows), wall-clock-jittered pheromone strengths and
 * strength buckets, summed event-tick totals, text lengths, and anything
 * id-, path-, or timestamp-shaped (the digest already drops those).
 *
 * Changing a baseline is a reviewed act: only when behavior is
 * intentionally changed, safe, and justified — never to make a red golden
 * green (see docs/golden-output-model.md).
 */

import type { DemoGoldenExpectation } from "./demoGolden";

export const DEMO_GOLDEN_BASELINES: Record<string, DemoGoldenExpectation> = {
  demoMission: {
    demoName: "demoMission",
    // INTENTIONAL BASELINE CHANGE (Pre-Capability Closure, Part 1): the
    // AntQueen fold-in routes this legacy demo through the canonical
    // engine, so the mission now runs the full decomposition/scheduling
    // spine. usedDecompositionEngine flipped from forbidden to required,
    // and the planner-only roster proves the fold visibly: tasks whose
    // roles have no ant are blocked/skipped rather than silently assigned.
    requiredFlags: ["usedDecompositionEngine"],
    requiredStatuses: ["approved", "completed", "blocked", "HumanIntentPheromone", "TrailPheromone", "NeedHelpPheromone"],
    minimumStableCounts: { strength: 3 },
  },

  demoPheromoneFlow: {
    demoName: "demoPheromoneFlow",
    // Decay-to-expiry: only the pre-decay emission (strength 1) survives
    // into the digest; an unexpired remnant would raise the sum.
    requiredStatuses: ["TrailPheromone"],
    exactStableCounts: { strength: 1 },
  },

  demoSensesLoop: {
    demoName: "demoSensesLoop",
    // All eight senses produce typed readings with fixed demo inputs.
    // elapsedSinceMissionStartMs is wall-clock-derived (~5s from the demo's
    // start anchor), so it is banded rather than exact-asserted.
    requiredStatuses: ["vision", "hearing", "smell", "touch", "taste", "memory", "time", "risk"],
    exactStableCounts: { qualityScore: 0.8 },
    minimumStableCounts: { confidence: 5, elapsedSinceMissionStartMs: 4900 },
    maximumStableCounts: { elapsedSinceMissionStartMs: 6000 },
  },

  demoSafetyBlock: {
    demoName: "demoSafetyBlock",
    // FORBIDDEN classification, blocked receipt, blocked-action pheromone,
    // and the decision is not allowed.
    requiredStatuses: ["FORBIDDEN", "blocked", "BlockedActionPheromone"],
    requiredReasonCodes: ["forbidden-indicators"],
    forbiddenFlags: ["allowed"],
  },

  demoInspector: {
    demoName: "demoInspector",
    // Read-only walk completed, protected read refused, folders skipped,
    // scout trace present. File/size counts deliberately unasserted.
    requiredStatuses: ["completed", "refused", "folder", "scout"],
    minimumStableCounts: { totalSkipped: 1 },
  },

  demoMissionPlanning: {
    demoName: "demoMissionPlanning",
    requiredFlags: ["usedDecompositionEngine", "usedSnapshot"],
    requiredStatuses: ["approved", "blocked", "queued", "rejected", "scout", "planner", "builder", "tester", "auditor", "messenger"],
    requiredReasonCodes: ["forbidden-indicators"],
    exactStableCounts: { orderedCount: 6, safetyBlockedCount: 5, dependencyBlockedCount: 1 },
  },

  demoCodeProposal: {
    demoName: "demoCodeProposal",
    requiredFlags: ["created", "enqueued", "refused", "allProposalsUnapplied"],
    forbiddenFlags: ["applied"],
    requiredReasonCodes: ["protected-path", "safety-blocked"],
    exactStableCounts: { pendingCount: 1 },
    expectedInvariantFields: { appliedFalse: true },
  },

  demoReviewLoop: {
    demoName: "demoReviewLoop",
    requiredFlags: ["adequate", "allUnapplied", "refused", "repairCreated"],
    requiredStatuses: ["clean", "defects-found", "major", "refused", "completed"],
    requiredReasonCodes: ["safety-blocked"],
    exactStableCounts: { proposalCount: 3 },
  },

  demoGitProposal: {
    demoName: "demoGitProposal",
    requiredFlags: ["allUnexecuted", "commitCreated", "nothingRun", "refused"],
    forbiddenFlags: ["commitApplied", "commitPushIntent"],
    requiredStatuses: ["clean"],
    requiredReasonCodes: ["push-intent-refused", "disallowed-git-operation"],
    exactStableCounts: { plannedActionCount: 3, bundledFiles: 1, sourceProposalCount: 2 },
  },

  demoColonySimulation: {
    demoName: "demoColonySimulation",
    // Deterministic scheduling is asserted via exact tick/step/task counts
    // (run 1 completes in 12; run 2 halts at 3; 12+3=15 ticks).
    requiredFlags: ["allProposalsUnapplied", "noCommandRun", "noFileWritten", "noPush", "usedSnapshot"],
    requiredStatuses: ["completed", "halted-budget", "step-budget-reached", "task-processed", "proposal-created", "proposal-reviewed", "approved", "HumanIntentPheromone", "SuccessPheromone", "TrailPheromone"],
    exactStableCounts: { tasksProcessed: 12, ticksUsed: 15, proposalsCreated: 2, schedulerStepsUsed: 12, totalActive: 14 },
  },

  demoAgentAdapters: {
    demoName: "demoAgentAdapters",
    requiredFlags: ["allSimulated", "allProposalsUnapplied", "noNetworkCall", "noProcessCall", "noRealAgentCall", "ok", "refused"],
    requiredStatuses: ["agent-exchange", "claude-code", "codex", "kimi", "local-script", "propose-build", "analyze", "summarize", "refused"],
    requiredReasonCodes: ["safety-blocked"],
    exactStableCounts: { proposalsCreated: 1 },
  },

  demoBotDesktopPlan: {
    demoName: "demoBotDesktopPlan",
    requiredFlags: ["created", "planFlagsOk", "narrationFlagsOk", "noRealAutomation", "noNetworkOrProcess", "refused"],
    requiredStatuses: ["click", "type-text", "open-app", "focus-window", "read-screen-region", "completed", "refused"],
    requiredReasonCodes: ["protected-surface"],
    exactStableCounts: { narratedSteps: 5 },
  },

  demoEndToEnd: {
    demoName: "demoEndToEnd",
    // The canonical public runtime: both runs complete, receipts exist,
    // pheromone attention exists, proposals stay unapplied, and the
    // guarantees block holds (no git/desktop/command/network/write).
    requiredFlags: ["accepted", "allProposalsUnapplied", "noCommandRun", "noGitRun", "noDesktopAction", "noFileWritten", "noNetwork", "usedSnapshot"],
    requiredStatuses: ["approved", "completed", "claude-code", "clean", "HumanIntentPheromone", "SuccessPheromone", "TrailPheromone"],
    exactStableCounts: { tasksProcessed: 13, receiptCount: 22, totalActive: 8, proposalsCreated: 1, agentExchanges: 1, reviewEvents: 1 },
  },

  demoAntRoleRegistry: {
    demoName: "demoAntRoleRegistry",
    requiredFlags: ["builderIsEngineActive", "guardOwnerIsSafetyGuard", "unknownRoleRejected", "pureDataOnly", "noBehaviorExecuted"],
    requiredStatuses: ["queen", "commander", "guard", "memory", "repair", "archivist"],
    exactStableCounts: { totalRoleCount: 20, "wrapper-only": 12, "wired-facade": 7, "duplicate-of-core": 1 },
  },

  demoSafetyMatcher: {
    demoName: "demoSafetyMatcher",
    requiredFlags: ["allExpectationsMet"],
    exactStableCounts: {
      dangerousRegressionCount: 0,
      receiptCrashCount: 0,
      totalCases: 48,
      actualRefused: 31,
      actualAllowed: 17,
    },
  },

  demoReceiptIsolation: {
    demoName: "demoReceiptIsolation",
    requiredFlags: [
      "aStartsDeterministically",
      "bStartsDeterministically",
      "aDoesNotAdvanceB",
      "aOrderPreserved",
      "bOrderPreserved",
      "secondIdsDistinctWithinLogs",
      "traceIsNotAReceipt",
      "noCrash",
      "allExpectationsMet",
    ],
    exactStableCounts: { crashCount: 0, logACount: 3, logBCount: 3 },
  },

  demoCreateApprovalContracts: {
    demoName: "demoCreateApprovalContracts",
    // Capability C0 (data-only): every refusal category represented, zero
    // writes, zero crashes, simulated:true / executed:false as literals.
    requiredFlags: ["allExpectationsMet", "simulated"],
    forbiddenFlags: ["executed"],
    requiredStatuses: [
      "approval-valid",
      "grant-already-consumed",
      "grant-proposal-mismatch",
      "grant-scope-mismatch",
      "integrity-mismatch",
      "proposal-invariant-failed",
      "wrong-change-kind",
      "missing-create-content",
      "review-not-approved",
      "approval-declaration-invalid",
      "descriptor-path-mismatch",
      "descriptor-length-mismatch",
      "absolute-path",
      "path-traversal",
      "protected-name-segment",
      "content-too-large",
      "not-single-operation",
      "structural-policy-passed",
    ],
    exactStableCounts: {
      totalCases: 18,
      passedCases: 1,
      refusedCases: 17,
      writeApiCount: 0,
      filesCreatedByCapability: 0,
      receiptCrashCount: 0,
    },
  },

  demoCreateDryRun: {
    demoName: "demoCreateDryRun",
    // Capability C1 (read-only dry run): a real filesystem metadata
    // inspection with zero mutation, zero files created, no write authority,
    // and no grant consumption. One safe absent target is ready-for-future-
    // review; every real boundary (existing target, case-insensitive
    // collision, missing parent, parent-chain link) blocks; integrity
    // tampering refuses at the C0 gate before inspection.
    requiredFlags: ["allExpectationsMet", "simulated", "requiresFreshC2Revalidation"],
    forbiddenFlags: ["executed", "grantConsumedByDryRun"],
    requiredStatuses: [
      "dry-run-clean",
      "boundary-target-exists",
      "boundary-case-insensitive-collision",
      "boundary-parent-missing",
      "boundary-parent-chain-link",
      "c0-approval-refused",
    ],
    expectedInvariantFields: { simulatedTrue: true, executedFalse: true },
    exactStableCounts: {
      totalCases: 6,
      passedCases: 1,
      blockedCases: 4,
      refusedCases: 1,
      failedCases: 0,
      authoritativeWriteDecisions: 0,
      writeAuthorizedCount: 0,
      writePerformedCount: 0,
      filesCreatedByCapability: 0,
      mutationApiCount: 0,
      receiptCrashCount: 0,
    },
    minimumStableCounts: { readyCandidateCount: 1 },
  },

  demoC2AuthorityContracts: {
    demoName: "demoC2AuthorityContracts",
    // Capability C2-A (contracts only): trusted permit accepted, forged
    // permit refused, strict C2 policy + exact-byte + C0 approval + injected
    // C1 boundary refusals/blocks all represented, and the non-mutating
    // creator never reports a write. Zero writes, zero mutation APIs, one fs
    // importer, no grant consumption, process-local (non-durable) replay.
    requiredFlags: ["allExpectationsMet", "simulated", "processLocalReplayOnly"],
    forbiddenFlags: ["executed", "grantConsumedByC2A", "durableReplayProtection"],
    requiredStatuses: [
      "candidate-ready-for-c2b-review",
      "write-authority-permit-invalid",
      "c2-policy-refused",
      "c0-approval-refused",
      "not-in-generated-dir",
      "nested-path",
      "disallowed-extension",
      "filename-not-allowed",
      "windows-reserved-name",
      "absolute-path",
      "path-traversal",
      "protected-name-segment",
      "content-too-large",
      "bom-not-allowed",
      "nul-not-allowed",
      "carriage-return-not-allowed",
      "control-char-not-allowed",
      "unpaired-high-surrogate",
      "unpaired-low-surrogate",
      "grant-proposal-mismatch",
      "descriptor-path-mismatch",
      "descriptor-length-mismatch",
      "integrity-mismatch",
      "wrong-change-kind",
      "applied-not-false",
      "requires-human-approval-false",
      "grant-already-consumed",
      "not-single-operation",
      "inspection-incomplete",
      "boundary-target-exists",
      "boundary-parent-chain-link",
    ],
    expectedInvariantFields: { simulatedTrue: true, executedFalse: true },
    exactStableCounts: {
      totalCases: 32,
      passedCases: 32,
      refusedCases: 27,
      blockedCases: 3,
      candidateReadyCases: 2,
      forgedPermitAcceptedCount: 0,
      runtimePermitMintCount: 0,
      writeAttemptCount: 0,
      writePerformedCount: 0,
      filesCreatedByCapability: 0,
      filesystemMutationApiCount: 0,
      fsImporterCount: 1,
      exactByteFingerprintLength: 64,
      receiptCrashCount: 0,
    },
    minimumStableCounts: { trustedPermitAcceptedCount: 1 },
  },

  demoC2ExclusiveCreateSimulation: {
    demoName: "demoC2ExclusiveCreateSimulation",
    // Capability C2-B (real primitive installed, inactive): full create
    // lifecycle driven by an injected fake driver. Only admitted attempts
    // consume grants (and consume even on failure); pre-admission and final-
    // inspection failures never consume; replay is refused in-process;
    // residual-artifact and receipt-failure truths are represented; the real
    // Node driver is never invoked and no real write executes.
    requiredFlags: ["allExpectationsMet", "exactBytesPreserved", "processLocalReplayOnly"],
    forbiddenFlags: ["durableReplayProtection", "c2cStarted"],
    requiredStatuses: [
      "created",
      "open-target-exists",
      "open-failed",
      "write-failed",
      "zero-progress-write",
      "invalid-write-count",
      "sync-failed",
      "close-failed",
      "inspection-incomplete",
      "boundary-target-exists",
      "boundary-case-insensitive-collision",
      "boundary-parent-missing",
      "boundary-parent-chain-link",
      "boundary-real-parent-escapes-root",
      "write-authority-permit-invalid",
      "grant-proposal-mismatch",
      "descriptor-length-mismatch",
      "not-in-generated-dir",
      "grant-already-consumed",
    ],
    exactStableCounts: {
      totalCases: 25,
      passedCases: 25,
      refusedCases: 8,
      blockedCases: 7,
      failedCases: 8,
      completedCases: 2,
      admittedAttemptCount: 11,
      grantsConsumedCount: 11,
      preAdmissionConsumptionCount: 0,
      finalInspectionConsumptionCount: 0,
      residualArtifactCases: 7,
      receiptFailureCases: 1,
      successfulLifecycleCases: 1,
      realNodeDriverInvocationCount: 0,
      realFilesystemWriteExecutionCount: 0,
      filesCreatedByCapability: 0,
      fsImporterCount: 2,
      unauthorizedFsImporterCount: 0,
      unauthorizedMutationApiCount: 0,
      receiptCrashCount: 0,
    },
    minimumStableCounts: { replayRefusalCount: 1 },
  },

  demoRealAcademyPilotV2: {
    demoName: "demoRealAcademyPilotV2",
    // Tamara–Namla Real Academy Pilot V2 (Build Law §21). A 5-ant voluntary
    // cohort trains through the FAKE provider driver: mixed Claude/Codex, one
    // quota failure, one malformed result, three evaluated (one fails), with
    // bounded evidence updates and ZERO certifications from one pilot. Real
    // provider/network/fs/process counters are exactly zero. (The accepted
    // cohort of exactly 5 is proven inside `allExpectationsMet`; the digest
    // doubles keys shared with the command-center, so behavioral counts use
    // minimums, not exacts.)
    requiredFlags: ["allExpectationsMet", "pilotCompleted", "simulated", "withinByteBudget"],
    forbiddenFlags: ["executed"],
    exactStableCounts: {
      totalPersistentAnts: 300,
      nonVolunteerAssignments: 0,
      tamaraDirectAntAssignments: 0,
      centralTaskAssignments: 0,
      queenTaskAssignments: 0,
      globalPlannerDecisions: 0,
      realClaudeCalls: 0,
      realCodexCalls: 0,
      quotaFailures: 1,
      malformedResults: 1,
      certificationsGranted: 0,
      realFilesystemWrites: 0,
      realNetworkCalls: 0,
      realProviderProcessExecutions: 0,
      workspaceBoundaryViolations: 0,
      dangerousRegressionCount: 0,
      receiptCrashCount: 0,
      mismatchCount: 0,
    },
    minimumStableCounts: {
      voluntaryTrainingClaims: 8,
      providerCallsCompleted: 1,
      providerCallsFailed: 1,
      evaluationsCompleted: 1,
      evaluationsPassed: 1,
      evaluationsFailed: 1,
      remediationRequests: 1,
      passportEvidenceUpdates: 1,
      simulatedClaudeCalls: 1,
      simulatedCodexCalls: 1,
    },
    expectedInvariantFields: { simulatedTrue: true, executedFalse: true },
  },

  demoAntAcademyV1: {
    demoName: "demoAntAcademyV1",
    // Tamara–Namla Federation V1 + Ant Academy V1 (Build Law §20). A 300-ant
    // colony trains across 18 domains with independent evaluators, mentors,
    // builds a multi-domain project, promotes on evidence (never self-certifies),
    // certifies some ants, and Tamara publishes one objective the colony
    // self-organizes. Real provider/network/fs/process counters are exactly zero.
    requiredFlags: [
      "allExpectationsMet",
      "allPassportsWithinBounds",
      "deterministicRerunMatches",
      "diversityPreserved",
      "scaleBounded",
      "scaleDeterministic",
      "scaleDiversity",
      "simulated",
      "specializationDiversityMaintained",
    ],
    forbiddenFlags: ["executed"],
    exactStableCounts: {
      totalPersistentAnts: 300,
      queenIdentities: 1,
      workerIdentities: 299,
      academyDomains: 18,
      nonVolunteerAssignments: 0,
      selfCertifications: 0,
      unsupportedPromotions: 0,
      centralTaskAssignments: 0,
      queenTaskAssignments: 0,
      tamaraDirectAntAssignments: 0,
      globalPlannerDecisions: 0,
      realClaudeCalls: 0,
      realCodexCalls: 0,
      realNetworkCalls: 0,
      realFilesystemWrites: 0,
      processExecutions: 0,
      dangerousRegressionCount: 0,
      receiptCrashCount: 0,
      mismatchCount: 0,
      tamaraObjectivesReceived: 1,
      colonyMissionsCreated: 1,
    },
    minimumStableCounts: {
      trainingMissions: 1,
      examinationMissions: 1,
      projectMissions: 1,
      voluntaryClaims: 1,
      acceptedClaims: 1,
      mentorsActivated: 1,
      mentorshipEvents: 1,
      examinationPasses: 1,
      examinationFailures: 1,
      remediations: 1,
      promotions: 1,
      rejectedPromotions: 1,
      certifications: 1,
      skillPassportUpdates: 1,
      temporaryTeamsFormed: 1,
      teamsDissolved: 1,
      reviewsCompleted: 1,
      verificationRuns: 1,
      repairRounds: 1,
    },
    maximumStableCounts: { peakCognitivelyActiveAnts: 30 },
    expectedInvariantFields: { simulatedTrue: true, executedFalse: true },
  },

  demoRealProviderActivationR2: {
    demoName: "demoRealProviderActivationR2",
    // Real Cognitive Ants R2 (Build Law §19): the human-only provider execution
    // boundary, exercised with the FAKE process driver across 22 cases (permit
    // forgery/scope/consume/replay refusals, every process failure path, and
    // fake Claude+Codex success lifecycles). Every real-execution counter is
    // asserted exactly zero; the permit-safety counters (forged accepted,
    // pre-admission consumption) are exactly zero; simulated calls are positive.
    requiredFlags: ["allExpectationsMet", "simulated"],
    forbiddenFlags: ["executed"],
    exactStableCounts: {
      totalCases: 22,
      passedCases: 22,
      mismatchCount: 0,
      forgedPermitsAccepted: 0,
      preAdmissionPermitConsumption: 0,
      replayRefusals: 2,
      realClaudeCalls: 0,
      realCodexCalls: 0,
      realProviderProcessExecutions: 0,
      shellTrueCount: 0,
      arbitraryExecutableCount: 0,
      arbitraryArgumentCount: 0,
      sourceTreeWrites: 0,
      workspaceBoundaryViolations: 0,
      centralTaskAssignments: 0,
      queenTaskAssignments: 0,
      globalPlannerDecisions: 0,
      receiptCrashCount: 0,
      dangerousRegressionCount: 0,
    },
    minimumStableCounts: {
      refusedCases: 1,
      failedCases: 1,
      completedCases: 1,
      admittedInvocations: 1,
      consumedPermits: 1,
      simulatedClaudeCalls: 1,
      simulatedCodexCalls: 1,
    },
    expectedInvariantFields: { simulatedTrue: true, executedFalse: true },
  },

  demoRealCognitiveAntsR1: {
    demoName: "demoRealCognitiveAntsR1",
    // Real Cognitive Ants R1 (Build Law §18): the deterministic end-to-end
    // mission demo over the provider-neutral bounded cognitive runtime
    // (src/colonyMission/, §16). Every count is produced by a real run through
    // proposal competition + quorum, the voluntary work market, bounded
    // cognitive admission, artifact review, verification, defect injection, and
    // bounded repair. No real provider, process, network, or filesystem write.
    requiredFlags: ["allExpectationsMet", "finalVerificationPassed", "quorumReached", "simulated"],
    forbiddenFlags: ["executed"],
    exactStableCounts: {
      totalPersistentAnts: 300,
      queenIdentities: 1,
      workerIdentities: 299,
      scoutProposalCount: 3,
      nonVolunteerAssignments: 0,
      centralTaskAssignments: 0,
      queenTaskAssignments: 0,
      globalPlannerDecisions: 0,
      injectedDefects: 1,
      workspaceBoundaryViolations: 0,
      realClaudeCalls: 0,
      realCodexCalls: 0,
      realProviderProcessExecutions: 0,
      realNetworkCalls: 0,
      realFilesystemWrites: 0,
      dangerousRegressionCount: 0,
      receiptCrashCount: 0,
      mismatchCount: 0,
    },
    minimumStableCounts: {
      rejectedProposalCount: 2,
      voluntaryTaskClaims: 1,
      acceptedTaskClaims: 1,
      cognitiveClaims: 1,
      cognitionClaimsAccepted: 1,
      artifactProposals: 1,
      artifactsReviewed: 1,
      verificationRuns: 1,
      verificationFailures: 1,
      repairRounds: 1,
      deterministicProviderCalls: 1,
    },
    maximumStableCounts: { peakCognitiveAnts: 5 },
    expectedInvariantFields: { simulatedTrue: true, executedFalse: true },
  },

  demoAntIntelligenceDeepening: {
    demoName: "demoAntIntelligenceDeepening",
    // Ant Intelligence Deepening V1 (Build Law §17): a second deterministic
    // layer over the committed G1-G7 colony. Every count below is produced by
    // real exercised behavior over an evolved 300-identity population plus a
    // 300/1,000/10,000 scale validation. Flags AND-combine across the tree
    // (including the three scale sub-results), so a single false anywhere
    // fails the golden. Behavioral counters use minimums (they are seeded but
    // not worth pinning exactly); the safety/decentralization counters are
    // asserted exactly zero, and the cognitive budget at most 30.
    requiredFlags: [
      "allExpectationsMet",
      "allMindsWithinBounds",
      "calibrationImproved",
      "deterministicRerunMatches",
      "diversityPreserved",
      "intelligenceVocabularySafe",
      "plansWithinBounds",
      "scaleBounded",
      "scaleDeterministic",
      "scaleDiversityPreserved",
      "simulated",
      "specializationDiversityMaintained",
    ],
    forbiddenFlags: ["executed"],
    exactStableCounts: {
      queenIdentities: 1,
      totalPersistentAnts: 300,
      individualCognitiveProfiles: 299,
      centralTaskAssignments: 0,
      queenTaskAssignments: 0,
      globalPlannerDecisions: 0,
      externalLlmCalls: 0,
      realNetworkCalls: 0,
      realFilesystemWrites: 0,
      processExecutions: 0,
      dangerousRegressionCount: 0,
      receiptCrashCount: 0,
      crisisScenariosRun: 10,
      mismatchCount: 0,
    },
    minimumStableCounts: {
      localPlansCreated: 1,
      localPlansRevised: 1,
      selfEvaluations: 1,
      confidenceAdjustments: 1,
      peerReviewsCompleted: 1,
      disagreementsRecorded: 1,
      assumptionsChallenged: 1,
      temporaryTeamsFormed: 1,
      teamsDissolved: 1,
      knowledgeProposals: 1,
      acceptedKnowledge: 1,
      rejectedKnowledge: 1,
      contradictionsDetected: 1,
      knowledgeReused: 1,
      mentorshipEvents: 1,
      youngWorkersImproved: 1,
      crisesRecovered: 1,
      unreliableClaimsContained: 1,
    },
    maximumStableCounts: { peakCognitivelyActiveAnts: 30 },
    expectedInvariantFields: { simulatedTrue: true, executedFalse: true },
  },

  demoEngineMissionRefusal: {
    demoName: "demoEngineMissionRefusal",
    // The canonical refused-mission path: SafetyGuard refuses before
    // admission, nothing is processed or proposed, the refusal is
    // receipted with its reason code, and the report says accepted: false.
    forbiddenFlags: ["missionAccepted"],
    requiredFlags: [
      "refusalReceipted",
      "nothingProcessed",
      "nothingProposed",
      "allProposalsUnapplied",
      "noGitAction",
      "noAdapterOrDesktopAction",
    ],
    requiredStatuses: ["refused"],
    requiredReasonCodes: ["forbidden-indicators"],
    exactStableCounts: { tasksProcessed: 0, proposalsCreated: 0, activePheromones: 0, receiptCount: 2 },
  },

  demoReceiptStatusSemantics: {
    demoName: "demoReceiptStatusSemantics",
    requiredFlags: ["allExpectationsMet"],
    // flags.terminal is the AND across the status table; approved being
    // non-terminal keeps it false — approved provably differs from
    // completed at digest level. refused vs blocked distinctness is inside
    // allExpectationsMet (case t04) plus both statuses being present.
    forbiddenFlags: ["terminal"],
    requiredStatuses: ["approved", "completed", "refused", "blocked", "failed"],
    exactStableCounts: { receiptCrashCount: 0, totalCases: 12 },
  },

  demoColonyGenesisG0: {
    demoName: "demoColonyGenesisG0",
    // Colony Genesis G0: identity and topology only. Every count below is
    // fully deterministic — a colony contains no timestamp, no wall-clock
    // value, and no unseeded randomness, so nothing here needs banding
    // except the genome-driven reserve split (see minimum/maximum below).
    requiredFlags: [
      "allExpectationsMet",
      "nestConnected",
      "deterministicRerunMatches",
      "colonyVocabularySafe",
      "simulated",
    ],
    // The four queen-authority flags are literal `false` in the type; listing
    // them as forbidden means a cast that flips one fails the golden too.
    forbiddenFlags: [
      "executed",
      "queenTaskAssignmentAuthority",
      "queenRoutingAuthority",
      "queenQuorumSelectionAuthority",
      "queenPopulationMemoryAccess",
    ],
    requiredStatuses: [
      "total-persistent-identities-300",
      "queen-identities-1",
      "worker-identities-299",
      "unique-ant-ids-300",
      "every-worker-valid-chamber",
      "every-worker-genome-profile",
      "every-worker-thresholds",
      "every-worker-local-state",
      "nest-graph-connected",
      "nest-edges-reference-existing-chambers",
      "queen-holds-no-task-authority",
      "central-task-assignments-zero",
      "queen-task-assignments-zero",
      "no-worker-holds-population-reference",
      "no-external-calls",
      "no-cognitively-active-ants-at-genesis",
    ],
    exactStableCounts: {
      // Population: 300 = 1 queen-system + 299 worker-capable, all unique.
      // `uniqueAntIdCount` is the digest-visible twin of `uniqueAntIds`,
      // which the digest strips as an id-shaped key.
      totalPersistentAnts: 300,
      queenIdentities: 1,
      workerIdentities: 299,
      uniqueAntIdCount: 300,
      // Nest: 13 chambers, 16 undirected edges, symmetric adjacency, and all
      // 13 reachable from the first chamber. 12 are occupied — the queen
      // chamber holds the queen and G0 places no worker in it.
      nestChambers: 13,
      nestEdges: 16,
      nestAdjacencyEntries: 32,
      reachableChambers: 13,
      chambersOccupied: 12,
      // Every worker is complete: placed, genomed, thresholded, local-stated.
      workersWithValidChamber: 299,
      workersWithGenomeProfile: 299,
      workersWithThresholds: 299,
      workersWithLocalState: 299,
      // Decentralization: nobody assigned anything to anybody.
      centralTaskAssignments: 0,
      queenTaskAssignments: 0,
      antSchedulerImportsUsed: 0,
      decompositionEngineImportsUsed: 0,
      taskRouterImportsUsed: 0,
      colonySimulationImportsUsed: 0,
      // Capability absence, and nobody is thinking expensively at tick 0.
      externalLlmCalls: 0,
      realFilesystemWrites: 0,
      networkCalls: 0,
      processExecutions: 0,
      cognitivelyActiveAtGenesis: 0,
      // Invariants, safety, receipts.
      invariantChecksRun: 16,
      invariantChecksPassed: 16,
      dangerousRegressionCount: 0,
      receiptCount: 4,
      receiptCrashCount: 0,
      mismatchCount: 0,
    },
    // Reserve size is a genome consequence (reserveFraction 0.45 sampled per
    // ant), not a fixed constant. The claim G0 actually makes is "a
    // substantial part of the population starts in reserve", so this is a
    // band — tightening it to an exact count would make a future genome
    // tuning look like a safety regression.
    minimumStableCounts: { reserveWorkers: 100 },
    maximumStableCounts: { reserveWorkers: 200 },
    expectedInvariantFields: { simulatedTrue: true, executedFalse: true },
  },

  demoColonyGenesis: {
    demoName: "demoColonyGenesis",
    // Colony Genesis G1-G7: the full decentralized behavior core over a
    // deterministic 400-tick run. Structural/law-guaranteed facts are
    // pinned exact; simulation-derived activity sums are banded generously
    // (AH2 Step 5 convention: summed event-tick totals are not exact-pinned,
    // so legitimate future constant tuning does not read as a regression).
    requiredFlags: [
      "allExpectationsMet",
      "allPheromoneTypesHaveDecisionSite",
      "colonyVocabularySafe",
      "genesisInvariantsPassed",
      "peakCognitiveEligibilityAtMost30",
      "populationIdentityPreserved",
      "simulated",
    ],
    forbiddenFlags: ["executed"],
    expectedInvariantFields: { simulatedTrue: true, executedFalse: true },
    exactStableCounts: {
      totalPersistentAnts: 300,
      queenIdentities: 1,
      workerIdentities: 299,
      ticksExecuted: 400,
      centralTaskAssignments: 0,
      queenTaskAssignments: 0,
      externalLlmCalls: 0,
      networkCalls: 0,
      realFilesystemWrites: 0,
      processExecutions: 0,
      queenDirectNursingAssignments: 0,
      cognitiveBudgetViolations: 0,
      // Never fires in this fixed-300 run — the population cap is already
      // saturated at genesis (NAMLA_BUILD_LAW.md Section 15's bounded
      // population policy). demoColonyScale's renewalProof exercises the
      // same mechanism with cap headroom instead.
      populationRenewals: 0,
      generationTransitions: 0,
      maximumCognitiveBudget: 30,
      pheromoneTypesWithDecisionSite: 10,
      genesisInvariantChecksRun: 16,
      genesisInvariantChecksPassed: 16,
      dangerousRegressionCount: 0,
      receiptCrashCount: 0,
      mismatchCount: 0,
      receiptCount: 3,
    },
    minimumStableCounts: {
      localTaskDecisions: 20000,
      encounters: 50000,
      movementCount: 3000,
      pheromonesDeposited: 50000,
      pheromonesRead: 20000,
      pheromonesReinforced: 50000,
      pheromonesDecayed: 10000,
      taskSwitchCount: 1000,
      specializationChanges: 10000,
      reserveActivationCount: 20,
      recruitmentEvents: 20,
      quorumLocalCommitments: 1,
      broodRecordsCreated: 3,
      broodLifecycleTransitions: 5,
      nursingStimulusEvents: 100,
      nursingLocalResponses: 200,
      cognitionClaims: 20000,
      cognitionClaimsAccepted: 1000,
      cognitionClaimsRejected: 10000,
      deterministicFallbackActions: 10000,
      observedPeakCognitivelyActiveAnts: 20,
      workerSenescenceEntries: 50,
      workerRecoveryEntries: 100,
    },
    maximumStableCounts: {
      // Independently bounded by construction, not just observed:
      // MAX_LIVE_BROOD caps live brood at 10 (broodLifecycleSystem.ts);
      // resolveCognitionClaims caps admission at MAX_COGNITIVE_BUDGET.
      broodRecordsCreated: 10,
      observedPeakCognitivelyActiveAnts: 30,
      peakCognitiveEligibility: 30,
      peakCognitionClaims: 299,
      workerRetirements: 100,
    },
  },

  demoColonyScale: {
    demoName: "demoColonyScale",
    // Bounded, deterministic behavior at 300/1,000/10,000 identities plus a
    // dedicated small-colony proof that population renewal genuinely admits
    // a new persistent identity when the cap is not already saturated.
    // Counts below are summed across the three scale reports (the digest
    // sums same-named numeric leaves across the whole result tree) plus the
    // renewal proof's own fields.
    requiredFlags: [
      "allExpectationsMet",
      "boundedMemoryConfirmed",
      "noAllToAllInteraction",
      "deterministicRerunMatches",
      "renewalMechanismProven",
    ],
    exactStableCounts: {
      centralTaskAssignments: 0,
      queenTaskAssignments: 0,
      externalLlmCalls: 0,
      realNetworkCalls: 0,
      realFilesystemWrites: 0,
      processExecutions: 0,
      queenIdentityCount: 3,
      persistentIdentityCount: 11300,
      uniqueIdentityCount: 11300,
      workerIdentityCount: 11297,
      workerCount: 11297,
      pheromoneCellCount: 390,
      maximumCognitiveBudget: 90,
      maximumEncounterWindow: 60,
      ticksExecuted: 520,
      startingWorkerCount: 20,
      populationCap: 40,
    },
    minimumStableCounts: {
      localTaskDecisions: 100000,
      encounterCount: 200000,
      pheromoneReadCount: 100000,
      peakCognitiveClaims: 1000,
      peakCognitivelyActive: 60,
      finalWorkerCount: 21,
      populationRenewalsObserved: 1,
    },
  },

  demoRealCognitiveColony: {
    demoName: "demoRealCognitiveColony",
    // Real Cognitive Ants V1: the full mission pipeline (scout quorum,
    // voluntary claims, bounded cognitive budget, artifact review, defect
    // injection/detection/repair) using ONLY DeterministicCognitiveWorker.
    // Structural/law-guaranteed facts are pinned exact; simulation-derived
    // activity sums are banded (same AH2 Step 5 convention as the colony
    // baselines above).
    requiredFlags: ["allExpectationsMet", "quorumReached", "finalVerificationPassed", "simulated"],
    forbiddenFlags: ["executed"],
    expectedInvariantFields: { simulatedTrue: true, executedFalse: true },
    exactStableCounts: {
      totalPersistentAnts: 300,
      queenIdentities: 1,
      workerIdentities: 299,
      centralTaskAssignments: 0,
      queenTaskAssignments: 0,
      realClaudeCalls: 0,
      realCodexCalls: 0,
      realNetworkCalls: 0,
      injectedDefects: 1,
      verificationFailures: 1,
      repairRounds: 1,
      workspaceBoundaryViolations: 0,
      activeCognitiveAnts: 0,
      dangerousRegressionCount: 0,
      receiptCrashCount: 0,
      mismatchCount: 0,
    },
    minimumStableCounts: {
      scoutProposalCount: 3,
      rejectedProposalCount: 2,
      voluntaryTaskClaims: 100,
      acceptedTaskClaims: 3,
      cognitiveClaims: 5,
      cognitiveClaimsAccepted: 5,
      artifactProposals: 4,
      artifactsReviewed: 3,
      filesApplied: 4,
      verificationRuns: 2,
      fakeProviderCalls: 5,
      receiptCount: 8,
    },
    maximumStableCounts: {
      // Independently bounded by construction, not just observed:
      // CognitiveExecutionBudget caps concurrent admission at
      // MAX_CONCURRENT_COGNITIVE_ANTS (5 in this demo).
      peakCognitiveAnts: 5,
      cognitiveClaimsRejected: 0,
    },
  },

  demoDigitalSuperorganismV1: {
    demoName: "demoDigitalSuperorganismV1",
    // Digital Superorganism Metabolism V1 (Build Law §23). The digital economy
    // is a conserving event-sourced ledger, so every flag below is a real
    // invariant: `conserved`/`closed` (resource ledgers reconstruct), `passed`
    // (all causal checks pass), `toolAccessClosed` (permit capacity closes),
    // `boundedCognitive`/`objectivePassed` (scale re-checks), and the demo's own
    // `allExpectationsMet`. Volume metrics are asserted as minimums (they derive
    // from simulation events, never hard-coded totals); the safety-critical
    // decentralization + conservation numbers are asserted exactly at 0.
    requiredFlags: ["allExpectationsMet", "boundedCognitive", "causalityClean", "closed", "conserved", "finalObjectivePassed", "objectivePassed", "passed", "quorumReached", "toolAccessClosed"],
    exactStableCounts: {
      providerCalls: 0,
      centralTaskAssignments: 0,
      queenTaskAssignments: 0,
      tamaraDirectAntAssignments: 0,
      globalPlannerDecisions: 0,
      unexplainedResourceCreation: 0,
      causalityViolations: 0,
      toolAccessHeldAtEnd: 0,
      monetaryBudgetConsumed: 0,
      expectationsChecked: 36,
      persistentIdentities: 300,
    },
    minimumStableCounts: {
      rawInformationCollected: 1,
      verifiedKnowledgeCreated: 1,
      workingContextConsumed: 1,
      computeConsumed: 1,
      tokenBudgetConsumed: 1,
      toolAccessGrants: 1,
      voluntaryTaskClaims: 1,
      activeWorkingHands: 1,
      artifactsCreated: 1,
      reviewsCompleted: 1,
      testsExecuted: 1,
      failuresGenerated: 1,
      errorWasteCreated: 1,
      wasteRecycled: 1,
      technicalDebtTracked: 1,
      knowledgeReused: 1,
      digitalTrophallaxisEvents: 1,
      bandwidthConsumed: 1,
      securityThreatsDetected: 1,
      quarantinedArtifacts: 1,
      remediationActions: 1,
      broodTrained: 1,
      promotions: 1,
      reserveActivations: 1,
      retirements: 1,
      transmissionEdges: 1,
    },
    maximumStableCounts: {
      // Global cognitive cap (30) enforced by construction in the runner.
      peakCognitiveWorkers: 30,
    },
  },

  demoDigitalSuperorganismOperationsV2: {
    demoName: "demoDigitalSuperorganismOperationsV2",
    // Digital Superorganism Operations V2 (Build Law §24). Tamara's software
    // objective becomes reviewed, tested, repaired software through a conserving
    // decentralized ant economy. Flags are real invariants (conservation,
    // causality, quorum, final acceptance, the demo's own allExpectationsMet).
    // Safety-critical decentralization + no-real-action + boundary numbers are
    // asserted exactly at 0; identity/defect counts exactly; volume as minimums.
    // (verificationRuns/repairRounds/securityQuarantines/wasteRecycled read
    // doubled because the command-center projection re-exposes them under the
    // same key names — the minimums below hold regardless.)
    requiredFlags: ["allExpectationsMet", "boundedCognitive", "causalityClean", "conserved", "finalAcceptance", "finalObjectivePassed", "finalVerificationPassed", "objectivePassed", "quorumReached"],
    exactStableCounts: {
      totalPersistentAnts: 300,
      queenIdentities: 1,
      workerIdentities: 299,
      tamaraObjectivesReceived: 1,
      injectedDefects: 1,
      expectationsChecked: 49,
      nonVolunteerAssignments: 0,
      centralTaskAssignments: 0,
      queenTaskAssignments: 0,
      tamaraDirectAntAssignments: 0,
      globalPlannerDecisions: 0,
      realClaudeCalls: 0,
      realCodexCalls: 0,
      realProviderProcessExecutions: 0,
      realNetworkCalls: 0,
      realFilesystemWrites: 0,
      unexplainedResourceCreation: 0,
      causalityViolations: 0,
      workspaceBoundaryViolations: 0,
      dangerousRegressionCount: 0,
      receiptCrashCount: 0,
    },
    minimumStableCounts: {
      rawInformationCollected: 1,
      verifiedKnowledgeCreated: 1,
      scoutProposalCount: 3,
      rejectedProposalCount: 2,
      voluntaryTaskClaims: 1,
      acceptedTaskClaims: 1,
      activeWorkingHands: 1,
      toolAccessGrants: 1,
      workingContextConsumed: 1,
      computeConsumed: 1,
      tokenBudgetConsumed: 1,
      artifactProposals: 1,
      artifactsReviewed: 1,
      filesApplied: 1,
      verificationRuns: 2,
      verificationFailures: 1,
      repairRounds: 1,
      wasteRecycled: 1,
      knowledgeReused: 1,
      academyEvidenceUpdates: 1,
      securityQuarantines: 1,
      deterministicProviderCalls: 1,
    },
    maximumStableCounts: {
      // V2 operational target for provider-backed cognition is 1-5.
      peakCognitiveWorkers: 5,
    },
  },

  demoDigitalLiveObjectiveV3: {
    demoName: "demoDigitalLiveObjectiveV3",
    // Digital Superorganism Live Objective V3 (Build Law §25). The fake-live
    // three-ant flow: 3 provider calls (1 isolated failure), reviewed artifacts,
    // one detected defect, one approved repair, final verification green — with
    // zero real provider/process/network/filesystem action. Flags carry the
    // demo's self-check + final outcome; the safety-critical counts (cohort size,
    // call counts, repair rounds, all real-action + boundary + budget zeros) are
    // asserted exactly; discovery volume as minimums. 24 guard cases and 33
    // expectations all pass (an empty mismatchCaseIds is required via the flag).
    requiredFlags: ["allExpectationsMet", "finalObjectivePassed", "finalVerificationPassed"],
    exactStableCounts: {
      totalPersistentAnts: 300,
      queenIdentities: 1,
      workerIdentities: 299,
      acceptedLiveCohortSize: 3,
      providerCallsStarted: 3,
      repairCalls: 1,
      repairRounds: 1,
      verificationFailures: 1,
      selfReviewsAccepted: 0,
      nonVolunteerAssignments: 0,
      centralTaskAssignments: 0,
      queenTaskAssignments: 0,
      tamaraDirectAntAssignments: 0,
      globalPlannerDecisions: 0,
      realClaudeCalls: 0,
      realCodexCalls: 0,
      realProviderProcessExecutions: 0,
      realFilesystemWrites: 0,
      realNetworkCalls: 0,
      workspaceBoundaryViolations: 0,
      sourceTreeWrites: 0,
      providerBudgetViolations: 0,
      safetyViolations: 0,
      dangerousRegressionCount: 0,
      receiptCrashCount: 0,
      expectationsChecked: 33,
      guardCasesChecked: 24,
    },
    minimumStableCounts: {
      voluntaryLiveClaims: 8,
      providerCallsCompleted: 1,
      providerCallsFailed: 1,
      normalizedProviderResults: 1,
      artifactProposals: 1,
      independentReviews: 1,
      filesApplied: 1,
      verificationRuns: 2,
    },
  },

  demoDigitalLiveObjectiveV4Wiring: {
    demoName: "demoDigitalLiveObjectiveV4Wiring",
    // Digital Superorganism Live Objective V4 (Build Law §26). Proves the REAL
    // provider/workspace/verification wiring is reachable and correct through
    // the FAKE process driver — three provider calls, review-before-apply, one
    // detected defect, one confirmed repair, final green — with every real-action
    // counter exactly 0. A key guard proves the real Node process driver refuses
    // an automated-test-origin permit WITHOUT executing (realProviderProcessExecutions
    // stays 0). 15 guard cases, 14 expectations; empty mismatchCaseIds via the flag.
    requiredFlags: ["allExpectationsMet", "finalObjectivePassed"],
    exactStableCounts: {
      totalPersistentAnts: 300,
      acceptedLiveCohortSize: 3,
      providerCallsStarted: 3,
      providerCallsCompleted: 3,
      verificationFailures: 1,
      repairCalls: 1,
      repairRounds: 1,
      selfReviewsAccepted: 0,
      realClaudeCalls: 0,
      realCodexCalls: 0,
      realProviderProcessExecutions: 0,
      realNetworkCalls: 0,
      realFilesystemWrites: 0,
      workspaceBoundaryViolations: 0,
      sourceTreeWrites: 0,
      providerBudgetViolations: 0,
      dangerousRegressionCount: 0,
      receiptCrashCount: 0,
      expectationsChecked: 14,
      wiringGuardsChecked: 15,
    },
    minimumStableCounts: {
      filesApplied: 1,
      verificationRuns: 2,
    },
  },

  demoCodexInvocationFix: {
    demoName: "demoCodexInvocationFix",
    // Windows Codex stdin-timeout fix (targeted). Proves Codex is invoked as
    // `exec --ephemeral --json <PROMPT>` (bounded prompt as the single final
    // positional argument) with EMPTY stdin, Claude is unchanged (prompt on
    // stdin), multi-line Codex JSONL is parsed and the agent_message extracted,
    // stderr warnings do not fail an exit-0 result, and missing/malformed output
    // fails safely — all through a spy driver making zero real calls.
    requiredFlags: ["allExpectationsMet"],
    exactStableCounts: {
      codexGuardsChecked: 14,
      expectationsChecked: 5,
      realClaudeCalls: 0,
      realCodexCalls: 0,
      realProviderProcessExecutions: 0,
      realFilesystemWrites: 0,
      realNetworkCalls: 0,
      dangerousRegressionCount: 0,
      receiptCrashCount: 0,
    },
  },

  demoLiveObjectivePreSpawn: {
    demoName: "demoLiveObjectivePreSpawn",
    // Live-objective pre-spawn hang fix (readline lifecycle). Proves the exact
    // human confirmation is accepted; askOnce opens ONE readline, reads one
    // answer, and CLOSES it immediately; no second hidden input precedes the
    // first provider call; the preparation sequence reaches provider-spawn-
    // starting/completed (all 7 stages); the fake process driver's run() is
    // actually invoked (count 3); and every real-action counter stays 0.
    requiredFlags: ["allExpectationsMet"],
    exactStableCounts: {
      totalPersistentAnts: 300,
      acceptedLiveCohortSize: 3,
      preSpawnStagesReached: 7,
      fakeProcessRunCount: 3,
      preSpawnGuardsChecked: 13,
      expectationsChecked: 7,
      realClaudeCalls: 0,
      realCodexCalls: 0,
      realProviderProcessExecutions: 0,
      realFilesystemWrites: 0,
      realNetworkCalls: 0,
      dangerousRegressionCount: 0,
      receiptCrashCount: 0,
    },
  },

  demoNamlaCivilizationOSV1: {
    demoName: "demoNamlaCivilizationOSV1",
    // Namla Civilization OS V1 (Build Law §27). A living digital ant settlement:
    // 20 districts, a Tamara national objective, competing plans reaching quorum
    // with minority reports, a voluntary labor market forming/dissolving teams,
    // bounded MCP cognition + deterministic provider routing, artifacts/reviews/
    // verification, injected failures recycled through repair, a living knowledge
    // economy, and evidence-gated academy promotion — conserving, decentralized,
    // zero real provider/network/fs/process action, holding at 300/1k/10k.
    requiredFlags: ["allExpectationsMet", "boundedCognitive", "boundedMcpSessions", "causalityClean", "conserved", "finalObjectivePassed", "quorumReached", "zeroCentralAssignment", "zeroRealAction"],
    exactStableCounts: {
      totalPersistentAnts: 300,
      queenIdentities: 1,
      workerIdentities: 299,
      districtsCreated: 20,
      tamaraObjectivesReceived: 1,
      nonVolunteerAssignments: 0,
      centralTaskAssignments: 0,
      queenTaskAssignments: 0,
      tamaraDirectAntAssignments: 0,
      globalPlannerDecisions: 0,
      realProviderCalls: 0,
      realNetworkCalls: 0,
      realFilesystemWrites: 0,
      processExecutions: 0,
      unexplainedResourceCreation: 0,
      causalityViolations: 0,
      dangerousRegressionCount: 0,
      receiptCrashCount: 0,
      expectationsChecked: 44,
    },
    minimumStableCounts: {
      scoutProposals: 3,
      minorityReports: 1,
      voluntaryClaims: 1,
      acceptedClaims: 1,
      temporaryTeamsFormed: 1,
      councilsActivated: 1,
      disagreementsRecorded: 1,
      peerReviewsCompleted: 1,
      mcpToolCalls: 1,
      mcpToolFailures: 1,
      providerCalls: 1,
      artifactsCreated: 1,
      reviewsCompleted: 1,
      verificationRuns: 1,
      failuresDetected: 2,
      repairsCompleted: 1,
      knowledgeAccepted: 1,
      knowledgeContradictions: 1,
      academyEvidenceUpdates: 1,
      skillPassportUpdates: 1,
      technicalDebtTracked: 1,
      wasteRecycled: 1,
    },
    maximumStableCounts: {
      peakCognitiveAnts: 30,
    },
  },

  demoNamlaCivilizationLiveV2: {
    demoName: "demoNamlaCivilizationLiveV2",
    // Namla Civilization OS V2 — Live MCP (Build Law §28). The settlement runs a
    // LIVE mission through the reused V4 provider wiring (over a fake process
    // driver), a fake MCP execution driver, an in-memory workspace, and a fake
    // verification driver: a voluntary 3-ant cohort, bounded MCP tools with one
    // isolated failure, one provider failure, a security finding, one detected
    // defect, an incident council, one confirmed repair, final green — with every
    // real counter exactly 0.
    requiredFlags: ["allExpectationsMet", "finalObjectivePassed", "quorumReached"],
    exactStableCounts: {
      totalPersistentAnts: 300,
      districtsCreated: 20,
      acceptedLiveCohortSize: 3,
      tamaraObjectivesReceived: 1,
      verificationFailures: 1,
      securityFindings: 1,
      repairCalls: 1,
      selfReviewsAccepted: 0,
      nonVolunteerAssignments: 0,
      centralTaskAssignments: 0,
      queenTaskAssignments: 0,
      tamaraDirectAntAssignments: 0,
      globalPlannerDecisions: 0,
      realProviderCalls: 0,
      realProviderProcessExecutions: 0,
      realMcpExecutions: 0,
      realNetworkCalls: 0,
      realFilesystemWrites: 0,
      providerBudgetViolations: 0,
      safetyViolations: 0,
      unexplainedResourceCreation: 0,
      dangerousRegressionCount: 0,
      receiptCrashCount: 0,
      expectationsChecked: 41,
    },
    minimumStableCounts: {
      voluntaryLiveClaims: 15,
      councilsActivated: 5,
      scoutProposals: 3,
      minorityReports: 1,
      providerCalls: 1,
      providerFailures: 1,
      providerHealthUpdates: 1,
      mcpToolGrants: 6,
      mcpToolCalls: 1,
      mcpToolFailures: 1,
      mcpHealthUpdates: 1,
      artifactsCreated: 1,
      independentReviews: 1,
      verificationRuns: 2,
      incidentsCreated: 1,
      repairsCompleted: 1,
      knowledgeAccepted: 1,
      academyEvidenceUpdates: 1,
      technicalDebtTracked: 1,
      wasteRecycled: 1,
    },
    maximumStableCounts: {
      peakCognitiveAnts: 30,
    },
  },
  demoTamaraNamlaFederationV3: {
    demoName: "demoTamaraNamlaFederationV3",
    // Tamara–Namla Sovereign Federation Runtime V3: one national objective →
    // 3+ strategy proposals → quorum + minority reports → 14-district mission
    // program → capability-complete voluntary team → bounded fake provider +
    // MCP execution (one malformed output, one MCP failure, one security
    // finding, one verification failure) → reviewed artifacts → gated repair →
    // knowledge/Academy/SkillPassport loops → capability fabric (future tools
    // refused, all grants revoked) → evidence → Tamara ACCEPTS. Real action 0.
    requiredFlags: ["allExpectationsMet", "quorumReached", "finalVerificationPassed", "conservationClosed", "causalityClean", "architectureCoverage", "implementationCoverage", "independentReviewCoverage", "futureCapabilityRefused", "repairConfirmationGated"],
    exactStableCounts: {
      totalPersistentAnts: 300,
      tamaraObjectivesReceived: 1,
      nonVolunteerAssignments: 0,
      tamaraDirectAntAssignments: 0,
      queenTaskAssignments: 0,
      centralTaskAssignments: 0,
      councilWorkerAssignments: 0,
      globalPlannerDecisions: 0,
      selfReviewsAccepted: 0,
      realProviderCalls: 0,
      realMcpExecutions: 0,
      realFilesystemWrites: 0,
      realNetworkCalls: 0,
      realProviderProcessExecutions: 0,
      processExecutions: 0,
      unexplainedResourceCreation: 0,
      activeCapabilityGrantsAfterRun: 0,
      dangerousRegressionCount: 0,
      receiptCrashCount: 0,
      expectationsChecked: 57,
    },
    minimumStableCounts: {
      districtsActivated: 12,
      strategyProposals: 3,
      minorityReports: 1,
      privateAssessments: 1,
      voluntaryClaims: 15,
      acceptedCohortSize: 3,
      providerCalls: 1,
      providerFailures: 1,
      mcpGrants: 1,
      mcpCalls: 1,
      mcpFailures: 1,
      artifactsProposed: 1,
      artifactsReviewed: 1,
      artifactsApplied: 1,
      safetyFindings: 1,
      incidentsCreated: 1,
      repairsCompleted: 1,
      verificationRuns: 2,
      verificationFailures: 1,
      knowledgeUpdates: 1,
      academyUpdates: 1,
      skillPassportUpdates: 1,
      selfCertificationBlocked: 1,
      capabilityRegistrySize: 30,
      capabilityHealthUpdates: 1,
      providerHealthUpdates: 1,
      mcpHealthUpdates: 1,
      stateTransitions: 15,
    },
  },
  demoNamolaTwinEmpireV1: {
    demoName: "demoNamolaTwinEmpireV1",
    // Namola Twin Empire V1: two isolated colonies compete to frozen bundles,
    // cross-examine, resolve a contradiction by decisive test, and Namola merges
    // approved components through the zero-trust forge (one injected merge
    // failure -> one separately authorized fake repair -> final green -> customer
    // delivery). A SEPARATE isolated witness proves fake test evidence forces
    // SAFELY_ABORT with no merge verification and no delivery. Fakes only.
    requiredFlags: ["allExpectationsMet", "conservationClosed", "causalityClean", "packetsAreIdentical"],
    exactStableCounts: {
      totalPersistentAnts: 1000,
      claudeColonyAnts: 440,
      codexColonyAnts: 440,
      sovereignCourtAnts: 40,
      witnessLaboratoryAnts: 40,
      reserveAnts: 40,
      claudeSubscriptionConcurrency: 1,
      codexSubscriptionConcurrency: 1,
      selfReviewsAccepted: 0,
      realProviderCalls: 0,
      realMcpExecutions: 0,
      realFilesystemWrites: 0,
      realNetworkCalls: 0,
      processExecutions: 0,
      unexplainedResourceCreation: 0,
      receiptCrashCount: 0,
      dangerousRegressionCount: 0,
      frozenBundles: 2,
      missionWitnessFakeEvidence: 0,
      fakeScenarioMergeRuns: 0,
      expectationsChecked: 113,
    },
    minimumStableCounts: {
      locallyActiveAnts: 100,
      claudeArtifacts: 1,
      codexArtifacts: 1,
      claudeIndependentReviews: 1,
      codexIndependentReviews: 1,
      fakeTestEvidenceDetected: 1,
    },
    maximumStableCounts: {
      locallyActiveAnts: 300,
      peakDeepCognitionAnts: 30,
      peakConcurrentProviderCalls: 10,
    },
  },
};
