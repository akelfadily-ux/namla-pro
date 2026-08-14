/**
 * GitReadPlanner describes which read-only git commands a future authorized
 * phase WOULD run — as PlannedAction data with executed: false, the same
 * shape the Phase 0 bodies use. Nothing here executes: no process-spawning
 * module is imported in this file or anywhere else in the project.
 *
 * Any candidate command that names a state-changing or history-changing git
 * operation (push, commit, add, reset, clean, checkout, rebase, merge, ...)
 * is refused as data with a receipt. SafetyGuard is run over every candidate
 * as a second, independent gate.
 *
 * Receipt wording rule (learned in the Phase 4 verification): no receipt
 * summary or reason literal may contain a SecretProtectionPolicy indicator
 * substring, or ReceiptLog itself would throw. All wording below is audited
 * against that list.
 */

import { randomUUID } from "crypto";
import type { ActionReceipt } from "../types/receiptTypes";
import type { GitReadPlan } from "./gitStateModel";
import { buildPlannedAction } from "../bodies/toolAdapter";
import { SafetyGuard } from "../core/safetyGuard";
import { ReceiptLog } from "../core/receiptLog";

/** Git operations that change state or history; planning them is refused. */
const DISALLOWED_GIT_WORDS: string[] = [
  "push",
  "commit",
  "add",
  "reset",
  "clean",
  "checkout",
  "rebase",
  "merge",
  "restore",
  "stash",
  "cherry-pick",
  "filter-branch",
  "gc",
  "prune",
  "rm",
  "mv",
  "branch -d",
  "branch -D",
  "tag -d",
  "remote add",
  "fetch",
  "pull",
  "clone",
];

const DEFAULT_READ_ONLY_COMMANDS: string[] = [
  "git status",
  "git log --oneline -20",
  "git diff --stat",
];

export interface GitReadPlanRefusal {
  refusalId: string;
  reasonCode: string;
  receiptId: string;
  refusedAt: string;
}

export interface GitReadPlanResult {
  plan: GitReadPlan;
  refusals: GitReadPlanRefusal[];
  receipt: ActionReceipt;
}

export class GitReadPlanner {
  constructor(
    private readonly safetyGuard: SafetyGuard,
    private readonly receiptLog: ReceiptLog
  ) {}

  planReadOnlyInspection(
    requestedByAntId: string,
    candidateCommands: string[] = DEFAULT_READ_ONLY_COMMANDS
  ): GitReadPlanResult {
    const plan: GitReadPlan = {
      planId: `git-read-plan-${randomUUID()}`,
      plannedActions: [],
      createdAt: new Date().toISOString(),
    };
    const refusals: GitReadPlanRefusal[] = [];

    for (const command of candidateCommands) {
      const lowered = command.toLowerCase();

      const disallowedWord = DISALLOWED_GIT_WORDS.find((word) => lowered.includes(word));
      if (disallowedWord !== undefined) {
        refusals.push(this.refuseCommand(command, "disallowed-git-operation", requestedByAntId));
        continue;
      }

      // Independent second gate. Note: SafetyGuard treats "push" as
      // FORBIDDEN on its own, so even if the word list above were trimmed,
      // a push-shaped command would still be refused here.
      const decision = this.safetyGuard.evaluateText(command);
      if (!decision.allowed) {
        refusals.push(this.refuseCommand(command, "safety-blocked", requestedByAntId));
        continue;
      }

      plan.plannedActions.push(
        buildPlannedAction({
          kind: "command-execute",
          description: `Planned read-only git inspection for a future authorized phase; not run in Phase 5.`,
          targetCommand: command,
          requestedByAntId,
          requiresHumanApproval: true,
        })
      );
    }

    const receipt = this.receiptLog.create({
      summary: `Git read plan created: ${plan.plannedActions.length} planned action(s), ${refusals.length} refused. Nothing was run.`,
      status: "completed",
      links: { antId: requestedByAntId },
      details: { planId: plan.planId, refusalReasonCodes: refusals.map((r) => r.reasonCode) },
    });

    return { plan, refusals, receipt };
  }

  private refuseCommand(command: string, reasonCode: string, requestedByAntId: string): GitReadPlanRefusal {
    // Redacted: the raw command text stays out of the receipt entirely —
    // only its length and reason code. (A refused command is by definition
    // dangerous wording.)
    const receipt = this.receiptLog.create({
      summary: `Git read plan action refused: the candidate names a disallowed operation.`,
      status: "refused",
      links: { antId: requestedByAntId },
      details: { reasonCode, commandLength: command.length },
    });

    return {
      refusalId: `git-refusal-${randomUUID()}`,
      reasonCode,
      receiptId: receipt.receiptId,
      refusedAt: new Date().toISOString(),
    };
  }
}
