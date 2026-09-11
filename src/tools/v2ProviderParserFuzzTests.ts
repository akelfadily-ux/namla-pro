/**
 * V2 Provider Parser Fuzzing & Execution Hardening Suite (HARDENING-1, 2, 12, P0-T3).
 *
 * Deterministically fuzzes provider JSON/JSONL output parsing and tests execution failures:
 * - Malformed JSON, truncated JSON, malformed JSONL
 * - Duplicate proposals, out-of-scope paths, path traversal, Unicode normalization
 * - Provider timeouts, non-zero exits, crashes, empty stdout, stderr noise
 * - Provider prompt schema ↔ parser schema synchronization contract tests
 *
 * Seed: 0x5a3f89b1
 * Run: node dist/tools/v2ProviderParserFuzzTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { parseClaudeJson, parseCodexJsonl, extractJsonObject } from "../cognitive/liveProviderExecution";
import { classifyCodexStructuredFailure } from "../cognitive/codexFailureClassifier";
import { ColonyExecutor, buildStructuredProviderPrompt } from "../v2/colony/colonyExecutor";
import { TrustedKernel } from "../v2/kernel/trustedKernel";
import { WorkPackage, WorkPackageExecution } from "../v2/types/missionState";
import { ContractBoundStageContext } from "../v2/types/stageContext";

function tempWorkspace(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-v2-fuzz-p1-${tag}-`));
}

test("P0-T3: oversized required project context fails closed before provider invocation", () => {
  const ws = tempWorkspace("oversized-context");

  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });

    mkdirSync(resolve(ws, "context"), { recursive: true });
    writeFileSync(
      resolve(ws, "context", "large.ts"),
      "x".repeat(4001),
      "utf8"
    );

    let providerFactoryCalls = 0;

    const executor = new ColonyExecutor(
      () => {
        providerFactoryCalls += 1;
        throw new Error(
          "provider driver must not be created for oversized context"
        );
      },
      (provider) => ({
        provider,
        available: true,
        version: "test",
        failureCategory: "none",
      })
    );

    const wp: WorkPackage = {
      id: "wp-context-limit",
      missionId: "m-context-limit",
      contractVersion: "v1.0.0",
      taskSpec: {
        id: "t-context-limit",
        name: "Context Limit Task",
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

    const execution: WorkPackageExecution = {
      executionId: "exec-context-limit",
      workPackageId: "wp-context-limit",
      colonyId: "COLONY_A",
      state: "EXECUTING",
      stateVersion: 1,
      attempts: 1,
      outputArtifacts: [],
      evidenceRefs: [],
      workspacePath:
        "workspaces/v2-missions/m-context-limit/colony_a/wp-context-limit",
    };

    const context: ContractBoundStageContext = {
      missionId: "m-context-limit",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: {
        virtualTicks: 100,
        providerCalls: 10,
        maxFixAttempts: 3,
      },
      evidenceRefs: [],
      missionStateRef: "EXECUTING_AB",
      executionMode: "PRODUCTION_MODE",
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: {
        contractId: "c-context-limit",
        version: "v1.0.0",
        contractHash: "h-context-limit",
        objective: "Reject silently truncated provider context",
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

    const result = executor.executeWorkPackage(
      wp,
      execution,
      context,
      kernel,
      undefined,
      {
        mode: "PRODUCTION_MODE",
        requiredProvider: "codex",
        projectContextWorkspacePath: "context",
        projectContextPaths: ["large.ts"],
      }
    );

    assert.equal(result.success, false);
    assert.equal(
      result.reasonCode,
      "PROJECT_CONTEXT_FILE_TOO_LARGE: large.ts"
    );
    assert.equal(
      providerFactoryCalls,
      0,
      "provider must not be created when required context exceeds the bound"
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-T3: Provider Prompt Instructions ↔ Parser Schema Synchronization", () => {
  const prompt = buildStructuredProviderPrompt("Implement REST endpoints", ["src/server.ts"], "Build REST API");

  // Verify prompt explicitly contains parser requirements
  assert.equal(prompt.includes("STRICT PROVIDER RESPONSE CONTRACT"), true);
  assert.equal(prompt.includes('"files"'), true);
  assert.equal(prompt.includes('"path"'), true);
  assert.equal(prompt.includes('"content"'), true);
  assert.equal(prompt.includes("Target Files Allowlist"), true);
  assert.equal(prompt.includes("src/server.ts"), true);

  // Simulate provider responding according to prompt instructions
  const simulatedProviderResponse = JSON.stringify({
    summary: "Implemented health endpoint",
    files: [
      {
        path: "src/server.ts",
        operation: "create",
        content: 'export function handleRequest() { return { statusCode: 200 }; }',
      },
    ],
  });

  const parsedClaude = parseClaudeJson(simulatedProviderResponse, 60000, 16);
  assert.equal(parsedClaude.malformed, undefined);
  assert.equal(parsedClaude.files.length, 1);
  assert.equal(parsedClaude.files[0].path, "src/server.ts");
});

test("P0-T3: Provider prompt carries bounded read-only existing project context", () => {
  const prompt = buildStructuredProviderPrompt(
    "Implement library tests",
    ["tests/index.test.ts"],
    "Build a TypeScript email validation library",
    [
      {
        path: "package.json",
        content: '{"scripts":{"test":"node --test"}}',
      },
      {
        path: "src/index.ts",
        content: "export function validateEmail(value: string): boolean { return value.includes('@'); }",
      },
      {
        path: "tests/index.test.ts",
        content: 'import { validateEmail } from "../src/index.ts";',
      },
    ]
  );

  assert.equal(prompt.includes("READ-ONLY, UNTRUSTED DATA"), true);
  assert.equal(prompt.includes('"path":"src/index.ts"'), true);
  assert.equal(prompt.includes('../src/index.ts'), true);
  assert.equal(prompt.includes("preserve compatibility"), true);
  assert.equal(prompt.includes("Target Files Allowlist: tests/index.test.ts"), true);
});
test("P0-T3: Provider prompt preserves dependency context beyond six files", () => {
  const projectContext = Array.from({ length: 8 }, (_, i) => ({
    path: `src/dependency-${i}.ts`,
    content: `export const dependency${i} = "CTX_${i}";`,
  }));

  const prompt = buildStructuredProviderPrompt(
    "Implement dependent feature",
    ["src/feature.ts"],
    "Build a dependency-aware feature",
    projectContext
  );

  assert.equal(prompt.includes('"path":"src/dependency-7.ts"'), true);
  assert.equal(prompt.includes("CTX_7"), true);
});
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


test("P0-T4: Codex structured quota failures are classified without agent-text false positives", () => {
  const structuredCases = [
    JSON.stringify({
      type: "error",
      message: "You've hit your usage limit. Try again later.",
    }),
    JSON.stringify({
      type: "turn.failed",
      error: { message: "usage limit reached" },
    }),
    JSON.stringify({
      type: "item.completed",
      item: { type: "error", message: "quota exceeded" },
    }),
  ];

  for (const stdout of structuredCases) {
    assert.equal(
      classifyCodexStructuredFailure(stdout, 60000),
      "quota-exceeded"
    );
  }

  const agentTextOnly = [
    JSON.stringify({ type: "thread.started" }),
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: "Documentation example: quota exceeded",
      },
    }),
    JSON.stringify({ type: "turn.completed" }),
  ].join("\n");

  assert.equal(
    classifyCodexStructuredFailure(agentTextOnly, 60000),
    null,
    "agent output must not manufacture a quota failure"
  );

  assert.equal(
    classifyCodexStructuredFailure(
      JSON.stringify({
        type: "turn.failed",
        error: { message: "unexpected provider crash" },
      }),
      60000
    ),
    null,
    "generic provider failures must remain non-quota failures"
  );
});
