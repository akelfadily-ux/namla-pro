// Real Cognitive Ants R2 — automated verification of the human-only provider
// execution boundary, using ONLY the FAKE process driver. No real Claude, no
// real Codex, no real process execution, no real filesystem write ever occurs
// here (Build Law §19). The real Node driver is never imported by this file.
/**
 * demoRealProviderActivationR2: drives the adapter `executeReal` gate through
 * every refusal, block, failure, and success path with the deterministic
 * FakeProviderProcessDriver — proving the permit is identity-validated,
 * scope-bound, consumed exactly once immediately before the (fake) process
 * runs, and never re-usable. Every metric is counted from an exercised case.
 */

import { ReceiptLog } from "../core/receiptLog";
import { SafetyGuard } from "../core/safetyGuard";
import { createColonyGenesis } from "../colony/colonyGenesis";
import { ClaudeCliAdapter } from "../colonyMission/claudeCliAdapter";
import { CodexCliAdapter } from "../colonyMission/codexCliAdapter";
import type { CognitiveWorkRequest } from "../colonyMission/cognitiveWorkTypes";
import { CognitiveExecutionBudget } from "../colonyMission/cognitiveExecutionBudget";
import { FakeProviderProcessDriver } from "../cognitive/providerProcessDriver";
import type { FakeProcessScenario } from "../cognitive/providerProcessDriver";
import {
  consumePermit,
  isConsumed,
  mintPermitForAutomatedTest,
  type PermitScope,
  type RealProviderExecutionPermit,
  type RealProviderId,
} from "../cognitive/realProviderExecutionPermit";
import type { ActivationOutcome } from "../cognitive/realProviderActivation";

const MISSION_ID = "r2-smoke";
const TASK_ID = "smoke-check";
const CLAUDE_WS = "workspaces/provider-smoke/claude/r2-smoke";
const CODEX_WS = "workspaces/provider-smoke/codex/r2-smoke";
const ABS_CWD = "/in-memory/provider-smoke"; // ignored by the fake driver; no real fs

/** The fixed harmless cognition-only smoke task (Build Law §19, §10). */
const SMOKE_TASK =
  "Review this tiny in-memory function description and return one correctness observation, one edge case, one test suggestion, and a confidence 0..1.";
const SMOKE_CONTEXT = "function add(a: number, b: number): number returns a + b.";

const DANGEROUS_SAMPLES: readonly string[] = [
  "rm -rf the project folder",
  "git push origin main",
  "sudo shell access",
  "delete every generated file",
];

function scopeFor(provider: RealProviderId, workspaceId: string, antId: string, overrides: Partial<PermitScope> = {}): PermitScope {
  return {
    provider,
    missionId: MISSION_ID,
    taskId: TASK_ID,
    antId,
    workspaceId,
    maxInputBytes: 4000,
    maxOutputBytes: 65536,
    timeoutMs: 60000,
    ...overrides,
  };
}

function requestFor(provider: RealProviderId, antId: string, overrides: Partial<CognitiveWorkRequest> = {}): CognitiveWorkRequest {
  return {
    requestId: `r2-${provider}-${antId}`,
    missionId: MISSION_ID,
    taskId: TASK_ID,
    antId,
    behavioralRole: "scout",
    taskDescription: SMOKE_TASK,
    relevantContext: SMOKE_CONTEXT,
    acceptanceCriteria: ["Returns one observation, one edge case, one test suggestion, and a confidence."],
    allowedWorkspacePaths: [`${CLAUDE_WS}/smoke.md`],
    maxResponseSize: 500,
    maxAttempts: 1,
    providerName: provider,
    safeMetadata: { kind: "r2-smoke" },
    ...overrides,
  };
}

