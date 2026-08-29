/**
 * NAMLA PRO V2 End-to-End Acceptance Qualification Suite (§14).
 *
 * Tests the canonical V2 NamlaRuntime against representative objectives
 * and project classes (TypeScript library, CLI application, REST API, Dockerized service),
 * verifying planning, dual colony execution, Son comparison, Leggo integration,
 * ProMax verification, Lab packaging, evidence generation, and reproducibility.
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

test("V2 E2E: TypeScript Library Project - Full Pipeline Execution", () => {
  const ws = tempWorkspace("ts-lib");
  try {
    const runtime = new NamlaRuntime();
    const result = runtime.runMission({
      missionId: "mission-ts-lib-1",
      objective: "Build a TypeScript math library with add and multiply functions",
      workspaceRoot: ws,
      projectClass: "TYPESCRIPT_LIBRARY",
      simulatedColonyACode: `export function add(a: number, b: number): number { return a + b; }\nexport function multiply(a: number, b: number): number { return a * b; }\n`,
      simulatedColonyBCode: `export function add(x: number, y: number): number { return x + y; }\nexport function multiply(x: number, y: number): number { return x * y; }\n`,
    });

    assert.equal(result.success, true, `Mission must succeed: ${result.reasonCode}`);
    assert.equal(result.finalState, "COMPLETED");
    assert.equal(result.deliveryPackage !== undefined, true, "Delivery package must be produced");
    assert.equal(result.deliveryPackage?.verified, true, "Delivery package must be verified");
    assert.equal(result.evidenceRecords.length >= 9, true, "Evidence records for all pipeline stages must exist");
    assert.equal(result.receipts.length > 0, true, "Receipts must be generated");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("V2 E2E: CLI Application Project - Pipeline Execution", () => {
  const ws = tempWorkspace("cli-app");
  try {
    const runtime = new NamlaRuntime();
    const result = runtime.runMission({
      missionId: "mission-cli-1",
      objective: "Create a CLI tool that parses arguments and prints help output",
      workspaceRoot: ws,
      projectClass: "CLI_APPLICATION",
    });

    assert.equal(result.success, true, `CLI mission must succeed: ${result.reasonCode}`);
    assert.equal(result.finalState, "COMPLETED");
    assert.equal(result.deliveryPackage?.artifacts.length, 1);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("V2 E2E: Dockerized Service Project - Pipeline Execution", () => {
  const ws = tempWorkspace("docker-app");
  try {
    const runtime = new NamlaRuntime();
    const result = runtime.runMission({
      missionId: "mission-docker-1",
      objective: "Build a dockerized microservice endpoint",
      workspaceRoot: ws,
      projectClass: "DOCKERIZED_SERVICE",
    });

    assert.equal(result.success, true, `Dockerized service mission must succeed: ${result.reasonCode}`);
    assert.equal(result.finalState, "COMPLETED");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("V2 E2E: A/B Disagreement & Synthesis Handling", () => {
  const ws = tempWorkspace("ab-disagree");
  try {
    const runtime = new NamlaRuntime();
    // Colony A succeeds with custom code, Colony B fails
    const result = runtime.runMission({
      missionId: "mission-disagree-1",
      objective: "Implement a data validation module",
      workspaceRoot: ws,
      projectClass: "TYPESCRIPT_LIBRARY",
      simulatedColonyACode: "export function validate(data: unknown): boolean { return data !== null; }\n",
      simulatedColonyBCode: "", // Empty / failing code
    });

    assert.equal(result.success, true, "Synthesis must select Colony A when Colony B fails");
    assert.equal(result.finalState, "COMPLETED");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("V2 E2E: Clean-Room Reproducibility", () => {
  const ws1 = tempWorkspace("repro-1");
  const ws2 = tempWorkspace("repro-2");
  try {
    const runtime1 = new NamlaRuntime();
    const runtime2 = new NamlaRuntime();

    const request = {
      missionId: "mission-repro",
      objective: "Build a deterministic utility module",
      projectClass: "TYPESCRIPT_LIBRARY" as ProjectClass,
      simulatedColonyACode: "export const version = '1.0.0';\n",
      simulatedColonyBCode: "export const version = '1.0.0';\n",
    };

    const res1 = runtime1.runMission({ ...request, workspaceRoot: ws1 });
    const res2 = runtime2.runMission({ ...request, workspaceRoot: ws2 });

    assert.equal(res1.success, true);
    assert.equal(res2.success, true);
    assert.equal(
      res1.deliveryPackage?.deliveryManifest.checksums["src/index.ts"],
      res2.deliveryPackage?.deliveryManifest.checksums["src/index.ts"],
      "Clean room runs must yield identical artifact checksums"
    );
  } finally {
    rmSync(ws1, { recursive: true, force: true });
    rmSync(ws2, { recursive: true, force: true });
  }
});
