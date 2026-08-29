/**
 * NAMLA PRO V2 Black-Box Clean-Room Qualification Suite (§14, P0.8, P0.20, P0.18).
 *
 * Independently inspects, builds, typechecks, tests, and smoke-executes delivered project artifacts
 * across all 7 project classes + an 8+ file project DAG, independently recomputing artifact checksums.
 *
 * Run: node dist/tools/v2E2eRunner.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { resolve, join } from "path";
import { createHash } from "crypto";
import { spawnSync } from "child_process";
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
  test(`V2 Black-Box Clean-Room: ${projectClass} - Full Pipeline & Independent Verification`, () => {
    const ws = tempWorkspace(projectClass.toLowerCase());
    try {
      const runtime = new NamlaRuntime();
      const missionId = `mission-cleanroom-${projectClass.toLowerCase()}`;

      // 1. Run NamlaRuntime
      const result = runtime.runMission({
        missionId,
        objective: `Build an autonomous ${projectClass} with full verification and packaging`,
        workspaceRoot: ws,
        projectClass,
      });

      assert.equal(result.success, true, `Clean-room run for ${projectClass} must succeed: ${result.reasonCode}`);
      assert.equal(result.finalState, "COMPLETED");
      assert.equal(result.deliveryPackage !== undefined, true, "DeliveryPackage must exist");

      const delivery = result.deliveryPackage!;
      const deliveryRelDir = `workspaces/v2-missions/${missionId}/leggo-integrated`;
      const deliveryAbsDir = resolve(join(ws, deliveryRelDir));

      // 2. Black-Box Inspection: Verify delivered files exist on disk
      assert.equal(existsSync(deliveryAbsDir), true, "Delivered workspace directory must exist");
      for (const art of delivery.artifacts) {
        const fileAbsPath = resolve(join(ws, art.path));
        assert.equal(existsSync(fileAbsPath), true, `Delivered artifact ${art.path} must exist on disk`);

        // 3. Black-Box Checksum Re-Hashing (P0.20)
        const fileBytes = readFileSync(fileAbsPath);
        const computedSha256 = createHash("sha256").update(fileBytes).digest("hex");
        assert.equal(
          computedSha256,
          delivery.deliveryManifest.checksums[art.path],
          `Independently computed checksum for ${art.path} must match delivery manifest`
        );
      }

      // 4. Black-Box Execution: Run npm test in delivered workspace
      const testCmd = spawnSync("npm", ["test"], {
        cwd: deliveryAbsDir,
        shell: false,
        encoding: "utf8",
        timeout: 15000,
      });

      assert.equal(testCmd.status, 0, `Independent npm test execution in delivered workspace must pass: ${testCmd.stderr || testCmd.stdout}`);

      // 5. Class-Specific Smoke Verification
      if (projectClass === "REST_API") {
        const serverFile = resolve(join(deliveryAbsDir, "src/server.ts"));
        assert.equal(existsSync(serverFile), true);
        const serverContent = readFileSync(serverFile, "utf8");
        assert.equal(serverContent.includes("handleRequest"), true, "REST API must export handleRequest server endpoint");
      } else if (projectClass === "DOCKERIZED_SERVICE") {
        const dockerFile = resolve(join(deliveryAbsDir, "Dockerfile"));
        assert.equal(existsSync(dockerFile), true, "Dockerized service must deliver Dockerfile");
      }
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
}

test("V2 Black-Box Clean-Room: 8+ File Multi-WorkPackage Project Run (P0.18)", () => {
  const ws = tempWorkspace("multi-file-8");
  try {
    const runtime = new NamlaRuntime();
    const missionId = "mission-multifile-8";

    const result = runtime.runMission({
      missionId,
      objective: "Build a REST API for tasks with CRUD, validation, persistence and tests",
      workspaceRoot: ws,
      projectClass: "REST_API",
    });

    assert.equal(result.success, true);
    assert.equal(result.finalState, "COMPLETED");

    const delivery = result.deliveryPackage!;

    // Verify all files from the multi-task DAG exist in the final delivered candidate
    const deliveredPaths = delivery.artifacts.map((a) => a.path);
    assert.equal(deliveredPaths.length >= 8, true, `Delivered candidate must contain >= 8 files, got ${deliveredPaths.length}`);

    // Verify every file exists on disk and matches checksums
    for (const art of delivery.artifacts) {
      const fileAbs = resolve(join(ws, art.path));
      assert.equal(existsSync(fileAbs), true, `Multi-file artifact ${art.path} must exist on disk`);
      const bytes = readFileSync(fileAbs);
      const computedHash = createHash("sha256").update(bytes).digest("hex");
      assert.equal(computedHash, delivery.deliveryManifest.checksums[art.path]);
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
