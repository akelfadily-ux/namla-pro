/**
 * academy:real-pilot — the ONE human-only, bounded multi-ant live training
 * pilot (Build Law §21).
 *
 * `npm run academy:real-pilot -- --providers claude,codex --domain debugging-and-testing --cohort 3`
 *
 * Runs a live training pilot of 1-5 VOLUNTARY ants through real providers, one
 * bounded call per ant, at most 5 total. It requires an interactive terminal
 * and the human typing the EXACT dynamic phrase "RUN TAMARA NAMLA PILOT WITH N
 * ANTS". Tamara sets the objective; the cohort is the accepted subset of
 * voluntary claims (the human never names an ant). Real results are
 * independently evaluated and update only bounded SkillPassport evidence; one
 * pilot grants zero certifications.
 *
 * Never invoked by any automated test/demo/build. Confirmation cannot come from
 * argv, an environment variable, or piped stdin.
 */

import * as readline from "readline";
import { ReceiptLog } from "../core/receiptLog";
import { NodeProviderProcessDriver } from "../cognitive/nodeProviderProcessDriver";
import {
  acquireHumanConfirmation,
  type PermitScope,
  type RealProviderId,
} from "../cognitive/realProviderExecutionPermit";
import { mintHumanPilotPermit, requiredPilotPhrase, type PilotScope } from "../cognitive/multiProviderPilotPermit";
import { ensureAcademyPilotWorkspace, writePilotArtifact } from "../cognitive/smokeWorkspace";
import { ACADEMY_DOMAINS, type AcademyDomain } from "../academy/academyDomains";
import { buildPilotPopulation, runAcademyPilot, selectVoluntaryCohort, buildPilotCommandCenter } from "../academy/realAcademyPilot";
import { createSkillPassport, type SkillPassport } from "../academy/skillPassport";
import { parseFlags } from "./cliArgs";
import { initializeEnvironmentSecretRegistry } from "../cognitive/environmentSecretBootstrap";

const MAX_INPUT = 8000;
const MAX_OUTPUT = 8000;
const TIMEOUT_MS = 60000;
const CONFIRMATION_FLAG_NAMES = ["yes", "y", "confirm", "run", "force"];

/** CLI-friendly domain aliases mapping onto real academy domains. */
const DOMAIN_ALIAS: Readonly<Record<string, AcademyDomain>> = { "debugging-and-testing": "debugging" };

function question(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(prompt, (a) => { rl.close(); res(a); }));
}

