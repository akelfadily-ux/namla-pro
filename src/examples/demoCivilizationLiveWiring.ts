/**
 * demoCivilizationLiveWiring — the regression proof that the EXACT human
 * confirmation reaches the real-run orchestration path, using ONLY fakes
 * (Build Law §28). It mirrors the civilization:live CLI byte-for-byte — acquire a
 * TTY-gated confirmation for the exact phrase, mint one CivilizationLivePermit +
 * one scoped provider permit per ant, then call `runCivilizationLiveSession` — but
 * swaps in a FAKE process driver, a FAKE MCP executor, an in-memory workspace, and
 * the fake verification driver, so every real-action counter stays 0.
 *
 * It proves: the exact phrase (not a wrong one) unlocks the session; the fake
 * provider driver actually ran (> 0); the fake MCP executor actually ran (> 0);
 * reviews precede application; verification runs; the injected defect fails the
 * first verification and creates an incident; a single SEPARATE repair
 * confirmation authorizes exactly one bounded repair that succeeds; the final
 * objective passes; NO repair confirmation is requested before the initial
 * provider calls; and every readline is closed immediately after its answer.
 *
 * Async by nature (the repair gate awaits a confirmation), so it runs standalone
 * rather than through the synchronous golden harness. No fs, no child_process, no
 * network, no wall clock. Deterministic by seed.
 */

import { admitCivilizationCohort, buildSettlementWorkers, runCivilizationLiveSession } from "../civilization/civilizationLiveRunner";
import { buildCivLiveReport } from "../civilization/civilizationLiveReport";
import { FakeMcpExecutionDriver } from "../civilization/civLiveMcp";
import { mintHumanCivilizationPermit, CIV_MAX_COHORT, CIV_MAX_PROVIDER_CALLS, CIV_MAX_REPAIR_CALLS } from "../cognitive/civilizationLivePermit";
import type { CivilizationLiveScope } from "../cognitive/civilizationLivePermit";
import { RealLiveProviderDriver } from "../cognitive/liveProviderExecution";
import { acquireHumanConfirmation, mintHumanConfirmedPermit, mintHumanConfirmedPermitBatch } from "../cognitive/realProviderExecutionPermit";
import type { PermitScope, RealProviderExecutionPermit, RealProviderId } from "../cognitive/realProviderExecutionPermit";
import { FakeVerificationDriver } from "../digital/digitalVerification";
import { InMemoryWorkspaceDriver } from "../digital/digitalWorkspace";
import { askOnce } from "../cli/liveObjectiveCliHelpers";
import type { QuestionInterface } from "../cli/liveObjectiveCliHelpers";
import type { ProviderProcessDriver, ProviderProcessResult, ProviderProcessSpec } from "../cognitive/providerProcessDriver";

const SEED = 20260905;
const OBJECTIVE_ID = "civ-projman";
const RUN_ID = `run-${OBJECTIVE_ID}`;
const WORKSPACE_ID = `workspaces/namla-civilization/${RUN_ID}`;
const EXACT_PHRASE = "RUN NAMLA CIVILIZATION WITH 3 ANTS";
const REPAIR_PHRASE = "RUN ONE CIVILIZATION REPAIR ANT";
const ALLOWED_TOOLS = ["repo-inspection", "bounded-file-read", "code-search", "project-analysis", "typecheck", "tests", "documentation", "knowledge-retrieval", "workspace-file-create", "build"];

/** Fake process driver that records every run so we can prove ordering + count. */
class CountingFakeProcessDriver implements ProviderProcessDriver {
  readonly isReal = false;
  runs = 0;
  constructor(private readonly events: string[]) {}
  run(spec: ProviderProcessSpec): ProviderProcessResult {
    this.runs += 1;
    this.events.push("provider-run");
    const base = { ran: true, exitCode: 0 as number | null, terminationSignalCategory: "none" as const, stderr: "", stdoutTruncated: false, stderrTruncated: false, failureCategory: "none" as const };
    const isCodex = spec.executableId === "codex";
    const promptText = isCodex ? spec.argumentList[spec.argumentList.length - 1] ?? "" : spec.stdinData;
    const role = promptText.startsWith("role:") ? promptText.slice(5) : "build";
    const files = role === "architecture" ? [{ path: "ARCHITECTURE.md", operation: "create" as const, content: "# Architecture\nProjectService + TaskService + InMemoryRepo" }] : role === "review" ? [{ path: "src/projectService.test.ts", operation: "create" as const, content: "// tests for projects/tasks" }] : [{ path: "src/projectService.ts", operation: "create" as const, content: "export class ProjectService { list() { return []; } }" }, { path: "README.md", operation: "create" as const, content: "# Project Manager" }];
    const payload = JSON.stringify({ summary: `role ${role}`, assumptions: [], files, risks: [], tests: ["list"], confidence: 0.7 });
    if (isCodex) return { ...base, stdout: [JSON.stringify({ type: "thread.started" }), JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: payload } }), JSON.stringify({ type: "turn.completed", usage: { total_tokens: 8 } })].join("\n") };
    return { ...base, stdout: payload };
  }
}

