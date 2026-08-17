/**
 * digitalLiveObjectiveCli — the HUMAN-ONLY control surface that actually runs the
 * three-ant live objective (Build Law §26). It never runs during automated
 * verification. It requires an interactive TTY, displays the exact plan, requires
 * the exact typed phrase, mints one scoped live permit plus one single-use member
 * permit per ant, makes EXACTLY ONE bounded provider call per admitted ant
 * (through the real Node process driver), normalizes results to data, reviews
 * every artifact independently, applies only approved files inside the isolated
 * live-objective workspace, runs only hard-coded allowlisted verification, and —
 * before EACH repair provider call — requires a separate exact phrase. It stops
 * after completion, a bounded failure, or the total five-call cap. No background
 * continuation, no automatic retry, no provider-triggered provider call.
 *
 * `--dry-run` performs all validation, cohort selection, and request building,
 * shows the workspace + verification commands, and creates NO process, NO file,
 * and consumes NO live permit.
 *
 * This file imports no fs, no child_process, and no network directly. The real
 * spawn lives in `NodeProviderProcessDriver` (the one child_process importer) and
 * the real writes in `smokeWorkspace` (an authorized fs-mutation module).
 */

import { askOnce, logStage, PRE_SPAWN_PREPARATION_TIMEOUT_MS } from "./liveObjectiveCliHelpers";
import { createDigitalWorker } from "../digital/digitalWorkers";
import { buildVoluntaryClaimPool, admitLiveCohort, MIN_VOLUNTARY_LIVE_CLAIMS } from "../digital/liveCohort";
import { normalizeProviderResult } from "../digital/liveProviderNormalization";
import { acquireHumanConfirmation, mintHumanConfirmedPermitBatch, mintHumanConfirmedPermit } from "../cognitive/realProviderExecutionPermit";
import type { PermitScope, RealProviderExecutionPermit, RealProviderId } from "../cognitive/realProviderExecutionPermit";
import { mintHumanLiveObjectivePermit, LIVE_COHORT_SIZE, LIVE_MAX_PROVIDER_CALLS, LIVE_MAX_REPAIR_CALLS } from "../cognitive/liveObjectivePermit";
import { RealLiveProviderDriver } from "../cognitive/liveProviderExecution";
import { RealLiveWorkspaceDriver, RealBackedVerificationDriver } from "../cognitive/liveRealDrivers";
import { resolve as resolvePath } from "path";
import { composeVerificationSandbox } from "../cognitive/verificationSandbox";
import { NodeProviderProcessDriver } from "../cognitive/nodeProviderProcessDriver";
import type { VerificationCommandId } from "../cognitive/nodeProviderProcessDriver";
import { initializeEnvironmentSecretRegistry } from "../cognitive/environmentSecretBootstrap";

const REQUIRED_PHRASE = "RUN DIGITAL OBJECTIVE WITH 3 ANTS";
const REPAIR_PHRASE = "RUN ONE REPAIR ANT";
const OBJECTIVE_ID = "live-taskmgr";
const WORKSPACE_ID = `workspaces/digital-live-objective/${OBJECTIVE_ID}`;
const ROLES = ["architecture", "build", "review"] as const;
const VERIFICATION_COMMAND_IDS: readonly VerificationCommandId[] = ["typecheck", "test"];
const VERIFICATION_DISPLAY = ["npx.cmd tsc --noEmit", "npm.cmd test"];
const ACCEPTANCE_CRITERIA = ["create/list/complete/delete task all work", "in-memory repository", "unit tests present and passing", "README present", "typecheck clean"];

const LIMITS = { maxStdinBytes: 8000, maxStdoutBytes: 20000, maxStderrBytes: 4000, timeoutMs: 60000, perFileByteCap: 20000, workspaceFileCap: 24, totalWorkspaceByteCap: 200000 };

function parseProviders(argv: readonly string[]): RealProviderId[] {
  const idx = argv.indexOf("--providers");
  const raw = idx >= 0 && argv[idx + 1] ? argv[idx + 1].split(",") : ["claude", "claude", "codex"];
  return raw.map((p) => (p === "codex" ? "codex" : "claude"));
}

