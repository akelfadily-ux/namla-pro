/**
 * twinEmpireLiveCli - the HUMAN-ONLY control surface for a live NAMOLA TWIN
 * EMPIRE run.
 *
 * `--dry-run` displays the full plan (objective, both colony cohorts + coverage,
 * provider assignments + availability, workspace roots, isolation policy, all
 * limits, verification commands, and the exact confirmation + repair phrases)
 * while performing ZERO real action: no provider, no MCP, no file, no process,
 * no permit, no directory.
 *
 * THE REAL PATH DOES EXECUTE. It is TTY-only and requires the exact phrase
 * `RUN NAMOLA TWIN EMPIRE`. After that confirmation it mints the empire, colony
 * and repair permits, creates two isolated real workspaces, and runs BOTH
 * colonies through the bounded build/verify/repair loop with real provider
 * processes. An earlier version of this comment said the real execution path
 * was "intentionally NOT enabled here" and that the run STOPS after minting
 * permits; that stopped being true when the real drivers were wired below, and
 * a control surface that understates what it does is the wrong way to be wrong.
 *
 * WHAT STILL DOES NOT HAPPEN AUTOMATICALLY: cross-examination, the Namola
 * court, merge, and delivery. Those remain separate, human-initiated steps.
 *
 * VERIFICATION CANNOT FALL BACK TO THE HOST. The sandbox is composed once here;
 * if isolation cannot be proven the executor is null and every candidate freezes
 * as VERIFICATION_BLOCKED. There is no host execution of a generated package.
 *
 * The mission is supplied with `--objective-file <path>`; the compiled-in
 * objective remains only as the demo default.
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
import { loadMissionObjectiveFile, validateMissionId } from "../cognitive/missionObjectiveFile";
import { composeVerificationSandbox } from "../cognitive/verificationSandbox";
import { RealBackedVerificationDriver } from "../cognitive/liveRealDrivers";
import type { VerificationCommandId } from "../cognitive/nodeProviderProcessDriver";
import { isValidHumanConfirmation } from "../cognitive/realProviderExecutionPermit";
import { TWIN_DEFAULT_MAX_REPAIR_ATTEMPTS, validateMaxRepairAttempts } from "../twin/twinBuildLoop";
import type { TwinRepairSlot, TwinVerificationBackend } from "../twin/twinBuildLoop";
import { resolve as resolvePath } from "path";

/** The three stages every twin candidate must clear, in order. */
const VERIFICATION_COMMAND_IDS: readonly VerificationCommandId[] = ["typecheck", "build", "test"];

/**
 * Fixed, bounded prompt template per role. The objective spec lives INSIDE the
 * prompt — never as a CLI argument and never turned into a command. Each role
 * receives only its own contract; no competitor data is ever included.
 */
function makePromptForRole(spec: string): (role: string, antId: string, contextBrief?: string) => string {
  return function promptForRole(role: string, _antId: string, contextBrief?: string): string {
  const ask =
    role === "architecture"
      ? "Return JSON {summary, assumptions, files:[{path,operation,content}], risks, tests, confidence} describing architectureSummary, filePlan, requirementMapping and risks. Return NO file contents and request NO commands."
      : role === "review"
        ? "Return JSON {summary, files, risks, tests, confidence} with reviewedArtifactIds, findings, approvedArtifactIds, rejectedArtifactIds, securityFindings and requiredRepairs. Write NO files and request NO commands."
        : "Return JSON {summary, files:[{path,operation,content}], risks, tests, confidence} where every file has an exact relative path, complete content, purpose and requirementsCovered. Request NO commands.";
  // The bounded contextBrief carries the repair objective on a repair call and
  // the plan/manifest otherwise. It is appended as DATA; `safeProviderRequest`
  // bounds it and fails closed on credentials before anything is spawned.
  const brief = contextBrief && contextBrief.length > 0 ? `\n${contextBrief}` : "";
  return `${spec}\nROLE: ${role}\n${ask}${brief}`;
  };
}

/** The compiled-in demo objective, used only when no --objective-file is given. */
const DEFAULT_OBJECTIVE = "Build a small TypeScript task manager: tasks CRUD + completion, in-memory storage, unit tests (no npm install, no network, no shell commands).";

const DEFAULT_MISSION_ID = "namola-twin-taskmgr";

