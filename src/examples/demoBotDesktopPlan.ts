// Focused feature demo — proves desktop-automation-as-data (Phase 8).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoBotDesktopPlan: Phase 8 desktop automation as planned data.
 *
 * Scenarios:
 * 1. A safe desktop action plan is built as data — five step kinds, all
 *    describing a harmless docs-viewer rehearsal.
 * 2. BotBodySimulator narrates the plan step by step; the narration is
 *    data, and every line carries simulated: true / executed: false.
 * 3. A plan whose step targets a protected surface is refused with a
 *    redacted receipt (reason code, counts, lengths, fingerprint — the
 *    surface is never named in the receipt).
 * 4. Assertions: every plan, step, and narration line is simulated: true
 *    and executed: false.
 * 5. Statement of absences: no mouse, keyboard, window, screenshot, OS,
 *    terminal, network, git, or package-manager capability is used — no
 *    API for any of those exists in this project.
 */

import { ReceiptLog } from "../core/receiptLog";
import { SafetyGuard } from "../core/safetyGuard";
import { DesktopActionPlanner } from "../bots/desktopActionPlanner";
import { BotBodySimulator } from "../bots/botBodySimulator";

export function runDemoBotDesktopPlan() {
  const receiptLog = new ReceiptLog();
  const planner = new DesktopActionPlanner(new SafetyGuard(), receiptLog);
  const simulator = new BotBodySimulator(receiptLog);

  // Scenario 1: a safe plan — a docs-viewer rehearsal.
  const safe = planner.buildPlan({
    missionId: "mission-desktop-demo",
    taskId: "ptask-desktop-1",
    taskDescription: "Rehearse how a bot would arrange the docs viewer for reading.",
    steps: [
      { kind: "open-app", targetDescription: "the documentation viewer" },
      { kind: "focus-window", targetDescription: "the notes pane" },
      { kind: "click", targetDescription: "the table-of-contents entry for pheromones" },
      { kind: "type-text", targetDescription: "the search box", inputSummary: "pheromone decay" },
      { kind: "read-screen-region", targetDescription: "the heading area of the notes pane" },
    ],
  });

  // Scenario 2: narrate the safe plan.
  const narration = safe.ok ? simulator.narrate(safe.plan) : undefined;

  // Scenario 3: a refused plan — the step targets a protected surface.
  const refused = planner.buildPlan({
    missionId: "mission-desktop-demo",
    taskId: "ptask-desktop-2",
    taskDescription: "This plan must be refused before it exists.",
    steps: [
      { kind: "click", targetDescription: "the password field on the login form" },
    ],
  });

  // Scenario 4: invariants across plan, steps, and narration.
  const planFlagsOk = safe.ok
    ? safe.plan.simulated === true &&
      safe.plan.executed === false &&
      safe.plan.actions.every((s) => s.simulated === true && s.executed === false)
    : false;
  const narrationFlagsOk =
    narration?.narration.every((line) => line.simulated === true && line.executed === false) ?? false;

  return {
    scenario1: {
      created: safe.ok,
      planId: safe.ok ? safe.plan.planId : undefined,
      stepCount: safe.ok ? safe.plan.actions.length : 0,
    },
    scenario2: {
      narratedSteps: narration?.narration.length ?? 0,
      firstLine: narration?.narration[0]?.text,
    },
    scenario3: {
      refused: !refused.ok,
      reasonCode: refused.ok ? undefined : refused.refusal.reasonCode,
      refusalReceiptSummary: refused.receipt.summary,
      refusalReceiptDetails: refused.receipt.details,
    },
    scenario4: { planFlagsOk, narrationFlagsOk },
    scenario5: {
      noRealAutomation: true, // no OS/input/window/screen API exists in this project
      noNetworkOrProcess: true, // see SAFETY_INVARIANTS.md checks
    },
    allReceipts: receiptLog.list(),
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoBotDesktopPlan(), null, 2));
}
