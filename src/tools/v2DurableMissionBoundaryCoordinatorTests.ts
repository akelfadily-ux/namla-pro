import test from "node:test";
import assert from "node:assert/strict";

import {
  DurableMissionBoundaryCoordinator,
} from "../v2/persistence/durableMissionBoundaryCoordinator";

import {
  InMemoryMissionCheckpointStore,
} from "../v2/persistence/inMemoryMissionCheckpointStore";

import {
  MissionCheckpoint,
  V2_MISSION_CHECKPOINT_SCHEMA,
} from "../v2/persistence/missionCheckpointStore";

import {
  PlanContract,
} from "../v2/types/contracts";

import {
  EvidenceRecord,
} from "../v2/types/evidence";

import {
  IntegratedCandidate,
  WorkPackageExecution,
} from "../v2/types/missionState";

import {
  LoopBudget,
} from "../v2/types/namlaLoopTypes";

function makeBudget(
  remainingTicks = 100,
  remainingFixAttempts = 3,
  remainingProviderCalls = 20,
): LoopBudget {
  return {
    maxTicks: 100,
    remainingTicks,
    maxFixAttempts: 3,
    remainingFixAttempts,
    maxProviderCalls: 20,
    remainingProviderCalls,
  };
}

function makeContract(
  hash = "contract-hash-1",
): PlanContract {
  return {
    contractId: "contract-1",
    version: "v1.0.0",
    contractHash: hash,
    objective: "Build durable NAMLA",
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
    frozenAt: 1000,
  };
}

function makeEvidence(
  missionId: string,
  id: string,
  sequenceNumber: number,
): EvidenceRecord {
  return {
    evidenceId: id,
    producer: "TEST",
    missionId,
    stageId: "EER",
    environmentIdentity: {
      platform: "test",
      nodeVersion: "test",
      cwd: "test",
      envFingerprint:
        "0".repeat(64),
    },
    timestamp: sequenceNumber,
    sequenceNumber,
    status: "VALID",
    details: {
      proof: id,
    },
    hash:
      sequenceNumber
        .toString(16)
        .padStart(64, "0"),
  };
}

function makeCandidate(
  missionId: string,
  id: string,
): IntegratedCandidate {
  return {
    candidateId: id,
    missionId,
    integratedArtifacts: [],
    resolvedConflicts: [],
    sourceTraceability: {},
    workspacePath:
      `workspaces/${missionId}/${id}`,
  };
}

function makeExecution(
  overrides:
    Partial<WorkPackageExecution> = {},
): WorkPackageExecution {
  return {
    executionId: "exec-1",
    workPackageId: "wp-1",
    colonyId: "COLONY_A",
    state: "READY",
    stateVersion: 1,
    attempts: 1,
    outputArtifacts: [],
    evidenceRefs: [],
    workspacePath:
      "workspaces/mission/colony-a/wp-1",
    ...overrides,
  };
}

async function startCoordinator(
  missionId: string,
) {
  const store =
    new InMemoryMissionCheckpointStore();

  let now = 1000;

  const coordinator =
    new DurableMissionBoundaryCoordinator(
      store,
      missionId,
      () => {
        now += 1;
        return now;
      },
    );

  const started =
    await coordinator.start({
      loopBudget:
        makeBudget(),
    });

  assert.equal(started.ok, true);

  return {
    store,
    coordinator,
  };
}

test(
  "10E2 start owns canonical EER v1 boundary",
  async () => {
    const {
      coordinator,
    } =
      await startCoordinator(
        "mission-start",
      );

    const snapshot =
      coordinator.getSnapshot();

    assert.ok(snapshot);

    assert.equal(
      snapshot.state.stateVersion,
      1,
    );

    assert.equal(
      snapshot.state.currentStage,
      "EER",
    );

    assert.equal(
      snapshot.state.currentState,
      "INTERPRETING",
    );

    assert.equal(
      snapshot.state.checkpointStage,
      "EER",
    );
  },
);

test(
  "10E2 same-stage checkpoint advances version and preserves stage authority",
  async () => {
    const {
      coordinator,
    } =
      await startCoordinator(
        "mission-same-stage",
      );

    const evidence =
      makeEvidence(
        "mission-same-stage",
        "ev-1",
        1,
      );

    const result =
      await coordinator.advance({
        nextStage: "EER",
        evidenceRecords: [
          evidence,
        ],
      });

    assert.equal(result.ok, true);

    if (!result.ok) {
      assert.fail(
        "same-stage checkpoint must succeed",
      );
    }

    assert.equal(
      result.checkpoint.state.stateVersion,
      2,
    );

    assert.equal(
      result.checkpoint.state.currentStage,
      "EER",
    );

    assert.equal(
      result.checkpoint.evidenceRecords.length,
      1,
    );
  },
);

