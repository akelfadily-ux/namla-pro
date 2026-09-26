import test from "node:test";
import assert from "node:assert/strict";

import {
  fingerprintOperationIdentity,
} from "../v2/kernel/operationIdentity";

import type {
  OperationExecutionRecord,
  TaskExecutionAuthority,
} from "../v2/kernel/executionAuthority";

import {
  DurableCanonicalEerRuntime,
  type CanonicalEerExecutionStore,
} from "../v2/runtime/durableCanonicalEerRuntime";

import {
  readCanonicalFactoryOutput,
} from "../v2/runtime/canonicalFactoryDurableOutput";

import {
  PostgresCanonicalFactoryEvidenceAuthority,
} from "../v2/persistence/postgresCanonicalFactoryEvidenceAuthority";

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
  "c9e1d-mission";

interface StoredOperation {
  readonly identityValue:
    unknown;
  readonly record:
    OperationExecutionRecord;
  readonly completedValue?:
    unknown;
}

function context():
  PreFreezeStageContext {
  return {
    missionId:
      MISSION,
    authoritativeInputs:
      ["objective"],
    policyVersions:
      ["policy-v1"],
    budgets: {
      virtualTicks:
        20,
      providerCalls:
        5,
      maxFixAttempts:
        3,
    },
    evidenceRefs: [],
    missionStateRef:
      "mission-state-c9e1d",
    contractPhase:
      "PRE_FREEZE",
  };
}

class MemoryStore
  implements CanonicalEerExecutionStore {
  public readonly operations =
    new Map<
      string,
      StoredOperation
    >();

  public acquireCalls =
    0;

  public completeCalls =
    0;

  public refuseLease =
    false;

  public refuseValidation =
    false;

  private leaseEpoch =
    0;

  public async acquireTaskLease(
    input:
      AcquireTaskLeaseInput,
  ): Promise<
    TaskLeaseAcquireResult
  > {
    this.acquireCalls +=
      1;

    if (this.refuseLease) {
      return {
        ok:
          false,
        status:
          "REFUSED",
        reasonCode:
          "held-by-other",
      };
    }

    this.leaseEpoch +=
      1;

    return {
      ok:
        true,
      status:
        "ACQUIRED",
      reasonCode:
        "ok",
      authority:
        {
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
  ): Promise<
    PostgresOperationClaimResult
  > {
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
        existing.record.missionId !==
          input.authority.missionId ||
        existing.record.taskId !==
          input.authority.taskId ||
        existing.record.authorityScope !==
          input.authority.authorityScope ||
        existing.record.operationType !==
          input.operationType ||
        existing.record.inputFingerprint !==
          fingerprint
      ) {
        return {
          ok:
            false,
          status:
            "REFUSED",
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
          ok:
            true,
          status:
            "REPLAY_COMPLETED",
          reasonCode:
            "ok",
          inputFingerprint:
            fingerprint,
          record:
            existing.record,
          completedValue:
            structuredClone(
              existing.completedValue,
            ),
        };
      }

      return {
        ok:
          true,
        status:
          "ALREADY_CLAIMED_BY_CALLER",
        reasonCode:
          "ok",
        inputFingerprint:
          fingerprint,
        record:
          existing.record,
      };
    }

    const now =
      1_000 +
      this.operations.size;

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
        claimEpoch:
          1,
        claimExpiresAt:
          9_000_000_000_000,
        createdAt:
          now,
        updatedAt:
          now,
      };

    this.operations.set(
      input.operationKey,
      {
        identityValue:
          structuredClone(
            input.value,
          ),
        record,
      },
    );

    return {
      ok:
        true,
      status:
        "CLAIMED",
      reasonCode:
        "ok",
      inputFingerprint:
        fingerprint,
      record,
    };
  }

  public async validateOperationClaim(
    input:
      ValidateDurableOperationClaimInput,
  ): Promise<
    PostgresOperationClaimValidationResult
  > {
    const existing =
      this.operations.get(
        input.operationKey,
      );

    if (
      this.refuseValidation ||
      !existing ||
      existing.record.status !==
        "RUNNING" ||
      existing.record.claimToken !==
        input.claimToken ||
      existing.record.claimEpoch !==
        input.claimEpoch
    ) {
      return {
        ok:
          false,
        status:
          "REFUSED",
        reasonCode:
          "operation-not-running",
      };
    }

    return {
      ok:
        true,
      status:
        "VALID",
      reasonCode:
        "ok",
      record:
        existing.record,
      now:
        1_500,
    };
  }

  public async completeOperation(
    input:
      CompleteDurableOperationInput,
  ): Promise<
    PostgresOperationFinalizeResult
  > {
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
        ok:
          false,
        status:
          "REFUSED",
        reasonCode:
          "operation-not-running",
      };
    }

    this.completeCalls +=
      1;

    const completed:
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
        identityValue:
          existing.identityValue,
        record:
          completed,
        completedValue:
          structuredClone(
            input.value,
          ),
      },
    );

    return {
      ok:
        true,
      status:
        "COMPLETED",
      reasonCode:
        "ok",
      record:
        completed,
    };
  }

  public async readCompletedOperation(
    input:
      ReadCompletedDurableOperationInput,
  ): Promise<
    PostgresCompletedOperationReadResult
  > {
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
        ok:
          false,
        status:
          "REFUSED",
        reasonCode:
          "operation-not-found",
      };
    }

    if (
      existing.record.status !==
        "COMPLETED"
    ) {
      return {
        ok:
          false,
        status:
          "REFUSED",
        reasonCode:
          "operation-not-completed",
      };
    }

    return {
      ok:
        true,
      status:
        "COMPLETED",
      reasonCode:
        "ok",
      record:
        existing.record,
      completedValue:
        structuredClone(
          existing.completedValue,
        ),
    };
  }
}

