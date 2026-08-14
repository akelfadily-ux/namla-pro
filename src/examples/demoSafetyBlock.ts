// Focused feature demo — proves SafetyGuard refusal + blocked receipt (Phase 0).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoSafetyBlock: shows SafetyGuard rejecting a dangerous instruction, and
 * PheromoneBus/ReceiptLog recording the refusal. Illustrative only.
 */

import { SafetyGuard } from "../core/safetyGuard";
import { ReceiptLog } from "../core/receiptLog";
import { PheromoneBus } from "../core/pheromoneBus";

export function runDemoSafetyBlock() {
  const guard = new SafetyGuard();
  const receipts = new ReceiptLog();
  const pheromones = new PheromoneBus();

  const dangerousInstruction = "Run npm install and then git push to production.";
  const decision = guard.evaluateText(dangerousInstruction);

  pheromones.emit({
    type: "BlockedActionPheromone",
    emittedByAntId: "guard-demo-1",
    topic: "dangerous-instruction",
    payload: { level: decision.level },
  });

  const receipt = receipts.create({
    summary: `Instruction blocked at level ${decision.level}.`,
    status: "blocked",
    details: { reasons: decision.reasons },
  });

  return { decision, receipt, pheromones: pheromones.list() };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoSafetyBlock(), null, 2));
}
