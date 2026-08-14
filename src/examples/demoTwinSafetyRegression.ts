/**
 * demoTwinSafetyRegression — deterministic regressions for the twin-empire safety
 * invariants that must never silently weaken again:
 *
 *   1. Detected fake test evidence makes SilentWitness `integrityIntact` FALSE.
 *   2. The Namola sovereign court rejects fake test evidence through BOTH
 *      independent detectors (the witness count AND an admitted
 *      `invalid-test-evidence` finding), each sufficient on its own.
 *   3. Valid colony project paths are ACCEPTED (no extension allowlist):
 *      .tsx, .css, .mdx, .sh, dotfiles, and extensionless files included.
 *   4. Traversal, absolute (Windows + Unix), repository-control, empty, and
 *      null-byte paths are REJECTED with precise reason codes.
 *
 * Fakes only: no fs, no child_process, no network, no provider calls.
 */

import { SilentWitness } from "../twin/silentWitness";
import { validateColonyRelPath, ColonyWorkspaceAuthority, ColonyIsolationBoundary } from "../twin/colonyWorkspace";
import { evaluateHardRejections, renderNamolaDecision } from "../twin/namolaSovereignCourt";
import type { NamolaCourtInput } from "../twin/namolaSovereignCourt";
import { runColonyForge } from "../twin/colonyForge";
import type { TwinMissionPacket, ColonyProfile } from "../twin/colonyForge";
import { buildSettlementWorkers } from "../civilization/civilizationLiveRunner";

const SEED = 20260915;
const MISSION_ID = "twin-safety-regression";
const ACCEPTANCE: readonly string[] = ["tasks CRUD + completion", "in-memory storage", "unit tests present"];

/** Paths a colony may legitimately propose inside its OWN workspace. */
const VALID_PATHS: readonly string[] = ["src/index.ts", "src/index.tsx", "src/styles.css", "docs/guide.mdx", ".gitignore", ".eslintrc.json", "Dockerfile", "LICENSE", "bin/run.sh", "package.json", "README.md", "test/taskManager.test.ts"];

/** Paths that must always be refused, with the exact expected reason code. */
const REJECTED_PATHS: readonly { readonly path: string; readonly reason: string }[] = [
  { path: "../escape.ts", reason: "path-traversal" },
  { path: "../../etc/passwd", reason: "path-traversal" },
  { path: "src/../../out.ts", reason: "path-traversal" },
  { path: "C:/Windows/system32/hosts", reason: "absolute-path" },
  { path: "D:\\temp\\evil.ts", reason: "absolute-path" },
  { path: "/etc/passwd", reason: "absolute-path" },
  { path: "\\\\server\\share\\x.ts", reason: "absolute-path" },
  { path: ".git/config", reason: "source-tree-path" },
  { path: "node_modules/pkg/index.js", reason: "source-tree-path" },
  { path: "", reason: "outside-workspace" },
  { path: "src/\0evil.ts", reason: "outside-workspace" },
  { path: "~/secrets.ts", reason: "outside-workspace" },
];

function buildBundles() {
  const workers = buildSettlementWorkers(SEED, 1000);
  const packet: TwinMissionPacket = { missionId: MISSION_ID, objective: "small TypeScript task manager", acceptanceCriteria: ACCEPTANCE, seed: SEED };
  const claudeProfile: ColonyProfile = { colonyId: "claude-forge", culture: "architecture-first", masterAntId: workers[0].workerId, workers: workers.slice(0, 440), seedOffset: 1 };
  const codexProfile: ColonyProfile = { colonyId: "codex-crucible", culture: "implementation-first", masterAntId: workers[440].workerId, workers: workers.slice(440, 880), seedOffset: 2 };
  return { claude: runColonyForge(claudeProfile, packet), codex: runColonyForge(codexProfile, packet) };
}

