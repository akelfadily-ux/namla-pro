import test from "node:test";
import assert from "node:assert/strict";

import {
  fingerprintOperationIdentity,
} from "../v2/kernel/operationIdentity";

import type {
  OperationExecutionRecord,
} from "../v2/kernel/executionAuthority";

import {
  InMemoryCanonicalRuntimeRecoveryStore,
} from "../v2/persistence/inMemoryCanonicalRuntimeRecoveryStore";

import {
  PostgresCanonicalFactoryEvidenceAuthority,
} from "../v2/persistence/postgresCanonicalFactoryEvidenceAuthority";

import {
  DurableCanonicalRuntimeOrchestrator,
} from "../v2/runtime/durableCanonicalRuntimeOrchestrator";

import {
  DurableCanonicalEerRuntime,
  type CanonicalEerExecutionStore,
} from "../v2/runtime/durableCanonicalEerRuntime";

import {
  DurableCanonicalEerOrchestratedRuntime,
} from "../v2/runtime/durableCanonicalEerOrchestratedRuntime";

import type {
  AcquireTaskLeaseInput,
  ClaimDurableOperationInput,
  CompleteDurableOperationInput,
  PostgresCompletedOperationReadResult,
  PostgresOperationClaimResult,
  PostgresOperationClaimValidationResult,
  PostgresOperationFinalizeResult,
  ReadCompletedDurableOperationInput,
  TaskLeaseAcquireResult,
  ValidateDurableOperationClaimInput,
} from "../v2/persistence/postgresExecutionAuthorityStore";

import type {
  PreFreezeStageContext,
} from "../v2/types/stageContext";

const MISSION =
  "c9e2a-mission";

interface Stored {
  readonly identity:
    unknown;
  readonly record:
    OperationExecutionRecord;
  readonly value?:
    unknown;
}

class MemoryExecutionStore
  implements CanonicalEerExecutionStore {
  public readonly operations =
    new Map<string, Stored>();

  public acquireCalls =
    0;

  public completeCalls =
    0;

  private leaseEpoch =
    0;

  public async acquireTaskLease(
    input:
      AcquireTaskLeaseInput,
  ): Promise<TaskLeaseAcquireResult> {
    this.acquireCalls += 1;
    this.leaseEpoch += 1;

    return {
      ok: true,
      status: "ACQUIRED",
      reasonCode: "ok",
      authority: {
        missionId:
          input.missionId,
        taskId:
          input.taskId,
        workerId:
          input.workerId,
        authorityScope:
          input.authorityScope,
        leaseToken:
          `lease-${this.leaseEpoch}`,
        leaseEpoch:
          this.leaseEpoch,
        expiresAt:
          9_000_000_000_000,
      },
    };
  }

  public async claimOperation(
    input:
      ClaimDurableOperationInput,
  ): Promise<PostgresOperationClaimResult> {
    const fingerprint =
      fingerprintOperationIdentity({
        missionId:
          input.authority.missionId,
        authorityScope:
          input.authority.authorityScope,
        operationType:
          input.operationType,
        value:
          input.value,
      });

    const existing =
      this.operations.get(
        input.operationKey,
      );

    if (existing) {
      if (
        existing.record.inputFingerprint !==
          fingerprint ||
        existing.record.operationType !==
          input.operationType ||
        existing.record.authorityScope !==
          input.authority.authorityScope
      ) {
        return {
          ok: false,
          status: "REFUSED",
          reasonCode:
            "existing-operation-binding-mismatch",
          inputFingerprint:
            fingerprint,
          record:
            existing.record,
        };
      }

      if (
        existing.record.status ===
          "COMPLETED"
      ) {
        return {
          ok: true,
          status:
            "REPLAY_COMPLETED",
          reasonCode: "ok",
          inputFingerprint:
            fingerprint,
          record:
            existing.record,
          completedValue:
            structuredClone(
              existing.value,
            ),
        };
      }

      return {
        ok: true,
        status:
          "ALREADY_CLAIMED_BY_CALLER",
        reasonCode: "ok",
        inputFingerprint:
          fingerprint,
        record:
          existing.record,
      };
    }

    const record:
      OperationExecutionRecord = {
        operationKey:
          input.operationKey,
        missionId:
          input.authority.missionId,
        taskId:
          input.authority.taskId,
        authorityScope:
          input.authority.authorityScope,
        operationType:
          input.operationType,
        inputFingerprint:
          fingerprint,
        status:
          "RUNNING",
        claimOwnerWorkerId:
          input.authority.workerId,
        claimTaskLeaseToken:
          input.authority.leaseToken,
        claimTaskLeaseEpoch:
          input.authority.leaseEpoch,
        claimToken:
          `claim-${this.operations.size + 1}`,
        claimEpoch: 1,
        claimExpiresAt:
          9_000_000_000_000,
        createdAt:
          1_000,
        updatedAt:
          1_000,
      };

    this.operations.set(
      input.operationKey,
      {
        identity:
          structuredClone(
            input.value,
          ),
        record,
      },
    );

    return {
      ok: true,
      status: "CLAIMED",
      reasonCode: "ok",
      inputFingerprint:
        fingerprint,
      record,
    };
  }

  public async validateOperationClaim(
    input:
      ValidateDurableOperationClaimInput,
  ): Promise<PostgresOperationClaimValidationResult> {
    const existing =
      this.operations.get(
        input.operationKey,
      );

    if (
      !existing ||
      existing.record.status !==
        "RUNNING" ||
      existing.record.claimToken !==
        input.claimToken ||
      existing.record.claimEpoch !==
        input.claimEpoch
    ) {
      return {
        ok: false,
        status: "REFUSED",
        reasonCode:
          "operation-not-running",
      };
    }

    return {
      ok: true,
      status: "VALID",
      reasonCode: "ok",
      record:
        existing.record,
      now:
        1_500,
    };
  }

  public async completeOperation(
    input:
      CompleteDurableOperationInput,
  ): Promise<PostgresOperationFinalizeResult> {
    const existing =
      this.operations.get(
        input.operationKey,
      );

    if (
      !existing ||
      existing.record.status !==
        "RUNNING"
    ) {
      return {
        ok: false,
        status: "REFUSED",
        reasonCode:
          "operation-not-running",
      };
    }

    this.completeCalls += 1;

    const record:
      OperationExecutionRecord = {
        ...existing.record,
        status:
          "COMPLETED",
        updatedAt:
          2_000 +
          this.completeCalls,
        finishedAt:
          2_000 +
          this.completeCalls,
      };

    this.operations.set(
      input.operationKey,
      {
        identity:
          existing.identity,
        record,
        value:
          structuredClone(
            input.value,
          ),
      },
    );

    return {
      ok: true,
      status: "COMPLETED",
      reasonCode: "ok",
      record,
    };
  }

  public async readCompletedOperation(
    input:
      ReadCompletedDurableOperationInput,
  ): Promise<PostgresCompletedOperationReadResult> {
    const existing =
      this.operations.get(
        input.operationKey,
      );

    if (
      !existing ||
      existing.record.missionId !==
        input.missionId
    ) {
      return {
        ok: false,
        status: "REFUSED",
        reasonCode:
          "operation-not-found",
      };
    }

    if (
      existing.record.status !==
        "COMPLETED"
    ) {
      return {
        ok: false,
        status: "REFUSED",
        reasonCode:
          "operation-not-completed",
      };
    }

    return {
      ok: true,
      status: "COMPLETED",
      reasonCode: "ok",
      record:
        existing.record,
      completedValue:
        structuredClone(
          existing.value,
        ),
    };
  }
}

