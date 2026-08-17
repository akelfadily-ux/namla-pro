/**
 * twinEmpireLiveCli — the HUMAN-ONLY control surface for a live NAMOLA TWIN EMPIRE
 * run. This milestone ships the DRY-RUN and the confirmation/permit seam only; the
 * real execution path is intentionally NOT enabled here. `--dry-run` displays the
 * full plan (objective, both colony cohorts + coverage, provider assignments +
 * availability, workspace roots, isolation policy, all limits, verification
 * commands, and the exact confirmation + repair phrases) while performing ZERO
 * real action: no provider, no MCP, no file, no process, no permit, no directory.
 *
 * The real path is TTY-only and requires the exact phrase `RUN NAMOLA TWIN EMPIRE`;
 * it mints the empire + colony permits and STOPS (no real provider/MCP/workspace
 * execution in this milestone). Each repair would require the separate phrase
 * `RUN ONE NAMOLA MERGE REPAIR`.
 *
 * Imports no fs, no child_process, and no network directly.
 */

import { askOnce, logStage } from "./liveObjectiveCliHelpers";
import { buildSettlementWorkers } from "../civilization/civilizationLiveRunner";
import { buildTwinEmpireLivePlan, createTwinEmpireLiveSession, TWIN_CONFIRMATION_PHRASE, TWIN_REPAIR_PHRASE } from "../twin/twinEmpireLivePlan";
import { detectProviderAvailability, NodeProviderProcessDriver } from "../cognitive/nodeProviderProcessDriver";
import { acquireHumanConfirmation, mintHumanConfirmedTwinColonyPermits } from "../cognitive/realProviderExecutionPermit";
import type { PermitScope, RealProviderId } from "../cognitive/realProviderExecutionPermit";
import { RealLiveProviderDriver } from "../cognitive/liveProviderExecution";
import { RealLiveWorkspaceDriver } from "../cognitive/liveRealDrivers";
import { ensureTwinColonyWorkspace } from "../cognitive/smokeWorkspace";
import { runTwinEmpireLive, wrapLiveWorkspaceApplier } from "../twin/twinColonyLiveRunner";
import { initializeEnvironmentSecretRegistry } from "../cognitive/environmentSecretBootstrap";

/**
 * Fixed, bounded prompt template per role. The objective spec lives INSIDE the
 * prompt — never as a CLI argument and never turned into a command. Each role
 * receives only its own contract; no competitor data is ever included.
 */
function promptForRole(role: string): string {
  const spec = "Build a small TypeScript task manager: tasks CRUD + completion, in-memory storage, unit tests (no npm install, no network, no shell commands).";
  const ask =
    role === "architecture"
      ? "Return JSON {summary, assumptions, files:[{path,operation,content}], risks, tests, confidence} describing architectureSummary, filePlan, requirementMapping and risks. Return NO file contents and request NO commands."
      : role === "review"
        ? "Return JSON {summary, files, risks, tests, confidence} with reviewedArtifactIds, findings, approvedArtifactIds, rejectedArtifactIds, securityFindings and requiredRepairs. Write NO files and request NO commands."
        : "Return JSON {summary, files:[{path,operation,content}], risks, tests, confidence} where every file has an exact relative path, complete content, purpose and requirementsCovered. Request NO commands.";
  return `${spec}\nROLE: ${role}\n${ask}`;
}

const MISSION_ID = "namola-twin-taskmgr";

function parseProviders(argv: readonly string[]): RealProviderId[] {
  const idx = argv.indexOf("--providers");
  const raw = idx >= 0 && argv[idx + 1] ? argv[idx + 1].split(",") : ["claude", "codex"];
  return raw.map((p) => (p === "codex" ? "codex" : "claude"));
}