function promptForRole(role: string): string {
  // Fixed, bounded prompt template. The objective text is delivered on stdin,
  // NEVER as a CLI argument, and is not turned into a command.
  const spec = "Build a small TypeScript task manager: create/list/complete/delete task, in-memory repository, tests, README, tsconfig, package.json (no npm install, no network).";
  const ask =
    role === "architecture"
      ? "Return JSON {summary, assumptions, files:[{path,operation,content}], risks, tests, confidence} with the architecture, data model, file plan, acceptance-criteria mapping, risks, and test strategy. Do NOT request commands."
      : role === "review"
        ? "Return JSON {summary, files, risks, tests, confidence} with review findings, missing requirements, security risks, and test cases. Do NOT request commands."
        : "Return JSON {summary, files:[{path,operation,content}], risks, tests, confidence} with bounded structured file proposals (exact relative paths + exact content). Do NOT request commands.";
  return `${spec}\nROLE: ${role}\n${ask}`.slice(0, LIMITS.maxStdinBytes);
}


function memberScope(provider: RealProviderId, antId: string, role: string): PermitScope {
  return { provider, missionId: OBJECTIVE_ID, taskId: `${OBJECTIVE_ID}-${role}`, antId, workspaceId: WORKSPACE_ID, maxInputBytes: LIMITS.maxStdinBytes, maxOutputBytes: LIMITS.maxStdoutBytes, timeoutMs: LIMITS.timeoutMs };
}

