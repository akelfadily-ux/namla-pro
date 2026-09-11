import test from "node:test";
import assert from "node:assert/strict";

import {
  MissionCheckpoint,
  V2_MISSION_CHECKPOINT_SCHEMA,
  validateMissionCheckpoint,
} from "../v2/persistence/missionCheckpointStore";

function makeCheckpoint(): MissionCheckpoint {
  return {
    schemaVersion: V2_MISSION_CHECKPOINT_SCHEMA,
    missionId: "mission-1",
    state: {
      missionId: "mission-1",
      currentState: "INTERPRETING",
      stateVersion: 1,
      currentStage: "EER",
      activeWorkPackages: [],
      executions: [],
      failureCount: 0,
      livelockCounter: 0,
    },
    loopBudget: {
      maxTicks: 100,
      remainingTicks: 100,
      maxFixAttempts: 3,
      remainingFixAttempts: 3,
      maxProviderCalls: 20,
      remainingProviderCalls: 20,
    },
    evidenceRecords: [],
    integratedCandidates: [],
    savedAt: 1,
  };
}

test("V2 persistence contract accepts a valid checkpoint", () => {
  assert.deepEqual(
    validateMissionCheckpoint(makeCheckpoint()),
    { ok: true, reasonCode: "ok" },
  );
});

test("V2 persistence contract rejects state mission mismatch", () => {
  const base = makeCheckpoint();

  const result = validateMissionCheckpoint({
    ...base,
    state: {
      ...base.state,
      missionId: "other-mission",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "state-mission-id-mismatch");
});

test("V2 persistence contract rejects invalid state version", () => {
  const base = makeCheckpoint();

  const result = validateMissionCheckpoint({
    ...base,
    state: {
      ...base.state,
      stateVersion: 0,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "state-version-invalid");
});

test("V2 persistence contract rejects impossible loop budget", () => {
  const base = makeCheckpoint();

  const result = validateMissionCheckpoint({
    ...base,
    loopBudget: {
      ...base.loopBudget,
      remainingTicks: 101,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "loop-budget-invalid");
});

test("V2 persistence contract rejects evidence from another mission", () => {
  const base = makeCheckpoint();

  const result = validateMissionCheckpoint({
    ...base,
    evidenceRecords: [
      {
        evidenceId: "ev-1",
        producer: "TEST",
        missionId: "other-mission",
        stageId: "EER",
        environmentIdentity: {
          platform: "test",
          nodeVersion: "test",
          cwd: "test",
          envFingerprint: "0".repeat(64),
        },
        timestamp: 1,
        sequenceNumber: 1,
        status: "VALID",
        details: {},
        hash: "1".repeat(64),
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "evidence-mission-id-mismatch");
});

test("V2 persistence contract rejects duplicate evidence ids", () => {
  const base = makeCheckpoint();

  const evidence = {
    evidenceId: "ev-1",
    producer: "TEST",
    missionId: "mission-1",
    stageId: "EER",
    environmentIdentity: {
      platform: "test",
      nodeVersion: "test",
      cwd: "test",
      envFingerprint: "0".repeat(64),
    },
    timestamp: 1,
    sequenceNumber: 1,
    status: "VALID" as const,
    details: {},
    hash: "1".repeat(64),
  };

  const result = validateMissionCheckpoint({
    ...base,
    evidenceRecords: [evidence, evidence],
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "duplicate-evidence-id");
});

test("V2 persistence contract rejects candidate from another mission", () => {
  const base = makeCheckpoint();

  const result = validateMissionCheckpoint({
    ...base,
    integratedCandidates: [
      {
        candidateId: "candidate-1",
        missionId: "other-mission",
        integratedArtifacts: [],
        resolvedConflicts: [],
        sourceTraceability: {},
        workspacePath: "workspace",
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "candidate-mission-id-mismatch");
});