function argValue(argv: readonly string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

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

  // --- MISSION INPUT (bounded, validated, DATA only) ------------------------
  // The objective never becomes an argv entry and never reaches a shell: the
  // provider flag template is fixed in safeProviderRequest.ts and this text
  // travels only inside the bounded prompt.
  const missionIdArg = argValue(argv, "--mission-id");
  if (missionIdArg !== null && !validateMissionId(missionIdArg)) {
    console.log(JSON.stringify({ status: "refused", reasonCode: "invalid-mission-id" }));
    process.exit(0);
    return;
  }
  const missionId = missionIdArg ?? DEFAULT_MISSION_ID;

  const objectiveFileArg = argValue(argv, "--objective-file");
  let objective = DEFAULT_OBJECTIVE;
  let objectiveSource = "compiled-in-default";
  if (objectiveFileArg !== null) {
    const loaded = loadMissionObjectiveFile(objectiveFileArg, [resolvePath(process.cwd())]);
    if (!loaded.ok) {
      console.log(JSON.stringify({ status: "refused", reasonCode: loaded.reasonCode }));
      process.exit(0);
      return;
    }
    objective = loaded.objective;
    objectiveSource = "objective-file";
  }

  const maxRepairArg = argValue(argv, "--max-repair-attempts");
  const maxRepairAttempts = maxRepairArg === null ? TWIN_DEFAULT_MAX_REPAIR_ATTEMPTS : validateMaxRepairAttempts(Number(maxRepairArg));
  if (maxRepairAttempts === null) {
    console.log(JSON.stringify({ status: "refused", reasonCode: "invalid-max-repair-attempts" }));
    process.exit(0);
    return;
  }
  const promptForRole = makePromptForRole(objective);

  const workers = buildSettlementWorkers(20260915, 1000);
  const plan = buildTwinEmpireLivePlan(workers, providers, missionId, objective);
  console.log(`objective source: ${objectiveSource}`);
  console.log(`mission id: ${missionId}`);
  console.log(`max repair attempts: ${maxRepairAttempts}`);

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
  console.log(`verification stages enforced per candidate: ${VERIFICATION_COMMAND_IDS.join(" -> ")}`);
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
  // REPAIR AUTHORIZATIONS. Each repair round is a separate provider call and so
  // needs its own permit: a permit is single-use and bound to one (ant, task).
  // They are minted HERE, by the composition root, from the same single human
  // confirmation - the loop never invents an identity for itself, and a colony
  // that exhausts these slots fails closed rather than continuing unauthorized.
  const repairSlotsFor = (colony: "claude-forge" | "codex-crucible", cohort: readonly { antId: string; role: string }[]): TwinRepairSlot[] => {
    const impl = cohort.find((m) => m.role === "implementation") ?? cohort[0];
    return Array.from({ length: maxRepairAttempts }, (_unused, k) => ({ antId: `${impl.antId}-repair-${k + 1}`, taskId: `${plan.missionId}-${colony}-repair-${k + 1}` }));
  };
  const claudeRepairSlots = repairSlotsFor("claude-forge", plan.claudeCohort);
  const codexRepairSlots = repairSlotsFor("codex-crucible", plan.codexCohort);

  const execPermits = mintHumanConfirmedTwinColonyPermits(
    [...plan.claudeCohort.map((m) => scopeFor("claude-forge", claudeProvider, m.antId, m.role)), ...claudeRepairSlots.map((sl, k) => scopeFor("claude-forge", claudeProvider, sl.antId, `repair-${k + 1}`))],
    [...plan.codexCohort.map((m) => scopeFor("codex-crucible", codexProvider, m.antId, m.role)), ...codexRepairSlots.map((sl, k) => scopeFor("codex-crucible", codexProvider, sl.antId, `repair-${k + 1}`))],
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
  const claudeDriver = new RealLiveProviderDriver({ processDriver: new NodeProviderProcessDriver(), permitByAnt: new Map([...plan.claudeCohort.map((m, i) => [m.antId, execPermits.claude[i]] as const), ...claudeRepairSlots.map((sl, k) => [sl.antId, execPermits.claude[plan.claudeCohort.length + k]] as const)]), missionId: plan.missionId, workspaceId: plan.workspaceRoots.claude, workspaceAbsolutePath: claudeWs.absolutePath, maxStdinBytes: plan.limits.maxStdinBytes, maxStdoutBytes: plan.limits.maxStdoutBytes, maxStderrBytes: 4000, timeoutMs: plan.limits.perCallTimeoutMs, promptForRole });
  const codexDriver = new RealLiveProviderDriver({ processDriver: new NodeProviderProcessDriver(), permitByAnt: new Map([...plan.codexCohort.map((m, i) => [m.antId, execPermits.codex[i]] as const), ...codexRepairSlots.map((sl, k) => [sl.antId, execPermits.codex[plan.codexCohort.length + k]] as const)]), missionId: plan.missionId, workspaceId: plan.workspaceRoots.codex, workspaceAbsolutePath: codexWs.absolutePath, maxStdinBytes: plan.limits.maxStdinBytes, maxStdoutBytes: plan.limits.maxStdoutBytes, maxStderrBytes: 4000, timeoutMs: plan.limits.perCallTimeoutMs, promptForRole });

  // --- VERIFICATION CAPABILITY -------------------------------------------
  // Composed once per colony workspace. `composeVerificationSandbox` returns a
  // non-null executor ONLY after the backend has proven its own isolation, so a
  // non-null value is itself the evidence that the sandbox is verified. When it
  // is null the driver is still constructed and still consulted - it reports
  // `verification-unavailable`, which the loop records as VERIFICATION_BLOCKED.
  // There is deliberately no branch here that runs a generated package on the
  // host, and no branch that treats "could not verify" as a pass.
  const humanAuthorizedVerification = isValidHumanConfirmation(confirmation.confirmation);
  const mountRoots = [resolvePath(process.cwd(), "workspaces")];
  const buildVerification = (workspaceAbsolutePath: string, probeAbsolutePath: string | null): TwinVerificationBackend => {
    const sandbox = composeVerificationSandbox({ workspaceHostPath: workspaceAbsolutePath, authorizedMountRoots: mountRoots, probeWorkspaceHostPath: probeAbsolutePath });
    return {
      driver: new RealBackedVerificationDriver(workspaceAbsolutePath, VERIFICATION_COMMAND_IDS, plan.limits.perCallTimeoutMs, plan.limits.maxStdoutBytes, humanAuthorizedVerification, sandbox),
      sandboxBackendId: sandbox === null ? "none" : "container",
      sandboxVerified: sandbox !== null,
    };
  };
  const probeWs = new RealLiveWorkspaceDriver(`${plan.missionId}/verify-probe`, plan.limits.perFileByteCap, plan.limits.workspaceFileCap, "workspaces/namola-twin", ensureTwinColonyWorkspace);
  const probePath = probeWs.ready && probeWs.absolutePath ? probeWs.absolutePath : null;
  const claudeVerification = buildVerification(claudeWs.absolutePath, probePath);
  const codexVerification = buildVerification(codexWs.absolutePath, probePath);
  logStage("verification-capability", { sandboxVerified: claudeVerification.sandboxVerified, backend: claudeVerification.sandboxBackendId });

  // Sequential per colony; Claude fully completes before Codex begins.
  const run = runTwinEmpireLive({
    claude: { colonyId: "claude-forge", culture: "architecture-first", provider: claudeProvider, missionId: plan.missionId, workspaceId: plan.workspaceRoots.claude, cohort: plan.claudeCohort.map((m) => ({ antId: m.antId, role: m.role })), empirePermit, providerDriver: claudeDriver, applier: wrapLiveWorkspaceApplier(claudeWs, `${plan.missionId}/claude-forge`), acceptance: plan.acceptanceCriteria, missionObjective: objective, verification: claudeVerification, repairSlots: claudeRepairSlots, maxRepairAttempts, repairTimeoutMs: plan.limits.perCallTimeoutMs, log: logStage },
    codex: { colonyId: "codex-crucible", culture: "implementation-first", provider: codexProvider, missionId: plan.missionId, workspaceId: plan.workspaceRoots.codex, cohort: plan.codexCohort.map((m) => ({ antId: m.antId, role: m.role })), empirePermit, providerDriver: codexDriver, applier: wrapLiveWorkspaceApplier(codexWs, `${plan.missionId}/codex-crucible`), acceptance: plan.acceptanceCriteria, missionObjective: objective, verification: codexVerification, repairSlots: codexRepairSlots, maxRepairAttempts, repairTimeoutMs: plan.limits.perCallTimeoutMs, log: logStage },
    log: logStage,
  });

  console.log(
    JSON.stringify({
      status: run.status,
      missionId: plan.missionId,
      claude: { providerCalls: run.claude.providerCalls, artifactsApplied: run.claude.artifactsApplied, independentReviews: run.claude.independentReviews, failureReason: run.claude.failureReason, fingerprint: run.claude.bundle?.fingerprint ?? "none", realProviderProcessExecutions: claudeDriver.realProviderProcessExecutions, realClaudeCalls: claudeDriver.realClaudeCalls },
      codex: { providerCalls: run.codex.providerCalls, artifactsApplied: run.codex.artifactsApplied, independentReviews: run.codex.independentReviews, failureReason: run.codex.failureReason, fingerprint: run.codex.bundle?.fingerprint ?? "none", realProviderProcessExecutions: codexDriver.realProviderProcessExecutions, realCodexCalls: codexDriver.realCodexCalls },
      bothFrozen: run.bothFrozen,
      // Frozen and VERIFIED are separate facts and are reported separately.
      bothVerified: run.bothVerified,
      claudeVerification: run.claudeVerificationStatus,
      codexVerification: run.codexVerificationStatus,
      sandboxVerified: claudeVerification.sandboxVerified,
      sandboxBackendId: claudeVerification.sandboxBackendId,
      distinctFingerprints: run.distinctFingerprints,
      totalProviderCalls: run.claude.providerCalls + run.codex.providerCalls,
      realFilesystemWrites: claudeWs.realFilesystemWrites + codexWs.realFilesystemWrites,
      repairPhrase: TWIN_REPAIR_PHRASE,
      note: "Each colony ran the bounded build/verify/repair loop before freezing. Cross-examination, Namola court, merge, and delivery are NOT started automatically. No background continuation. A candidate is VERIFIED only when a real verification driver passed it; VERIFICATION_BLOCKED means nothing could be checked and is never a pass.",
    })
  );
  process.exit(0);
}

if (require.main === module) {
  void main();
}
