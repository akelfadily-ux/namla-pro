import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("FINAL-02 Automated Acceptance Gate", () => {
  it("prohibits Court-side default operation generation without evidence", () => {
    const courtContent = readFileSync(join(process.cwd(), "src/twin/namolaSovereignCourt.ts"), "utf8");
    assert.equal(courtContent.includes("BLOCKED / MISSING_AUTHORITATIVE_FILE_OPERATION"), true);
  });

  it("prohibits as any in FINAL-02 production and invariant test files", () => {
    const filesToScan = [
      "src/twin/final02/executionPlanBuilder.ts",
      "src/twin/final02/final02Coordinator.ts",
      "src/twin/final02/verificationRunner.ts",
      "src/twin/final02/regressionRunner.ts",
      "src/twin/final02/conflictEngine.ts",
      "src/tools/final02AssertionInvariantsTests.ts",
      "src/tools/final02ExecutionRuntimeTests.ts",
    ];

    for (const f of filesToScan) {
      const content = readFileSync(join(process.cwd(), f), "utf8");
      assert.equal(content.includes("as any"), false, `Found 'as any' in ${f}`);
    }
  });

  it("prohibits keyRegistry parameter in public production Final02ExecuteInput", () => {
    const coordContent = readFileSync(join(process.cwd(), "src/twin/final02/final02Coordinator.ts"), "utf8");
    assert.equal(coordContent.includes("keyRegistry?:"), false);
  });

  it("prohibits FINAL02_HARD_DISABLE_LEGACY conditional env var checks", () => {
    const mergeForgeContent = readFileSync(join(process.cwd(), "src/twin/mergeForge.ts"), "utf8");
    assert.equal(mergeForgeContent.includes("FINAL02_HARD_DISABLE_LEGACY"), false);
  });

  it("prohibits synthetic // merged from write paths in merge forge", () => {
    const mergeForgeContent = readFileSync(join(process.cwd(), "src/twin/mergeForge.ts"), "utf8");
    assert.equal(mergeForgeContent.includes("// merged from"), false);
  });

  it("prohibits authoritative Date.now() in baseline digest generation", () => {
    const mergeForgeContent = readFileSync(join(process.cwd(), "src/twin/mergeForge.ts"), "utf8");
    assert.equal(mergeForgeContent.includes("Date.now()"), false);
  });
});