test(
  "10E2 canonical pipeline reaches DELIVERY with exact forward ordering",
  async () => {
    const {
      coordinator,
    } =
      await startCoordinator(
        "mission-full-pipeline",
      );

    assert.equal(
      (
        await coordinator.advance({
          nextStage: "PLAN",
        })
      ).ok,
      true,
    );

    assert.equal(
      (
        await coordinator.advance({
          nextStage: "PROTOCOL",
          frozenContract:
            makeContract(),
        })
      ).ok,
      true,
    );

    assert.equal(
      (
        await coordinator.advance({
          nextStage: "PRO",
        })
      ).ok,
      true,
    );

    assert.equal(
      (
        await coordinator.advance({
          nextStage: "COLONY_AB",
        })
      ).ok,
      true,
    );

    assert.equal(
      (
        await coordinator.advance({
          nextStage: "SON",
        })
      ).ok,
      true,
    );

    const candidate =
      makeCandidate(
        "mission-full-pipeline",
        "candidate-1",
      );

    assert.equal(
      (
        await coordinator.advance({
          nextStage: "LEGGO",
          integratedCandidates: [
            candidate,
          ],
        })
      ).ok,
      true,
    );

    assert.equal(
      (
        await coordinator.advance({
          nextStage: "PROMAX",
        })
      ).ok,
      true,
    );

    assert.equal(
      (
        await coordinator.advance({
          nextStage: "NAMLA_LAB",
        })
      ).ok,
      true,
    );

    const delivered =
      await coordinator.advance({
        nextStage: "DELIVERY",
      });

    assert.equal(
      delivered.ok,
      true,
    );

    if (!delivered.ok) {
      assert.fail(
        "delivery boundary must succeed",
      );
    }

    assert.equal(
      delivered.checkpoint.state.currentState,
      "COMPLETED",
    );

    assert.equal(
      delivered.checkpoint.state.currentStage,
      "DELIVERY",
    );

    assert.equal(
      delivered.checkpoint.state.stateVersion,
      10,
    );
  },
);

test(
  "10E2 stage skipping is refused and fail-closes coordinator",
  async () => {
    const {
      coordinator,
    } =
      await startCoordinator(
        "mission-skip",
      );

    const result =
      await coordinator.advance({
        nextStage: "PRO",
      });

    assert.equal(result.ok, false);

    if (result.ok) {
      assert.fail(
        "stage skip must fail",
      );
    }

    assert.equal(
      result.reasonCode,
      "stage-transition-not-allowed",
    );

    const retry =
      await coordinator.advance({
        nextStage: "PLAN",
      });

    assert.equal(retry.ok, false);

    if (retry.ok) {
      assert.fail(
        "failed-closed coordinator must reject retry",
      );
    }

    assert.equal(
      retry.reasonCode,
      "coordinator-failed-closed",
    );
  },
);

test(
  "10E2 PROTOCOL requires frozen contract",
  async () => {
    const {
      coordinator,
    } =
      await startCoordinator(
        "mission-contract-required",
      );

    assert.equal(
      (
        await coordinator.advance({
          nextStage: "PLAN",
        })
      ).ok,
      true,
    );

    const result =
      await coordinator.advance({
        nextStage: "PROTOCOL",
      });

    assert.equal(result.ok, false);

    if (result.ok) {
      assert.fail(
        "PROTOCOL without contract must fail",
      );
    }

    assert.equal(
      result.reasonCode,
      "contract-freeze-required",
    );
  },
);

test(
  "10E2 frozen contract cannot mutate after PROTOCOL",
  async () => {
    const {
      coordinator,
    } =
      await startCoordinator(
        "mission-contract-immutable",
      );

    await coordinator.advance({
      nextStage: "PLAN",
    });

    await coordinator.advance({
      nextStage: "PROTOCOL",
      frozenContract:
        makeContract(
          "original-hash",
        ),
    });

    const result =
      await coordinator.advance({
        nextStage: "PRO",
        frozenContract:
          makeContract(
            "tampered-hash",
          ),
      });

    assert.equal(result.ok, false);

    if (result.ok) {
      assert.fail(
        "frozen contract mutation must fail",
      );
    }

    assert.equal(
      result.reasonCode,
      "frozen-contract-mutated",
    );
  },
);

