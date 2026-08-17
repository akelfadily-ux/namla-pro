/**
 * demoTwinResumeRegression — deterministic proof that a partially successful twin
 * run resumes ONLY the failed colony, with fakes only.
 *
 * Scenario A reproduces the first real run: Claude implementation TIMES OUT, so
 * the review call must be SKIPPED (budget preserved) and the Claude bundle must
 * not freeze — while Codex completes all three roles and freezes.
 * Scenario B resumes ONLY Claude: two bounded calls (implementation, then review
 * once artifacts exist), a SEPARATE repair workspace, review before application,
 * the Claude bundle freezes, and the preserved Codex bundle is byte-identical
 * with a distinct fingerprint. Codex spends ZERO calls during the resume.
 *
 * No fs, no child_process, no network, no real provider calls.
 */

import { buildTwinEmpireLivePlan, TWIN_CONFIRMATION_PHRASE } from "../twin/twinEmpireLivePlan";
import { buildSettlementWorkers } from "../civilization/civilizationLiveRunner";
import { runTwinColonyLive, InMemoryTwinWorkspaceApplier } from "../twin/twinColonyLiveRunner";
import type { TwinCohortRoleMember } from "../twin/twinColonyLiveRunner";
import { runTwinResume } from "../twin/twinResumeRunner";
import { buildTwinResumeRecord, verifyPreservedBundle, repairWorkspaceId, MAX_REPAIR_IMPLEMENTATION_TIMEOUT_MS } from "../twin/twinResumeState";
import { verifyBundleImmutable } from "../twin/frozenBundleValidator";
import { ColonyWorkspaceAuthority } from "../twin/colonyWorkspace";
import { RealLiveProviderDriver } from "../cognitive/liveProviderExecution";
import { acquireHumanConfirmation, mintPermitForAutomatedTest } from "../cognitive/realProviderExecutionPermit";
import type { RealProviderExecutionPermit, RealProviderId } from "../cognitive/realProviderExecutionPermit";
import { mintTwinEmpirePermitForAutomatedTest, consumeTwinEmpirePermit } from "../cognitive/twinEmpireLivePermit";
import type { TwinEmpireLiveScope } from "../cognitive/twinEmpireLivePermit";
import type { ProviderProcessDriver, ProviderProcessResult, ProviderProcessSpec } from "../cognitive/providerProcessDriver";

const MISSION_ID = "namola-twin-taskmgr";
const REPAIR_PHRASE = "RUN ONE NAMOLA CLAUDE REPAIR";

/** Fake driver; `timeoutImplementation` reproduces the real Claude failure. */
class ResumeFakeProcessDriver implements ProviderProcessDriver {
  readonly isReal = false;
  runs = 0;
  rolesRun: string[] = [];
  constructor(private readonly opts: { timeoutImplementation?: boolean } = {}) {}
  run(spec: ProviderProcessSpec): ProviderProcessResult {
    this.runs += 1;
    const base = { ran: true, exitCode: 0 as number | null, terminationSignalCategory: "none" as const, stderr: "", stdoutTruncated: false, stderrTruncated: false, failureCategory: "none" as const };
    const isCodex = spec.executableId === "codex";
    const promptText = isCodex ? spec.argumentList[spec.argumentList.length - 1] ?? "" : spec.stdinData;
    const role = (promptText.match(/^role:([a-z-]+)/) ?? [])[1] ?? "build";
    this.rolesRun.push(role);
    if (this.opts.timeoutImplementation && role === "build") {
      // Exactly what the real run produced: SIGKILL at the timeout, empty stdout.
      return { ...base, ran: true, exitCode: null, stdout: "", terminationSignalCategory: "timeout-kill", failureCategory: "timed-out" };
    }
    const files = role === "architecture" ? [{ path: "ARCHITECTURE.md", operation: "create" as const, content: "# Architecture\nsrc/taskManager.ts" }] : role === "review" ? [] : [{ path: "src/taskManager.ts", operation: "create" as const, content: "export class TaskManager { list() { return []; } }" }];
    const payload = JSON.stringify({ summary: `role ${role}`, assumptions: [], files, risks: role === "review" ? ["reviewed"] : [], tests: role === "review" ? ["list"] : [], confidence: 0.7 });
    if (isCodex) return { ...base, stdout: [JSON.stringify({ type: "thread.started" }), JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: payload } }), JSON.stringify({ type: "turn.completed" })].join("\n") };
    return { ...base, stdout: payload };
  }
}

