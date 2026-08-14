/**
 * TesterAnt proposes a test plan for a piece of work. Phase 0: it never runs
 * a real test suite — it only describes what should be tested.
 *
 * Phase 4: a TesterAnt can additionally validate a verification plan as
 * data, through an injected TestPlanChecker. Still nothing is run.
 */

import type { AntIdentity } from "../types/antTypes";
import type { TestPlanChecker, TestPlanCheckResult } from "../review/testPlanChecker";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";

export class TesterAnt {
  readonly identity: AntIdentity;

  constructor(antId: string) {
    this.identity = {
      antId,
      role: "tester",
      displayName: "Tester Ant",
      generation: 0,
      trustLevel: "probationary",
      capabilities: [
        { name: "propose-test-plan", description: "Propose what should be tested, without running tests.", requiresApproval: true },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  proposeTestPlan(targetDescription: string): AntFacadeTrace {
    return createFacadeTrace({
      role: "tester",
      action: "propose-test-plan",
      status: "completed",
      noteCode: "no-tests-run",
      createdBy: this.identity.antId,
      details: { targetDescriptionLength: targetDescription.length },
    });
  }

  /**
   * Phase 4: validate a verification plan through an injected checker.
   * Pure data analysis; the checker writes the REAL receipt, and the
   * tester returns a façade trace referencing it (Step 4C semantics).
   */
  checkTestPlan(
    checker: TestPlanChecker,
    planText: string,
    context: { missionId?: string; taskId?: string } = {}
  ): { result: TestPlanCheckResult; trace: AntFacadeTrace } {
    const result = checker.check(planText, { ...context, checkerAntId: this.identity.antId });

    return {
      result,
      trace: createFacadeTrace({
        role: "tester",
        action: "check-test-plan",
        status: "completed",
        noteCode: result.adequate ? "plan-adequate" : "plan-inadequate",
        createdBy: this.identity.antId,
        relatedReceiptIds: [result.receipt.receiptId],
        details: { auditId: result.report.auditId, findingCount: result.report.findings.length },
      }),
    };
  }
}