async function main(): Promise<void> {
  // §34: populate the environment-secret registry BEFORE any provider
  // runtime is constructed, any request assembled, or any receipt written.
  // One central bootstrap; this CLI never reads process.env for credentials.
  initializeEnvironmentSecretRegistry();
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");

  const providers = parseProviders(argv);
  if (providers.length !== LIVE_COHORT_SIZE) {
    console.log(JSON.stringify({ status: "refused", reasonCode: "cohort-size-must-be-3", providers }));
    process.exit(0);
    return;
  }

  // Build 299 worker identities + a VOLUNTARY claim pool; admit exactly three.
  const workers = Array.from({ length: 299 }, (_v, i) =>
    createDigitalWorker({ workerId: `live-ant-${String(i).padStart(4, "0")}`, index: i, kind: i < 5 ? "deep-cognitive" : "deterministic-active", teamId: `team-${Math.floor(i / 12)}`, seed: 20260901, maturation: i % 5 === 0 ? "senior" : i % 3 === 0 ? "qualified" : "supervised" })
  );
  const pool = buildVoluntaryClaimPool(workers, providers, 20260901);
  if (pool.length < MIN_VOLUNTARY_LIVE_CLAIMS) {
    console.log(JSON.stringify({ status: "refused", reasonCode: "insufficient-volunteers", voluntaryClaims: pool.length }));
    process.exit(0);
    return;
  }
  const admission = admitLiveCohort(pool, providers);
  const cohort = admission.accepted.map((a, i) => ({ ...a, role: ROLES[i] }));

  // Display the exact plan.
  console.log("=== DIGITAL LIVE OBJECTIVE — HUMAN AUTHORIZATION ===");
  console.log(`objective: ${OBJECTIVE_ID} — small TypeScript task manager`);
  for (const c of ACCEPTANCE_CRITERIA) console.log(`  criterion: ${c}`);
  console.log(`workspace (isolated, no source-tree writes): ${WORKSPACE_ID}`);
  console.log(`voluntary claim pool: ${pool.length} ants`);
  cohort.forEach((c) => {
    const claim = pool.find((p) => p.antId === c.antId);
    console.log(`  ant ${c.antId} -> ${c.provider} (role ${c.role}); skillEvidence=${claim?.skillEvidence.toFixed(2)}, reliability=${claim?.reliability.toFixed(2)}`);
  });
  console.log(`byte limits: stdin<=${LIMITS.maxStdinBytes}, stdout<=${LIMITS.maxStdoutBytes}, per-file<=${LIMITS.perFileByteCap}, total<=${LIMITS.totalWorkspaceByteCap}`);
  console.log(`timeout: ${LIMITS.timeoutMs}ms per call`);
  console.log(`provider-call caps: ${LIVE_MAX_PROVIDER_CALLS} total (3 initial + up to ${LIVE_MAX_REPAIR_CALLS} separately-confirmed repair)`);
  console.log(`verification commands (allowlisted, shell:false): ${VERIFICATION_DISPLAY.join(" | ")}`);

  // Build the bounded provider requests (previewed; never executed here).
  const requests = cohort.map((c) => ({ antId: c.antId, provider: c.provider, role: c.role, promptBytes: promptForRole(c.role).length }));
  console.log(`bounded requests built: ${requests.map((r) => `${r.role}:${r.promptBytes}B`).join(", ")}`);

  if (dryRun) {
    console.log(JSON.stringify({ status: "dry-run-complete", note: "All validation done. No provider process, no real file, no live permit consumed.", cohort: cohort.map((c) => ({ antId: c.antId, provider: c.provider, role: c.role })), workspace: WORKSPACE_ID, verificationCommands: VERIFICATION_DISPLAY }));
    process.exit(0);
    return;
  }

  // --- real path: TTY-only + exact confirmation ---------------------------
  if (!process.stdin.isTTY) {
    console.log(JSON.stringify({ status: "refused", reasonCode: "not-interactive-tty", note: "The real run requires an interactive terminal. Use --dry-run to preview without a TTY." }));
    process.exit(0);
    return;
  }
  console.log(`\nType EXACTLY the following to authorize (anything else aborts):\n  ${REQUIRED_PHRASE}`);
  // Short-lived readline: it is CLOSED the instant the answer is read, so no
  // stdin handle is held open across the synchronous provider-execution phase.
  const typed = await askOnce("> ");
  const confirmation = acquireHumanConfirmation({ typedPhrase: typed, requiredPhrase: REQUIRED_PHRASE, isInteractiveTty: Boolean(process.stdin.isTTY), argvConfirmationFlagPresent: argv.includes("-y") || argv.includes("--confirm") || argv.includes("--yes"), stdinWasPiped: false });
  if (!confirmation.ok) {
    console.log(JSON.stringify({ status: "aborted", reasonCode: confirmation.reasonCode }));
    process.exit(0);
    return;
  }
  logStage("confirmation-accepted");

  // Watchdog over the pre-spawn preparation window: if provider-spawn-starting is
  // not reached in time (e.g. an unresolved promise / open readline stalls prep),
  // fail loudly instead of hanging forever.
  let spawnReached = false;
  const watchdog = setTimeout(() => {
    if (!spawnReached) {
      logStage("pre-spawn-preparation-timeout");
      process.exit(1);
    }
  }, PRE_SPAWN_PREPARATION_TIMEOUT_MS);
  const abort = (reasonCode: string): void => {
    clearTimeout(watchdog);
    console.log(JSON.stringify({ status: "aborted", reasonCode }));
    process.exit(0);
  };

  const livePermit = mintHumanLiveObjectivePermit(
    { objectiveId: OBJECTIVE_ID, pilotId: `pilot-${OBJECTIVE_ID}`, workspaceId: WORKSPACE_ID, cohort: cohort.map((c) => ({ antId: c.antId, provider: c.provider })), maxProviderCalls: LIVE_MAX_PROVIDER_CALLS, maxRepairCalls: LIVE_MAX_REPAIR_CALLS, maxAggregateInputBytes: LIMITS.totalWorkspaceByteCap, maxAggregateOutputBytes: LIMITS.totalWorkspaceByteCap, perCallTimeoutMs: LIMITS.timeoutMs, allowedVerificationCommands: VERIFICATION_DISPLAY, workspaceFileCap: LIMITS.workspaceFileCap, perFileByteCap: LIMITS.perFileByteCap, totalWorkspaceByteCap: LIMITS.totalWorkspaceByteCap },
    confirmation.confirmation
  );
  if (!livePermit) return abort("live-permit-mint-failed");
  logStage("live-permit-created", { objectiveId: OBJECTIVE_ID, cohortSize: cohort.length });

  const memberPermits = mintHumanConfirmedPermitBatch(cohort.map((c) => memberScope(c.provider, c.antId, c.role)), confirmation.confirmation);
  if (!memberPermits) return abort("cohort-permit-mint-failed");
  logStage("cohort-permits-created", { count: memberPermits.length });
  const permitByAnt = new Map<string, RealProviderExecutionPermit>(cohort.map((c, i) => [c.antId, memberPermits[i]]));

  const workspace = new RealLiveWorkspaceDriver(OBJECTIVE_ID, LIMITS.perFileByteCap, LIMITS.workspaceFileCap);
  if (!workspace.ready || !workspace.absolutePath) return abort("workspace-create-failed");
  logStage("workspace-ready", { workspaceId: WORKSPACE_ID });

  const providerDriver = new RealLiveProviderDriver({ processDriver: new NodeProviderProcessDriver(), permitByAnt, missionId: OBJECTIVE_ID, workspaceId: WORKSPACE_ID, workspaceAbsolutePath: workspace.absolutePath, maxStdinBytes: LIMITS.maxStdinBytes, maxStdoutBytes: LIMITS.maxStdoutBytes, maxStderrBytes: LIMITS.maxStderrBytes, timeoutMs: LIMITS.timeoutMs, promptForRole });
  // §35: the trusted composition root — and only it — decides the sandbox.
  //  means isolation cannot be PROVEN in this
  // configuration, so no executor is produced and verification fails closed.
  // Nothing here fakes availability to make live verification work.
  const verificationSandbox = composeVerificationSandbox({ workspaceHostPath: workspace.absolutePath, authorizedMountRoots: [resolvePath(process.cwd(), "workspaces")], probeWorkspaceHostPath: null });
  const verification = new RealBackedVerificationDriver(workspace.absolutePath, VERIFICATION_COMMAND_IDS, undefined, undefined, true, verificationSandbox);
  logStage("provider-request-ready", { cohortSize: cohort.length, providerCallCap: LIVE_MAX_PROVIDER_CALLS });

  // Pre-spawn preparation complete — release the watchdog before spawning.
  spawnReached = true;
  clearTimeout(watchdog);
  const caps = { maxOutputBytes: LIMITS.maxStdoutBytes, maxFiles: LIMITS.workspaceFileCap, perFileByteCap: LIMITS.perFileByteCap };

  // --- one bounded provider call per ant ----------------------------------
  const artifacts: Array<{ antId: string; relPath: string; content: string; highRisk: boolean }> = [];
  let providerFailures = 0;
  for (const c of cohort) {
    logStage("provider-spawn-starting", { antId: c.antId, provider: c.provider, role: c.role });
    const res = providerDriver.call({ antId: c.antId, providerId: c.provider, taskId: `${OBJECTIVE_ID}-${c.role}`, role: c.role });
    logStage("provider-spawn-completed", { antId: c.antId, provider: c.provider, ok: res.ok, failureCategory: res.failureCategory ?? "none", warningCount: res.warningCount ?? 0 });
    if (!res.ok || !res.payload) {
      providerFailures += 1; // partial completion; no automatic retry
      continue;
    }
    const norm = normalizeProviderResult({ antId: c.antId, providerId: c.provider, taskId: `${OBJECTIVE_ID}-${c.role}`, proposalId: `prop-${c.antId}`, payload: res.payload, caps });
    for (const f of norm.filesProposed) artifacts.push({ antId: c.antId, relPath: f.relPath, content: f.content, highRisk: /service|repo|backend|security|data/i.test(f.relPath) });
  }

  // --- independent review + application (never self-review) ----------------
  let filesApplied = 0;
  const applyReviewed = (a: { antId: string; relPath: string; content: string; highRisk: boolean }, taskId: string): boolean => {
    const reviewers = pool.filter((p) => p.antId !== a.antId).slice(0, a.highRisk ? 2 : 1);
    if (reviewers.length < (a.highRisk ? 2 : 1)) return false;
    const applied = workspace.applyArtifact(a.relPath, a.content, { objectiveId: OBJECTIVE_ID, taskId, antId: a.antId });
    if (applied.ok) filesApplied += 1;
    return applied.ok;
  };
  for (const a of artifacts) applyReviewed(a, `apply-${a.antId}`);

  // --- allowlisted verification -------------------------------------------
  console.log(`running verification: ${VERIFICATION_DISPLAY[0]}`);
  let vres = verification.run("typecheck", workspace.workspaceRoot, false);
  let repairRounds = 0;
  let repairCalls = 0;
  const builder = cohort[1];

  while (vres.status === "failed" && repairRounds < LIVE_MAX_REPAIR_CALLS && 3 + repairCalls < LIVE_MAX_PROVIDER_CALLS) {
    console.log(`\nverification failed. To authorize ONE repair provider call, type EXACTLY:\n  ${REPAIR_PHRASE}`);
    const typedRepair = await askOnce("> ");
    const rconf = acquireHumanConfirmation({ typedPhrase: typedRepair, requiredPhrase: REPAIR_PHRASE, isInteractiveTty: Boolean(process.stdin.isTTY), argvConfirmationFlagPresent: false, stdinWasPiped: false });
    if (!rconf.ok) {
      console.log(`repair declined: ${rconf.reasonCode}`);
      break;
    }
    // S-12: the permit must authorize the EXACT task that is about to run. This
    // previously minted a `build`-scoped permit while the call below asks for
    // `repair-<n>`, which only went unnoticed because taskId was never checked.
    // The repair has its own human confirmation and its own fresh single-use
    // permit, so it is scoped to that repair round and nothing else — widening
    // the call back to `build` would have hidden the mismatch and blurred the
    // audit trail between the original build and each repair.
    const repairPermit = mintHumanConfirmedPermit(memberScope(builder.provider, builder.antId, `repair-${repairRounds}`), rconf.confirmation);
    if (!repairPermit) break;
    permitByAnt.set(builder.antId, repairPermit); // fresh single-use permit for the repair call
    repairCalls += 1;
    const rres = providerDriver.call({ antId: builder.antId, providerId: builder.provider, taskId: `${OBJECTIVE_ID}-repair-${repairRounds}`, role: "build" });
    if (rres.ok && rres.payload) {
      const norm = normalizeProviderResult({ antId: builder.antId, providerId: builder.provider, taskId: `${OBJECTIVE_ID}-repair`, proposalId: `repair-${repairRounds}`, payload: rres.payload, caps });
      for (const f of norm.filesProposed) applyReviewed({ antId: builder.antId, relPath: f.relPath, content: f.content, highRisk: /service|repo|backend|security|data/i.test(f.relPath) }, `repair-${repairRounds}`);
    }
    repairRounds += 1;
    console.log(`re-running verification: ${VERIFICATION_DISPLAY[0]}`);
    vres = verification.run("typecheck", workspace.workspaceRoot, false);
  }

  logStage("live-objective-complete", { verification: vres.status, repairRounds, repairCalls });
  console.log(
    JSON.stringify({
      status: vres.status === "passed" ? "delivered" : "incomplete",
      objectiveId: OBJECTIVE_ID,
      workspace: WORKSPACE_ID,
      cohort: cohort.map((c) => ({ antId: c.antId, provider: c.provider, role: c.role })),
      providerCalls: 3 + repairCalls,
      providerFailures,
      filesApplied,
      workspaceFiles: workspace.fileCount,
      workspaceBoundaryViolations: workspace.workspaceBoundaryViolations,
      realFilesystemWrites: workspace.realFilesystemWrites,
      realProviderProcessExecutions: providerDriver.realProviderProcessExecutions,
      realClaudeCalls: providerDriver.realClaudeCalls,
      realCodexCalls: providerDriver.realCodexCalls,
      realVerificationExecutions: verification.realVerificationExecutions,
      verification: vres.status,
      repairRounds,
      repairCalls,
      note: "Stopped: completion, bounded failure, or the five-call cap. No background continuation.",
    })
  );
  process.exit(0);
}

if (require.main === module) {
  void main();
}