function fixture(
  store =
    new MemoryStore(),
) {
  return {
    store,
    runtime:
      new DurableCanonicalEerRuntime(
        store,
      ),
  };
}

function input() {
  return {
    objective:
      "Build and test a TypeScript service",
    context:
      context(),
    checkpointVersion:
      1,
    cursorStepVersion:
      1,
    workerId:
      "worker-c9e1d",
  } as const;
}

test(
  "C9E1D real EER execution persists one v2 output and one v2 completion",
  async () => {
    const f =
      fixture();

    const result =
      await f.runtime.execute(
        input(),
      );

    assert.ok(
      result.ok,
      result.reasonCode,
    );

    if (!result.ok) {
      return;
    }

    assert.equal(
      result.status,
      "COMPLETED",
    );

    assert.equal(
      result.output.success,
      true,
    );

    assert.equal(
      result.completion.factoryId,
      "EER",
    );

    assert.equal(
      f.store.operations.size,
      2,
    );

    assert.equal(
      f.store.completeCalls,
      2,
    );
  },
);

test(
  "C9E1D returned completion and output independently verify through C9D and C9E",
  async () => {
    const f =
      fixture();

    const result =
      await f.runtime.execute(
        input(),
      );

    assert.ok(result.ok);

    if (!result.ok) {
      return;
    }

    const completion =
      await new PostgresCanonicalFactoryEvidenceAuthority(
        f.store,
      ).verifyFactoryCompletion(
        result.completion,
      );

    assert.ok(
      completion.ok,
      completion.reasonCode,
    );

    const output =
      await readCanonicalFactoryOutput(
        f.store,
        result.completion,
      );

    assert.ok(
      output.ok,
      output.reasonCode,
    );

    if (!output.ok) {
      return;
    }

    assert.deepEqual(
      output.output,
      result.output,
    );
  },
);

