/**
 * NAMLA PRO V2 End-to-End Acceptance Qualification Suite (§14, P0.8).
 *
 * Clean-room E2E qualification across all 7 project classes with NO injected solution code:
 * 1. TYPESCRIPT_LIBRARY
 * 2. CLI_APPLICATION
 * 3. REST_API
 * 4. WEB_APPLICATION
 * 5. FULLSTACK_APPLICATION
 * 6. DATABASE_SERVICE
 * 7. DOCKERIZED_SERVICE
 *
 * Run: node dist/tools/v2E2eRunner.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { NamlaRuntime } from "../v2/runtime/namlaRuntime";
import { ProjectClass } from "../v2/factory/projectFactory";

function tempWorkspace(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-v2-e2e-${tag}-`));
}

const ALL_PROJECT_CLASSES: ProjectClass[] = [
  "TYPESCRIPT_LIBRARY",
  "CLI_APPLICATION",
  "REST_API",
  "WEB_APPLICATION",
  "FULLSTACK_APPLICATION",
  "DATABASE_SERVICE",
  "DOCKERIZED_SERVICE",
];

for (const projectClass of ALL_PROJECT_CLASSES) {
  test(`V2 E2E Clean-Room: ${projectClass} - Autonomous Pipeline Execution`, () => {
    const ws = tempWorkspace(projectClass.toLowerCase());
    try {
      const runtime = new NamlaRuntime();
      // CLEAN-ROOM RUN: Objective + projectClass only. NO injected solution code.
      const result = runtime.runMission({
        missionId: `mission-cleanroom-${projectClass.toLowerCase()}`,
        objective: `Build an autonomous ${projectClass} with full verification and packaging`,
        workspaceRoot: ws,
        projectClass,
      });

      assert.equal(result.success, true, `Clean-room run for ${projectClass} must succeed: ${result.reasonCode}`);
      assert.equal(result.finalState, "COMPLETED");
      assert.equal(result.deliveryPackage !== undefined, true, "Delivery package must be produced");
      assert.equal(result.deliveryPackage?.verified, true, "Delivery package must be verified");
      assert.equal(result.evidenceRecords.length >= 9, true, "Evidence records for all pipeline stages must exist");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
}

test("V2 E2E Clean-Room: Reproducibility across Independent Workspaces", () => {
  const ws1 = tempWorkspace("repro-clean-1");
  const ws2 = tempWorkspace("repro-clean-2");
  try {
    const runtime1 = new NamlaRuntime();
    const runtime2 = new NamlaRuntime();

    const request = {
      missionId: "mission-repro-clean",
      objective: "Build an autonomous clean-room TypeScript library",
      projectClass: "TYPESCRIPT_LIBRARY" as ProjectClass,
    };

    const res1 = runtime1.runMission({ ...request, workspaceRoot: ws1 });
    const res2 = runtime2.runMission({ ...request, workspaceRoot: ws2 });

    assert.equal(res1.success, true);
    assert.equal(res2.success, true);
    assert.equal(
      res1.deliveryPackage?.deliveryManifest.checksums["src/index.ts"],
      res2.deliveryPackage?.deliveryManifest.checksums["src/index.ts"],
      "Independent clean-room runs must yield identical artifact checksums"
    );
  } finally {
    rmSync(ws1, { recursive: true, force: true });
    rmSync(ws2, { recursive: true, force: true });
  }
});
