// Focused semantic regression harness for all demo baselines (AH2 Step 5).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoGoldenOutputs: runs every demo once in-process (direct runner
 * imports — no subprocesses, no console parsing), digests each result,
 * and evaluates it against its semantic baseline.
 *
 * A crash in one demo is caught and reported as a safe category (name +
 * error type only — never a message, stack trace, or path) so it cannot
 * hide the others. The final report carries counts, names, and failure
 * codes only.
 */

import { createDemoDigest } from "../tools/demoDigest";
import { evaluateAllDemoGoldens, DemoGoldenExpectation } from "../tools/demoGolden";
import { DEMO_GOLDEN_BASELINES } from "../tools/demoGoldenBaselines";

import { runDemoMission } from "./demoMission";
import { runDemoPheromoneFlow } from "./demoPheromoneFlow";
import { runDemoSensesLoop } from "./demoSensesLoop";
import { runDemoSafetyBlock } from "./demoSafetyBlock";
import { runDemoInspector } from "./demoInspector";
import { runDemoMissionPlanning } from "./demoMissionPlanning";
import { runDemoCodeProposal } from "./demoCodeProposal";
import { runDemoReviewLoop } from "./demoReviewLoop";
import { runDemoGitProposal } from "./demoGitProposal";
import { runDemoColonySimulation } from "./demoColonySimulation";
import { runDemoAgentAdapters } from "./demoAgentAdapters";
import { runDemoBotDesktopPlan } from "./demoBotDesktopPlan";
import { runDemoEndToEnd } from "./demoEndToEnd";
import { runDemoAntRoleRegistry } from "./demoAntRoleRegistry";
import { runDemoSafetyMatcher } from "./demoSafetyMatcher";
import { runDemoReceiptIsolation } from "./demoReceiptIsolation";
import { runDemoReceiptStatusSemantics } from "./demoReceiptStatusSemantics";
import { runDemoEngineMissionRefusal } from "./demoEngineMissionRefusal";
import { runDemoCreateApprovalContracts } from "./demoCreateApprovalContracts";
import { runDemoCreateDryRun } from "./demoCreateDryRun";
import { runDemoC2AuthorityContracts } from "./demoC2AuthorityContracts";
import { runDemoC2ExclusiveCreateSimulation } from "./demoC2ExclusiveCreateSimulation";
import { runDemoColonyGenesisG0 } from "./demoColonyGenesisG0";
import { runDemoColonyGenesis } from "./demoColonyGenesis";
import { runDemoColonyScale } from "./demoColonyScale";
import { runDemoRealCognitiveColony } from "./demoRealCognitiveColony";
import { runDemoAntIntelligenceDeepening } from "./demoAntIntelligenceDeepening";
import { runDemoRealCognitiveAntsR1 } from "./demoRealCognitiveAntsR1";
import { runDemoRealProviderActivationR2 } from "./demoRealProviderActivationR2";
import { runDemoAntAcademyV1 } from "./demoAntAcademyV1";
import { runDemoRealAcademyPilotV2 } from "./demoRealAcademyPilotV2";
import { runDemoDigitalSuperorganismV1 } from "./demoDigitalSuperorganismV1";
import { runDemoDigitalSuperorganismOperationsV2 } from "./demoDigitalSuperorganismOperationsV2";
import { runDemoDigitalLiveObjectiveV3 } from "./demoDigitalLiveObjectiveV3";
import { runDemoDigitalLiveObjectiveV4Wiring } from "./demoDigitalLiveObjectiveV4Wiring";
import { runDemoCodexInvocationFix } from "./demoCodexInvocationFix";
import { runDemoLiveObjectivePreSpawn } from "./demoLiveObjectivePreSpawn";
import { runDemoNamlaCivilizationOSV1 } from "./demoNamlaCivilizationOSV1";
import { runDemoNamlaCivilizationLiveV2 } from "./demoNamlaCivilizationLiveV2";
import { runDemoTamaraNamlaFederationV3 } from "./demoTamaraNamlaFederationV3";
import { runDemoNamolaTwinEmpireV1 } from "./demoNamolaTwinEmpireV1";

