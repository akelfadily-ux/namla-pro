/**
 * colony:mission — one explicit, human-triggered mission run.
 *
 * `npm run colony:mission -- --provider fake --goal "Build a task manager"`
 *
 * `fake` is the default and requires no confirmation. `claude`/`codex` must
 * be explicitly named and require typed human confirmation before the
 * mission starts — but real execution still always refuses inside the
 * adapters themselves (see cliCognitiveWorkerBase.ts): confirmation gates
 * STARTING the mission, not the Phase 0 hard boundary. No background
 * process, no automatic retry beyond MissionRunner's own bounded rounds, no
 * Queen-controlled activation — cognitive ants only ever act after their
 * own voluntary claim and cognitive-budget admission.
 */

import * as readline from "readline";
import { createColonyGenesis } from "../colony/colonyGenesis";
import { DeterministicCognitiveWorker } from "../colonyMission/deterministicCognitiveWorker";
import { ClaudeCliAdapter } from "../colonyMission/claudeCliAdapter";
import { CodexCliAdapter } from "../colonyMission/codexCliAdapter";
import { CognitiveWorkerRegistry } from "../colonyMission/cognitiveWorkerRegistry";
import { MissionRunner } from "../colonyMission/missionRunner";
import type { CognitiveProviderName } from "../colonyMission/cognitiveWorkTypes";
import type { WorkTask } from "../colonyMission/workDemand";
import { ReceiptLog } from "../core/receiptLog";
import { parseFlags } from "./cliArgs";

const MAX_CONCURRENT_COGNITIVE_ANTS = 5;
const MAX_REPAIR_ROUNDS = 3;

function buildRegistry(receiptLog: ReceiptLog): CognitiveWorkerRegistry {
  const registry = new CognitiveWorkerRegistry();
  registry.register(new DeterministicCognitiveWorker());
  registry.register(new ClaudeCliAdapter(receiptLog));
  registry.register(new CodexCliAdapter(receiptLog));
  return registry;
}

function buildTasksFor(missionId: string, goal: string): { scoutTask: WorkTask; buildTasks: readonly WorkTask[] } {
  const scoutTask: WorkTask = {
    taskId: "architecture-plan",
    missionId,
    category: "architecture",
    description: `Design the overall architecture for: ${goal}`,
    acceptanceCriteria: ["Addresses the stated goal", "Is testable"],
  };
  const buildTasks: WorkTask[] = [
    { taskId: "core-logic", missionId, category: "backend", description: `Implement the core logic for: ${goal}`, acceptanceCriteria: ["Exposes a handle() function"] },
    { taskId: "tests", missionId, category: "testing", description: `Add tests for: ${goal}`, acceptanceCriteria: ["Exposes a handle() function"] },
    { taskId: "docs", missionId, category: "documentation", description: `Document: ${goal}`, acceptanceCriteria: ["Exposes a handle() function"] },
  ];
  return { scoutTask, buildTasks };
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toUpperCase() === "YES");
    });
  });
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const provider = (flags.provider ?? "fake") as CognitiveProviderName;
  const goal = flags.goal ?? "Build a small task-management application.";
  const missionId = flags.missionId ?? `mission-${Date.now()}`;

  if (provider !== "fake") {
    console.log(`Real provider selected: ${provider}.`);
    console.log(`Task: ${goal}`);
    console.log(`Mission workspace: workspaces/${missionId}/`);
    console.log(
      "Real execution is refused in this phase regardless of confirmation (NAMLA_BUILD_LAW.md Section 1 hard boundary — see docs/real-provider-adapters.md)."
    );
    const confirmed = await confirm('Type "YES" to proceed anyway (the mission will still run with the request refused at the provider): ');
    if (!confirmed) {
      console.log("Not confirmed. Exiting without starting the mission.");
      return;
    }
  }

  const genesis = createColonyGenesis({ colonyId: "namla-colony-mission", seed: Date.now() });
  const receiptLog = new ReceiptLog();
  const registry = buildRegistry(receiptLog);
  const { scoutTask, buildTasks } = buildTasksFor(missionId, goal);

  const runner = new MissionRunner({
    missionId,
    missionGoal: goal,
    genesis,
    providerName: provider,
    cognitiveWorkerRegistry: registry,
    maxConcurrentCognitiveAnts: MAX_CONCURRENT_COGNITIVE_ANTS,
    scoutTask,
    scoutCount: 3,
    buildTasks,
    maxRepairRounds: MAX_REPAIR_ROUNDS,
    receiptLog,
  });

  const { report } = runner.run();
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("colony:mission failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  });
}