async function main(): Promise<void> {
  // §34: populate the environment-secret registry BEFORE any provider
  // runtime is constructed, any request assembled, or any receipt written.
  // One central bootstrap; this CLI never reads process.env for credentials.
  initializeEnvironmentSecretRegistry();
  const rawArgs = process.argv.slice(2);
  const flags = parseFlags(rawArgs);

  const providersRaw = (flags.providers ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const providers = providersRaw.filter((p): p is RealProviderId => p === "claude" || p === "codex");
  const domainInput = flags.domain ?? "";
  const aliased = DOMAIN_ALIAS[domainInput];
  const domain: AcademyDomain | undefined = aliased ?? ((ACADEMY_DOMAINS as readonly string[]).includes(domainInput) ? (domainInput as AcademyDomain) : undefined);
  const cohortSize = Number.parseInt(flags.cohort ?? "", 10);

  if (providers.length === 0) {
    console.error("academy:real-pilot requires --providers with at least one of claude,codex. Nothing started.");
    process.exitCode = 1;
    return;
  }
  if (!domain || !(ACADEMY_DOMAINS as readonly string[]).includes(domain)) {
    console.error("academy:real-pilot requires --domain from the academy domains (e.g. debugging-and-testing). Nothing started.");
    process.exitCode = 1;
    return;
  }
  if (!Number.isInteger(cohortSize) || cohortSize < 1 || cohortSize > 5) {
    console.error("academy:real-pilot requires --cohort between 1 and 5. Nothing started.");
    process.exitCode = 1;
    return;
  }

  const isInteractiveTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const stdinWasPiped = !process.stdin.isTTY;
  if (!isInteractiveTty) {
    console.error("academy:real-pilot requires an interactive terminal. Refusing (no headless or piped activation).");
    process.exitCode = 1;
    return;
  }

  const seed = 1;
  const { mindful } = buildPilotPopulation(seed);
  const selection = selectVoluntaryCohort(mindful, domain, cohortSize, seed);
  const cohort = selection.cohort.slice(0, cohortSize);
  if (cohort.length === 0) {
    console.error("No ant voluntarily claimed this training. Nothing started.");
    process.exitCode = 1;
    return;
  }

  const pilotId = `pilot-${Date.now().toString(36)}`;
  const workspaceId = `workspaces/academy-pilot/${pilotId}`;
  const ws = ensureAcademyPilotWorkspace(workspaceId);
  if (!ws.ok) {
    console.error(`Pilot workspace refused (${ws.reasonCode}). Nothing started.`);
    process.exitCode = 1;
    return;
  }

  // Ants express a provider preference; the resolver picks only from the human
  // allowed pool. Round-robin among the allowed providers (never chosen by Tamara).
  const providerForAnt: RealProviderId[] = cohort.map((_, i) => providers[i % providers.length]);

  console.log("--- academy:real-pilot (bounded live training) ---");
  console.log(`Tamara objective: train voluntary ${domain} cohort (evidence-gated, no certification from one pilot)`);
  console.log(`domain:          ${domain}`);
  console.log(`accepted cohort: ${cohort.map((c) => c.ant.antId).join(", ")}`);
  console.log(`providers:       ${providers.join(", ")}`);
  console.log(`workspace:       ${workspaceId}`);
  console.log(`max calls:       ${cohort.length} (cap 5)`);
  console.log(`input byte cap:  ${MAX_INPUT}   output byte cap: ${MAX_OUTPUT}`);
  console.log(`timeout (ms):    ${TIMEOUT_MS}`);
  console.log("Each accepted ant makes at most ONE real call; results are independently evaluated; then this stops.");

  const requiredPhrase = requiredPilotPhrase(cohort.length);
  const typed = (await question(`Type exactly "${requiredPhrase}" to proceed: `)).trim();
  const argvConfirmationFlagPresent = CONFIRMATION_FLAG_NAMES.some((n) => n in flags || rawArgs.includes(`--${n}`) || rawArgs.includes(`-${n}`));

  const confirmation = acquireHumanConfirmation({ typedPhrase: typed, requiredPhrase, isInteractiveTty, argvConfirmationFlagPresent, stdinWasPiped });
  if (!confirmation.ok) {
    console.log(`Not confirmed (${confirmation.reasonCode}). Exiting without any provider call.`);
    return;
  }

  const pilotScope: PilotScope = {
    pilotId,
    objectiveId: `obj-${domain}-pilot`,
    academyDomain: domain,
    difficulty: "core",
    allowedProviders: providers,
    workspaceId,
    maxCohortSize: cohort.length,
    maxProviderCalls: cohort.length,
    maxAggregateInputBytes: MAX_INPUT,
    maxAggregateOutputBytes: MAX_OUTPUT,
    perCallTimeoutMs: TIMEOUT_MS,
    maxPilotSteps: 50,
  };
  const memberScopes: PermitScope[] = cohort.map((m, slot) => ({
    provider: providerForAnt[slot],
    missionId: pilotId,
    taskId: `pilot-task-${slot}`,
    antId: m.ant.antId,
    workspaceId,
    maxInputBytes: MAX_INPUT,
    maxOutputBytes: MAX_OUTPUT,
    timeoutMs: TIMEOUT_MS,
  }));
  const mint = mintHumanPilotPermit(pilotScope, memberScopes, confirmation.confirmation);
  if (!mint) {
    console.error("Pilot permit could not be minted; exiting.");
    process.exitCode = 1;
    return;
  }

  const passports = new Map<string, SkillPassport>();
  for (const m of cohort) passports.set(m.ant.antId, createSkillPassport(m.ant.antId, m.ant.reliability));
  const receipts = new ReceiptLog();

  writePilotArtifact(ws.handle, "request-manifest.json", JSON.stringify({ pilotId, domain, providers, cohortSize: cohort.length, maxCalls: cohort.length, maxInput: MAX_INPUT, maxOutput: MAX_OUTPUT }, null, 2));

  // The ONE bounded live run. requireHumanCliOrigin: true — only human-minted
  // member permits reach the real Node driver; one call per ant.
  const result = runAcademyPilot({
    pilotPermit: mint.pilotPermit,
    memberPermits: mint.memberPermits,
    cohort,
    evaluators: selection.evaluators,
    passports,
    providerForAnt,
    driverForSlot: () => new NodeProviderProcessDriver(),
    requireHumanCliOrigin: true,
    workingDirectoryAbsolute: ws.handle.absolutePath,
    receiptLog: receipts,
    seed,
  });

  const commandCenter = buildPilotCommandCenter(result, selection.voluntaryTrainingClaims, "human-authorized");
  writePilotArtifact(ws.handle, "pilot-summary.json", JSON.stringify(commandCenter, null, 2));

  console.log("--- pilot result (redacted) ---");
  console.log(JSON.stringify({
    pilotOutcome: result.pilotOutcome,
    acceptedCohortSize: result.acceptedCohortSize,
    providerCallsStarted: result.providerCallsStarted,
    providerCallsCompleted: result.providerCallsCompleted,
    providerCallsFailed: result.providerCallsFailed,
    quotaFailures: result.quotaFailures,
    evaluationsPassed: result.evaluationsPassed,
    evaluationsFailed: result.evaluationsFailed,
    remediationRequests: result.remediationRequests,
    passportEvidenceUpdates: result.passportEvidenceUpdates,
    certificationsGranted: result.certificationsGranted,
    providerBudgetRemaining: result.providerBudgetRemaining,
  }, null, 2));
  console.log("Done. At most one call per ant was issued; every permit is consumed. One pilot grants no certification.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("academy:real-pilot failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  });
}