function context(
  missionId = MISSION,
): PreFreezeStageContext {
  return {
    missionId,
    authoritativeInputs:
      ["objective"],
    policyVersions:
      ["policy-v1"],
    budgets: {
      virtualTicks: 20,
      providerCalls: 5,
      maxFixAttempts: 3,
    },
    evidenceRefs: [],
    missionStateRef:
      "mission-state-c9e2a",
    contractPhase:
      "PRE_FREEZE",
  };
}

function input(
  missionId = MISSION,
) {
  return {
    objective:
      "Build and test a TypeScript service",
    context:
      context(missionId),
    workerId:
      "worker-c9e2a",
  };
}

function fixture() {
  const recovery =
    new InMemoryCanonicalRuntimeRecoveryStore();

  const execution =
    new MemoryExecutionStore();

  let now =
    1_900_000_000_000;

  return {
    recovery,
    execution,
    runtime:
      new DurableCanonicalEerOrchestratedRuntime({
        missionId:
          MISSION,
        recoveryStore:
          recovery,
        executionStore:
          execution,
        clock:
          () => ++now,
      }),
  };
}

test(
  "C9E2A start executes real EER and advances only to LOOP_AFTER_EER",
  async () => {
    const f =
      fixture();

    const result =
      await f.runtime
        .startAndRunEer(
          input(),
        );

    assert.ok(
      result.ok,
      result.reasonCode,
    );

    if (!result.ok) return;

    assert.equal(
      result.status,
      "STARTED_AND_ADVANCED",
    );

    assert.equal(
      result.checkpoint.checkpointVersion,
      2,
    );

    assert.equal(
      result.checkpoint.cursor.nodeId,
      "LOOP_AFTER_EER",
    );

    assert.equal(
      result.checkpoint.cursor.nodeKind,
      "GATE",
    );

    assert.equal(
      f.execution.operations.size,
      2,
    );
  },
);