test(
  "10E2 loop budgets cannot be replenished",
  async () => {
    const {
      coordinator,
    } =
      await startCoordinator(
        "mission-budget",
      );

    const reduced =
      await coordinator.advance({
        nextStage: "EER",
        loopBudget:
          makeBudget(
            90,
            2,
            18,
          ),
      });

    assert.equal(
      reduced.ok,
      true,
    );

    const replenished =
      await coordinator.advance({
        nextStage: "EER",
        loopBudget:
          makeBudget(
            91,
            2,
            18,
          ),
      });

    assert.equal(
      replenished.ok,
      false,
    );

    if (replenished.ok) {
      assert.fail(
        "budget replenishment must fail",
      );
    }

    assert.equal(
      replenished.reasonCode,
      "loop-budget-replenishment",
    );
  },
);

test(
  "10E2 loop budget maxima cannot mutate",
  async () => {
    const {
      coordinator,
    } =
      await startCoordinator(
        "mission-budget-max",
      );

    const result =
      await coordinator.advance({
        nextStage: "EER",
        loopBudget: {
          ...makeBudget(),
          maxTicks: 101,
        },
      });

    assert.equal(result.ok, false);

    if (result.ok) {
      assert.fail(
        "budget max mutation must fail",
      );
    }

    assert.equal(
      result.reasonCode,
      "loop-budget-max-mutated",
    );
  },
);

test(
  "10E2 evidence history is append-only",
  async () => {
    const {
      coordinator,
    } =
      await startCoordinator(
        "mission-evidence",
      );

    const original =
      makeEvidence(
        "mission-evidence",
        "ev-1",
        1,
      );

    assert.equal(
      (
        await coordinator.advance({
          nextStage: "EER",
          evidenceRecords: [
            original,
          ],
        })
      ).ok,
      true,
    );

    const mutated = {
      ...original,
      hash:
        "f".repeat(64),
    };

    const result =
      await coordinator.advance({
        nextStage: "EER",
        evidenceRecords: [
          mutated,
        ],
      });

    assert.equal(result.ok, false);

    if (result.ok) {
      assert.fail(
        "evidence mutation must fail",
      );
    }

    assert.equal(
      result.reasonCode,
      "evidence-history-regression",
    );
  },
);

test(
  "10E2 integrated candidate history is append-only",
  async () => {
    const {
      coordinator,
    } =
      await startCoordinator(
        "mission-candidate",
      );

    await coordinator.advance({
      nextStage: "PLAN",
    });

    await coordinator.advance({
      nextStage: "PROTOCOL",
      frozenContract:
        makeContract(),
    });

    await coordinator.advance({
      nextStage: "PRO",
    });

    await coordinator.advance({
      nextStage: "COLONY_AB",
    });

    await coordinator.advance({
      nextStage: "SON",
    });

    const candidate =
      makeCandidate(
        "mission-candidate",
        "candidate-1",
      );

    assert.equal(
      (
        await coordinator.advance({
          nextStage: "LEGGO",
          integratedCandidates: [
            candidate,
          ],
        })
      ).ok,
      true,
    );

    const mutated = {
      ...candidate,
      workspacePath:
        "tampered/workspace",
    };

    const result =
      await coordinator.advance({
        nextStage: "LEGGO",
        integratedCandidates: [
          mutated,
        ],
      });

    assert.equal(result.ok, false);

    if (result.ok) {
      assert.fail(
        "candidate mutation must fail",
      );
    }

    assert.equal(
      result.reasonCode,
      "candidate-history-regression",
    );
  },
);

test(
  "10E2 execution history cannot disappear or regress",
  async () => {
    const {
      coordinator,
    } =
      await startCoordinator(
        "mission-execution",
      );

    await coordinator.advance({
      nextStage: "PLAN",
    });

    await coordinator.advance({
      nextStage: "PROTOCOL",
      frozenContract:
        makeContract(),
    });

    await coordinator.advance({
      nextStage: "PRO",
    });

    const execution =
      makeExecution();

    assert.equal(
      (
        await coordinator.advance({
          nextStage: "COLONY_AB",
          executions: [
            execution,
          ],
        })
      ).ok,
      true,
    );

    const updated =
      makeExecution({
        state: "EXECUTING",
        stateVersion: 2,
      });

    assert.equal(
      (
        await coordinator.advance({
          nextStage: "COLONY_AB",
          executions: [
            updated,
          ],
        })
      ).ok,
      true,
    );

    const regressed =
      await coordinator.advance({
        nextStage: "COLONY_AB",
        executions: [
          makeExecution({
            state: "READY",
            stateVersion: 1,
          }),
        ],
      });

    assert.equal(
      regressed.ok,
      false,
    );

    if (regressed.ok) {
      assert.fail(
        "execution version regression must fail",
      );
    }

    assert.equal(
      regressed.reasonCode,
      "execution-history-regression",
    );
  },
);