function scope(plan: ReturnType<typeof buildTwinEmpireLivePlan>, total: number): TwinEmpireLiveScope {
  return { missionId: MISSION_ID, objectiveId: MISSION_ID, claudeWorkspaceId: plan.workspaceRoots.claude, codexWorkspaceId: plan.workspaceRoots.codex, allowedProviders: ["claude", "codex"], maxClaudeConcurrency: 1, maxCodexConcurrency: 1, maxTotalProviderCalls: total, maxDeepCognitionAnts: 30, maxMcpCalls: 50, perFileByteCap: 20000, workspaceFileCap: 32, maxStdinBytes: 8000, maxStdoutBytes: 20000, perCallTimeoutMs: 900000 };
}

function driverFor(cohort: readonly TwinCohortRoleMember[], provider: RealProviderId, ws: string, proc: ProviderProcessDriver, colonyId = "claude-forge", repair = false): RealLiveProviderDriver {
  const permitByAnt = new Map<string, RealProviderExecutionPermit>();
  for (const m of cohort) permitByAnt.set(m.antId, mintPermitForAutomatedTest({ provider, missionId: MISSION_ID, taskId: repair ? `${MISSION_ID}-${colonyId}-repair-${m.role === "review" ? "review" : "implementation"}` : `${MISSION_ID}-${colonyId}-${m.role}`, antId: m.antId, workspaceId: ws, maxInputBytes: 8000, maxOutputBytes: 20000, timeoutMs: 900000 }));
  return new RealLiveProviderDriver({ processDriver: proc, permitByAnt, missionId: MISSION_ID, workspaceId: ws, workspaceAbsolutePath: `/fake/${ws}`, maxStdinBytes: 8000, maxStdoutBytes: 20000, maxStderrBytes: 4000, timeoutMs: 900000, promptForRole: (role, antId) => `role:${role};ant:${antId}` });
}

