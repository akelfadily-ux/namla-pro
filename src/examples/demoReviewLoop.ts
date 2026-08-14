// Focused feature demo — proves the review/test/repair chain (Phase 4).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoReviewLoop: demonstrates the Phase 4 audit/test/repair chain, driven
 * entirely by this one human-run script — there is no loop, no timer, and
 * no scheduler anywhere; each step below happens because a line of this
 * file explicitly calls it.
 *
 * Scenarios:
 * 1. A safe proposal reviewed cleanly by an AuditorAnt via ProposalReviewer.
 * 2. A create-collision defect (targeting README.md, which exists in the
 *    snapshot) producing a major AuditFinding.
 * 3. A repair proposal for that finding, produced by a RepairAnt through
 *    RepairProposalFlow with a corrected target path.
 * 4. An unsafe repair revision (dangerous command text) refused by the
 *    factory with a redacted refusal receipt.
 * 5. Confirmation that every proposal that exists remains applied === false
 *    and that nothing was written to disk (there is no write API anywhere
 *    in the project outside the read-only inspector).
 *
 * A TesterAnt also checks one verification plan as data, to exercise the
 * TestPlanChecker wiring.
 */

import path from "path";
import { ReceiptLog } from "../core/receiptLog";
import { SafetyGuard } from "../core/safetyGuard";
import { ProjectInspector } from "../inspector/projectInspector";
import { ProposalFactory } from "../generation/proposalFactory";
import { ProposalReviewer } from "../review/proposalReviewer";
import { TestPlanChecker } from "../review/testPlanChecker";
import { RepairProposalFlow } from "../review/repairProposalFlow";
import { BuilderAnt } from "../ants/builderAnt";
import { AuditorAnt } from "../ants/auditorAnt";
import { TesterAnt } from "../ants/testerAnt";
import { RepairAnt } from "../ants/repairAnt";
import type { CodeProposal } from "../generation/codeProposal";

export function runDemoReviewLoop() {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const receiptLog = new ReceiptLog();
  const safetyGuard = new SafetyGuard();

  const inspector = new ProjectInspector(projectRoot, receiptLog);
  const { snapshot } = inspector.inspect("review-demo-setup");

  const factory = new ProposalFactory(safetyGuard, receiptLog, projectRoot);
  const reviewer = new ProposalReviewer(safetyGuard, receiptLog);
  const checker = new TestPlanChecker(receiptLog);
  const repairFlow = new RepairProposalFlow(factory, receiptLog);

  const builder = new BuilderAnt("builder-review-demo");
  const auditor = new AuditorAnt("auditor-review-demo");
  const tester = new TesterAnt("tester-review-demo");
  const repairer = new RepairAnt("repair-review-demo");

  const createdProposals: CodeProposal[] = [];

  // Scenario 1: safe proposal, clean review.
  const safe = builder.proposeCode(factory, {
    missionId: "mission-review-demo",
    taskId: "ptask-review-1",
    targetRelativePath: "docs/decay-notes-addendum.md",
    changeKind: "create",
    proposedContent: "# Decay Notes Addendum\n\nWorked half-life numbers live in the walkthrough doc.\n",
    rationale: "Add an addendum pointer for operators.",
  });
  if (safe.result.ok) createdProposals.push(safe.result.proposal);
  const cleanReview = safe.result.ok
    ? auditor.reviewProposal(reviewer, safe.result.proposal, snapshot)
    : undefined;

  // Scenario 2: create-collision — README.md already exists in the snapshot.
  const colliding = builder.proposeCode(factory, {
    missionId: "mission-review-demo",
    taskId: "ptask-review-2",
    targetRelativePath: "README.md",
    changeKind: "create",
    proposedContent: "# A second readme\n\nThis collides with the existing one.\n",
    rationale: "Deliberate collision to show the reviewer catching it.",
  });
  if (colliding.result.ok) createdProposals.push(colliding.result.proposal);
  const collisionReview = colliding.result.ok
    ? auditor.reviewProposal(reviewer, colliding.result.proposal, snapshot)
    : undefined;
  const collisionFinding = collisionReview?.outcome.report.findings.find((f) => f.severity === "major");

  // Scenario 3: repair proposal with a corrected, non-colliding target.
  const repair = collisionFinding && colliding.result.ok
    ? repairer.requestRepairProposal(repairFlow, {
        finding: collisionFinding,
        originalProposal: colliding.result.proposal,
        revision: {
          targetRelativePath: "docs/readme-addendum.md",
          changeKind: "create",
          proposedContent: "# Readme Addendum\n\nContent that was going to collide now lives here.\n",
          rationale: "Repair the collision by moving the new content to its own file.",
        },
      })
    : undefined;
  if (repair?.flowResult.result?.ok) createdProposals.push(repair.flowResult.result.proposal);

  // Scenario 4: unsafe repair revision — refused by the factory, receipt
  // redacted (reason code only, no raw content or path in the audit trail).
  const unsafeRepair = collisionFinding && colliding.result.ok
    ? repairer.requestRepairProposal(repairFlow, {
        finding: collisionFinding,
        originalProposal: colliding.result.proposal,
        revision: {
          targetRelativePath: "docs/readme-addendum.md",
          changeKind: "create",
          proposedContent: "Fix by running rm -rf docs and npm install again.",
          rationale: "This revision must be refused for dangerous command text.",
        },
      })
    : undefined;

  // Tester wiring: check one verification plan as data.
  const planCheck = tester.checkTestPlan(
    checker,
    "Check that the addendum file is listed in a fresh snapshot; confirm the walkthrough links to it; expect zero review findings on re-review. Scope: docs only.",
    { missionId: "mission-review-demo", taskId: "ptask-review-3" }
  );

  // Scenario 5: everything that exists is unapplied; nothing wrote to disk.
  const allUnapplied = createdProposals.every((p) => p.applied === false);

  return {
    scenario1: { verdict: cleanReview?.outcome.verdict, findings: cleanReview?.outcome.report.findings.length },
    scenario2: {
      verdict: collisionReview?.outcome.verdict,
      majorFindingSummary: collisionFinding?.summary,
    },
    scenario3: {
      repairCreated: repair?.flowResult.result?.ok ?? false,
      repairProposalId: repair?.flowResult.result?.ok ? repair.flowResult.result.proposal.proposalId : undefined,
    },
    scenario4: {
      refused: unsafeRepair?.flowResult.result ? !unsafeRepair.flowResult.result.ok : false,
      reasonCode:
        unsafeRepair?.flowResult.result && !unsafeRepair.flowResult.result.ok
          ? unsafeRepair.flowResult.result.refusal.reasonCode
          : undefined,
    },
    scenario5: { allUnapplied, proposalCount: createdProposals.length },
    testPlanCheck: { adequate: planCheck.result.adequate, findings: planCheck.result.report.findings.length },
    allReceipts: receiptLog.list(),
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoReviewLoop(), null, 2));
}