test(
  "10E2 concurrent coordinators preserve single-writer CAS authority",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    let clockValue = 5000;

    const clock = () => {
      clockValue += 1;
      return clockValue;
    };

    const seed =
      new DurableMissionBoundaryCoordinator(
        store,
        "mission-cas-boundary",
        clock,
      );

    assert.equal(
      (
        await seed.start({
          loopBudget:
            makeBudget(),
        })
      ).ok,
      true,
    );

    const writerA =
      new DurableMissionBoundaryCoordinator(
        store,
        "mission-cas-boundary",
        clock,
      );

    const writerB =
      new DurableMissionBoundaryCoordinator(
        store,
        "mission-cas-boundary",
        clock,
      );

    assert.equal(
      (await writerA.resume()).ok,
      true,
    );

    assert.equal(
      (await writerB.resume()).ok,
      true,
    );

    assert.equal(
      (
        await writerA.advance({
          nextStage: "PLAN",
        })
      ).ok,
      true,
    );

    const stale =
      await writerB.advance({
        nextStage: "PLAN",
      });

    assert.equal(stale.ok, false);

    if (stale.ok) {
      assert.fail(
        "stale writer must lose CAS",
      );
    }

    assert.equal(
      stale.reasonCode,
      "session:checkpoint-version-conflict",
    );

    const persisted =
      await store.load(
        "mission-cas-boundary",
      );

    assert.ok(persisted);

    assert.equal(
      persisted.state.stateVersion,
      2,
    );

    assert.equal(
      persisted.state.currentStage,
      "PLAN",
    );
  },
);

test(
  "10E2 resume rejects structurally valid but semantically mismatched stage/state",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    const malformed:
      MissionCheckpoint = {
        schemaVersion:
          V2_MISSION_CHECKPOINT_SCHEMA,

        missionId:
          "mission-semantic",

        state: {
          missionId:
            "mission-semantic",

          currentState:
            "VERIFYING",

          stateVersion:
            1,

          currentStage:
            "EER",

          checkpointStage:
            "EER",

          activeWorkPackages:
            [],

          executions:
            [],

          failureCount:
            0,

          livelockCounter:
            0,
        },

        loopBudget:
          makeBudget(),

        evidenceRecords:
          [],

        integratedCandidates:
          [],

        savedAt:
          1,
      };

    assert.equal(
      await store.create(
        malformed,
      ),
      "CREATED",
    );

    const coordinator =
      new DurableMissionBoundaryCoordinator(
        store,
        "mission-semantic",
      );

    const result =
      await coordinator.resume();

    assert.equal(result.ok, false);

    if (result.ok) {
      assert.fail(
        "semantic state/stage mismatch must fail",
      );
    }

    assert.equal(
      result.reasonCode,
      "invalid-stage-state-pair",
    );
  },
);

test(
  "10E2 completed DELIVERY boundary is terminal",
  async () => {
    const {
      coordinator,
    } =
      await startCoordinator(
        "mission-terminal",
      );

    await coordinator.advance({
      nextStage: "PLAN",
    });

    await coordinator.advance({
      nextStage: "PROTOCOL",
      frozenContract:
        makeContract(),
    });

    await coordinator.advance({
      nextStage: "PRO",
    });

    await coordinator.advance({
      nextStage: "COLONY_AB",
    });

    await coordinator.advance({
      nextStage: "SON",
    });

    await coordinator.advance({
      nextStage: "LEGGO",
    });

    await coordinator.advance({
      nextStage: "PROMAX",
    });

    await coordinator.advance({
      nextStage: "NAMLA_LAB",
    });

    assert.equal(
      (
        await coordinator.advance({
          nextStage: "DELIVERY",
        })
      ).ok,
      true,
    );

    const result =
      await coordinator.advance({
        nextStage: "DELIVERY",
      });

    assert.equal(result.ok, false);

    if (result.ok) {
      assert.fail(
        "completed delivery must be terminal",
      );
    }

    assert.equal(
      result.reasonCode,
      "terminal-boundary",
    );
  },
);