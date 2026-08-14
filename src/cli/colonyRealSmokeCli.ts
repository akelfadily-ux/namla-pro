/**
 * colony:real-smoke — the ONE human-only, single-request real provider check
 * (Build Law §19).
 *
 * `npm run colony:real-smoke -- --provider claude`
 * `npm run colony:real-smoke -- --provider codex`
 *
 * This is the only place in Namla Pro that can run a real Claude/Codex process,
 * and it does so only after ALL of: an interactive terminal, explicit provider
 * selection, one ant admitted through the bounded cognitive budget, a dedicated
 * validated smoke workspace, and the human typing the EXACT phrase
 * ("RUN ONE CLAUDE ANT" / "RUN ONE CODEX ANT"). It then mints one
 * non-serializable permit, issues exactly one bounded request, prints a
 * redacted result, writes a safe receipt/summary, and stops. No loop, no
 * mission, no retry, no second request.
 *
 * It is never invoked by any automated test/demo/build. Confirmation cannot
 * come from argv, an environment variable, or piped stdin — only from a human
 * typing at a TTY.
 */

import * as readline from "readline";
import { createColonyGenesis } from "../colony/colonyGenesis";
import { CognitiveExecutionBudget } from "../colonyMission/cognitiveExecutionBudget";
import { ClaudeCliAdapter } from "../colonyMission/claudeCliAdapter";
import { CodexCliAdapter } from "../colonyMission/codexCliAdapter";
import type { CognitiveWorkRequest } from "../colonyMission/cognitiveWorkTypes";
import { ReceiptLog } from "../core/receiptLog";
import { NodeProviderProcessDriver } from "../cognitive/nodeProviderProcessDriver";
import {
  acquireHumanConfirmation,
  mintHumanConfirmedPermit,
  REQUIRED_CONFIRMATION_PHRASE,
  type PermitScope,
  type RealProviderId,
} from "../cognitive/realProviderExecutionPermit";
import { ensureSmokeWorkspace, writeSmokeManifest, writeSmokeResultSummary } from "../cognitive/smokeWorkspace";
import { parseFlags } from "./cliArgs";
import { initializeEnvironmentSecretRegistry } from "../cognitive/environmentSecretBootstrap";

const MISSION_ID = "provider-smoke";
const TASK_ID = "smoke-check";
const MAX_INPUT_BYTES = 4000;
const MAX_OUTPUT_BYTES = 65536;
const TIMEOUT_MS = 60000;

/** The fixed harmless cognition-only smoke task (Build Law §19, §10). */
const SMOKE_TASK =
  "Review this tiny in-memory TypeScript function description and return: one correctness observation; one possible edge case; one test suggestion; confidence from 0 to 1. Return JSON with keys summary, confidence, observations, edgeCase, testSuggestion.";
const SMOKE_CONTEXT = "function add(a: number, b: number): number { return a + b; }";

/** argv confirmation flags are NEVER accepted as confirmation. */
const CONFIRMATION_FLAG_NAMES = ["yes", "y", "confirm", "run", "force"];

function question(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(prompt, (answer) => { rl.close(); res(answer); }));
}