test(
  "C9E1D exact replay returns verified durable state without acquiring another lease",
  async () => {
    const f =
      fixture();

    const first =
      await f.runtime.execute(
        input(),
      );

    assert.ok(first.ok);

    if (!first.ok) {
      return;
    }

    const acquireCalls =
      f.store.acquireCalls;

    const completeCalls =
      f.store.completeCalls;

    const second =
      await f.runtime.execute(
        input(),
      );

    assert.ok(second.ok);

    if (!second.ok) {
      return;
    }

    assert.equal(
      second.status,
      "REPLAY_COMPLETED",
    );

    assert.equal(
      f.store.acquireCalls,
      acquireCalls,
    );

    assert.equal(
      f.store.completeCalls,
      completeCalls,
    );

    assert.deepEqual(
      second.completion,
      first.completion,
    );
  },
);

test(
  "C9E1D authority-sensitive EER objective creates no durable operation",
  async () => {
    const f =
      fixture();

    const result =
      await f.runtime.execute({
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
      "eer-refused",
    );

    assert.equal(
      f.store.acquireCalls,
      0,
    );

    assert.equal(
      f.store.operations.size,
      0,
    );
  },
);

test(
  "C9E1D PRE_FREEZE context rejects currentDraftPlan injection before EER authority",
  async () => {
    const f =
      fixture();

    const malicious = {
      ...context(),
      currentDraftPlan: {
        draftId:
          "forged",
      },
    } as unknown as
      PreFreezeStageContext;

    const result =
      await f.runtime.execute({
        ...input(),
        context:
          malicious,
      });

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.reasonCode,
      "input-invalid",
    );

    assert.equal(
      f.store.acquireCalls,
      0,
    );
  },
);

test(
  "C9E1D task lease refusal prevents output and completion claims",
  async () => {
    const f =
      fixture();

    f.store.refuseLease =
      true;

    const result =
      await f.runtime.execute(
        input(),
      );

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.reasonCode,
      "lease-refused",
    );

    assert.equal(
      f.store.operations.size,
      0,
    );
  },
);

test(
  "C9E1D crash-shaped partial output is safely replayed and missing completion is repaired",
  async () => {
    const f =
      fixture();

    const first =
      await f.runtime.execute(
        input(),
      );

    assert.ok(first.ok);

    if (!first.ok) {
      return;
    }

    f.store.operations.delete(
      first.completion.operationKey,
    );

    const completeCalls =
      f.store.completeCalls;

    const second =
      await f.runtime.execute(
        input(),
      );

    assert.ok(second.ok);

    if (!second.ok) {
      return;
    }

    assert.equal(
      second.status,
      "RECOVERED",
    );

    assert.equal(
      f.store.operations.size,
      2,
    );

    assert.equal(
      f.store.completeCalls,
      completeCalls + 1,
    );

    const verified =
      await new PostgresCanonicalFactoryEvidenceAuthority(
        f.store,
      ).verifyFactoryCompletion(
        second.completion,
      );

    assert.ok(
      verified.ok,
      verified.reasonCode,
    );
  },
);

test(
  "C9E1D tampered completed output fails closed before another task lease is acquired",
  async () => {
    const f =
      fixture();

    const first =
      await f.runtime.execute(
        input(),
      );

    assert.ok(first.ok);

    if (!first.ok) {
      return;
    }

    const outputEntry =
      [...f.store.operations.entries()]
        .find(
          ([key]) =>
            key.startsWith(
              "factory-output:",
            ),
        );

    assert.ok(outputEntry);

    if (!outputEntry) {
      return;
    }

    f.store.operations.set(
      outputEntry[0],
      {
        ...outputEntry[1],
        completedValue: {
          forged:
            true,
        },
      },
    );

    const acquireCalls =
      f.store.acquireCalls;

    const second =
      await f.runtime.execute(
        input(),
      );

    assert.equal(
      second.ok,
      false,
    );

    assert.equal(
      second.reasonCode,
      "durable-state-invalid",
    );

    assert.equal(
      f.store.acquireCalls,
      acquireCalls,
    );
  },
);
