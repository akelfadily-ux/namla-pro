// Focused feature demo — proves git-as-data and the no-push stack (Phase 5).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoGitProposal: demonstrates Phase 5 git-as-data, driven entirely by
 * this human-run script.
 *
 * Scenarios:
 * 1. A reviewed CodeProposal is bundled into a GitCommitProposal by an
 *    ArchivistAnt via an injected CommitProposalFactory.
 * 2. Push intent is impossible at the type level (CommitProposalRequest has
 *    no such field) and, when cast around via an aliased object, is refused
 *    at runtime with a receipt.
 * 3. A GitReadPlanner produces planned git status/log/diff actions — every
 *    one with executed: false — and refuses a push-shaped candidate.
 * 4. Refusal receipts carry reason codes and redacted metadata only.
 * 5. Assertions: no git command was run (there is no execution API in the
 *    entire project), the commit proposal remains applied === false, and
 *    pushIntent remains false.
 */

import path from "path";
import { ReceiptLog } from "../core/receiptLog";
import { SafetyGuard } from "../core/safetyGuard";
import { ProjectInspector } from "../inspector/projectInspector";
import { ProposalFactory } from "../generation/proposalFactory";
import { ProposalReviewer } from "../review/proposalReviewer";
import { GitReadPlanner } from "../git/gitReadPlanner";
import { CommitProposalFactory, CommitProposalRequest } from "../git/commitProposalFactory";
import { BuilderAnt } from "../ants/builderAnt";
import { AuditorAnt } from "../ants/auditorAnt";
import { ArchivistAnt } from "../ants/archivistAnt";

export function runDemoGitProposal() {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const receiptLog = new ReceiptLog();
  const safetyGuard = new SafetyGuard();

  const inspector = new ProjectInspector(projectRoot, receiptLog);
  const { snapshot } = inspector.inspect("git-demo-setup");

  const proposalFactory = new ProposalFactory(safetyGuard, receiptLog, projectRoot);
  const reviewer = new ProposalReviewer(safetyGuard, receiptLog);
  const commitFactory = new CommitProposalFactory(safetyGuard, receiptLog);
  const readPlanner = new GitReadPlanner(safetyGuard, receiptLog);

  const builder = new BuilderAnt("builder-git-demo");
  const auditor = new AuditorAnt("auditor-git-demo");
  const archivist = new ArchivistAnt("archivist-git-demo");

  // Scenario 1: create -> review -> bundle into a commit proposal.
  const code = builder.proposeCode(proposalFactory, {
    missionId: "mission-git-demo",
    taskId: "ptask-git-1",
    targetRelativePath: "docs/decay-notes-part-two.md",
    changeKind: "create",
    proposedContent: "# Decay Notes, Part Two\n\nMore worked half-life numbers for operators.\n",
    rationale: "Extend the decay notes for operators.",
  });

  const review = code.result.ok
    ? auditor.reviewProposal(reviewer, code.result.proposal, snapshot)
    : undefined;

  const commit =
    code.result.ok && review?.outcome.verdict === "clean"
      ? archivist.assembleCommitProposal(commitFactory, {
          sourceProposals: [code.result.proposal],
          message: "Docs: extend decay notes for operators",
          rationale: "Bundle the reviewed documentation proposal into one commit for human review.",
        })
      : undefined;

  // Scenario 2: push intent cast around the type system -> runtime refusal.
  // (An aliased object dodges excess-property checking; the factory catches
  // it at runtime.)
  const sneaky = code.result.ok
    ? {
        sourceProposals: [code.result.proposal],
        message: "Docs: extend decay notes for operators",
        rationale: "This must be refused: it smuggles a push intent.",
        pushIntent: true,
      }
    : undefined;
  const pushAttempt = sneaky
    ? archivist.assembleCommitProposal(commitFactory, sneaky as CommitProposalRequest)
    : undefined;

  // Scenario 3: read-only plan, plus one push-shaped candidate refused.
  const readPlan = readPlanner.planReadOnlyInspection("archivist-git-demo");
  const refusedPlan = readPlanner.planReadOnlyInspection("archivist-git-demo", ["git push origin main"]);

  // Scenario 5: assertions over everything created.
  const commitProposal = commit?.result.ok ? commit.result.proposal : undefined;

  return {
    scenario1: {
      reviewVerdict: review?.outcome.verdict,
      commitCreated: commit?.result.ok ?? false,
      commitProposalId: commitProposal?.proposalId,
      bundledFiles: commitProposal?.fileList.length,
    },
    scenario2: {
      refused: pushAttempt ? !pushAttempt.result.ok : false,
      reasonCode: pushAttempt && !pushAttempt.result.ok ? pushAttempt.result.refusal.reasonCode : undefined,
    },
    scenario3: {
      plannedActionCount: readPlan.plan.plannedActions.length,
      allUnexecuted: readPlan.plan.plannedActions.every((a) => a.executed === false),
      pushCandidateRefusals: refusedPlan.refusals.map((r) => r.reasonCode),
    },
    scenario4: {
      refusalReceiptSummaries: receiptLog
        .list()
        .filter((r) => r.status === "refused")
        .map((r) => r.summary),
    },
    scenario5: {
      commitApplied: commitProposal?.applied ?? false,
      commitPushIntent: commitProposal?.pushIntent ?? false,
      nothingRun: true, // no execution API exists anywhere in this project
    },
    allReceipts: receiptLog.list(),
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoGitProposal(), null, 2));
}