test(
  "C9E2A crash gap after durable EER but before cursor commit resumes without a new EER lease",
  async () => {
    const f =
      fixture();

    const authority =
      new PostgresCanonicalFactoryEvidenceAuthority(
        f.execution,
      );

    let now =
      1_910_000_000_000;

    const control =
      new DurableCanonicalRuntimeOrchestrator({
        missionId:
          MISSION,
        store:
          f.recovery,
        factoryCompletionAuthority:
          authority,
        clock:
          () => ++now,
      });

    const started =
      await control.start(
        context().budgets,
      );

    assert.ok(started.ok);
    if (!started.ok) return;

    const writer =
      new DurableCanonicalEerRuntime(
        f.execution,
      );

    const written =
      await writer.execute({
        objective:
          input().objective,
        context:
          context(),
        checkpointVersion:
          started.checkpoint
            .checkpointVersion,
        cursorStepVersion:
          started.checkpoint
            .cursor.stepVersion,
        workerId:
          input().workerId,
      });

    assert.ok(written.ok);
    if (!written.ok) return;

    assert.equal(
      started.checkpoint.cursor.nodeId,
      "EER",
    );

    const leasesBefore =
      f.execution.acquireCalls;

    const resumed =
      await f.runtime
        .resumeAndRunEer(
          input(),
        );

    assert.ok(
      resumed.ok,
      resumed.reasonCode,
    );

    if (!resumed.ok) return;

    assert.equal(
      resumed.status,
      "RESUMED_AND_ADVANCED",
    );

    assert.equal(
      resumed.writerStatus,
      "REPLAY_COMPLETED",
    );

    assert.equal(
      f.execution.acquireCalls,
      leasesBefore,
    );

    assert.equal(
      resumed.checkpoint.cursor.nodeId,
      "LOOP_AFTER_EER",
    );
  },
);

test(
  "C9E2A restart after cursor advancement re-verifies durable EER evidence without writer execution",
  async () => {
    const f =
      fixture();

    const first =
      await f.runtime
        .startAndRunEer(
          input(),
        );

    assert.ok(first.ok);
    if (!first.ok) return;

    const leasesBefore =
      f.execution.acquireCalls;

    const fresh =
      new DurableCanonicalEerOrchestratedRuntime({
        missionId:
          MISSION,
        recoveryStore:
          f.recovery,
        executionStore:
          f.execution,
      });

    const resumed =
      await fresh.resumeAndRunEer(
        input(),
      );

    assert.ok(
      resumed.ok,
      resumed.reasonCode,
    );

    if (!resumed.ok) return;

    assert.equal(
      resumed.status,
      "ALREADY_AT_LOOP_AFTER_EER",
    );

    assert.equal(
      resumed.writerStatus,
      "NOT_EXECUTED",
    );

    assert.equal(
      f.execution.acquireCalls,
      leasesBefore,
    );

    assert.deepEqual(
      resumed.completion,
      first.completion,
    );
  },
);

test(
  "C9E2A tampered durable EER output is refused on restart at LOOP_AFTER_EER",
  async () => {
    const f =
      fixture();

    const first =
      await f.runtime
        .startAndRunEer(
          input(),
        );

    assert.ok(first.ok);
    if (!first.ok) return;

    const output =
      [...f.execution.operations.entries()]
        .find(
          ([key]) =>
            key.startsWith(
              "factory-output:",
            ),
        );

    assert.ok(output);
    if (!output) return;

    f.execution.operations.set(
      output[0],
      {
        ...output[1],
        value: {
          forged: true,
        },
      },
    );

    const fresh =
      new DurableCanonicalEerOrchestratedRuntime({
        missionId:
          MISSION,
        recoveryStore:
          f.recovery,
        executionStore:
          f.execution,
      });

    const resumed =
      await fresh.resumeAndRunEer(
        input(),
      );

    assert.equal(
      resumed.ok,
      false,
    );

    assert.equal(
      resumed.reasonCode,
      "durable-replay-invalid",
    );
  },
);

test(
  "C9E2A authority-sensitive EER refuses and leaves durable cursor at EER",
  async () => {
    const f =
      fixture();

    const result =
      await f.runtime
        .startAndRunEer({
          ...input(),
          objective:
            "delete production database",
        });

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.reasonCode,
      "eer-writer-refused",
    );

    const stored =
      await f.recovery.load(
        MISSION,
        null,
      );

    assert.ok(stored);

    assert.equal(
      stored?.cursor.nodeId,
      "EER",
    );

    assert.equal(
      f.execution.operations.size,
      0,
    );
  },
);