const DEMO_RUNNERS: Record<string, () => unknown> = {
  demoMission: runDemoMission,
  demoPheromoneFlow: runDemoPheromoneFlow,
  demoSensesLoop: runDemoSensesLoop,
  demoSafetyBlock: runDemoSafetyBlock,
  demoInspector: runDemoInspector,
  demoMissionPlanning: runDemoMissionPlanning,
  demoCodeProposal: runDemoCodeProposal,
  demoReviewLoop: runDemoReviewLoop,
  demoGitProposal: runDemoGitProposal,
  demoColonySimulation: runDemoColonySimulation,
  demoAgentAdapters: runDemoAgentAdapters,
  demoBotDesktopPlan: runDemoBotDesktopPlan,
  demoEndToEnd: runDemoEndToEnd,
  demoAntRoleRegistry: runDemoAntRoleRegistry,
  demoSafetyMatcher: runDemoSafetyMatcher,
  demoReceiptIsolation: runDemoReceiptIsolation,
  demoReceiptStatusSemantics: runDemoReceiptStatusSemantics,
  demoEngineMissionRefusal: runDemoEngineMissionRefusal,
  demoCreateApprovalContracts: runDemoCreateApprovalContracts,
  demoCreateDryRun: runDemoCreateDryRun,
  demoC2AuthorityContracts: runDemoC2AuthorityContracts,
  demoC2ExclusiveCreateSimulation: runDemoC2ExclusiveCreateSimulation,
  demoColonyGenesisG0: runDemoColonyGenesisG0,
  demoColonyGenesis: runDemoColonyGenesis,
  demoColonyScale: runDemoColonyScale,
  demoRealCognitiveColony: runDemoRealCognitiveColony,
  demoAntIntelligenceDeepening: runDemoAntIntelligenceDeepening,
  demoRealCognitiveAntsR1: runDemoRealCognitiveAntsR1,
  demoRealProviderActivationR2: runDemoRealProviderActivationR2,
  demoAntAcademyV1: runDemoAntAcademyV1,
  demoRealAcademyPilotV2: runDemoRealAcademyPilotV2,
  demoDigitalSuperorganismV1: runDemoDigitalSuperorganismV1,
  demoDigitalSuperorganismOperationsV2: runDemoDigitalSuperorganismOperationsV2,
  demoDigitalLiveObjectiveV3: runDemoDigitalLiveObjectiveV3,
  demoDigitalLiveObjectiveV4Wiring: runDemoDigitalLiveObjectiveV4Wiring,
  demoCodexInvocationFix: runDemoCodexInvocationFix,
  demoLiveObjectivePreSpawn: runDemoLiveObjectivePreSpawn,
  demoNamlaCivilizationOSV1: runDemoNamlaCivilizationOSV1,
  demoNamlaCivilizationLiveV2: runDemoNamlaCivilizationLiveV2,
  demoTamaraNamlaFederationV3: runDemoTamaraNamlaFederationV3,
  demoNamolaTwinEmpireV1: runDemoNamolaTwinEmpireV1,
};

interface CrashReport {
  demoName: string;
  errorCategory: "runner-crash";
  errorTypeName: string;
}

export function runDemoGoldenOutputs() {
  const entries: Array<{ digest: ReturnType<typeof createDemoDigest>; expectation: DemoGoldenExpectation }> = [];
  const crashes: CrashReport[] = [];
  const missingBaselines: string[] = [];

  for (const [demoName, runner] of Object.entries(DEMO_RUNNERS)) {
    const expectation = DEMO_GOLDEN_BASELINES[demoName];
    if (!expectation) {
      missingBaselines.push(demoName);
      continue;
    }

    try {
      const result = runner();
      entries.push({ digest: createDemoDigest(result, demoName), expectation });
    } catch (error) {
      crashes.push({
        demoName,
        errorCategory: "runner-crash",
        errorTypeName: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  const totals = evaluateAllDemoGoldens(entries);

  return {
    totalDemos: Object.keys(DEMO_RUNNERS).length,
    passedDemos: totals.passedDemos,
    failedDemos: totals.failedDemos + crashes.length + missingBaselines.length,
    failedDemoNames: [
      ...totals.failedDemoNames,
      ...crashes.map((c) => c.demoName),
      ...missingBaselines,
    ],
    totalExpectationChecks: totals.totalExpectationChecks,
    failedExpectationChecks: totals.failedExpectationChecks,
    failureReasonCodes: totals.failureReasonCodes,
    failures: totals.results.flatMap((r) => r.failures),
    crashes,
    crashCount: crashes.length,
    baselineCoverageComplete: missingBaselines.length === 0,
    allGoldensPassed:
      totals.allGoldensPassed && crashes.length === 0 && missingBaselines.length === 0,
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoGoldenOutputs(), null, 2));
}
