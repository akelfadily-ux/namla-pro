/**
 * civilizationLiveCli — the HUMAN-ONLY control surface that actually RUNS a live
 * civilization mission (Build Law §28). It never runs during automated
 * verification. It requires an interactive TTY, displays the exact plan (Tamara
 * objective, 15+ voluntary claimants, accepted 1-5 cohort, districts, councils,
 * provider assignments, allowed MCP tools, workspace, all limits, and the exact
 * verification commands), and requires the exact typed phrase. `--dry-run`
 * performs all validation with ZERO real action (no provider, no MCP, no file,
 * no permit consumed). Each interactive prompt uses `askOnce`, so `process.stdin`
 * is never held open across execution (no pre-spawn hang).
 *
 * After the exact phrase, the CLI mints one `CivilizationLivePermit` + one scoped
 * single-use provider permit per accepted ant, creates the isolated real workspace
 * under `workspaces/namla-civilization/<run-id>/`, and runs the bounded live
 * session through `runCivilizationLiveSession`: real provider cognition via
 * `RealLiveProviderDriver` → `NodeProviderProcessDriver`, real MCP tool execution
 * via `RealMcpExecutionDriver`, reviewed-file application, and allowlisted
 * verification via `RealBackedVerificationDriver`. If verification fails it asks
 * for a SEPARATE fresh phrase before ONE bounded repair provider call. It stops
 * after the run — no automatic retry, no background continuation.
 *
 * Imports no fs, no child_process, and no network directly. The one real spawn
 * lives in `NodeProviderProcessDriver` (the single child_process importer); the
 * real writes in `smokeWorkspace` (an authorized fs-mutation module).
 */

import { askOnce, logStage, PRE_SPAWN_PREPARATION_TIMEOUT_MS } from "./liveObjectiveCliHelpers";
import { admitCivilizationCohort, buildSettlementWorkers, runCivilizationLiveSession } from "../civilization/civilizationLiveRunner";
import { MIN_VOLUNTARY_LIVE_CLAIMS, selectRepairMember } from "../civilization/civLiveCohort";
import { buildCivLiveReport } from "../civilization/civilizationLiveReport";
import { RealMcpExecutionDriver } from "../civilization/civLiveMcp";
import { DISTRICTS } from "../civilization/settlementTypes";
import { acquireHumanConfirmation, mintHumanConfirmedPermit, mintHumanConfirmedPermitBatch } from "../cognitive/realProviderExecutionPermit";
import type { PermitScope, RealProviderExecutionPermit, RealProviderId } from "../cognitive/realProviderExecutionPermit";
import { mintHumanCivilizationPermit, CIV_MAX_COHORT, CIV_MAX_PROVIDER_CALLS, CIV_MAX_REPAIR_CALLS } from "../cognitive/civilizationLivePermit";
import { RealLiveProviderDriver } from "../cognitive/liveProviderExecution";
import { RealLiveWorkspaceDriver, RealBackedVerificationDriver } from "../cognitive/liveRealDrivers";
import { resolve as resolvePath } from "path";
import { composeVerificationSandbox } from "../cognitive/verificationSandbox";
import { NodeProviderProcessDriver, detectProviderAvailability } from "../cognitive/nodeProviderProcessDriver";
import { ensureCivilizationWorkspace, inspectCivilizationWorkspace } from "../cognitive/smokeWorkspace";
import type { VerificationCommandId } from "../cognitive/nodeProviderProcessDriver";
import { initializeEnvironmentSecretRegistry } from "../cognitive/environmentSecretBootstrap";

const OBJECTIVE_ID = "civ-projman";
const REPAIR_PHRASE = "RUN ONE CIVILIZATION REPAIR ANT";
const ALLOWED_MCP_TOOLS = ["repo-inspection", "bounded-file-read", "code-search", "project-analysis", "typecheck", "tests", "documentation", "knowledge-retrieval", "workspace-file-create", "build"];
const VERIFICATION_COMMAND_IDS: readonly VerificationCommandId[] = ["typecheck", "test", "build"];
const VERIFICATION_COMMANDS = ["npx.cmd tsc --noEmit", "npm.cmd test", "npm.cmd run build"];
const ACTIVE_COUNCILS = ["architecture", "security", "quality", "tool-permission", "knowledge-validation", "incident (on failure)"];
const ACCEPTANCE_CRITERIA = ["projects + tasks CRUD, status, priorities, listing", "in-memory repository", "unit tests present and passing", "README + architecture docs", "security review", "typecheck/build evidence"];
const LIMITS = { maxStdinBytes: 8000, maxStdoutBytes: 20000, maxStderrBytes: 4000, timeoutMs: 60000, perFileByteCap: 20000, workspaceFileCap: 32, totalWorkspaceByteCap: 200000, maxMcpCalls: 50, maxVerificationCalls: 10, tokenBudget: 400, computeBudget: 300, monetaryBudget: 100 };

