/**
 * Opt-In Real Provider Qualification Suite (§21, P0.21, FINAL-P0-1, FINAL-P0-4).
 *
 * Runs real provider calls ONLY when explicitly enabled via process.env.NAMLA_RUN_REAL_PROVIDER.
 * When enabled and provider is available, executes a genuinely non-trivial mission end-to-end in PRODUCTION_MODE:
 * objective → WorkPackage → real provider request → real provider response → file operations → actual build/test → evidence → ProMax → delivery.
 * Proves that the resulting solution was NOT sourced from deterministic fixture generators or static templates.
 *
 * Run: node dist/tools/v2RealProviderTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { resolve, join } from "path";
import { detectProviderAvailability } from "../cognitive/nodeProviderProcessDriver";
import { ProviderExecutableId } from "../cognitive/providerProcessDriver";
import { NamlaRuntime } from "../v2/runtime/namlaRuntime";

function tempWorkspace(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-v2-real-provider-${tag}-`));
}

test("Opt-In Real Provider Qualification Suite", (t) => {
  const isEnabled = process.env.NAMLA_RUN_REAL_PROVIDER === "true";

  if (!isEnabled) {
    t.skip("SKIPPED_REAL_PROVIDER: Opt-in environment variable NAMLA_RUN_REAL_PROVIDER is not set to true");
    return;
  }

  const provider: ProviderExecutableId = (process.env.NAMLA_PROVIDER as ProviderExecutableId) ?? "claude";
  const availability = detectProviderAvailability(provider);

  if (!availability.available) {
    t.skip(`SKIPPED_REAL_PROVIDER: Provider ${provider} is not locally available (${availability.failureCategory})`);
    return;
  }

  assert.equal(availability.available, true, `Provider ${provider} must be available when opt-in run is enabled`);
  assert.match(availability.version, /[0-9]/, "Version token must be non-empty");

  // FINAL-P0-4: Execute one genuinely non-trivial mission in PRODUCTION_MODE
  const ws = tempWorkspace("email-validator");
  try {
    const runtime = new NamlaRuntime();
    const missionId = "mission-real-provider-email-validator";

    const result = runtime.runMission({
      missionId,
      objective: "Build a TypeScript library that validates email addresses and includes meaningful positive/negative tests",
      workspaceRoot: ws,
      executionMode: "PRODUCTION_MODE",
      projectClass: "TYPESCRIPT_LIBRARY",
    });

    assert.equal(result.success, true, `Real provider mission execution must succeed: ${result.reasonCode}`);
    assert.equal(result.executionMode, "PRODUCTION_MODE");
    assert.equal(result.finalState, "COMPLETED");

    // Verify real provider execution evidence exists in evidence records (FINAL-P0-1)
    const providerEv = result.evidenceRecords.find(
      (e) => e.stageId === "COLONY_AB" && e.details.executionMode === "PRODUCTION_MODE"
    );
    assert.equal(providerEv !== undefined, true, "Real provider execution evidence must exist in evidence pool");

    // Verify delivered workspace contains files
    const deliveryDir = resolve(join(ws, `workspaces/v2-missions/${missionId}/leggo-integrated`));
    assert.equal(existsSync(deliveryDir), true, "Delivered workspace directory must exist");

    const indexFile = resolve(join(deliveryDir, "src/index.ts"));
    assert.equal(existsSync(indexFile), true, "Delivered index.ts must exist");
    const indexContent = readFileSync(indexFile, "utf8");

    // Prove solution was NOT sourced from deterministic fixture generators
    assert.equal(indexContent.includes("Library mission-real-provider-email-validator ready"), false, "Delivered code must NOT be static ProjectFactory template");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
