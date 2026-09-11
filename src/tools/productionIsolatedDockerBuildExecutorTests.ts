/**
 * Hermetic proofs for ProductionIsolatedDockerBuildExecutor.
 *
 * No WSL, Docker, BuildKit or host process is executed here.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  ProductionIsolatedDockerBuildExecutor,
} from "../cognitive/productionIsolatedDockerBuildExecutor";

import {
  WORKSPACE_STAGE_SCHEMA_VERSION,
  type ProductionWorkspaceStagingResult,
} from "../cognitive/productionWorkspaceStager";

import type {
  IsolatedDockerBuildRequest,
} from "../cognitive/isolatedDockerBuild";

import type {
  ProductionWslLaunchResult,
} from "../cognitive/productionWslLauncher";

function request(
  overrides: Partial<IsolatedDockerBuildRequest> = {},
): IsolatedDockerBuildRequest {
  return {
    workspaceAbsolutePath: "C:\\candidate",
    missionId: "mission-1",
    stageId: "stage-1",
    imageTag: "test-mission-1",
    timeoutMs: 5000,
    ...overrides,
  };
}

function stagedOk(
  payload: Buffer = Buffer.from("STAGED_PAYLOAD", "utf8"),
): ProductionWorkspaceStagingResult {
  return {
    ok: true,
    reasonCode: "OK",
    manifest: {
      schemaVersion: WORKSPACE_STAGE_SCHEMA_VERSION,
      entries: [],
      fileCount: 0,
      totalBytes: 0,
      treeSha256: "a".repeat(64),
    },
    payload,
    payloadSha256: "b".repeat(64),
  };
}

function launchedOk(): ProductionWslLaunchResult {
  return {
    success: true,
    exitCode: 0,
    stdout: "BUILD_OK",
    stderr: "",
    reasonCode: "OK",
  };
}

test("ISO-EXEC-01: exact workspace is staged and exact payload/timeout reach WSL launcher", () => {
  let stagedPath = "";
  let launchedPayload: Buffer | null = null;
  let launchedTimeout = -1;

  const expectedPayload = Buffer.from("EXACT_STAGE", "utf8");

  const executor = new ProductionIsolatedDockerBuildExecutor({
    stager: (workspace) => {
      stagedPath = workspace;
      return stagedOk(expectedPayload);
    },

    launcher: {
      launchBuildPayload(payload, timeoutMs) {
        launchedPayload = payload;
        launchedTimeout = timeoutMs;
        return launchedOk();
      },
    },
  });

  const result = executor.build(request());

  assert.equal(stagedPath, "C:\\candidate");
  assert.deepEqual(launchedPayload, expectedPayload);
  assert.equal(launchedTimeout, 5000);

  assert.equal(result.success, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "BUILD_OK");
  assert.equal(result.stderr, "");
  assert.equal(result.reasonCode, "OK");
});

test("ISO-EXEC-02: invalid evidence identifiers refuse before staging or launch", () => {
  let stagerCalls = 0;
  let launcherCalls = 0;

  const executor = new ProductionIsolatedDockerBuildExecutor({
    stager: () => {
      stagerCalls += 1;
      return stagedOk();
    },

    launcher: {
      launchBuildPayload() {
        launcherCalls += 1;
        return launchedOk();
      },
    },
  });

  const result = executor.build(
    request({ missionId: "mission\ninjection" }),
  );

  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "ISOLATED_DOCKER_REQUEST_REFUSED");
  assert.equal(stagerCalls, 0);
  assert.equal(launcherCalls, 0);
});

test("ISO-EXEC-03: malformed image tag refuses before staging", () => {
  let stagerCalls = 0;

  const executor = new ProductionIsolatedDockerBuildExecutor({
    stager: () => {
      stagerCalls += 1;
      return stagedOk();
    },
  });

  const result = executor.build(
    request({ imageTag: "bad/tag" }),
  );

  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "ISOLATED_DOCKER_REQUEST_REFUSED");
  assert.equal(stagerCalls, 0);
});

test("ISO-EXEC-04: invalid timeout refuses before scanning workspace", () => {
  let stagerCalls = 0;

  const executor = new ProductionIsolatedDockerBuildExecutor({
    stager: () => {
      stagerCalls += 1;
      return stagedOk();
    },
  });

  const result = executor.build(
    request({ timeoutMs: 999 }),
  );

  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "ISOLATED_DOCKER_REQUEST_REFUSED");
  assert.equal(stagerCalls, 0);
});

test("ISO-EXEC-05: unexpected stager exception fails closed and never launches WSL", () => {
  let launcherCalls = 0;

  const executor = new ProductionIsolatedDockerBuildExecutor({
    stager: () => {
      throw new Error("simulated");
    },

    launcher: {
      launchBuildPayload() {
        launcherCalls += 1;
        return launchedOk();
      },
    },
  });

  const result = executor.build(request());

  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "ISOLATED_DOCKER_STAGER_ERROR");
  assert.equal(launcherCalls, 0);
});

test("ISO-EXEC-06: staging refusal propagates a fixed isolated-Docker reason and blocks WSL", () => {
  let launcherCalls = 0;

  const executor = new ProductionIsolatedDockerBuildExecutor({
    stager: () => ({
      ok: false,
      reasonCode: "STAGING_SYMLINK_REFUSED",
      manifest: null,
      payload: null,
      payloadSha256: null,
    }),

    launcher: {
      launchBuildPayload() {
        launcherCalls += 1;
        return launchedOk();
      },
    },
  });

  const result = executor.build(request());

  assert.equal(result.success, false);
  assert.equal(
    result.reasonCode,
    "ISOLATED_DOCKER_STAGING_SYMLINK_REFUSED",
  );
  assert.equal(launcherCalls, 0);
});

test("ISO-EXEC-07: unexpected launcher exception fails closed", () => {
  const executor = new ProductionIsolatedDockerBuildExecutor({
    stager: () => stagedOk(),

    launcher: {
      launchBuildPayload() {
        throw new Error("simulated");
      },
    },
  });

  const result = executor.build(request());

  assert.equal(result.success, false);
  assert.equal(
    result.reasonCode,
    "ISOLATED_DOCKER_WSL_LAUNCHER_ERROR",
  );
});

test("ISO-EXEC-08: WSL timeout remains failure and preserves bounded process evidence", () => {
  const executor = new ProductionIsolatedDockerBuildExecutor({
    stager: () => stagedOk(),

    launcher: {
      launchBuildPayload() {
        return {
          success: false,
          exitCode: null,
          stdout: "partial",
          stderr: "timeout",
          reasonCode: "WSL_PROCESS_TIMEOUT",
        };
      },
    },
  });

  const result = executor.build(request());

  assert.equal(result.success, false);
  assert.equal(result.exitCode, null);
  assert.equal(result.stdout, "partial");
  assert.equal(result.stderr, "timeout");
  assert.equal(
    result.reasonCode,
    "ISOLATED_DOCKER_WSL_PROCESS_TIMEOUT",
  );
});

test("ISO-EXEC-09: nonzero Linux build exit cannot become success", () => {
  const executor = new ProductionIsolatedDockerBuildExecutor({
    stager: () => stagedOk(),

    launcher: {
      launchBuildPayload() {
        return {
          success: false,
          exitCode: 37,
          stdout: "",
          stderr: "build failed",
          reasonCode: "WSL_EXIT_NONZERO",
        };
      },
    },
  });

  const result = executor.build(request());

  assert.equal(result.success, false);
  assert.equal(result.exitCode, 37);
  assert.equal(
    result.reasonCode,
    "ISOLATED_DOCKER_WSL_EXIT_NONZERO",
  );
});

test("ISO-EXEC-10: mission, stage and image tag never become launcher arguments", () => {
  let observedPayload: Buffer | null = null;
  let observedTimeout = -1;

  const payload = Buffer.from("ONLY_STAGED_BYTES", "utf8");

  const executor = new ProductionIsolatedDockerBuildExecutor({
    stager: () => stagedOk(payload),

    launcher: {
      launchBuildPayload(input, timeoutMs) {
        observedPayload = input;
        observedTimeout = timeoutMs;
        return launchedOk();
      },
    },
  });

  const result = executor.build(
    request({
      missionId: "mission-secret-marker",
      stageId: "stage-secret-marker",
      imageTag: "test-secret-marker",
      timeoutMs: 7777,
    }),
  );

  assert.equal(result.success, true);
  assert.deepEqual(observedPayload, payload);
  assert.equal(observedTimeout, 7777);

  const bytes = (observedPayload as Buffer).toString("utf8");
  assert.equal(bytes.includes("mission-secret-marker"), false);
  assert.equal(bytes.includes("stage-secret-marker"), false);
  assert.equal(bytes.includes("test-secret-marker"), false);
});