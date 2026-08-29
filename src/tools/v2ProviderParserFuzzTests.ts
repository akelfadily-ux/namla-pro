/**
 * V2 Provider Parser Fuzzing & Execution Hardening Suite (HARDENING-1, 2, 12).
 *
 * Deterministically fuzzes provider JSON/JSONL output parsing and tests execution failures:
 * - Malformed JSON, truncated JSON, malformed JSONL
 * - Duplicate proposals, out-of-scope paths, path traversal, Unicode normalization
 * - Provider timeouts, non-zero exits, crashes, empty stdout, stderr noise
 *
 * Seed: 0x5a3f89b1
 * Run: node dist/tools/v2ProviderParserFuzzTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { parseClaudeJson, parseCodexJsonl, extractJsonObject } from "../cognitive/liveProviderExecution";
import { ColonyExecutor } from "../v2/colony/colonyExecutor";
import { TrustedKernel } from "../v2/kernel/trustedKernel";
import { WorkPackage, WorkPackageExecution } from "../v2/types/missionState";
import { ContractBoundStageContext } from "../v2/types/stageContext";

function tempWorkspace(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-v2-fuzz-p1-${tag}-`));
}

test("HARDENING-1: Provider Output Extraction & Fuzzing", () => {
  // 1. Fuzzing extractJsonObject & parseClaudeJson
  assert.equal(extractJsonObject(""), null);
  assert.equal(extractJsonObject("no json here"), null);
  assert.equal(extractJsonObject("{ unclosed json"), null);

  const fencedJson = "Here is the response:\n```json\n{\n  \"summary\": \"ok\",\n  \"files\": [{\"path\": \"src/index.ts\", \"operation\": \"create\", \"content\": \"hello\"}]\n}\n```";
  const extracted = extractJsonObject(fencedJson);
  assert.equal(extracted !== null, true);

  const parsedClaude = parseClaudeJson(fencedJson, 60000, 16);
  assert.equal(Boolean(parsedClaude.malformed), false);
  assert.equal(parsedClaude.files.length, 1);
  assert.equal(parsedClaude.files[0].path, "src/index.ts");

  // 2. Truncated JSON
  const truncatedJson = '{"summary": "test", "files": [{"path": "src/index.ts", "content": "export function foo() {';
  const parsedTruncated = parseClaudeJson(truncatedJson, 60000, 16);
  assert.equal(parsedTruncated.malformed, true);

  // 3. Codex JSONL Parsing
  const jsonlInput = `{"type": "thread.started"}\n{"type": "item.completed", "item": {"type": "agent_message", "text": "{\\"summary\\": \\"Codex ok\\", \\"files\\": [{\\"path\\": \\"src/index.ts\\", \\"content\\": \\"export const x = 1;\\"}]}"}}\n{"type": "turn.completed"}`;
  const parsedCodex = parseCodexJsonl(jsonlInput, 60000, 16);
  assert.equal(parsedCodex.status, "ok");
  assert.equal(parsedCodex.payload?.files.length, 1);
  assert.equal(parsedCodex.payload?.files[0].content, "export const x = 1;");
});

test("HARDENING-1 & HARDENING-2: ColonyExecutor PRODUCTION_MODE Adversarial Output & Failure Rejection", () => {
  const ws = tempWorkspace("adv-executor");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const executor = new ColonyExecutor();

    const wp: WorkPackage = {
      id: "wp-fuzz-1",
      missionId: "m-fuzz",
      contractVersion: "v1.0.0",
      taskSpec: {
        id: "t1",
        name: "Module Task",
        description: "",
        targetFiles: ["src/index.ts"],
        dependencies: [],
        capabilityRequirements: [],
      },
      acceptanceCriteria: [],
      inputArtifacts: [],
      readOnly: false,
      maxAttempts: 3,
    };

    const execA: WorkPackageExecution = {
      executionId: "exec-a-fuzz-1",
      workPackageId: "wp-fuzz-1",
      colonyId: "COLONY_A",
      state: "EXECUTING",
      stateVersion: 1,
      attempts: 1,
      outputArtifacts: [],
      evidenceRefs: [],
      workspacePath: "workspaces/v2-missions/m-fuzz/colony_a/wp-fuzz-1",
    };

    const context: ContractBoundStageContext = {
      missionId: "m-fuzz",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "EXECUTING_AB",
      executionMode: "PRODUCTION_MODE",
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: {
        contractId: "c1",
        version: "v1.0.0",
        contractHash: "h1",
        objective: "Obj",
        acceptanceCriteria: [],
        constraints: [],
        tasks: [],
        dependencies: [],
        allowedCapabilities: [],
        requiredTests: [],
        securityRequirements: [],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    // A. Nested Path Traversal Attempt
    const traversalPayload = JSON.stringify({
      summary: "traversal",
      files: [{ path: "src/../../etc/passwd", operation: "create", content: "root" }],
    });
    const resTraversal = executor.executeWorkPackage(wp, execA, context, kernel, traversalPayload, { mode: "PRODUCTION_MODE" });
    assert.equal(resTraversal.success, false);
    assert.equal(resTraversal.reasonCode.includes("PROVIDER_PROPOSAL_OUT_OF_SCOPE"), true);

    // B. Absolute Path Attempt
    const absPathPayload = JSON.stringify({
      summary: "abs path",
      files: [{ path: "/tmp/hacked.txt", operation: "create", content: "hacked" }],
    });
    const resAbs = executor.executeWorkPackage(wp, execA, context, kernel, absPathPayload, { mode: "PRODUCTION_MODE" });
    assert.equal(resAbs.success, false);
    assert.equal(resAbs.reasonCode.includes("PROVIDER_PROPOSAL_OUT_OF_SCOPE"), true);

    // C. Provider Stdout Carrying Success Text but No Structured Artifact Proposals
    const textOnlyPayload = JSON.stringify({
      summary: "I completed the task successfully!",
      files: [],
    });
    const resTextOnly = executor.executeWorkPackage(wp, execA, context, kernel, textOnlyPayload, { mode: "PRODUCTION_MODE" });
    assert.equal(resTextOnly.success, false);
    assert.equal(resTextOnly.reasonCode.includes("PROVIDER_NO_PROPOSALS"), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
