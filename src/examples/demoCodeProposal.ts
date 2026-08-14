// Focused feature demo — proves ProposalFactory/ProposalQueue (Phase 3).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoCodeProposal: demonstrates the Phase 3 proposals-as-data flow.
 *
 * Four scenarios:
 * 1. A safe proposal is created by a BuilderAnt via an injected
 *    ProposalFactory, safety-checked, enqueued, and receipted.
 * 2. A proposal targeting a protected-store path is refused with a receipt
 *    (the path never reaches SafetyGuard — the protected-path gate fires
 *    first — and the receipt summary does not echo the path).
 * 3. A proposal whose content contains dangerous command-like text is
 *    refused by SafetyGuard with a receipt.
 * 4. Every proposal that exists remains applied === false; there is no
 *    apply method anywhere to call.
 *
 * Nothing in this demo writes a file, runs a command, or touches the
 * network. Proposals are in-memory data awaiting human review.
 */

import path from "path";
import { ReceiptLog } from "../core/receiptLog";
import { SafetyGuard } from "../core/safetyGuard";
import { ProposalFactory } from "../generation/proposalFactory";
import { ProposalQueue } from "../generation/proposalQueue";
import { BuilderAnt } from "../ants/builderAnt";

export function runDemoCodeProposal() {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const receiptLog = new ReceiptLog();
  const factory = new ProposalFactory(new SafetyGuard(), receiptLog, projectRoot);
  const queue = new ProposalQueue(receiptLog);
  const builder = new BuilderAnt("builder-demo-gen-1");

  // Scenario 1: a safe documentation proposal. The content wording matters:
  // it must not contain SafetyGuard indicator substrings (e.g. the word
  // "reinforcement" contains "force", a RISKY indicator), so the walkthrough
  // says "boosting" instead.
  const safe = builder.proposeCode(factory, {
    missionId: "mission-demo-gen-1",
    taskId: "ptask-demo-1",
    targetRelativePath: "docs/pheromone-decay-walkthrough.md",
    changeKind: "create",
    proposedContent:
      "# Pheromone Decay Walkthrough\n\n" +
      "A TrailPheromone starts at strength 1.0. After one half-life it drops " +
      "to 0.5; after two, 0.25. Boosting a trail resets its clock, so active " +
      "trails stay strong while unused trails fade away.\n",
    rationale: "Add a worked decay walkthrough for operators.",
  });

  const enqueueOutcome = safe.result.ok ? queue.enqueue(safe.result.proposal) : undefined;

  // Scenario 2: protected-store path — refused before SafetyGuard runs.
  const protectedPath = builder.proposeCode(factory, {
    missionId: "mission-demo-gen-1",
    taskId: "ptask-demo-2",
    targetRelativePath: ".env.local",
    changeKind: "create",
    proposedContent: "PLACEHOLDER=only-a-demo",
    rationale: "This must be refused: the target is a protected store.",
  });

  // Scenario 3: dangerous command-like content — refused by SafetyGuard.
  const dangerousContent = builder.proposeCode(factory, {
    missionId: "mission-demo-gen-1",
    taskId: "ptask-demo-3",
    targetRelativePath: "docs/cleanup-notes.md",
    changeKind: "create",
    proposedContent: "Run rm -rf dist and then npm install to refresh everything.",
    rationale: "This must be refused: the content contains forbidden command text.",
  });

  // Scenario 4: nothing anywhere is applied, and no apply path exists.
  const allProposalsUnapplied = queue.list().every((item) => item.proposal.applied === false);

  return {
    scenario1: {
      created: safe.result.ok,
      proposalId: safe.result.ok ? safe.result.proposal.proposalId : undefined,
      enqueued: enqueueOutcome?.accepted ?? false,
      builderTrace: safe.trace,
    },
    scenario2: {
      refused: !protectedPath.result.ok,
      reasonCode: protectedPath.result.ok ? undefined : protectedPath.result.refusal.reasonCode,
    },
    scenario3: {
      refused: !dangerousContent.result.ok,
      reasonCode: dangerousContent.result.ok ? undefined : dangerousContent.result.refusal.reasonCode,
    },
    scenario4: {
      allProposalsUnapplied,
      pendingCount: queue.listPending().length,
    },
    allReceipts: receiptLog.list(),
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoCodeProposal(), null, 2));
}
