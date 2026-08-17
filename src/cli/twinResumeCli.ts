/**
 * twinResumeCli — the HUMAN-ONLY command that resumes ONLY the failed twin
 * colony. It never reruns the successful colony: that colony's frozen bundle is
 * loaded read-only, validated, and preserved; no provider call, no workspace
 * write, and no bundle regeneration happens for it.
 *
 * The real path requires an interactive TTY and EXACTLY the phrase
 * `RUN ONE NAMOLA CLAUDE REPAIR`. The confirmation can never come from argv, an
 * environment variable, a file, a pipe, provider output, or MCP —
 * `acquireHumanConfirmation` refuses all of those by construction.
 *
 * At most TWO additional bounded calls are spent (implementation, then review
 * only if valid artifacts exist), written into a SEPARATE numbered repair area so
 * earlier output is never overwritten. It stops after freezing; cross-examination
 * is NOT started automatically.
 *
 * Imports no fs, no child_process, and no network directly.
 */

import { askOnce, logStage } from "./liveObjectiveCliHelpers";
import { buildSettlementWorkers } from "../civilization/civilizationLiveRunner";
import { buildTwinEmpireLivePlan } from "../twin/twinEmpireLivePlan";
import { runTwinResume, REPAIR_IMPLEMENTATION_TIMEOUT_MS } from "../twin/twinResumeRunner";
import { repairWorkspaceId } from "../twin/twinResumeState";
import type { TwinResumeRecord } from "../twin/twinResumeState";
import { wrapLiveWorkspaceApplier } from "../twin/twinColonyLiveRunner";
import { acquireHumanConfirmation, mintHumanConfirmedTwinColonyPermits } from "../cognitive/realProviderExecutionPermit";
import type { PermitScope, RealProviderId } from "../cognitive/realProviderExecutionPermit";
import { mintHumanTwinEmpirePermit } from "../cognitive/twinEmpireLivePermit";
import type { TwinColonyId } from "../cognitive/twinEmpireLivePermit";
import { RealLiveProviderDriver } from "../cognitive/liveProviderExecution";
import { RealLiveWorkspaceDriver } from "../cognitive/liveRealDrivers";
import { NodeProviderProcessDriver } from "../cognitive/nodeProviderProcessDriver";
import { ensureTwinColonyWorkspace } from "../cognitive/smokeWorkspace";
import { initializeEnvironmentSecretRegistry } from "../cognitive/environmentSecretBootstrap";

export const TWIN_CLAUDE_REPAIR_PHRASE = "RUN ONE NAMOLA CLAUDE REPAIR" as const;