test(
  "C9E2A mission mismatch is refused before any recovery checkpoint is created",
  async () => {
    const f =
      fixture();

    const result =
      await f.runtime
        .startAndRunEer(
          input(
            "other-mission",
          ),
        );

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.reasonCode,
      "input-invalid",
    );

    assert.equal(
      await f.recovery.load(
        MISSION,
        null,
      ),
      null,
    );

    assert.equal(
      f.execution.operations.size,
      0,
    );
  },
);

test(
  "C9E3A verified EER evidence passes LOOP_AFTER_EER and advances only to PLAN",
  async () => {
    const f =
      fixture();

    const result =
      await f.runtime
        .startThroughEerGate(
          input(),
        );

    assert.ok(
      result.ok,
      result.reasonCode,
    );

    if (!result.ok) return;

    assert.equal(
      result.status,
      "STARTED_TO_PLAN",
    );

    assert.equal(
      result.checkpoint
        .checkpointVersion,
      3,
    );

    assert.equal(
      result.checkpoint
        .cursor.stepVersion,
      3,
    );

    assert.equal(
      result.checkpoint
        .cursor.nodeId,
      "PLAN",
    );

    assert.equal(
      result.checkpoint
        .cursor.nodeKind,
      "FACTORY",
    );

    assert.equal(
      result.verdict.status,
      "PASS",
    );

    assert.equal(
      result.verdict.nextAction,
      "NEXT",
    );

    assert.equal(
      f.execution.operations.size,
      2,
    );

    assert.equal(
      f.execution.acquireCalls,
      1,
    );
  },
);

test(
  "C9E3A restart at LOOP_AFTER_EER re-verifies EER and advances gate without another EER lease",
  async () => {
    const f =
      fixture();

    const eer =
      await f.runtime
        .startAndRunEer(
          input(),
        );

    assert.ok(eer.ok);

    if (!eer.ok) return;

    const leasesBefore =
      f.execution.acquireCalls;

    const fresh =
      new DurableCanonicalEerOrchestratedRuntime({
        missionId:
          MISSION,
        recoveryStore:
          f.recovery,
        executionStore:
          f.execution,
      });

    const resumed =
      await fresh
        .resumeThroughEerGate(
          input(),
        );

    assert.ok(
      resumed.ok,
      resumed.reasonCode,
    );

    if (!resumed.ok) return;

    assert.equal(
      resumed.status,
      "RESUMED_TO_PLAN",
    );

    assert.equal(
      resumed.checkpoint
        .cursor.nodeId,
      "PLAN",
    );

    assert.equal(
      f.execution.acquireCalls,
      leasesBefore,
    );
  },
);

test(
  "C9E3A restart after durable gate advancement is idempotently recognized at PLAN",
  async () => {
    const f =
      fixture();

    const first =
      await f.runtime
        .startThroughEerGate(
          input(),
        );

    assert.ok(first.ok);

    if (!first.ok) return;

    const leasesBefore =
      f.execution.acquireCalls;

    const fresh =
      new DurableCanonicalEerOrchestratedRuntime({
        missionId:
          MISSION,
        recoveryStore:
          f.recovery,
        executionStore:
          f.execution,
      });

    const resumed =
      await fresh
        .resumeThroughEerGate(
          input(),
        );

    assert.ok(
      resumed.ok,
      resumed.reasonCode,
    );

    if (!resumed.ok) return;

    assert.equal(
      resumed.status,
      "ALREADY_AT_PLAN",
    );

    assert.equal(
      resumed.checkpoint
        .checkpointVersion,
      3,
    );

    assert.equal(
      resumed.checkpoint
        .cursor.nodeId,
      "PLAN",
    );

    assert.equal(
      f.execution.acquireCalls,
      leasesBefore,
    );
  },
);

test(
  "C9E3A exhausted tick budget blocks at LOOP_AFTER_EER and cannot enter PLAN",
  async () => {
    const f =
      fixture();

    const zeroBudget = {
      ...input(),
      context: {
        ...context(),
        budgets: {
          virtualTicks:
            0,
          providerCalls:
            5,
          maxFixAttempts:
            3,
        },
      },
    };

    const result =
      await f.runtime
        .startThroughEerGate(
          zeroBudget,
        );

    assert.ok(
      result.ok,
      result.reasonCode,
    );

    if (!result.ok) return;

    assert.equal(
      result.status,
      "GATE_BLOCKED",
    );

    assert.equal(
      result.verdict.status,
      "HUMAN_REQUIRED",
    );

    assert.equal(
      result.verdict.nextAction,
      "HUMAN_REQUIRED",
    );

    assert.equal(
      result.checkpoint
        .cursor.nodeId,
      "LOOP_AFTER_EER",
    );

    const durable =
      await f.recovery.load(
        MISSION,
        null,
      );

    assert.ok(durable);

    assert.equal(
      durable?.cursor.nodeId,
      "LOOP_AFTER_EER",
    );
  },
);