function parseProviders(argv: readonly string[]): RealProviderId[] {
  const idx = argv.indexOf("--providers");
  const raw = idx >= 0 && argv[idx + 1] ? argv[idx + 1].split(",") : ["codex", "codex", "claude"];
  return raw.map((p) => (p === "codex" ? "codex" : "claude"));
}
function parseCohort(argv: readonly string[], providers: number): number {
  const idx = argv.indexOf("--cohort");
  const n = idx >= 0 && argv[idx + 1] ? parseInt(argv[idx + 1], 10) : providers;
  return Math.min(Math.max(1, Number.isFinite(n) ? n : providers), CIV_MAX_COHORT);
}

/**
 * Fixed, bounded prompt template per (mapped) role. The fixed objective spec is
 * delivered inside the prompt — NEVER as a CLI argument, and never turned into a
 * command. `RealLiveProviderDriver` delivers this on stdin (Claude) or as the
 * single final positional argument (Codex) with `shell:false`.
 */
function promptForRole(role: string): string {
  const spec = "Build a small TypeScript project-management app: projects + tasks CRUD, status, priorities, listing, in-memory repository, unit tests, README + architecture docs (no npm install, no network, no shell commands).";
  const ask =
    role === "architecture"
      ? "Return JSON {summary, assumptions, files:[{path,operation,content}], risks, tests, confidence} with the architecture, data model, file plan, acceptance-criteria mapping, risks, and test strategy. Do NOT request commands."
      : role === "review"
        ? "Return JSON {summary, files, risks, tests, confidence} with review findings, missing requirements, security risks, and test cases. Do NOT request commands."
        : "Return JSON {summary, files:[{path,operation,content}], risks, tests, confidence} with bounded structured file proposals (exact relative paths + exact content). Do NOT request commands.";
  return `${spec}\nROLE: ${role}\n${ask}`.slice(0, LIMITS.maxStdinBytes);
}

