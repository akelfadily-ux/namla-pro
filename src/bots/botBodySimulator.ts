/**
 * BotBodySimulator narrates a DesktopActionPlan — it tells the story of
 * what a bot body WOULD do, step by step, as data. It performs nothing:
 * no OS API, no input injection, no window control, no screenshot, no
 * screen reading. Its only imports are the receipt log and the plan types.
 *
 * The narration text is returned to the caller (it describes a plan that
 * passed every gate); receipts carry only ids and counts, per the
 * established redaction standard.
 */

import { randomUUID } from "crypto";
import type { ActionReceipt } from "../types/receiptTypes";
import type { DesktopActionPlan, DesktopNarrationLine } from "./desktopActionTypes";
import { ReceiptLog } from "../core/receiptLog";

const NARRATION_VERBS: Record<DesktopNarrationLine["kind"], string> = {
  click: "would click",
  "type-text": "would type into",
  "open-app": "would open",
  "focus-window": "would bring to the front",
  "read-screen-region": "would look at",
};

export interface NarrationResult {
  narration: DesktopNarrationLine[];
  receipt: ActionReceipt;
}

export class BotBodySimulator {
  constructor(private readonly receiptLog: ReceiptLog) {}

  narrate(plan: DesktopActionPlan): NarrationResult {
    // Runtime re-check of the literal-typed invariants (casts can defeat
    // literal types): a plan claiming to be real or executed is corrupt.
    const invariantsHold =
      (plan as { simulated: unknown }).simulated === true &&
      (plan as { executed: unknown }).executed === false &&
      (plan as { requiresHumanApproval: unknown }).requiresHumanApproval === true;

    if (!invariantsHold) {
      const receipt = this.receiptLog.create({
        summary: "Narration refused: the plan violates core invariants.",
        status: "refused",
        links: { missionId: plan.missionId, taskId: plan.taskId },
        details: { planId: plan.planId },
      });
      return { narration: [], receipt };
    }

    const narration: DesktopNarrationLine[] = plan.actions.map((step, index) => ({
      stepId: step.stepId,
      kind: step.kind,
      text:
        `Step ${index + 1}: the bot ${NARRATION_VERBS[step.kind]} ${step.targetDescription}` +
        (step.inputSummary ? ` (typing: ${step.inputSummary})` : "") +
        " — simulated only, nothing performed.",
      simulated: true,
      executed: false,
    }));

    const receipt = this.receiptLog.create({
      summary: `Simulated narration produced for a desktop plan (nothing performed).`,
      status: "completed",
      links: { missionId: plan.missionId, taskId: plan.taskId },
      details: { planId: plan.planId, narratedStepCount: narration.length },
    });

    return { narration, receipt };
  }
}