function argValue(argv: readonly string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

/** Fixed, bounded repair prompts. The objective lives INSIDE the prompt, never as an argument. */
function promptForRole(role: string): string {
  const spec = "Build a small TypeScript task manager: tasks CRUD + completion, in-memory storage, unit tests (no npm install, no network, no shell commands).";
  return role === "review"
    ? `${spec}\nROLE: review\nReturn JSON {summary, files, risks, tests, confidence} with reviewedArtifactIds, findings, approvedArtifactIds, rejectedArtifactIds, securityFindings and requiredRepairs. Write NO files and request NO commands.`
    : `${spec}\nROLE: build\nReturn JSON {summary, files:[{path,operation,content}], risks, tests, confidence} where every file has an exact relative path, complete content, purpose and requirementsCovered. Request NO commands.`;
}

async function main(): Promise<void> {
  // §34: populate the environment-secret registry BEFORE any provider
  // runtime is constructed, any request assembled, or any receipt written.
  // One central bootstrap; this CLI never reads process.env for credentials.
  initializeEnvironmentSecretRegistry();
  const argv = process.argv.slice(2);
  const missionId = argValue(argv, "--mission") ?? "namola-twin-taskmgr";
  const colonyArg = argValue(argv, "--colony") ?? "claude-forge";
  if (colonyArg !== "claude-forge" && colonyArg !== "codex-crucible") {
    console.log(JSON.stringify({ status: "refused", reasonCode: "unknown-colony", colony: colonyArg }));
    process.exit(0);
    return;
  }
  const failedColony: TwinColonyId = colonyArg;
  const successfulColony: TwinColonyId = failedColony === "claude-forge" ? "codex-crucible" : "claude-forge";

  const workers = buildSettlementWorkers(20260915, 1000);
  const plan = buildTwinEmpireLivePlan(workers, ["claude", "codex"], missionId);
  const cohort = failedColony === "claude-forge" ? plan.claudeCohort : plan.codexCohort;
  const provider: RealProviderId = failedColony === "claude-forge" ? "claude" : "codex";
  const implAnt = cohort.find((m) => m.role === "implementation");
  const reviewAnt = cohort.find((m) => m.role === "review");
  if (!implAnt || !reviewAnt) {
    console.log(JSON.stringify({ status: "refused", reasonCode: "cohort-missing-repair-roles" }));
    process.exit(0);
    return;
  }

  // The resume record describes the partially-successful first attempt. It is
  // rebuilt here from the mission plan + the preserved bundle the human points
  // at; it carries safe scalars only.
  const repairArea = argValue(argv, "--repair-area") ?? "repair-1";
  const repairWs = repairWorkspaceId(missionId, failedColony, repairArea);

  console.log("=== NAMOLA TWIN EMPIRE — RESUME FAILED COLONY ===");
  console.log(`mission: ${missionId}`);
  console.log(`failed colony (to resume): ${failedColony}`);
  console.log(`successful colony (PRESERVED, not rerun): ${successfulColony}`);
  console.log(`reused architecture plan: ${plan.claudeCohort.length > 0 ? "from first attempt" : "(none)"}`);
  console.log(`repair workspace (separate, never overwrites earlier output): ${repairWs}`);
  console.log(`additional calls: implementation<=1, review<=1, total<=2; concurrency<=1; no automatic retry`);
  console.log(`implementation timeout: up to ${REPAIR_IMPLEMENTATION_TIMEOUT_MS}ms`);
  console.log(`confirmation phrase: ${TWIN_CLAUDE_REPAIR_PHRASE}`);

  if (argv.includes("--dry-run")) {
    console.log(JSON.stringify({ status: "dry-run-complete", note: "No provider, no permit, no real file, no workspace directory created.", missionId, failedColony, successfulColony, repairWorkspace: repairWs, confirmationPhrase: TWIN_CLAUDE_REPAIR_PHRASE }));
    process.exit(0);
    return;
  }

  // --- real path: TTY-only + exact confirmation -----------------------------
  if (!process.stdin.isTTY) {
    console.log(JSON.stringify({ status: "refused", reasonCode: "not-interactive-tty", note: "Resume requires an interactive terminal. Use --dry-run to preview." }));
    process.exit(0);
    return;
  }
  console.log(`\nType EXACTLY to authorize ONE repair (anything else aborts):\n  ${TWIN_CLAUDE_REPAIR_PHRASE}`);
  const typed = await askOnce("> ");
  const confirmation = acquireHumanConfirmation({ typedPhrase: typed, requiredPhrase: TWIN_CLAUDE_REPAIR_PHRASE, isInteractiveTty: Boolean(process.stdin.isTTY), argvConfirmationFlagPresent: argv.includes("-y") || argv.includes("--yes"), stdinWasPiped: false });
  if (!confirmation.ok) {
    console.log(JSON.stringify({ status: "aborted", reasonCode: confirmation.reasonCode }));
    process.exit(0);
    return;
  }
  logStage("repair-confirmation-accepted", { missionId, colony: failedColony });

  const empirePermit = mintHumanTwinEmpirePermit(
    { missionId, objectiveId: missionId, claudeWorkspaceId: plan.workspaceRoots.claude, codexWorkspaceId: plan.workspaceRoots.codex, allowedProviders: [provider], maxClaudeConcurrency: 1, maxCodexConcurrency: 1, maxTotalProviderCalls: 2, maxDeepCognitionAnts: 30, maxMcpCalls: 0, perFileByteCap: plan.limits.perFileByteCap, workspaceFileCap: plan.limits.workspaceFileCap, maxStdinBytes: plan.limits.maxStdinBytes, maxStdoutBytes: plan.limits.maxStdoutBytes, perCallTimeoutMs: REPAIR_IMPLEMENTATION_TIMEOUT_MS },
    confirmation.confirmation
  );
  if (!empirePermit) {
    console.log(JSON.stringify({ status: "aborted", reasonCode: "empire-permit-mint-failed" }));
    process.exit(0);
    return;
  }

  const scopeFor = (antId: string, role: string): PermitScope => ({ provider, missionId, taskId: `${missionId}-${failedColony}-repair-${role}`, antId, workspaceId: repairWs, maxInputBytes: plan.limits.maxStdinBytes, maxOutputBytes: plan.limits.maxStdoutBytes, timeoutMs: REPAIR_IMPLEMENTATION_TIMEOUT_MS });
  // Exactly two execution permits: one implementation, one review.
  const execPermits = mintHumanConfirmedTwinColonyPermits([scopeFor(implAnt.antId, "implementation")], [scopeFor(reviewAnt.antId, "review")], confirmation.confirmation);
  if (!execPermits) {
    console.log(JSON.stringify({ status: "aborted", reasonCode: "repair-permit-mint-failed" }));
    process.exit(0);
    return;
  }

  // Separate repair workspace — the original colony area is never touched.
  const repairDriver = new RealLiveWorkspaceDriver(`${missionId}/${failedColony}/${repairArea}`, plan.limits.perFileByteCap, plan.limits.workspaceFileCap, "workspaces/namola-twin", ensureTwinColonyWorkspace);
  if (!repairDriver.ready || !repairDriver.absolutePath) {
    console.log(JSON.stringify({ status: "aborted", reasonCode: "repair-workspace-create-failed", repairWorkspace: repairWs }));
    process.exit(0);
    return;
  }

  const providerDriver = new RealLiveProviderDriver({
    processDriver: new NodeProviderProcessDriver(),
    permitByAnt: new Map([
      [implAnt.antId, execPermits.claude[0]],
      [reviewAnt.antId, execPermits.codex[0]],
    ]),
    missionId,
    workspaceId: repairWs,
    workspaceAbsolutePath: repairDriver.absolutePath,
    maxStdinBytes: plan.limits.maxStdinBytes,
    maxStdoutBytes: plan.limits.maxStdoutBytes,
    maxStderrBytes: 4000,
    timeoutMs: REPAIR_IMPLEMENTATION_TIMEOUT_MS,
    promptForRole,
  });

  // The preserved bundle must be supplied by the operator's mission record. This
  // build has no bundle store yet, so the resume fails closed rather than
  // fabricating evidence for the successful colony.
  const record: TwinResumeRecord | null = null;
  if (!record) {
    logStage("twin-resume-failed", { reasonCode: "preserved-bundle-store-unavailable" });
    console.log(
      JSON.stringify({
        status: "twin-resume-failed",
        reasonCode: "preserved-bundle-store-unavailable",
        missionId,
        failedColony,
        successfulColony,
        repairWorkspace: repairWs,
        note: "The resume runner is wired and permits were minted, but this build has no persisted frozen-bundle store to load the preserved colony bundle from. Resume fails closed rather than regenerating or fabricating the successful colony's evidence. No provider call was made.",
        confirmationPhrase: TWIN_CLAUDE_REPAIR_PHRASE,
      })
    );
    process.exit(0);
    return;
  }

  const result = runTwinResume({
    record,
    culture: failedColony === "claude-forge" ? "architecture-first" : "implementation-first",
    provider,
    implementationAntId: implAnt.antId,
    reviewAntId: reviewAnt.antId,
    empirePermit,
    providerDriver,
    repairApplier: wrapLiveWorkspaceApplier(repairDriver, `${missionId}/${failedColony}/${repairArea}`),
    preservedBundle: null,
    acceptance: plan.acceptanceCriteria,
    reusedArchitecturePlan: [],
    log: logStage,
  });
  console.log(JSON.stringify({ status: result.status, missionId, failedColony, repairWorkspace: result.repairWorkspaceId, additionalProviderCalls: result.additionalProviderCalls, artifactsApplied: result.artifactsApplied, repairedFingerprint: result.repairedFingerprint, preservedFingerprint: result.preservedFingerprint, distinctFingerprints: result.distinctFingerprints, preservedBundleUnchanged: result.preservedBundleUnchanged, failureCategory: result.failureCategory, note: "Stopped after freezing. Cross-examination is NOT started automatically." }));
  process.exit(0);
}

if (require.main === module) {
  void main();
}
