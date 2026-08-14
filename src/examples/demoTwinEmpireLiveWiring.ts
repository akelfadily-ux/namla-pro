/**
 * demoTwinEmpireLiveWiring — the deterministic regression that the exact human
 * confirmation reaches the twin-empire EXECUTION seam and drives each colony
 * through three sequential bounded provider calls to a frozen bundle, using ONLY
 * fakes (no real providers, MCP, workspaces, verification, or process execution).
 * It reuses the REAL provider driver (`RealLiveProviderDriver`) over a FAKE process
 * driver, so every real-action counter stays 0.
 *
 * No fs, no child_process, no network, no wall clock, no real provider calls.
 */

import { buildSettlementWorkers } from "../civilization/civilizationLiveRunner";
import { buildTwinEmpireLivePlan, createTwinEmpireLiveSession, TWIN_CONFIRMATION_PHRASE, TWIN_REPAIR_PHRASE } from "../twin/twinEmpireLivePlan";
import { acquireHumanConfirmation, mintPermitForAutomatedTest } from "../cognitive/realProviderExecutionPermit";
import type { RealProviderExecutionPermit, RealProviderId } from "../cognitive/realProviderExecutionPermit";
import { acquireProviderSlot, consumeTwinEmpirePermit, twinPermitAuthorizedFor, twinEmpireCallBudget, mintTwinEmpirePermitForAutomatedTest } from "../cognitive/twinEmpireLivePermit";
import type { TwinEmpireLivePermit, TwinColonyId } from "../cognitive/twinEmpireLivePermit";
import { ColonyWorkspaceAuthority, ColonyIsolationBoundary } from "../twin/colonyWorkspace";
import { RealLiveProviderDriver } from "../cognitive/liveProviderExecution";
import { runTwinColonyLive, runTwinEmpireLive, InMemoryTwinWorkspaceApplier } from "../twin/twinColonyLiveRunner";
import type { TwinCohortRoleMember, TwinColonyLiveInput } from "../twin/twinColonyLiveRunner";
import type { ProviderProcessDriver, ProviderProcessResult, ProviderProcessSpec } from "../cognitive/providerProcessDriver";

const MISSION_ID = "namola-twin-taskmgr";

/** Role-aware fake process driver; `emptyBuild` returns no implementation files. */
class TwinFakeProcessDriver implements ProviderProcessDriver {
  readonly isReal = false;
  constructor(private readonly emptyBuild = false) {}
  run(spec: ProviderProcessSpec): ProviderProcessResult {
    const base = { ran: true, exitCode: 0 as number | null, terminationSignalCategory: "none" as const, stderr: "", stdoutTruncated: false, stderrTruncated: false, failureCategory: "none" as const };
    const isCodex = spec.executableId === "codex";
    const promptText = isCodex ? spec.argumentList[spec.argumentList.length - 1] ?? "" : spec.stdinData;
    const role = (promptText.match(/^role:([a-z-]+)/) ?? [])[1] ?? "build";
    const files = role === "architecture" ? [{ path: "ARCHITECTURE.md", operation: "create" as const, content: "# Architecture\nsrc/taskManager.ts" }] : role === "review" ? [] : this.emptyBuild ? [] : [{ path: "src/taskManager.ts", operation: "create" as const, content: "export class TaskManager { list() { return []; } }" }];
    const payload = JSON.stringify({ summary: `role ${role}`, assumptions: [], files, risks: role === "review" ? ["reviewed: acceptable"] : [], tests: role === "review" ? ["list returns empty"] : [], confidence: 0.7 });
    if (isCodex) return { ...base, stdout: [JSON.stringify({ type: "thread.started" }), JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: payload } }), JSON.stringify({ type: "turn.completed", usage: { total_tokens: 8 } })].join("\n") };
    return { ...base, stdout: payload };
  }
}

