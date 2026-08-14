/**
 * TestPlanChecker validates a verification-plan task's output — as text
 * data. It asks three questions of the plan's wording and produces findings;
 * it never runs a test, never spawns anything, and never touches disk.
 *
 * The heuristics are deliberately shallow (keyword and shape checks). They
 * catch empty or hand-wavy plans, not subtly wrong ones — judging whether a
 * plan is *correct* is future work for smarter ants (Phase 7 adapters).
 */

import { randomUUID } from "crypto";
import type { ActionReceipt } from "../types/receiptTypes";
import type { AuditFinding, AuditReport, AuditSeverity } from "../types/auditTypes";
import { ReceiptLog } from "../core/receiptLog";

export interface TestPlanCheckContext {
  missionId?: string;
  taskId?: string;
  checkerAntId: string;
}

export interface TestPlanCheckResult {
  /** True when no major or critical findings were raised. */
  adequate: boolean;
  report: AuditReport;
  receipt: ActionReceipt;
}

const CONCRETE_CHECK_WORDS = ["check", "confirm", "assert", "compare", "count", "inspect"];
const OUTCOME_WORDS = ["expect", "should", "outcome", "result"];
const SCOPE_WORDS = ["scope", "cover", "covers", "only", "limit", "boundary"];

export class TestPlanChecker {
  constructor(private readonly receiptLog: ReceiptLog) {}

  check(planText: string, context: TestPlanCheckContext): TestPlanCheckResult {
    const findings: AuditFinding[] = [];
    const lowered = planText.toLowerCase();

    const finding = (severity: AuditSeverity, summary: string): void => {
      findings.push({
        findingId: `finding-${randomUUID()}`,
        severity,
        summary,
        relatedTaskId: context.taskId,
      });
    };

    if (planText.trim().length === 0) {
      finding("major", "Verification plan is empty.");
    } else {
      if (!CONCRETE_CHECK_WORDS.some((word) => lowered.includes(word))) {
        finding("major", "Verification plan names no concrete check (no check/confirm/assert/compare language).");
      }

      if (!OUTCOME_WORDS.some((word) => lowered.includes(word))) {
        finding("minor", "Verification plan states no expected outcome.");
      }

      if (!SCOPE_WORDS.some((word) => lowered.includes(word)) && planText.trim().length < 80) {
        finding("minor", "Verification plan is short and does not define its scope.");
      }
    }

    const adequate = findings.every((f) => f.severity === "info" || f.severity === "minor");

    const report: AuditReport = {
      auditId: `audit-${randomUUID()}`,
      missionId: context.missionId,
      findings,
      generatedByAntId: context.checkerAntId,
      generatedAt: new Date().toISOString(),
    };

    // The plan text itself stays out of the receipt — only its length.
    const receipt = this.receiptLog.create({
      summary: `Test plan check completed: ${findings.length} finding(s), plan ${adequate ? "adequate" : "inadequate"}.`,
      status: "completed",
      links: { missionId: context.missionId, taskId: context.taskId, antId: context.checkerAntId },
      details: { auditId: report.auditId, planTextLength: planText.length, adequate },
    });

    return { adequate, report, receipt };
  }
}