async function main(): Promise<void> {
  // §34: populate the environment-secret registry BEFORE any provider
  // runtime is constructed, any request assembled, or any receipt written.
  // One central bootstrap; this CLI never reads process.env for credentials.
  initializeEnvironmentSecretRegistry();
  const rawArgs = process.argv.slice(2);
  const flags = parseFlags(rawArgs);
  const provider = flags.provider as RealProviderId | undefined;

  if (provider !== "claude" && provider !== "codex") {
    console.error("colony:real-smoke requires --provider claude or --provider codex explicitly. Nothing was started.");
    process.exitCode = 1;
    return;
  }

  const isInteractiveTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const stdinWasPiped = !process.stdin.isTTY;
  if (!isInteractiveTty) {
    console.error("colony:real-smoke requires an interactive terminal. Refusing (no headless or piped activation).");
    process.exitCode = 1;
    return;
  }

  // One ant admitted through the bounded cognitive budget (peak far under 30).
  const genesis = createColonyGenesis({ colonyId: "namla-provider-smoke", seed: 1 });
  const candidate = genesis.workers[0];
  const budget = new CognitiveExecutionBudget(5);
  const admitted = budget.resolve([{ antId: candidate.antId, claimScore: 0.9 }]);
  if (!admitted.has(candidate.antId)) {
    console.error("No ant was admitted; refusing.");
    process.exitCode = 1;
    return;
  }
  const antId = candidate.antId;

  const workspaceId = `workspaces/provider-smoke/${provider}/${MISSION_ID}`;
  const ws = ensureSmokeWorkspace(workspaceId);
  if (!ws.ok) {
    console.error(`Smoke workspace refused (${ws.reasonCode}). Nothing was started.`);
    process.exitCode = 1;
    return;
  }

  console.log("--- colony:real-smoke (one bounded provider request) ---");
  console.log(`provider:        ${provider}`);
  console.log(`antId:           ${antId}`);
  console.log(`taskId:          ${TASK_ID}`);
  console.log(`missionId:       ${MISSION_ID}`);
  console.log(`workspace:       ${workspaceId}`);
  console.log(`input byte cap:  ${MAX_INPUT_BYTES}`);
  console.log(`output byte cap: ${MAX_OUTPUT_BYTES}`);
  console.log(`timeout (ms):    ${TIMEOUT_MS}`);
  console.log(`invocation count: 1`);
  console.log("This runs ONE real provider process, prints a redacted result, and stops. No mission, no loop, no retry.");

  const requiredPhrase = REQUIRED_CONFIRMATION_PHRASE[provider];
  const typedPhrase = (await question(`Type exactly "${requiredPhrase}" to proceed: `)).trim();

  const argvConfirmationFlagPresent = CONFIRMATION_FLAG_NAMES.some((name) => name in flags || rawArgs.includes(`--${name}`) || rawArgs.includes(`-${name}`));

  const confirmation = acquireHumanConfirmation({
    typedPhrase,
    requiredPhrase,
    isInteractiveTty,
    argvConfirmationFlagPresent,
    stdinWasPiped,
  });
  if (!confirmation.ok) {
    console.log(`Not confirmed (${confirmation.reasonCode}). Exiting without sending anything.`);
    return;
  }

  const scope: PermitScope = {
    provider,
    missionId: MISSION_ID,
    taskId: TASK_ID,
    antId,
    workspaceId,
    maxInputBytes: MAX_INPUT_BYTES,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    timeoutMs: TIMEOUT_MS,
  };
  const permit = mintHumanConfirmedPermit(scope, confirmation.confirmation);
  if (!permit) {
    console.error("Permit could not be minted; exiting.");
    process.exitCode = 1;
    return;
  }

  writeSmokeManifest(ws.handle, {
    provider,
    missionId: MISSION_ID,
    taskId: TASK_ID,
    antId,
    maxInputBytes: MAX_INPUT_BYTES,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    timeoutMs: TIMEOUT_MS,
    invocationCount: 1,
  });

  const receipts = new ReceiptLog();
  const adapter = provider === "claude" ? new ClaudeCliAdapter(receipts) : new CodexCliAdapter(receipts);

  const request: CognitiveWorkRequest = {
    requestId: `smoke-${provider}-${antId}`,
    missionId: MISSION_ID,
    taskId: TASK_ID,
    antId,
    behavioralRole: "scout",
    taskDescription: SMOKE_TASK,
    relevantContext: SMOKE_CONTEXT,
    acceptanceCriteria: ["Returns one observation, one edge case, one test suggestion, and a confidence 0..1."],
    allowedWorkspacePaths: [`${workspaceId}/smoke.md`],
    maxResponseSize: MAX_OUTPUT_BYTES,
    maxAttempts: 1,
    providerName: provider,
    safeMetadata: { kind: "smoke" },
  };

  // The ONE real invocation. requireHumanCliOrigin: true — only a human-minted
  // permit reaches the real Node process driver.
  const outcome = adapter.executeReal({
    request,
    permitCandidate: permit,
    workspaceId,
    workingDirectoryAbsolute: ws.handle.absolutePath,
    driver: new NodeProviderProcessDriver(),
    requireHumanCliOrigin: true,
  });

  writeSmokeResultSummary(ws.handle, {
    status: outcome.status,
    providerFailureCategory: outcome.providerFailureCategory,
    outputTruncated: outcome.providerOutputTruncated,
    permitConsumed: outcome.permitConsumed,
    receiptId: outcome.providerReceiptId,
  });

  // Redacted result only — never raw stdout/stderr/env/credentials.
  console.log("--- result (redacted) ---");
  console.log(
    JSON.stringify(
      {
        status: outcome.status,
        providerSelected: outcome.providerSelected,
        permitConsumed: outcome.permitConsumed,
        providerInvocationStarted: outcome.providerInvocationStarted,
        providerInvocationCompleted: outcome.providerInvocationCompleted,
        providerTimedOut: outcome.providerTimedOut,
        providerOutputTruncated: outcome.providerOutputTruncated,
        providerFailureCategory: outcome.providerFailureCategory,
        providerReceiptId: outcome.providerReceiptId,
        summary: outcome.result && outcome.result.ok ? outcome.result.response.summary : null,
        confidence: outcome.result && outcome.result.ok ? outcome.result.response.confidence : null,
      },
      null,
      2
    )
  );
  console.log("Done. Exactly one request was issued; the permit is consumed and cannot be reused.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("colony:real-smoke failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  });
}