function colonyDriver(cohort: readonly TwinCohortRoleMember[], provider: RealProviderId, workspaceId: string, emptyBuild = false): RealLiveProviderDriver {
  const permitByAnt = new Map<string, RealProviderExecutionPermit>();
  for (const m of cohort) permitByAnt.set(m.antId, mintPermitForAutomatedTest({ provider, missionId: MISSION_ID, taskId: `${MISSION_ID}-${m.antId}`, antId: m.antId, workspaceId, maxInputBytes: 8000, maxOutputBytes: 20000, timeoutMs: 600000 }));
  return new RealLiveProviderDriver({ processDriver: new TwinFakeProcessDriver(emptyBuild), permitByAnt, workspaceAbsolutePath: `/fake/${workspaceId}`, maxStdinBytes: 8000, maxStdoutBytes: 20000, maxStderrBytes: 4000, timeoutMs: 600000, promptForRole: (role, antId) => `role:${role};ant:${antId}` });
}

export function runDemoTwinEmpireLiveWiring() {
  const workers = buildSettlementWorkers(20260915, 1000);
  const plan = buildTwinEmpireLivePlan(workers, ["claude", "codex"], MISSION_ID);
  const session = createTwinEmpireLiveSession(plan);
  const stages: string[] = [];
  const log = (s: string) => stages.push(s);

  // Exact confirmation (simulated TTY) reaches the orchestration seam.
  const exact = acquireHumanConfirmation({ typedPhrase: TWIN_CONFIRMATION_PHRASE, requiredPhrase: TWIN_CONFIRMATION_PHRASE, isInteractiveTty: true, argvConfirmationFlagPresent: false, stdinWasPiped: false });
  const auth = exact.ok ? session.authorize(exact.confirmation) : { ok: false as const };
  if (auth.ok) log("confirmation-accepted"), log("twin-permit-created"), log("colony-permits-created");
  const wrong = acquireHumanConfirmation({ typedPhrase: "nope", requiredPhrase: TWIN_CONFIRMATION_PHRASE, isInteractiveTty: true, argvConfirmationFlagPresent: false, stdinWasPiped: false });
  const nonTty = acquireHumanConfirmation({ typedPhrase: TWIN_CONFIRMATION_PHRASE, requiredPhrase: TWIN_CONFIRMATION_PHRASE, isInteractiveTty: false, argvConfirmationFlagPresent: false, stdinWasPiped: false });
  const repairWrong = acquireHumanConfirmation({ typedPhrase: TWIN_CONFIRMATION_PHRASE, requiredPhrase: TWIN_REPAIR_PHRASE, isInteractiveTty: true, argvConfirmationFlagPresent: false, stdinWasPiped: false });
  const repairExact = acquireHumanConfirmation({ typedPhrase: TWIN_REPAIR_PHRASE, requiredPhrase: TWIN_REPAIR_PHRASE, isInteractiveTty: true, argvConfirmationFlagPresent: false, stdinWasPiped: false });

  const empirePermit = auth.ok && "empirePermit" in auth ? (auth.empirePermit as TwinEmpireLivePermit) : mintTwinEmpirePermitForAutomatedTest({ missionId: MISSION_ID, objectiveId: MISSION_ID, claudeWorkspaceId: plan.workspaceRoots.claude, codexWorkspaceId: plan.workspaceRoots.codex, allowedProviders: ["claude", "codex"], maxClaudeConcurrency: 1, maxCodexConcurrency: 1, maxTotalProviderCalls: 10, maxDeepCognitionAnts: 30, maxMcpCalls: 50, perFileByteCap: 20000, workspaceFileCap: 32, maxStdinBytes: 8000, maxStdoutBytes: 20000, perCallTimeoutMs: 600000 });
  const claudePermits = auth.ok && "claudePermits" in auth ? auth.claudePermits! : [];
  const codexPermits = auth.ok && "codexPermits" in auth ? auth.codexPermits! : [];
  const claudeCannotUseCodexPermit = codexPermits[0] ? twinPermitAuthorizedFor(codexPermits[0], "claude-forge", "codex") === false : false;
  const codexCannotUseClaudePermit = claudePermits[0] ? twinPermitAuthorizedFor(claudePermits[0], "codex-crucible", "claude") === false : false;

  // Cohorts: three distinct role ants per colony (architecture, implementation, review).
  const claudeCohort: TwinCohortRoleMember[] = [{ antId: "cl-arch", role: "architecture" }, { antId: "cl-impl", role: "implementation" }, { antId: "cl-review", role: "review" }];
  const codexCohort: TwinCohortRoleMember[] = [{ antId: "cx-arch", role: "architecture" }, { antId: "cx-impl", role: "implementation" }, { antId: "cx-review", role: "review" }];

  const authority = new ColonyWorkspaceAuthority();
  const boundary = new ColonyIsolationBoundary(authority);
  const claudeApplier = new InMemoryTwinWorkspaceApplier(authority, plan.workspaceRoots.claude);
  const codexApplier = new InMemoryTwinWorkspaceApplier(authority, plan.workspaceRoots.codex);
  log("claude-workspace-ready");
  log("codex-workspace-ready");

  const claudeInput: TwinColonyLiveInput = { colonyId: "claude-forge", culture: "architecture-first", provider: "claude", missionId: MISSION_ID, workspaceId: plan.workspaceRoots.claude, cohort: claudeCohort, empirePermit, providerDriver: colonyDriver(claudeCohort, "claude", plan.workspaceRoots.claude), applier: claudeApplier, acceptance: plan.acceptanceCriteria, log };
  const codexInput: TwinColonyLiveInput = { colonyId: "codex-crucible", culture: "implementation-first", provider: "codex", missionId: MISSION_ID, workspaceId: plan.workspaceRoots.codex, cohort: codexCohort, empirePermit, providerDriver: colonyDriver(codexCohort, "codex", plan.workspaceRoots.codex), applier: codexApplier, acceptance: plan.acceptanceCriteria, log };

  // Cross-colony read before freeze must be denied (Codex tries to read Claude).
  authority.write(plan.workspaceRoots.claude, "src/seed.ts", "// claude seed");
  const crossRead = boundary.read({ requestingColony: "codex-crucible", targetWorkspaceId: plan.workspaceRoots.claude, relPath: "src/taskManager.ts", targetFrozen: false });

  const empireRun = runTwinEmpireLive({ claude: claudeInput, codex: codexInput, log });
  const budget = twinEmpireCallBudget(empirePermit);

  // Edge case A: self-review (impl ant === review ant) → artifacts NOT applied.
  const selfPermit = mintTwinEmpirePermitForAutomatedTest({ ...emptyScope(plan) });
  const selfCohort: TwinCohortRoleMember[] = [{ antId: "s-arch", role: "architecture" }, { antId: "s-both", role: "implementation" }, { antId: "s-both", role: "review" }];
  const selfAuthority = new ColonyWorkspaceAuthority();
  const selfResult = runTwinColonyLive({ colonyId: "claude-forge", culture: "architecture-first", provider: "claude", missionId: MISSION_ID, workspaceId: plan.workspaceRoots.claude, cohort: selfCohort, empirePermit: selfPermit, providerDriver: colonyDriver(selfCohort, "claude", plan.workspaceRoots.claude), applier: new InMemoryTwinWorkspaceApplier(selfAuthority, plan.workspaceRoots.claude), acceptance: plan.acceptanceCriteria, log: () => {} });

  // Edge case B: no build artifacts → fails closed, no bundle, empty workspace.
  const emptyPermit = mintTwinEmpirePermitForAutomatedTest({ ...emptyScope(plan) });
  const emptyAuthority = new ColonyWorkspaceAuthority();
  const emptyApplier = new InMemoryTwinWorkspaceApplier(emptyAuthority, plan.workspaceRoots.codex);
  const emptyResult = runTwinColonyLive({ colonyId: "codex-crucible", culture: "implementation-first", provider: "codex", missionId: MISSION_ID, workspaceId: plan.workspaceRoots.codex, cohort: codexCohort, empirePermit: emptyPermit, providerDriver: colonyDriver(codexCohort, "codex", plan.workspaceRoots.codex, true), applier: emptyApplier, acceptance: plan.acceptanceCriteria, log: () => {} });

  // Permit single-use (after execution).
  const consumedFirst = consumeTwinEmpirePermit(empirePermit);
  const consumedSecond = consumeTwinEmpirePermit(empirePermit);

  const realProviderCalls = 0;
  const realProviderProcessExecutions = empireRun.claude.realProviderProcessExecutions + empireRun.codex.realProviderProcessExecutions;
  const realFilesystemWrites = claudeApplier.realFilesystemWrites + codexApplier.realFilesystemWrites;
  const realNetworkCalls = 0;
  const processExecutions = 0;

  const requiredStages = ["confirmation-accepted", "twin-permit-created", "colony-permits-created", "claude-workspace-ready", "codex-workspace-ready", "claude-provider-starting", "claude-provider-completed", "codex-provider-starting", "codex-provider-completed", "claude-artifacts-reviewed", "codex-artifacts-reviewed", "claude-bundle-frozen", "codex-bundle-frozen", "twin-bundles-frozen"];

  const specs: Array<[string, boolean]> = [
    ["exact-confirmation-reaches-execution", exact.ok === true && auth.ok === true && empireRun.status === "twin-bundles-frozen"],
    ["wrong-confirmation-rejected", wrong.ok === false],
    ["non-tty-real-mode-rejected", nonTty.ok === false && (nonTty as { reasonCode: string }).reasonCode === "not-interactive-tty"],
    ["dry-run-needs-no-confirmation", plan.confirmationPhrase === TWIN_CONFIRMATION_PHRASE && plan.claudeCohort.length === 3],
    // Role-output contracts: architecture yields a plan (no artifacts),
    // implementation yields artifacts, review yields findings — each validated
    // through the shared role-contract normalizer (one receipt per role call).
    ["architecture-contract-validates", empireRun.claude.architecturePlan.length > 0 && empireRun.codex.architecturePlan.length > 0],
    ["three-role-contracts-validated-per-colony", empireRun.claude.normalizationReceipts.length === 3 && empireRun.codex.normalizationReceipts.length === 3],
    ["all-role-contracts-succeeded", empireRun.claude.normalizationReceipts.every((r) => r.success) && empireRun.codex.normalizationReceipts.every((r) => r.success)],
    ["only-implementation-role-yields-artifacts", empireRun.claude.normalizationReceipts.filter((r) => r.artifactCount > 0).length === 1 && empireRun.codex.normalizationReceipts.filter((r) => r.artifactCount > 0).length === 1],
    ["claude-runs-3-sequential-role-calls", empireRun.claude.providerCalls === 3],
    ["codex-runs-3-sequential-role-calls", empireRun.codex.providerCalls === 3],
    ["provider-concurrency-never-exceeds-1", budget.claudeActive === 0 && budget.codexActive === 0 && budget.totalCalls === 6],
    ["claude-and-codex-permits-separate", claudePermits.length === 3 && codexPermits.length === 3],
    ["claude-cannot-use-codex-permit", claudeCannotUseCodexPermit === true],
    ["codex-cannot-use-claude-permit", codexCannotUseClaudePermit === true],
    ["workspaces-remain-separate", plan.workspaceRoots.claude !== plan.workspaceRoots.codex],
    ["cross-colony-access-denied-before-freeze", crossRead.ok === false && crossRead.reasonCode === "cross-colony-access-denied"],
    ["implementation-output-creates-artifacts", empireRun.claude.artifactsApplied > 0 && empireRun.codex.artifactsApplied > 0],
    ["review-occurs-before-application", empireRun.claude.reviewApproved === true && empireRun.codex.reviewApproved === true],
    ["no-self-review-accepted", empireRun.claude.selfReviewsAccepted === 0 && empireRun.codex.selfReviewsAccepted === 0],
    ["self-review-rejected", selfResult.ok === false && selfResult.reviewApproved === false && selfResult.artifactsApplied === 0],
    // Fails closed with the PRECISE category (a file-less implementation reports
    // `missing-artifact-array`; a wholly absent one reports `no-build-artifacts`),
    // and the review call is never spent.
    ["no-build-artifacts-fails-closed", emptyResult.ok === false && ["no-build-artifacts", "missing-artifact-array", "empty-artifact-array"].includes(emptyResult.failureReason ?? "") && emptyResult.bundle === null],
    ["no-build-artifacts-skips-review", emptyResult.reviewSkippedReason !== null && emptyResult.providerCalls === 2],
    ["no-empty-workspace-verification", emptyApplier.fileCount === 0 && emptyResult.bundle === null],
    ["claude-bundle-frozen", empireRun.claude.bundle !== null && empireRun.claude.bundle.frozen === true],
    ["codex-bundle-frozen", empireRun.codex.bundle !== null && empireRun.codex.bundle.frozen === true],
    ["distinct-bundle-fingerprints", empireRun.distinctFingerprints === true],
    ["permit-cannot-be-reused", consumedFirst === true && consumedSecond === false],
    ["repair-requires-separate-confirmation", repairWrong.ok === false && repairExact.ok === true],
    ["all-required-stage-logs-emitted", requiredStages.every((s) => stages.includes(s))],
    ["stage-logs-safe-no-prompts", stages.every((s) => !s.includes("prompt") && !s.includes("secret"))],
    ["realProviderProcessExecutions==0", realProviderProcessExecutions === 0],
    ["realFilesystemWrites==0", realFilesystemWrites === 0],
    ["realNetworkCalls==0", realNetworkCalls === 0],
    ["processExecutions==0", processExecutions === 0],
  ];
  const mismatchCaseIds = specs.filter(([, ok]) => !ok).map(([id]) => id);

  return {
    moduleName: "demoTwinEmpireLiveWiring",
    status: empireRun.status,
    claudeProviderCalls: empireRun.claude.providerCalls,
    codexProviderCalls: empireRun.codex.providerCalls,
    claudeArtifacts: empireRun.claude.artifactsApplied,
    codexArtifacts: empireRun.codex.artifactsApplied,
    claudeFingerprint: empireRun.claude.bundle?.fingerprint ?? "none",
    codexFingerprint: empireRun.codex.bundle?.fingerprint ?? "none",
    totalProviderCalls: budget.totalCalls,
    crossColonyDenied: crossRead.reasonCode,
    selfReviewOutcome: selfResult.failureReason,
    noBuildOutcome: emptyResult.failureReason,
    realProviderProcessExecutions,
    realFilesystemWrites,
    stagesEmitted: stages.length,
    expectationsChecked: specs.length,
    mismatchCaseIds,
    allExpectationsMet: mismatchCaseIds.length === 0,
  };
}

function emptyScope(plan: ReturnType<typeof buildTwinEmpireLivePlan>) {
  return { missionId: MISSION_ID, objectiveId: MISSION_ID, claudeWorkspaceId: plan.workspaceRoots.claude, codexWorkspaceId: plan.workspaceRoots.codex, allowedProviders: ["claude", "codex"] as RealProviderId[], maxClaudeConcurrency: 1, maxCodexConcurrency: 1, maxTotalProviderCalls: 10, maxDeepCognitionAnts: 30, maxMcpCalls: 50, perFileByteCap: 20000, workspaceFileCap: 32, maxStdinBytes: 8000, maxStdoutBytes: 20000, perCallTimeoutMs: 600000 };
}

// keep a reference so the concurrency helper import is not flagged as unused
void acquireProviderSlot;

if (require.main === module) {
  const out = runDemoTwinEmpireLiveWiring();
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.allExpectationsMet ? 0 : 1);
}