async function main(): Promise<void> {
  // §34: populate the environment-secret registry BEFORE any provider
  // runtime is constructed, any request assembled, or any receipt written.
  // One central bootstrap; this CLI never reads process.env for credentials.
  initializeEnvironmentSecretRegistry();
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const providers = [...new Set(parseProviders(argv))];
  const workers = buildSettlementWorkers(20260915, 1000);
  const plan = buildTwinEmpireLivePlan(workers, providers, MISSION_ID);

  console.log("=== NAMOLA TWIN EMPIRE — LIVE MISSION PLAN ===");
  console.log(`customer objective: ${plan.objective}`);
  for (const c of plan.acceptanceCriteria) console.log(`  Namola acceptance: ${c}`);
  console.log(`Claude Forge cohort:`);
  plan.claudeCohort.forEach((m) => console.log(`  - ${m.antId} (${m.role}) -> ${m.provider}`));
  console.log(`Codex Crucible cohort:`);
  plan.codexCohort.forEach((m) => console.log(`  - ${m.antId} (${m.role}) -> ${m.provider}`));
  console.log(`capability coverage: claude arch=${plan.coverage.claude.architecture} impl=${plan.coverage.claude.implementation} review=${plan.coverage.claude.review} complete=${plan.coverage.claude.complete}`);
  console.log(`capability coverage: codex  arch=${plan.coverage.codex.architecture} impl=${plan.coverage.codex.implementation} review=${plan.coverage.codex.review} complete=${plan.coverage.codex.complete}`);
  plan.providerAssignments.forEach((a) => console.log(`provider assignment: ${a.colony} -> ${a.provider}`));
  if (!dryRun) {
    // Availability probe is an unpaid `--version` local check (real path only).
    for (const p of providers) {
      const a = detectProviderAvailability(p);
      console.log(`provider availability: ${p} -> ${a.available ? `available (${a.version || "version unknown"})` : `NOT DETECTED (${a.failureCategory})`}`);
    }
  } else {
    providers.forEach((p) => console.log(`provider availability: ${p} -> (not probed in dry-run)`));
  }
  console.log(`workspace roots: claude=${plan.workspaceRoots.claude} | codex=${plan.workspaceRoots.codex} | witness=${plan.workspaceRoots.silentWitness} | merge=${plan.workspaceRoots.mergeForge} | evidence=${plan.workspaceRoots.finalEvidence}`);
  plan.isolationPolicy.forEach((i) => console.log(`isolation: ${i}`));
  console.log(`provider-call limits: claude<=${plan.limits.maxClaudeConcurrency} codex<=${plan.limits.maxCodexConcurrency} total<=${plan.limits.maxTotalProviderCalls}`);
  console.log(`deep-cognition limit: <=${plan.limits.maxDeepCognitionAnts} ants`);
  console.log(`MCP limit: <=${plan.limits.maxMcpCalls}`);
  console.log(`file/byte limits: files<=${plan.limits.workspaceFileCap}, per-file<=${plan.limits.perFileByteCap}B, stdin<=${plan.limits.maxStdinBytes}B, stdout<=${plan.limits.maxStdoutBytes}B, timeout ${plan.limits.perCallTimeoutMs}ms`);
  console.log(`verification commands (allowlisted, shell:false): ${plan.verificationCommands.join(" | ")}`);
  console.log(`confirmation phrase (real path): ${plan.confirmationPhrase}`);
  console.log(`repair phrase (per repair): ${plan.repairPhrase}`);

  if (dryRun) {
    console.log(JSON.stringify({ status: "dry-run-complete", note: "No provider, no MCP tool, no real file, no process, no permit, no workspace directory created.", missionId: plan.missionId, providers, claudeCohort: plan.claudeCohort, codexCohort: plan.codexCohort, coverage: plan.coverage, workspaceRoots: plan.workspaceRoots, limits: plan.limits, confirmationPhrase: plan.confirmationPhrase, repairPhrase: plan.repairPhrase }));
    process.exit(0);
    return;
  }

  // --- real path: TTY-only + exact confirmation (mints permits, then STOPS) ---
  if (!process.stdin.isTTY) {
    console.log(JSON.stringify({ status: "refused", reasonCode: "not-interactive-tty", note: "The real run requires an interactive terminal. Use --dry-run to preview without a TTY." }));
    process.exit(0);
    return;
  }
  console.log(`\nType EXACTLY to authorize (anything else aborts):\n  ${TWIN_CONFIRMATION_PHRASE}`);
  const typed = await askOnce("> ");
  const confirmation = acquireHumanConfirmation({ typedPhrase: typed, requiredPhrase: TWIN_CONFIRMATION_PHRASE, isInteractiveTty: Boolean(process.stdin.isTTY), argvConfirmationFlagPresent: argv.includes("-y") || argv.includes("--yes"), stdinWasPiped: false });
  if (!confirmation.ok) {
    console.log(JSON.stringify({ status: "aborted", reasonCode: confirmation.reasonCode }));
    process.exit(0);
    return;
  }
  logStage("confirmation-accepted");
  const session = createTwinEmpireLiveSession(plan);
  const auth = session.authorize(confirmation.confirmation);
  if (!auth.ok) {
    console.log(JSON.stringify({ status: "aborted", reasonCode: auth.reasonCode }));
    process.exit(0);
    return;
  }
  logStage("twin-permit-created", { missionId: plan.missionId });
  logStage("colony-permits-created", { claudePermits: auth.claudePermits?.length ?? 0, codexPermits: auth.codexPermits?.length ?? 0 });
  const empirePermit = auth.empirePermit;
  if (!empirePermit) {
    console.log(JSON.stringify({ status: "aborted", reasonCode: "empire-permit-missing" }));
    process.exit(0);
    return;
  }

  // Per-colony execution permits for the REAL provider driver (3 sequential role
  // calls per colony, 6 total), minted from the SAME single human confirmation.
  const scopeFor = (colony: "claude-forge" | "codex-crucible", provider: RealProviderId, antId: string, role: string): PermitScope => ({ provider, missionId: plan.missionId, taskId: `${plan.missionId}-${colony}-${role}`, antId, workspaceId: colony === "claude-forge" ? plan.workspaceRoots.claude : plan.workspaceRoots.codex, maxInputBytes: plan.limits.maxStdinBytes, maxOutputBytes: plan.limits.maxStdoutBytes, timeoutMs: plan.limits.perCallTimeoutMs });
  const claudeProvider = plan.providerAssignments.find((a) => a.colony === "claude-forge")?.provider ?? "claude";
  const codexProvider = plan.providerAssignments.find((a) => a.colony === "codex-crucible")?.provider ?? "codex";
  const execPermits = mintHumanConfirmedTwinColonyPermits(
    plan.claudeCohort.map((m) => scopeFor("claude-forge", claudeProvider, m.antId, m.role)),
    plan.codexCohort.map((m) => scopeFor("codex-crucible", codexProvider, m.antId, m.role)),
    confirmation.confirmation
  );
  if (!execPermits) {
    console.log(JSON.stringify({ status: "aborted", reasonCode: "colony-execution-permit-mint-failed" }));
    process.exit(0);
    return;
  }

  // Isolated REAL workspaces, one per colony (allowlisted twin roots only).
  const claudeWs = new RealLiveWorkspaceDriver(`${plan.missionId}/claude-forge`, plan.limits.perFileByteCap, plan.limits.workspaceFileCap, "workspaces/namola-twin", ensureTwinColonyWorkspace);
  if (!claudeWs.ready || !claudeWs.absolutePath) {
    console.log(JSON.stringify({ status: "aborted", reasonCode: "claude-workspace-create-failed" }));
    process.exit(0);
    return;
  }
  logStage("claude-workspace-ready", { workspaceId: plan.workspaceRoots.claude });
  const codexWs = new RealLiveWorkspaceDriver(`${plan.missionId}/codex-crucible`, plan.limits.perFileByteCap, plan.limits.workspaceFileCap, "workspaces/namola-twin", ensureTwinColonyWorkspace);
  if (!codexWs.ready || !codexWs.absolutePath) {
    console.log(JSON.stringify({ status: "aborted", reasonCode: "codex-workspace-create-failed" }));
    process.exit(0);
    return;
  }
  logStage("codex-workspace-ready", { workspaceId: plan.workspaceRoots.codex });

  // One REAL provider driver per colony — separate process drivers and separate
  // permit maps, so the colonies never share a provider session.
  const claudeDriver = new RealLiveProviderDriver({ processDriver: new NodeProviderProcessDriver(), permitByAnt: new Map(plan.claudeCohort.map((m, i) => [m.antId, execPermits.claude[i]])), missionId: plan.missionId, workspaceId: plan.workspaceRoots.claude, workspaceAbsolutePath: claudeWs.absolutePath, maxStdinBytes: plan.limits.maxStdinBytes, maxStdoutBytes: plan.limits.maxStdoutBytes, maxStderrBytes: 4000, timeoutMs: plan.limits.perCallTimeoutMs, promptForRole });
  const codexDriver = new RealLiveProviderDriver({ processDriver: new NodeProviderProcessDriver(), permitByAnt: new Map(plan.codexCohort.map((m, i) => [m.antId, execPermits.codex[i]])), missionId: plan.missionId, workspaceId: plan.workspaceRoots.codex, workspaceAbsolutePath: codexWs.absolutePath, maxStdinBytes: plan.limits.maxStdinBytes, maxStdoutBytes: plan.limits.maxStdoutBytes, maxStderrBytes: 4000, timeoutMs: plan.limits.perCallTimeoutMs, promptForRole });

  // Sequential per colony; Claude fully completes before Codex begins.
  const run = runTwinEmpireLive({
    claude: { colonyId: "claude-forge", culture: "architecture-first", provider: claudeProvider, missionId: plan.missionId, workspaceId: plan.workspaceRoots.claude, cohort: plan.claudeCohort.map((m) => ({ antId: m.antId, role: m.role })), empirePermit, providerDriver: claudeDriver, applier: wrapLiveWorkspaceApplier(claudeWs, `${plan.missionId}/claude-forge`), acceptance: plan.acceptanceCriteria, log: logStage },
    codex: { colonyId: "codex-crucible", culture: "implementation-first", provider: codexProvider, missionId: plan.missionId, workspaceId: plan.workspaceRoots.codex, cohort: plan.codexCohort.map((m) => ({ antId: m.antId, role: m.role })), empirePermit, providerDriver: codexDriver, applier: wrapLiveWorkspaceApplier(codexWs, `${plan.missionId}/codex-crucible`), acceptance: plan.acceptanceCriteria, log: logStage },
    log: logStage,
  });

  console.log(
    JSON.stringify({
      status: run.status,
      missionId: plan.missionId,
      claude: { providerCalls: run.claude.providerCalls, artifactsApplied: run.claude.artifactsApplied, independentReviews: run.claude.independentReviews, failureReason: run.claude.failureReason, fingerprint: run.claude.bundle?.fingerprint ?? "none", realProviderProcessExecutions: claudeDriver.realProviderProcessExecutions, realClaudeCalls: claudeDriver.realClaudeCalls },
      codex: { providerCalls: run.codex.providerCalls, artifactsApplied: run.codex.artifactsApplied, independentReviews: run.codex.independentReviews, failureReason: run.codex.failureReason, fingerprint: run.codex.bundle?.fingerprint ?? "none", realProviderProcessExecutions: codexDriver.realProviderProcessExecutions, realCodexCalls: codexDriver.realCodexCalls },
      bothFrozen: run.bothFrozen,
      distinctFingerprints: run.distinctFingerprints,
      totalProviderCalls: run.claude.providerCalls + run.codex.providerCalls,
      realFilesystemWrites: claudeWs.realFilesystemWrites + codexWs.realFilesystemWrites,
      repairPhrase: TWIN_REPAIR_PHRASE,
      note: "Stopped after freezing. Cross-examination, Namola court, merge, and delivery are NOT started automatically. No repair call in this milestone. No automatic retry, no background continuation.",
    })
  );
  process.exit(0);
}

if (require.main === module) {
  void main();
}