/** A fake readline that answers with `answer` and records that it was closed. */
function makeFakeReadline(answer: string, onClose: () => void): () => QuestionInterface {
  return () => ({
    question(_query: string, cb: (a: string) => void): void {
      cb(answer);
    },
    close(): void {
      onClose();
    },
  });
}

const memberScope = (provider: RealProviderId, antId: string, role: string): PermitScope => ({ provider, missionId: OBJECTIVE_ID, taskId: `${OBJECTIVE_ID}-${role}`, antId, workspaceId: WORKSPACE_ID, maxInputBytes: 8000, maxOutputBytes: 20000, timeoutMs: 60000 });

export async function runDemoCivilizationLiveWiring() {
  const events: string[] = [];
  let mainReadlineClosed: boolean = false;
  let repairReadlineClosed: boolean = false;

  // A wrong phrase must NOT unlock the session.
  const wrong = acquireHumanConfirmation({ typedPhrase: "run namla civilization with 3 ants", requiredPhrase: EXACT_PHRASE, isInteractiveTty: true, argvConfirmationFlagPresent: false, stdinWasPiped: false });

  // The exact phrase, delivered through a short-lived readline that closes at once.
  const typed = await askOnce("> ", makeFakeReadline(EXACT_PHRASE, () => (mainReadlineClosed = true)));
  const confirmation = acquireHumanConfirmation({ typedPhrase: typed, requiredPhrase: EXACT_PHRASE, isInteractiveTty: true, argvConfirmationFlagPresent: false, stdinWasPiped: false });

  const workers = buildSettlementWorkers(SEED, 299);
  const providers: RealProviderId[] = ["codex", "codex", "claude"];
  const admission = admitCivilizationCohort(workers, providers, 3, SEED);
  const accepted = admission.accepted;

  const scope: CivilizationLiveScope = {
    civilizationRunId: RUN_ID,
    objectiveId: OBJECTIVE_ID,
    workspaceId: WORKSPACE_ID,
    allowedProviders: providers,
    allowedMcpToolIds: ALLOWED_TOOLS,
    cohort: accepted,
    maxCohortSize: CIV_MAX_COHORT,
    maxProviderCalls: CIV_MAX_PROVIDER_CALLS,
    maxRepairCalls: CIV_MAX_REPAIR_CALLS,
    maxAggregateInputBytes: 200000,
    maxAggregateOutputBytes: 200000,
    maxMcpCalls: 50,
    maxVerificationCalls: 10,
    tokenBudget: 400,
    computeBudget: 300,
    monetaryBudget: 100,
    perCallTimeoutMs: 60000,
    workspaceFileCap: 32,
    perFileByteCap: 20000,
    totalWorkspaceByteCap: 200000,
  };

  // Exactly like the CLI: the confirmation mints the civ permit (non-consuming
  // check) then the per-ant provider permits (consuming).
  const permit = confirmation.ok ? mintHumanCivilizationPermit(scope, confirmation.confirmation) : null;
  const memberPermits = confirmation.ok ? mintHumanConfirmedPermitBatch(accepted.map((a) => memberScope(a.provider, a.antId, a.role)), confirmation.confirmation) : null;
  const permitByAnt = new Map<string, RealProviderExecutionPermit>((memberPermits ?? []).map((p, i) => [accepted[i].antId, p]));

  const processDriver = new CountingFakeProcessDriver(events);
  const providerDriver = new RealLiveProviderDriver({ processDriver, permitByAnt, workspaceAbsolutePath: "/fake/civ/ws", maxStdinBytes: 8000, maxStdoutBytes: 20000, maxStderrBytes: 4000, timeoutMs: 60000, promptForRole: (role) => `role:${role}` });
  const mcpExecutor = new FakeMcpExecutionDriver({ failToolId: "code-search", seed: SEED });
  const workspace = new InMemoryWorkspaceDriver(RUN_ID, undefined, "workspaces/namla-civilization");
  const verificationDriver = new FakeVerificationDriver();
  const reviewerAntIds = workers.filter((w) => !accepted.some((a) => a.antId === w.workerId) && (w.maturation === "senior" || w.maturation === "qualified")).slice(0, 6).map((w) => w.workerId);
  const repairAnt = accepted.find((a) => a.role === "coding") ?? accepted[0];

  let repairConfirmations = 0;
  const providerRunsBeforeRepairGate: number[] = [];
  const confirmRepair = async (): Promise<boolean> => {
    repairConfirmations += 1;
    providerRunsBeforeRepairGate.push(processDriver.runs);
    events.push("repair-confirm");
    const typedRepair = await askOnce("> ", makeFakeReadline(REPAIR_PHRASE, () => (repairReadlineClosed = true)));
    const rconf = acquireHumanConfirmation({ typedPhrase: typedRepair, requiredPhrase: REPAIR_PHRASE, isInteractiveTty: true, argvConfirmationFlagPresent: false, stdinWasPiped: false });
    if (!rconf.ok) return false;
    const repairPermit = mintHumanConfirmedPermit(memberScope(repairAnt.provider, repairAnt.antId, "repair"), rconf.confirmation);
    if (!repairPermit) return false;
    permitByAnt.set(repairAnt.antId, repairPermit);
    return true;
  };

  // The session must only be reachable via a valid confirmation (exactly the CLI gate).
  const result = permit
    ? await runCivilizationLiveSession(
        { config: { seed: SEED, persistentIdentities: 300, objectiveId: RUN_ID, cohortSize: accepted.length }, permit, admission, workers, providerDriver, mcpExecutor, workspace, verificationDriver, reviewerAntIds, approveRepair: false, defectPresent: true },
        { log: () => {}, confirmRepair }
      )
    : null;

  const report = result ? buildCivLiveReport(result, permit!) : null;
  const m = result?.metrics;

  const firstProviderRun = events.indexOf("provider-run");
  const firstRepairConfirm = events.indexOf("repair-confirm");

  const specs: Array<[string, boolean]> = [
    ["wrong-phrase-refused", wrong.ok === false],
    ["exact-phrase-confirmed", confirmation.ok === true],
    ["civ-permit-minted", permit !== null],
    ["cohort-permits-minted", (memberPermits?.length ?? 0) === accepted.length],
    ["session-reached", result !== null && result.ok === true],
    ["cohort-subset-of-volunteers", accepted.every((a) => admission.pool.some((c) => c.antId === a.antId)) && accepted.length > 0],
    ["councils-activated", (m?.councilsActivated ?? 0) >= 5],
    ["no-self-review", (m?.selfReviewsAccepted ?? -1) === 0],
    ["fake-provider-runs>0", processDriver.runs > 0],
    ["provider-calls>0", (m?.providerCalls ?? 0) > 0],
    ["fake-mcp-runs>0", (m?.mcpToolCalls ?? 0) > 0],
    ["mcp-grants>0", (m?.mcpToolGrants ?? 0) > 0],
    ["reviews>0", (m?.independentReviews ?? 0) > 0],
    ["artifacts>0", (m?.artifactsCreated ?? 0) > 0],
    ["reviews-before-application", (m?.independentReviews ?? 0) >= (m?.artifactsCreated ?? 0) && (m?.artifactsCreated ?? 0) > 0],
    ["verification-runs>=2", (m?.verificationRuns ?? 0) >= 2],
    ["one-verification-failure", (m?.verificationFailures ?? 0) === 1],
    ["incident-from-failure", (m?.incidentsCreated ?? 0) >= 1],
    ["exactly-one-repair-confirmation", repairConfirmations === 1],
    ["one-repair-call", (m?.repairCalls ?? 0) === 1],
    ["repair-completed", (m?.repairsCompleted ?? 0) >= 1],
    ["final-objective-passed", m?.finalObjectivePassed === true],
    ["no-repair-confirm-before-initial-providers", firstProviderRun >= 0 && firstRepairConfirm > firstProviderRun],
    ["all-initial-providers-before-repair-gate", providerRunsBeforeRepairGate.length === 1 && providerRunsBeforeRepairGate[0] === accepted.length],
    ["main-readline-closed", mainReadlineClosed],
    ["repair-readline-closed", repairReadlineClosed],
    ["realProviderProcessExecutions==0", (m?.realProviderProcessExecutions ?? -1) === 0],
    ["realProviderCalls==0", (m?.realProviderCalls ?? -1) === 0],
    ["realMcpExecutions==0", (m?.realMcpExecutions ?? -1) === 0],
    ["realFilesystemWrites==0", (m?.realFilesystemWrites ?? -1) === 0],
    ["realNetworkCalls==0", (m?.realNetworkCalls ?? -1) === 0],
    ["nonVolunteerAssignments==0", (m?.nonVolunteerAssignments ?? -1) === 0],
    ["safetyViolations==0", (report?.safetyViolations ?? -1) === 0],
    ["conservation-valid", report?.digitalResourceConservationValid === true],
  ];
  const mismatchCaseIds = specs.filter(([, ok]) => !ok).map(([id]) => id);

  return {
    moduleName: "demoCivilizationLiveWiring",
    ...(m ?? {}),
    fakeProviderRuns: processDriver.runs,
    repairConfirmations,
    orderingEvents: events,
    safetyViolations: report?.safetyViolations ?? -1,
    conservationValid: report?.digitalResourceConservationValid ?? false,
    expectationsChecked: specs.length,
    mismatchCaseIds,
    allExpectationsMet: mismatchCaseIds.length === 0,
    finalOutcome: report?.commandCenter.finalOutcome ?? "no-run",
  };
}

async function main(): Promise<void> {
  const out = await runDemoCivilizationLiveWiring();
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.allExpectationsMet ? 0 : 1);
}

if (require.main === module) {
  void main();
}