async function main(): Promise<void> {
  // §34: populate the environment-secret registry BEFORE any provider
  // runtime is constructed, any request assembled, or any receipt written.
  // One central bootstrap; this CLI never reads process.env for credentials.
  initializeEnvironmentSecretRegistry();
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const providers = parseProviders(argv).filter((p): p is "claude" | "codex" => p === "claude" || p === "codex");
  const cohortSize = parseCohort(argv, providers.length);

  const seed = 20260905;
  const workers = buildSettlementWorkers(seed, 299);
  const admission = admitCivilizationCohort(workers, providers, cohortSize, seed);
  if (admission.voluntaryLiveClaims < MIN_VOLUNTARY_LIVE_CLAIMS) {
    console.log(JSON.stringify({ status: "refused", reasonCode: "insufficient-volunteers", voluntaryLiveClaims: admission.voluntaryLiveClaims }));
    process.exit(0);
    return;
  }
  // A software-building cohort must COVER architecture + implementation +
  // independent review (the first real run had no build-capable ant and produced
  // zero artifacts). Coverage is a validity constraint on voluntary admission —
  // refused BEFORE any confirmation or permit.
  if (admission.capabilityGap || admission.accepted.length === 0) {
    console.log(JSON.stringify({ status: "refused", reasonCode: "cohort-capability-gap", missingCapabilities: admission.missingCapabilities, voluntaryLiveClaims: admission.voluntaryLiveClaims, note: "The voluntary claim pool cannot cover architecture + implementation + independent review. Recruit/train more volunteers or raise the cohort size." }));
    process.exit(0);
    return;
  }
  const accepted = admission.accepted;
  const runId = `run-${OBJECTIVE_ID}`;
  const workspaceId = `workspaces/namla-civilization/${runId}`;
  const REQUIRED_PHRASE = `RUN NAMLA CIVILIZATION WITH ${accepted.length} ANTS`;

  // Display the exact plan.
  console.log("=== NAMLA CIVILIZATION — LIVE MISSION AUTHORIZATION ===");
  console.log(`Tamara national objective: ${OBJECTIVE_ID} — small TypeScript project manager`);
  for (const c of ACCEPTANCE_CRITERIA) console.log(`  criterion: ${c}`);
  console.log(`voluntary live claim pool: ${admission.voluntaryLiveClaims} ants`);
  console.log(`accepted cohort (1-${CIV_MAX_COHORT}), voluntary only:`);
  accepted.forEach((a) => console.log(`  - ${a.antId} @ ${a.districtId} -> ${a.provider} (role ${a.role})`));
  console.log(`districts (${DISTRICTS.length}): ${DISTRICTS.join(", ")}`);
  console.log(`councils: ${ACTIVE_COUNCILS.join(", ")}`);
  console.log(`allowed MCP tools: ${ALLOWED_MCP_TOOLS.join(", ")}`);
  console.log(`workspace (isolated, no source-tree writes): ${workspaceId}`);
  console.log(`limits: files<=${LIMITS.workspaceFileCap}, per-file<=${LIMITS.perFileByteCap}B, stdout<=${LIMITS.maxStdoutBytes}B, MCP<=${LIMITS.maxMcpCalls}, verification<=${LIMITS.maxVerificationCalls}, timeout ${LIMITS.timeoutMs}ms`);
  console.log(`budgets: token=${LIMITS.tokenBudget}, compute=${LIMITS.computeBudget}, monetary=${LIMITS.monetaryBudget}`);
  console.log(`provider-call caps: ${CIV_MAX_PROVIDER_CALLS} total (${accepted.length} initial + up to ${CIV_MAX_REPAIR_CALLS} separately-confirmed repair)`);
  console.log(`verification commands (allowlisted, shell:false): ${VERIFICATION_COMMANDS.join(" | ")}`);

  // Read-only pre-run workspace inspection (no creation, no writes, no deletes).
  const ws = inspectCivilizationWorkspace(workspaceId);
  console.log(`workspace preflight: path=${ws.resolvedPath ?? "n/a"} insideRoot=${ws.insideAllowedRoot} exists=${ws.exists} new=${ws.isNew} files=${ws.fileCount} bytes=${ws.byteCount} stale=${ws.staleOutput}`);

  if (dryRun) {
    console.log(JSON.stringify({ status: "dry-run-complete", note: "All validation done. No provider, no MCP tool, no real file, no live permit consumed.", runId, objectiveId: OBJECTIVE_ID, cohort: accepted, allowedMcpTools: ALLOWED_MCP_TOOLS, workspace: workspaceId, workspaceInspection: { resolvedPath: ws.resolvedPath, insideAllowedRoot: ws.insideAllowedRoot, exists: ws.exists, isNew: ws.isNew, fileCount: ws.fileCount, byteCount: ws.byteCount, staleOutput: ws.staleOutput }, verificationCommands: VERIFICATION_COMMANDS }));
    process.exit(0);
    return;
  }

  // --- real path: TTY-only + exact confirmation ---------------------------
  if (!process.stdin.isTTY) {
    console.log(JSON.stringify({ status: "refused", reasonCode: "not-interactive-tty", note: "The real run requires an interactive terminal. Use --dry-run to preview without a TTY." }));
    process.exit(0);
    return;
  }

  // Safe local provider-availability pre-flight (unpaid `--version`, not a
  // provider request). Non-fatal: it warns the human before they commit, but PATH
  // resolution at spawn time remains the real gate.
  const availability = [...new Set(providers)].map((p) => detectProviderAvailability(p));
  availability.forEach((a) => console.log(`provider availability: ${a.provider} -> ${a.available ? `available (${a.version || "version unknown"})` : `NOT DETECTED (${a.failureCategory})`}`));
  if (availability.some((a) => !a.available)) {
    console.log("warning: one or more providers were not detected on PATH; the run will fail fast at spawn if they are truly missing.");
  }

  // Never overwrite an earlier live run silently: if the run workspace already
  // holds prior-run output, STOP and ask the human to archive or rename it. We do
  // NOT delete or overwrite anything, and we refuse BEFORE any confirmation/permit.
  if (ws.staleOutput) {
    logStage("civilization-live-run-complete", { status: "refused", reason: "stale-workspace-output" });
    console.log(JSON.stringify({ status: "refused", reasonCode: "stale-workspace-output", note: `The live workspace ${ws.resolvedPath} already contains ${ws.fileCount} file(s) from an earlier run. Archive or rename that directory before starting a new run — nothing was deleted or overwritten.`, workspace: workspaceId, fileCount: ws.fileCount, byteCount: ws.byteCount }));
    process.exit(0);
    return;
  }

  console.log(`\nType EXACTLY to authorize (anything else aborts):\n  ${REQUIRED_PHRASE}`);
  // Short-lived readline: CLOSED the instant the answer is read, so no stdin
  // handle is held open across the synchronous provider-execution phase.
  const typed = await askOnce("> ");
  const confirmation = acquireHumanConfirmation({ typedPhrase: typed, requiredPhrase: REQUIRED_PHRASE, isInteractiveTty: Boolean(process.stdin.isTTY), argvConfirmationFlagPresent: argv.includes("-y") || argv.includes("--yes"), stdinWasPiped: false });
  if (!confirmation.ok) {
    console.log(JSON.stringify({ status: "aborted", reasonCode: confirmation.reasonCode }));
    process.exit(0);
    return;
  }
  logStage("confirmation-accepted");

  // Watchdog over the pre-spawn preparation window: if the run has not reached
  // provider execution in time (e.g. an unresolved promise stalls prep), fail
  // loudly instead of hanging forever.
  let spawnReached = false;
  const watchdog = setTimeout(() => {
    if (!spawnReached) {
      logStage("pre-spawn-preparation-timeout");
      process.exit(1);
    }
  }, PRE_SPAWN_PREPARATION_TIMEOUT_MS);
  const abort = (reasonCode: string): void => {
    clearTimeout(watchdog);
    logStage("civilization-live-run-complete", { status: "aborted", reason: reasonCode });
    console.log(JSON.stringify({ status: "aborted", reasonCode, note: "Terminated before the live run. No provider call, no MCP tool, no background continuation." }));
    process.exit(0);
  };

  // One civilization permit (the human confirmation is NOT consumed by this mint).
  const permit = mintHumanCivilizationPermit(
    { civilizationRunId: runId, objectiveId: OBJECTIVE_ID, workspaceId, allowedProviders: providers, allowedMcpToolIds: ALLOWED_MCP_TOOLS, cohort: accepted, maxCohortSize: CIV_MAX_COHORT, maxProviderCalls: CIV_MAX_PROVIDER_CALLS, maxRepairCalls: CIV_MAX_REPAIR_CALLS, maxAggregateInputBytes: LIMITS.totalWorkspaceByteCap, maxAggregateOutputBytes: LIMITS.totalWorkspaceByteCap, maxMcpCalls: LIMITS.maxMcpCalls, maxVerificationCalls: LIMITS.maxVerificationCalls, tokenBudget: LIMITS.tokenBudget, computeBudget: LIMITS.computeBudget, monetaryBudget: LIMITS.monetaryBudget, perCallTimeoutMs: LIMITS.timeoutMs, workspaceFileCap: LIMITS.workspaceFileCap, perFileByteCap: LIMITS.perFileByteCap, totalWorkspaceByteCap: LIMITS.totalWorkspaceByteCap },
    confirmation.confirmation
  );
  if (!permit) return abort("permit-mint-failed");
  logStage("civilization-permit-created", { runId, cohortSize: accepted.length });

  // One scoped, single-use provider permit per accepted ant (consumes the confirmation).
  const memberScope = (provider: RealProviderId, antId: string, role: string): PermitScope => ({ provider, missionId: OBJECTIVE_ID, taskId: `${OBJECTIVE_ID}-${role}`, antId, workspaceId, maxInputBytes: LIMITS.maxStdinBytes, maxOutputBytes: LIMITS.maxStdoutBytes, timeoutMs: LIMITS.timeoutMs });
  const memberPermits = mintHumanConfirmedPermitBatch(accepted.map((a) => memberScope(a.provider, a.antId, a.role)), confirmation.confirmation);
  if (!memberPermits) return abort("cohort-permit-mint-failed");
  const permitByAnt = new Map<string, RealProviderExecutionPermit>(accepted.map((a, i) => [a.antId, memberPermits[i]]));
  logStage("cohort-permits-created", { count: memberPermits.length });

  // The isolated real workspace, under workspaces/namla-civilization/<run-id>/ only.
  const workspace = new RealLiveWorkspaceDriver(runId, LIMITS.perFileByteCap, LIMITS.workspaceFileCap, "workspaces/namla-civilization", ensureCivilizationWorkspace);
  if (!workspace.ready || !workspace.absolutePath) return abort("workspace-create-failed");
  logStage("workspace-ready", { workspaceId });

  // Real drivers: provider cognition, MCP execution, verification.
  // §35: the trusted composition root — and only it — decides the sandbox.
  //  means isolation cannot be PROVEN in this
  // configuration, so no executor is produced and verification fails closed.
  // Nothing here fakes availability to make live verification work.
  const verificationSandbox = composeVerificationSandbox({ workspaceHostPath: workspace.absolutePath, authorizedMountRoots: [resolvePath(process.cwd(), "workspaces")], probeWorkspaceHostPath: null });
  const providerDriver = new RealLiveProviderDriver({ processDriver: new NodeProviderProcessDriver(), permitByAnt, missionId: OBJECTIVE_ID, workspaceId, workspaceAbsolutePath: workspace.absolutePath, maxStdinBytes: LIMITS.maxStdinBytes, maxStdoutBytes: LIMITS.maxStdoutBytes, maxStderrBytes: LIMITS.maxStderrBytes, timeoutMs: LIMITS.timeoutMs, promptForRole });
  const mcpExecutor = new RealMcpExecutionDriver({ handle: { workspaceId: workspace.workspaceRoot, absolutePath: workspace.absolutePath }, perFileByteCap: LIMITS.perFileByteCap, timeoutMs: LIMITS.timeoutMs, maxOutputBytes: LIMITS.maxStdoutBytes, contentForTask: () => null, humanAuthorized: true, sandbox: verificationSandbox });
  const verificationDriver = new RealBackedVerificationDriver(workspace.absolutePath, VERIFICATION_COMMAND_IDS, LIMITS.timeoutMs, LIMITS.maxStdoutBytes, true, verificationSandbox);
  const reviewerAntIds = workers.filter((w) => !accepted.some((a) => a.antId === w.workerId) && (w.maturation === "senior" || w.maturation === "qualified")).slice(0, 6).map((w) => w.workerId);

  // The repair ant the finalize phase will use — the SHARED implementation/
  // debugging-capable selection (never a security-only ant), so the minted repair
  // permit always lines up with the runner's choice.
  const repairAnt = selectRepairMember(accepted);

  // Pre-spawn preparation complete — release the watchdog before the run.
  spawnReached = true;
  clearTimeout(watchdog);

  // A SEPARATE fresh confirmation for ONE bounded repair provider call. It also
  // mints a fresh single-use provider permit for the repair ant (the initial one
  // is already consumed), so the repair call can run.
  const confirmRepair = async (): Promise<boolean> => {
    if (!repairAnt) {
      logStage("repair-declined", { reasonCode: "no-build-capable-repair-ant" });
      return false;
    }
    console.log(`\nVerification failed (or no artifacts were produced). To authorize ONE repair provider call by ${repairAnt.antId} (${repairAnt.role}), type EXACTLY:\n  ${REPAIR_PHRASE}`);
    const typedRepair = await askOnce("> ");
    const rconf = acquireHumanConfirmation({ typedPhrase: typedRepair, requiredPhrase: REPAIR_PHRASE, isInteractiveTty: Boolean(process.stdin.isTTY), argvConfirmationFlagPresent: false, stdinWasPiped: false });
    if (!rconf.ok) {
      logStage("repair-declined", { reasonCode: rconf.reasonCode });
      return false;
    }
    const repairPermit = mintHumanConfirmedPermit(memberScope(repairAnt.provider, repairAnt.antId, "repair"), rconf.confirmation);
    if (!repairPermit) {
      logStage("repair-declined", { reasonCode: "repair-permit-mint-failed" });
      return false;
    }
    permitByAnt.set(repairAnt.antId, repairPermit);
    return true;
  };

  // config.objectiveId is the run id: the workspace directory (workspaces/
  // namla-civilization/<run-id>/) and the applyArtifact attribution must agree.
  // The whole run is wrapped so a final report (or a redacted failure summary) is
  // ALWAYS produced, even if the session throws — never a silent crash.
  try {
    const result = await runCivilizationLiveSession(
      { config: { seed, persistentIdentities: workers.length + 1, objectiveId: runId, cohortSize: accepted.length }, permit, admission, workers, providerDriver, mcpExecutor, workspace, verificationDriver, reviewerAntIds, approveRepair: false, defectPresent: false },
      { log: logStage, confirmRepair }
    );

    const report = buildCivLiveReport(result, permit);
    const m = result.metrics;
    console.log(
      JSON.stringify({
        status: report.commandCenter.runStatus,
        runId,
        objectiveId: OBJECTIVE_ID,
        population: workers.length + 1,
        voluntaryLiveClaims: m.voluntaryLiveClaims,
        cohort: accepted.map((a) => ({ antId: a.antId, provider: a.provider, role: a.role })),
        providerCalls: m.providerCalls,
        providerFailures: m.providerFailures,
        mcpToolGrants: m.mcpToolGrants,
        mcpToolCalls: m.mcpToolCalls,
        mcpToolFailures: m.mcpToolFailures,
        councilsActivated: m.councilsActivated,
        minorityReports: m.minorityReports,
        artifactsCreated: m.artifactsCreated,
        independentReviews: m.independentReviews,
        verificationRuns: m.verificationRuns,
        verificationFailures: m.verificationFailures,
        incidentsCreated: m.incidentsCreated,
        repairsCompleted: m.repairsCompleted,
        repairCalls: m.repairCalls,
        technicalDebtTracked: m.technicalDebtTracked,
        wasteRecycled: m.wasteRecycled,
        knowledgeAccepted: m.knowledgeAccepted,
        academyEvidenceUpdates: m.academyEvidenceUpdates,
        providerHealthUpdates: m.providerHealthUpdates,
        mcpHealthUpdates: m.mcpHealthUpdates,
        workspace: workspaceId,
        workspaceFiles: result.workspaceFileCount,
        finalObjectivePassed: m.finalObjectivePassed,
        realProviderProcessExecutions: providerDriver.realProviderProcessExecutions,
        realClaudeCalls: providerDriver.realClaudeCalls,
        realCodexCalls: providerDriver.realCodexCalls,
        realMcpExecutions: m.realMcpExecutions,
        realFilesystemWrites: m.realFilesystemWrites,
        realVerificationRuns: mcpExecutor.realVerificationRuns,
        safetyViolations: report.safetyViolations,
        safetyViolationCodes: report.safetyViolationCodes,
        safetyViolationStages: report.safetyViolationStages,
        safetyViolationCategories: report.safetyViolationCategories,
        providerFailureCategories: result.failureCategories,
        architectureCoverage: m.architectureCoverage,
        implementationCoverage: m.implementationCoverage,
        independentReviewCoverage: m.independentReviewCoverage,
        failureCategory: m.finalObjectivePassed ? "none" : report.commandCenter.runStatus === "aborted" ? "aborted" : "objective-not-passed",
        repairPhrase: REPAIR_PHRASE,
        note: "Stopped: completion, bounded failure, or the eight-call cap. No automatic retry, no background continuation.",
      })
    );
    process.exit(0);
  } catch (error) {
    // Redacted failure summary — error NAME only, never a message, stack, prompt,
    // or raw output. The consumed permit cannot be reused.
    logStage("civilization-live-run-complete", { status: "error", failureCategory: error instanceof Error ? error.name : "unknown" });
    console.log(JSON.stringify({ status: "error", runId, objectiveId: OBJECTIVE_ID, workspace: workspaceId, failureCategory: error instanceof Error ? error.name : "unknown", note: "The live run terminated abnormally. No automatic retry, no background continuation. The consumed permit cannot be reused." }));
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