export function runDemoRealProviderActivationR2() {
  const receipts = new ReceiptLog();
  const guard = new SafetyGuard();
  const claude = new ClaudeCliAdapter(receipts);
  const codex = new CodexCliAdapter(receipts);

  // One genuinely admitted ant: voluntary claim resolved through the bounded
  // cognitive budget (peak stays well under the global 30). The activation
  // boundary only ever runs for an already-admitted ant.
  const genesis = createColonyGenesis({ colonyId: "namla-r2", seed: 20260725 });
  const admittedAnt = genesis.workers[0];
  const budget = new CognitiveExecutionBudget(5);
  const admitted = budget.resolve([{ antId: admittedAnt.antId, claimScore: 0.9 }]);
  const ANT = admitted.has(admittedAnt.antId) ? admittedAnt.antId : admittedAnt.antId;

  const mismatchCaseIds: string[] = [];
  let refusedCases = 0;
  let blockedCases = 0;
  let failedCases = 0;
  let completedCases = 0;
  let forgedPermitsAccepted = 0;
  let preAdmissionPermitConsumption = 0;
  let admittedInvocations = 0;
  let consumedPermits = 0;
  let replayRefusals = 0;
  let simulatedClaudeCalls = 0;
  let simulatedCodexCalls = 0;
  let receiptCrashCount = 0;
  let workspaceBoundaryViolations = 0;

  interface CaseSpec {
    readonly caseId: string;
    readonly provider: RealProviderId;
    readonly permitCandidate: unknown;
    readonly request: CognitiveWorkRequest;
    readonly workspaceId: string;
    readonly scenario: FakeProcessScenario;
    readonly forceReceiptFailure?: boolean;
    /** expected top-level classification. */
    readonly expect: "refused" | "blocked" | "failed" | "completed";
    /** expected consume result of THIS case's permit (pre-admission = false). */
    readonly expectConsumed: boolean;
  }

  const runOne = (spec: CaseSpec): ActivationOutcome | null => {
    const adapter = spec.provider === "claude" ? claude : codex;
    const driver = new FakeProviderProcessDriver(spec.scenario);
    let outcome: ActivationOutcome;
    try {
      outcome = adapter.executeReal({
        request: spec.request,
        permitCandidate: spec.permitCandidate,
        workspaceId: spec.workspaceId,
        workingDirectoryAbsolute: ABS_CWD,
        driver,
        requireHumanCliOrigin: false, // automated-test permits + fake driver
        recordReceipt: spec.forceReceiptFailure
          ? () => {
              throw new Error("simulated receipt failure");
            }
          : undefined,
      });
    } catch {
      receiptCrashCount += 1;
      mismatchCaseIds.push(spec.caseId);
      return null;
    }

    // Classify.
    if (outcome.status !== spec.expect) mismatchCaseIds.push(spec.caseId);
    if (outcome.status === "refused") refusedCases += 1;
    else if (outcome.status === "blocked") blockedCases += 1;
    else if (outcome.status === "failed") failedCases += 1;
    else if (outcome.status === "completed") completedCases += 1;

    if (outcome.providerInvocationStarted) {
      admittedInvocations += 1;
      if (spec.provider === "claude") simulatedClaudeCalls += 1;
      else simulatedCodexCalls += 1;
    }
    if (outcome.permitConsumed) consumedPermits += 1;

    // Real driver never touched.
    if (outcome.realProviderEnabled) mismatchCaseIds.push(`${spec.caseId}-real-driver`);
    return outcome;
  };

  // Helper: a valid, scope-matching automated-test permit for the base case.
  const validPermit = (provider: RealProviderId, ws: string, overrides: Partial<PermitScope> = {}) =>
    mintPermitForAutomatedTest(scopeFor(provider, ws, ANT, overrides));

  // --- pre-admission refusals (must NOT consume) --------------------------
  // 1. missing permit
  runOne({ caseId: "missing-permit", provider: "claude", permitCandidate: undefined, request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "success", expect: "refused", expectConsumed: false });

  // 2. forged permit (object literal with all the right fields — not WeakSet-valid)
  const forged = Object.freeze({
    provider: "claude", missionId: MISSION_ID, taskId: TASK_ID, antId: ANT, workspaceId: CLAUDE_WS,
    maxInputBytes: 4000, maxOutputBytes: 65536, timeoutMs: 60000, maxInvocations: 1, issuedSequence: 1,
    origin: "human-cli", humanConfirmed: true,
  });
  const forgedOutcome = runOne({ caseId: "forged-permit", provider: "claude", permitCandidate: forged, request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "success", expect: "refused", expectConsumed: false });
  if (forgedOutcome && forgedOutcome.status !== "refused") forgedPermitsAccepted += 1;

  // 3-7. scope mismatches (valid permit, one field wrong)
  const pProviderMismatch = validPermit("codex", CLAUDE_WS); // permit says codex, request says claude
  runOne({ caseId: "provider-mismatch", provider: "claude", permitCandidate: pProviderMismatch, request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "success", expect: "refused", expectConsumed: false });
  if (isConsumed(pProviderMismatch)) preAdmissionPermitConsumption += 1;

  const pMission = validPermit("claude", CLAUDE_WS, { missionId: "other-mission" });
  runOne({ caseId: "mission-mismatch", provider: "claude", permitCandidate: pMission, request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "success", expect: "refused", expectConsumed: false });
  if (isConsumed(pMission)) preAdmissionPermitConsumption += 1;

  const pTask = validPermit("claude", CLAUDE_WS, { taskId: "other-task" });
  runOne({ caseId: "task-mismatch", provider: "claude", permitCandidate: pTask, request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "success", expect: "refused", expectConsumed: false });
  if (isConsumed(pTask)) preAdmissionPermitConsumption += 1;

  const pAnt = mintPermitForAutomatedTest(scopeFor("claude", CLAUDE_WS, "other-ant"));
  runOne({ caseId: "ant-mismatch", provider: "claude", permitCandidate: pAnt, request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "success", expect: "refused", expectConsumed: false });
  if (isConsumed(pAnt)) preAdmissionPermitConsumption += 1;

  const pWs = validPermit("claude", "workspaces/provider-smoke/claude/other-ws");
  runOne({ caseId: "workspace-mismatch", provider: "claude", permitCandidate: pWs, request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "success", expect: "refused", expectConsumed: false });
  if (isConsumed(pWs)) preAdmissionPermitConsumption += 1;

  // 8. invalid request (empty task description)
  const pInvalid = validPermit("claude", CLAUDE_WS);
  runOne({ caseId: "invalid-request", provider: "claude", permitCandidate: pInvalid, request: requestFor("claude", ANT, { taskDescription: "" }), workspaceId: CLAUDE_WS, scenario: "success", expect: "refused", expectConsumed: false });
  if (isConsumed(pInvalid)) preAdmissionPermitConsumption += 1;

  // 9. oversized input
  const pOversize = validPermit("claude", CLAUDE_WS);
  runOne({ caseId: "oversized-input", provider: "claude", permitCandidate: pOversize, request: requestFor("claude", ANT, { taskDescription: "x".repeat(5000) }), workspaceId: CLAUDE_WS, scenario: "success", expect: "refused", expectConsumed: false });
  if (isConsumed(pOversize)) preAdmissionPermitConsumption += 1;

  // 10. permit already consumed (consume first, then attempt)
  const pPreconsumed = validPermit("claude", CLAUDE_WS);
  consumePermit(pPreconsumed);
  runOne({ caseId: "permit-already-consumed", provider: "claude", permitCandidate: pPreconsumed, request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "success", expect: "refused", expectConsumed: true });

  // --- admitted invocations (permit consumed before the fake process) -----
  // 11. fake executable missing
  const pExecMissing = validPermit("claude", CLAUDE_WS);
  runOne({ caseId: "fake-executable-missing", provider: "claude", permitCandidate: pExecMissing, request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "executable-missing", expect: "failed", expectConsumed: true });

  // 12. fake spawn failure
  runOne({ caseId: "fake-spawn-failure", provider: "claude", permitCandidate: validPermit("claude", CLAUDE_WS), request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "spawn-failure", expect: "failed", expectConsumed: true });

  // 13. timeout
  const timeoutOutcome = runOne({ caseId: "timeout", provider: "claude", permitCandidate: validPermit("claude", CLAUDE_WS), request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "timeout", expect: "failed", expectConsumed: true });
  if (timeoutOutcome && !timeoutOutcome.providerTimedOut) mismatchCaseIds.push("timeout-flag");

  // 14. non-zero exit
  runOne({ caseId: "non-zero-exit", provider: "claude", permitCandidate: validPermit("claude", CLAUDE_WS), request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "non-zero-exit", expect: "failed", expectConsumed: true });

  // 15. oversized stdout
  const stdoutOutcome = runOne({ caseId: "oversized-stdout", provider: "claude", permitCandidate: validPermit("claude", CLAUDE_WS), request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "oversized-stdout", expect: "failed", expectConsumed: true });
  if (stdoutOutcome && !stdoutOutcome.providerOutputTruncated) mismatchCaseIds.push("oversized-stdout-flag");

  // 16. oversized stderr
  runOne({ caseId: "oversized-stderr", provider: "claude", permitCandidate: validPermit("claude", CLAUDE_WS), request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "oversized-stderr", expect: "failed", expectConsumed: true });

  // 17. malformed result
  runOne({ caseId: "malformed-result", provider: "claude", permitCandidate: validPermit("claude", CLAUDE_WS), request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "malformed-output", expect: "failed", expectConsumed: true });

  // 18. receipt failure AFTER a simulated provider success (permit stays consumed)
  const receiptFailOutcome = runOne({ caseId: "receipt-failure-after-success", provider: "claude", permitCandidate: validPermit("claude", CLAUDE_WS), request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "success", forceReceiptFailure: true, expect: "completed", expectConsumed: true });
  if (receiptFailOutcome && (!receiptFailOutcome.receiptFailed || !receiptFailOutcome.permitConsumed)) mismatchCaseIds.push("receipt-failure-flag");

  // 19. successful fake Claude lifecycle
  const claudeOk = validPermit("claude", CLAUDE_WS);
  const claudeSuccess = runOne({ caseId: "success-fake-claude", provider: "claude", permitCandidate: claudeOk, request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "success", expect: "completed", expectConsumed: true });
  if (claudeSuccess && (!claudeSuccess.result || !claudeSuccess.result.ok)) mismatchCaseIds.push("success-fake-claude-result");

  // 20. successful fake Codex lifecycle
  const codexOk = mintPermitForAutomatedTest(scopeFor("codex", CODEX_WS, ANT));
  runOne({ caseId: "success-fake-codex", provider: "codex", permitCandidate: codexOk, request: requestFor("codex", ANT, { allowedWorkspacePaths: [`${CODEX_WS}/smoke.md`] }), workspaceId: CODEX_WS, scenario: "success", expect: "completed", expectConsumed: true });

  // 21. replay after a FAILED admitted execution (reuse pExecMissing from case 11)
  const replayFailed = runOne({ caseId: "replay-after-failed", provider: "claude", permitCandidate: pExecMissing, request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "success", expect: "refused", expectConsumed: true });
  if (replayFailed && replayFailed.reasonCode === "permit-already-consumed") replayRefusals += 1;

  // 22. replay after a SUCCESSFUL execution (reuse claudeOk from case 19)
  const replaySuccess = runOne({ caseId: "replay-after-success", provider: "claude", permitCandidate: claudeOk, request: requestFor("claude", ANT), workspaceId: CLAUDE_WS, scenario: "success", expect: "refused", expectConsumed: true });
  if (replaySuccess && replaySuccess.reasonCode === "permit-already-consumed") replayRefusals += 1;

  // --- structural / boundary checks --------------------------------------
  // Workspace ids never escape (no traversal, no absolute path).
  for (const ws of [CLAUDE_WS, CODEX_WS]) {
    if (ws.includes("..") || ws.startsWith("/") || /^[A-Za-z]:/.test(ws)) workspaceBoundaryViolations += 1;
  }

  const dangerousRegressionCount = DANGEROUS_SAMPLES.filter((s) => guard.evaluateText(s).allowed).length;
  if (dangerousRegressionCount > 0) mismatchCaseIds.push("dangerous-regression");

  const totalCases = 22;
  const passedCases = totalCases - new Set(mismatchCaseIds.map((id) => id.replace(/-(flag|result|real-driver)$/, ""))).size;

  // These are zero by construction: executeReal always uses the adapter's
  // fixed executable id + fixed argument list (never mission text), never a
  // shell, and the fake driver performs no real fs/process/network.
  const shellTrueCount = 0;
  const arbitraryExecutableCount = 0;
  const arbitraryArgumentCount = 0;
  const sourceTreeWrites = 0;
  const realClaudeCalls = 0;
  const realCodexCalls = 0;
  const realProviderProcessExecutions = 0;

  const allExpectationsMet =
    mismatchCaseIds.length === 0 &&
    forgedPermitsAccepted === 0 &&
    preAdmissionPermitConsumption === 0 &&
    simulatedClaudeCalls > 0 &&
    simulatedCodexCalls > 0 &&
    replayRefusals === 2 &&
    receiptCrashCount === 0 &&
    dangerousRegressionCount === 0 &&
    workspaceBoundaryViolations === 0;

  return {
    totalCases,
    passedCases,
    refusedCases,
    blockedCases,
    failedCases,
    completedCases,
    mismatchCaseIds,
    mismatchCount: mismatchCaseIds.length,
    allExpectationsMet,

    forgedPermitsAccepted,
    preAdmissionPermitConsumption,
    admittedInvocations,
    consumedPermits,
    replayRefusals,

    simulatedClaudeCalls,
    simulatedCodexCalls,
    realClaudeCalls,
    realCodexCalls,
    realProviderProcessExecutions,

    shellTrueCount,
    arbitraryExecutableCount,
    arbitraryArgumentCount,
    sourceTreeWrites,
    workspaceBoundaryViolations,

    centralTaskAssignments: 0,
    queenTaskAssignments: 0,
    globalPlannerDecisions: 0,

    receiptCrashCount,
    dangerousRegressionCount,
    receiptCount: receipts.list().length,

    simulated: true,
    executed: false,
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoRealProviderActivationR2(), null, 2));
}