export function runDemoTwinResumeRegression() {
  const workers = buildSettlementWorkers(20260915, 1000);
  const plan = buildTwinEmpireLivePlan(workers, ["claude", "codex"], MISSION_ID);
  const claudeCohort: TwinCohortRoleMember[] = [{ antId: "cl-arch", role: "architecture" }, { antId: "cl-impl", role: "implementation" }, { antId: "cl-review", role: "review" }];
  const codexCohort: TwinCohortRoleMember[] = [{ antId: "cx-arch", role: "architecture" }, { antId: "cx-impl", role: "implementation" }, { antId: "cx-review", role: "review" }];

  // ---- Scenario A: first attempt (Claude implementation times out) ----------
  const permitA = mintTwinEmpirePermitForAutomatedTest(scope(plan, 10));
  const authority = new ColonyWorkspaceAuthority();
  const claudeProc = new ResumeFakeProcessDriver({ timeoutImplementation: true });
  const codexProc = new ResumeFakeProcessDriver();
  const claudeApplier = new InMemoryTwinWorkspaceApplier(authority, plan.workspaceRoots.claude);
  const codexApplier = new InMemoryTwinWorkspaceApplier(authority, plan.workspaceRoots.codex);
  const stagesA: string[] = [];

  const claudeFirst = runTwinColonyLive({ colonyId: "claude-forge", culture: "architecture-first", provider: "claude", missionId: MISSION_ID, workspaceId: plan.workspaceRoots.claude, cohort: claudeCohort, empirePermit: permitA, providerDriver: driverFor(claudeCohort, "claude", plan.workspaceRoots.claude, claudeProc), applier: claudeApplier, acceptance: plan.acceptanceCriteria, log: (s) => stagesA.push(s) });
  const codexFirst = runTwinColonyLive({ colonyId: "codex-crucible", culture: "implementation-first", provider: "codex", missionId: MISSION_ID, workspaceId: plan.workspaceRoots.codex, cohort: codexCohort, empirePermit: permitA, providerDriver: driverFor(codexCohort, "codex", plan.workspaceRoots.codex, codexProc, "codex-crucible"), applier: codexApplier, acceptance: plan.acceptanceCriteria, log: (s) => stagesA.push(s) });

  const codexFingerprintBefore = codexFirst.bundle?.fingerprint ?? "";
  const claudeTimeoutDiag = claudeFirst.diagnostics.find((d) => d.role === "implementation");
  const claudeReviewCalled = claudeFirst.diagnostics.some((d) => d.role === "review");

  // ---- Resume record --------------------------------------------------------
  const record = buildTwinResumeRecord({ missionId: MISSION_ID, failed: claudeFirst, successful: codexFirst, totalCallBudget: 10, repairAttempt: 1 });
  const preservedCheck = verifyPreservedBundle(codexFirst.bundle, record);

  // ---- Confirmation gating --------------------------------------------------
  const wrongPhrase = acquireHumanConfirmation({ typedPhrase: TWIN_CONFIRMATION_PHRASE, requiredPhrase: REPAIR_PHRASE, isInteractiveTty: true, argvConfirmationFlagPresent: false, stdinWasPiped: false });
  const nonTty = acquireHumanConfirmation({ typedPhrase: REPAIR_PHRASE, requiredPhrase: REPAIR_PHRASE, isInteractiveTty: false, argvConfirmationFlagPresent: false, stdinWasPiped: false });
  const pipedStdin = acquireHumanConfirmation({ typedPhrase: REPAIR_PHRASE, requiredPhrase: REPAIR_PHRASE, isInteractiveTty: true, argvConfirmationFlagPresent: false, stdinWasPiped: true });
  const argvFlag = acquireHumanConfirmation({ typedPhrase: REPAIR_PHRASE, requiredPhrase: REPAIR_PHRASE, isInteractiveTty: true, argvConfirmationFlagPresent: true, stdinWasPiped: false });
  const exactPhrase = acquireHumanConfirmation({ typedPhrase: REPAIR_PHRASE, requiredPhrase: REPAIR_PHRASE, isInteractiveTty: true, argvConfirmationFlagPresent: false, stdinWasPiped: false });

  // ---- Scenario B: resume ONLY Claude ---------------------------------------
  const permitB = mintTwinEmpirePermitForAutomatedTest(scope(plan, 2));
  const repairWs = repairWorkspaceId(MISSION_ID, "claude-forge", record.repairArea);
  const repairApplier = new InMemoryTwinWorkspaceApplier(authority, repairWs);
  const repairProc = new ResumeFakeProcessDriver(); // implementation now succeeds
  const codexProcDuringResume = codexProc.runs; // snapshot: must not increase
  const stagesB: string[] = [];

  const resume = runTwinResume({
    record,
    culture: "architecture-first",
    provider: "claude",
    implementationAntId: "cl-impl",
    reviewAntId: "cl-review",
    empirePermit: permitB,
    providerDriver: driverFor(claudeCohort, "claude", repairWs, repairProc, "claude-forge", true),
    repairApplier,
    preservedBundle: codexFirst.bundle,
    acceptance: plan.acceptanceCriteria,
    reusedArchitecturePlan: claudeFirst.architecturePlan,
    log: (s) => stagesB.push(s),
  });

  const codexFingerprintAfter = codexFirst.bundle?.fingerprint ?? "";
  const codexStillImmutable = codexFirst.bundle ? verifyBundleImmutable(codexFirst.bundle) : false;
  const consumedFirst = consumeTwinEmpirePermit(permitB);
  const consumedSecond = consumeTwinEmpirePermit(permitB);

  const requiredResumeStages = ["resume-plan-loaded", "successful-bundle-validated", "claude-repair-implementation-starting", "claude-repair-implementation-completed", "claude-repair-review-starting", "claude-repair-review-completed", "claude-repair-artifacts-applied", "claude-bundle-frozen", "codex-bundle-unchanged", "twin-bundles-frozen"];

  const specs: Array<[string, boolean]> = [
    // Scenario A — review gating on implementation timeout
    ["A:claude-implementation-timed-out", claudeTimeoutDiag !== undefined && claudeTimeoutDiag.ok === false && claudeTimeoutDiag.failureCategory === "provider-timeout"],
    ["A:review-not-called-after-implementation-failure", claudeReviewCalled === false && claudeFirst.providerCalls === 2],
    ["A:exact-failure-category-preserved", claudeFirst.failureReason === "provider-timeout" && claudeFirst.reviewSkippedReason === "provider-timeout"],
    ["A:remaining-budget-preserved", claudeFirst.providerCalls === 2],
    ["A:claude-bundle-not-frozen", claudeFirst.bundle === null && claudeFirst.artifactsApplied === 0],
    ["A:codex-completed-and-froze", codexFirst.ok === true && codexFirst.bundle !== null && codexFirst.providerCalls === 3],
    // Resume record
    ["record-is-resumable", record.resumeStatus === "resumable" && record.failedColony === "claude-forge" && record.successfulColony === "codex-crucible"],
    ["record-carries-failure-category", record.failureCategory === "provider-timeout" && record.failedRole === "implementation"],
    ["record-reuses-completed-architecture", record.completedRoles.includes("architecture")],
    ["record-has-remaining-budget", record.remainingCallBudget >= 2],
    ["record-carries-no-secrets", JSON.stringify(record).match(/sk-|api[_-]?key|prompt|password|token/i) === null],
    ["preserved-bundle-validated", preservedCheck.ok === true],
    // Confirmation gating
    ["wrong-confirmation-rejected", wrongPhrase.ok === false],
    ["non-tty-rejected", nonTty.ok === false],
    ["piped-stdin-rejected", pipedStdin.ok === false],
    ["argv-flag-rejected", argvFlag.ok === false],
    ["exact-repair-phrase-accepted", exactPhrase.ok === true],
    // Scenario B — resume only Claude
    ["B:resume-froze-claude-bundle", resume.status === "twin-bundles-frozen" && resume.repairedBundle !== null && resume.repairedBundle.frozen === true],
    ["B:only-two-additional-calls", resume.additionalProviderCalls === 2],
    ["B:only-implementation-and-review-ran", repairProc.rolesRun.length === 2 && repairProc.rolesRun.includes("build") && repairProc.rolesRun.includes("review")],
    ["B:no-architecture-call-in-resume", repairProc.rolesRun.includes("architecture") === false && resume.architectureReused === true],
    ["B:codex-zero-runs-during-resume", codexProc.runs === codexProcDuringResume],
    ["B:repair-workspace-is-separate", resume.repairWorkspaceId === repairWs && repairWs.includes("/repair-1") && repairWs !== plan.workspaceRoots.claude],
    ["B:original-claude-workspace-untouched", authority.fileCount(plan.workspaceRoots.claude) === 0],
    ["B:artifacts-reviewed-before-application", resume.independentReviews === 1 && resume.artifactsApplied > 0],
    ["B:codex-fingerprint-unchanged", codexFingerprintAfter === codexFingerprintBefore && codexStillImmutable === true && resume.preservedBundleUnchanged === true],
    ["B:fingerprints-distinct", resume.distinctFingerprints === true && resume.repairedFingerprint !== resume.preservedFingerprint],
    ["B:permit-cannot-be-reused", consumedFirst === true && consumedSecond === false],
    ["B:repair-timeout-bounded", MAX_REPAIR_IMPLEMENTATION_TIMEOUT_MS === 900000 && (resume.diagnostics.find((d) => d.role === "implementation")?.timeoutMs ?? 0) <= 900000],
    ["B:all-resume-stages-emitted", requiredResumeStages.every((s) => stagesB.includes(s))],
    // Real-action counters
    ["realProviderProcessExecutions==0", resume.realProviderProcessExecutions === 0 && claudeFirst.realProviderProcessExecutions === 0 && codexFirst.realProviderProcessExecutions === 0],
    ["realFilesystemWrites==0", authority.realWrites === 0],
  ];
  const mismatchCaseIds = specs.filter(([, ok]) => !ok).map(([id]) => id);

  return {
    moduleName: "demoTwinResumeRegression",
    claudeFirstFailureCategory: claudeFirst.failureReason,
    claudeFirstProviderCalls: claudeFirst.providerCalls,
    claudeReviewCalledOnFailure: claudeReviewCalled,
    claudeImplementationTimeoutMs: claudeTimeoutDiag?.timeoutMs ?? 0,
    codexFirstProviderCalls: codexFirst.providerCalls,
    codexFingerprintBefore,
    codexFingerprintAfter,
    resumeStatus: resume.status,
    resumeAdditionalCalls: resume.additionalProviderCalls,
    resumeRolesRun: repairProc.rolesRun,
    codexRunsDuringResume: codexProc.runs - codexProcDuringResume,
    repairWorkspace: resume.repairWorkspaceId,
    repairedFingerprint: resume.repairedFingerprint,
    distinctFingerprints: resume.distinctFingerprints,
    realProviderProcessExecutions: resume.realProviderProcessExecutions,
    realFilesystemWrites: authority.realWrites,
    expectationsChecked: specs.length,
    mismatchCaseIds,
    allExpectationsMet: mismatchCaseIds.length === 0,
  };
}

if (require.main === module) {
  const out = runDemoTwinResumeRegression();
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.allExpectationsMet ? 0 : 1);
}