export function runDemoTwinSafetyRegression() {
  // --- 1. Witness integrity vs fake test evidence ---------------------------
  const cleanWitness = new SilentWitness();
  const cleanReport = cleanWitness.report();

  const fakeWitness = new SilentWitness();
  fakeWitness.recordAnomaly("fake-test-evidence");
  const fakeReport = fakeWitness.report();

  // --- 2. Sovereign court rejection through BOTH detectors ------------------
  const { claude, codex } = buildBundles();
  const baseInput: NamolaCourtInput = { claude, codex, admittedFindings: [], dominanceDecisions: [], residualUncertainty: [], witness: cleanReport, acceptance: ACCEPTANCE, budget: { maxMergeComponents: 4 } };

  const cleanChecks = evaluateHardRejections(baseInput);
  const cleanFakeCheck = cleanChecks.find((c) => c.id === "no-fake-test-evidence-accepted");

  // (a) witness-count detector alone must fail the check + abort the decision.
  const witnessOnlyInput: NamolaCourtInput = { ...baseInput, witness: fakeReport };
  const witnessOnlyCheck = evaluateHardRejections(witnessOnlyInput).find((c) => c.id === "no-fake-test-evidence-accepted");
  const witnessOnlyDecision = renderNamolaDecision(witnessOnlyInput);

  // (b) admitted-finding detector alone must fail the check + reject.
  const findingOnlyInput: NamolaCourtInput = { ...baseInput, admittedFindings: [{ findingId: "f-fake", findingCategory: "invalid-test-evidence" }] };
  const findingOnlyCheck = evaluateHardRejections(findingOnlyInput).find((c) => c.id === "no-fake-test-evidence-accepted");
  const findingOnlyDecision = renderNamolaDecision(findingOnlyInput);

  // --- 3 & 4. Path validation ------------------------------------------------
  const validResults = VALID_PATHS.map((p) => ({ path: p, reason: validateColonyRelPath(p) }));
  const rejectedResults = REJECTED_PATHS.map((r) => ({ ...r, actual: validateColonyRelPath(r.path) }));

  // A valid path must also be writable into the colony's own workspace, and a
  // rejected one must not be (end-to-end through the authority).
  const authority = new ColonyWorkspaceAuthority();
  const ws = `workspaces/namola-twin/${MISSION_ID}/claude-forge`;
  const writeValid = authority.write(ws, "src/index.tsx", "export const App = () => null;");
  const writeDotfile = authority.write(ws, ".gitignore", "dist/");
  const writeTraversal = authority.write(ws, "../escape.ts", "// nope");
  // The workspace-ID level still refuses a Namla source-tree target.
  const boundary = new ColonyIsolationBoundary(authority);
  const sourceTreeRead = boundary.read({ requestingColony: "claude-forge", targetWorkspaceId: "src/twin", relPath: "colonyWorkspace.ts", targetFrozen: true });

  const allValidAccepted = validResults.every((r) => r.reason === "ok");
  const allRejectedRefused = rejectedResults.every((r) => r.actual === r.reason);

  const specs: Array<[string, boolean]> = [
    // 1. witness
    ["clean-witness-integrity-true", cleanReport.integrityIntact === true && cleanReport.fakeTestEvidenceDetected === 0],
    ["fake-test-evidence-makes-integrity-false", fakeReport.fakeTestEvidenceDetected === 1 && fakeReport.integrityIntact === false],
    // 2. court
    ["clean-court-fake-check-passes", cleanFakeCheck !== undefined && cleanFakeCheck.passed === true],
    ["court-rejects-on-witness-count-alone", witnessOnlyCheck !== undefined && witnessOnlyCheck.passed === false],
    ["court-aborts-or-rejects-on-witness-count", witnessOnlyDecision.decision === "SAFELY_ABORT" || witnessOnlyDecision.decision === "REJECT_BOTH"],
    ["court-rejects-on-admitted-finding-alone", findingOnlyCheck !== undefined && findingOnlyCheck.passed === false],
    ["court-rejects-decision-on-admitted-finding", findingOnlyDecision.decision === "REJECT_BOTH" && findingOnlyDecision.decisionReason.includes("no-fake-test-evidence-accepted")],
    // 3. valid paths
    ["all-valid-project-paths-accepted", allValidAccepted],
    ["tsx-css-mdx-sh-accepted", ["src/index.tsx", "src/styles.css", "docs/guide.mdx", "bin/run.sh"].every((p) => validateColonyRelPath(p) === "ok")],
    ["dotfiles-and-extensionless-accepted", [".gitignore", ".eslintrc.json", "Dockerfile", "LICENSE"].every((p) => validateColonyRelPath(p) === "ok")],
    ["valid-path-writes-succeed", writeValid === "ok" && writeDotfile === "ok" && authority.fileCount(ws) === 2],
    // 4. rejected paths
    ["all-invalid-paths-rejected-with-exact-reason", allRejectedRefused],
    ["traversal-write-refused", writeTraversal === "path-traversal"],
    ["namla-source-tree-workspace-refused", sourceTreeRead.ok === false && sourceTreeRead.reasonCode === "source-tree-path"],
    // real-action counters
    ["realFilesystemWrites==0", authority.realWrites === 0],
    ["realProviderCalls==0", claude.costReport.realProviderCalls === 0 && codex.costReport.realProviderCalls === 0],
  ];
  const mismatchCaseIds = specs.filter(([, ok]) => !ok).map(([id]) => id);

  return {
    moduleName: "demoTwinSafetyRegression",
    cleanWitnessIntegrity: cleanReport.integrityIntact,
    fakeWitnessIntegrity: fakeReport.integrityIntact,
    fakeTestEvidenceDetected: fakeReport.fakeTestEvidenceDetected,
    witnessOnlyDecision: witnessOnlyDecision.decision,
    findingOnlyDecision: findingOnlyDecision.decision,
    validPathsAccepted: validResults.filter((r) => r.reason === "ok").length,
    validPathsTotal: VALID_PATHS.length,
    rejectedPathsRefused: rejectedResults.filter((r) => r.actual === r.reason).length,
    rejectedPathsTotal: REJECTED_PATHS.length,
    unexpectedPathOutcomes: [...validResults.filter((r) => r.reason !== "ok").map((r) => `${r.path}->${r.reason}`), ...rejectedResults.filter((r) => r.actual !== r.reason).map((r) => `${r.path}->${r.actual}(want ${r.reason})`)],
    realFilesystemWrites: authority.realWrites,
    realProviderCalls: 0,
    realNetworkCalls: 0,
    processExecutions: 0,
    expectationsChecked: specs.length,
    mismatchCaseIds,
    allExpectationsMet: mismatchCaseIds.length === 0,
  };
}

if (require.main === module) {
  const out = runDemoTwinSafetyRegression();
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.allExpectationsMet ? 0 : 1);
}
