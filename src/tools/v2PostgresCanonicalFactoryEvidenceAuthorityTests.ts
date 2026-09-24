import test from "node:test";
import assert from "node:assert/strict";

import {
  PostgresExecutionAuthorityStore,
  type PostgresCompletedOperationReadResult,
} from "../v2/persistence/postgresExecutionAuthorityStore";

import type {
  PostgresCheckpointDatabase,
  PostgresCheckpointQueryResult,
} from "../v2/persistence/postgresMissionCheckpointStore";

import {
  PostgresCanonicalFactoryEvidenceAuthority,
  CANONICAL_ASSURANCE_PROOF_OPERATION_TYPE,
  CANONICAL_FACTORY_COMPLETION_OPERATION_TYPE,
  canonicalAssuranceAuthorityScope,
  canonicalAssuranceAuthorityTaskId,
  canonicalAssuranceProofOperationKey,
  canonicalDurableResultRef,
  canonicalFactoryAuthorityScope,
  canonicalFactoryAuthorityTaskId,
  canonicalFactoryCompletionOperationKey,
} from "../v2/persistence/postgresCanonicalFactoryEvidenceAuthority";

import {
  fingerprintOperationIdentity,
} from "../v2/kernel/operationIdentity";

import {
  V2_CANONICAL_FACTORY_COMPLETION_SCHEMA,
  type CanonicalFactoryCompletion,
} from "../v2/runtime/durableCanonicalRuntimeOrchestrator";

import {
  V2_CANONICAL_POST_PROMAX_PROOF_SCHEMA,
  type CanonicalPostProMaxProof,
} from "../v2/assurance/postProMaxAssuranceFactories";

import type {
  OperationExecutionRecord,
} from "../v2/kernel/executionAuthority";

const MISSION = "c9d1-mission";

function baseRecord(
  overrides: Partial<OperationExecutionRecord> = {},
): OperationExecutionRecord {
  return {
    operationKey: "operation-1",
    missionId: MISSION,
    taskId: "task-1",
    authorityScope: "scope-1",
    operationType: "type-1",
    inputFingerprint: "a".repeat(64),
    status: "COMPLETED",
    claimOwnerWorkerId: "worker-1",
    claimTaskLeaseToken: "lease-1",
    claimTaskLeaseEpoch: 1,
    claimToken: "claim-1",
    claimEpoch: 1,
    claimExpiresAt: 5_000,
    createdAt: 1_000,
    updatedAt: 2_000,
    finishedAt: 2_000,
    ...overrides,
  };
}

function rowFrom(
  record: OperationExecutionRecord,
  result: unknown,
) {
  return {
    mission_id: record.missionId,
    operation_key: record.operationKey,
    task_id: record.taskId,
    authority_scope: record.authorityScope,
    operation_type: record.operationType,
    input_fingerprint: record.inputFingerprint,
    status: record.status,
    claim_owner_worker_id: record.claimOwnerWorkerId,
    claim_task_lease_token: record.claimTaskLeaseToken,
    claim_task_lease_epoch: record.claimTaskLeaseEpoch,
    claim_token: record.claimToken,
    claim_epoch: record.claimEpoch,
    claim_expires_at: record.claimExpiresAt,
    result,
    error_text: null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    finished_at: record.finishedAt ?? null,
  };
}

class SingleRowDatabase
  implements PostgresCheckpointDatabase {
  public constructor(
    private readonly row: unknown | null,
  ) {}

  public async query<T = unknown>(
    _sql: string,
    _params?: readonly unknown[],
  ): Promise<PostgresCheckpointQueryResult<T>> {
    return {
      rows:
        this.row === null
          ? []
          : [this.row as T],
    };
  }

  public async transaction<T>(
    _work: (
      client: PostgresCheckpointDatabase,
    ) => Promise<T>,
  ): Promise<T> {
    throw new Error(
      "C9D1_READ_ONLY_TEST_TRANSACTION_NOT_EXPECTED",
    );
  }
}

class FakeReader {
  public reads = 0;

  public constructor(
    public result:
      PostgresCompletedOperationReadResult,
  ) {}

  public async readCompletedOperation():
    Promise<PostgresCompletedOperationReadResult> {
    this.reads += 1;
    return this.result;
  }
}

function completion():
  CanonicalFactoryCompletion {
  const outputFingerprint =
    "b".repeat(64);

  const operationKey =
    canonicalFactoryCompletionOperationKey({
      missionId: MISSION,
      factoryId: "PLAN_TEST",
      checkpointVersion: 3,
      cursorStepVersion: 5,
      outputFingerprint,
    });

  return {
    schemaVersion:
      V2_CANONICAL_FACTORY_COMPLETION_SCHEMA,
    missionId: MISSION,
    factoryId: "PLAN_TEST",
    checkpointVersion: 3,
    cursorStepVersion: 5,
    operationKey,
    resultRef:
      canonicalDurableResultRef(
        operationKey,
      ),
    outputFingerprint,
  };
}

function proof():
  CanonicalPostProMaxProof {
  const outputFingerprint =
    "c".repeat(64);

  const key =
    canonicalAssuranceProofOperationKey({
      missionId: MISSION,
      candidateId: "candidate-1",
      contractId:
        `contract-${MISSION}`,
      contractVersion: "v1.0.0",
      contractHash: "d".repeat(64),
      stageId: "SECURITY",
      outputFingerprint,
    });

  return {
    schemaVersion:
      V2_CANONICAL_POST_PROMAX_PROOF_SCHEMA,
    missionId: MISSION,
    candidateId: "candidate-1",
    contractId:
      `contract-${MISSION}`,
    contractVersion: "v1.0.0",
    contractHash: "d".repeat(64),
    stageId: "SECURITY",
    resultRef:
      canonicalDurableResultRef(key),
    outputFingerprint,
  };
}

function completedRead(
  record: OperationExecutionRecord,
  completedValue: unknown,
): PostgresCompletedOperationReadResult {
  return {
    ok: true,
    status: "COMPLETED",
    reasonCode: "ok",
    record,
    completedValue,
  };
}

function factoryRecord(
  value: CanonicalFactoryCompletion,
  overrides: Partial<OperationExecutionRecord> = {},
): OperationExecutionRecord {
  const scope =
    canonicalFactoryAuthorityScope(
      value.factoryId,
    );

  return baseRecord({
    missionId: value.missionId,
    operationKey: value.operationKey,
    taskId:
      canonicalFactoryAuthorityTaskId(
        value.factoryId,
      ),
    authorityScope: scope,
    operationType:
      CANONICAL_FACTORY_COMPLETION_OPERATION_TYPE,
    inputFingerprint:
      fingerprintOperationIdentity({
        missionId: value.missionId,
        authorityScope: scope,
        operationType:
          CANONICAL_FACTORY_COMPLETION_OPERATION_TYPE,
        value,
      }),
    ...overrides,
  });
}

function proofRecord(
  value: CanonicalPostProMaxProof,
  overrides: Partial<OperationExecutionRecord> = {},
): OperationExecutionRecord {
  const key =
    canonicalAssuranceProofOperationKey({
      missionId: value.missionId,
      candidateId: value.candidateId,
      contractId: value.contractId,
      contractVersion: value.contractVersion,
      contractHash: value.contractHash,
      stageId: value.stageId,
      outputFingerprint:
        value.outputFingerprint,
    });

  const scope =
    canonicalAssuranceAuthorityScope(
      value.stageId,
    );

  return baseRecord({
    missionId: value.missionId,
    operationKey: key,
    taskId:
      canonicalAssuranceAuthorityTaskId(
        value.stageId,
      ),
    authorityScope: scope,
    operationType:
      CANONICAL_ASSURANCE_PROOF_OPERATION_TYPE,
    inputFingerprint:
      fingerprintOperationIdentity({
        missionId: value.missionId,
        authorityScope: scope,
        operationType:
          CANONICAL_ASSURANCE_PROOF_OPERATION_TYPE,
        value,
      }),
    ...overrides,
  });
}

test(
  "C9D1 PostgreSQL store reads one completed operation without opening a transaction",
  async () => {
    const record =
      baseRecord();

    const value = {
      durable: true,
    };

    const store =
      new PostgresExecutionAuthorityStore(
        new SingleRowDatabase(
          rowFrom(
            record,
            value,
          ),
        ),
      );

    const result =
      await store.readCompletedOperation({
        missionId: MISSION,
        operationKey:
          record.operationKey,
      });

    assert.ok(
      result.ok,
      result.reasonCode,
    );

    if (!result.ok) return;

    assert.equal(
      result.status,
      "COMPLETED",
    );

    assert.deepEqual(
      result.completedValue,
      value,
    );

    assert.equal(
      result.record.operationKey,
      record.operationKey,
    );
  },
);

test(
  "C9D1 PostgreSQL store refuses a non-terminal operation as completed evidence",
  async () => {
    const running =
      baseRecord({
        status: "RUNNING",
        finishedAt: undefined,
      });

    const store =
      new PostgresExecutionAuthorityStore(
        new SingleRowDatabase(
          rowFrom(
            running,
            null,
          ),
        ),
      );

    const result =
      await store.readCompletedOperation({
        missionId: MISSION,
        operationKey:
          running.operationKey,
      });

    assert.deepEqual(
      result,
      {
        ok: false,
        status: "REFUSED",
        reasonCode:
          "operation-not-completed",
      },
    );
  },
);

test(
  "C9D1 exact durable canonical factory completion is verified",
  async () => {
    const value = completion();

    const reader =
      new FakeReader(
        completedRead(
          factoryRecord(value),
          structuredClone(value),
        ),
      );

    const authority =
      new PostgresCanonicalFactoryEvidenceAuthority(
        reader,
      );

    const result =
      await authority
        .verifyFactoryCompletion(
          value,
        );

    assert.ok(
      result.ok,
      result.reasonCode,
    );

    assert.equal(
      reader.reads,
      1,
    );
  },
);

test(
  "C9D1 factory completion with a non-canonical operation key is refused before PostgreSQL",
  async () => {
    const value = {
      ...completion(),
      operationKey:
        "attacker-selected-key",
      resultRef:
        "pgop:attacker-selected-key",
    };

    const reader =
      new FakeReader({
        ok: false,
        status: "REFUSED",
        reasonCode:
          "operation-not-found",
      });

    const result =
      await new PostgresCanonicalFactoryEvidenceAuthority(
        reader,
      ).verifyFactoryCompletion(
        value,
      );

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.reasonCode,
      "DURABLE_COMPLETION_REFERENCE_MISMATCH",
    );

    assert.equal(
      reader.reads,
      0,
    );
  },
);

test(
  "C9D1 factory completion cannot reuse a completed row from another authority scope",
  async () => {
    const value = completion();

    const reader =
      new FakeReader(
        completedRead(
          factoryRecord(
            value,
            {
              authorityScope:
                "CANONICAL_FACTORY/PLAN",
            },
          ),
          value,
        ),
      );

    const result =
      await new PostgresCanonicalFactoryEvidenceAuthority(
        reader,
      ).verifyFactoryCompletion(
        value,
      );

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.reasonCode,
      "DURABLE_COMPLETION_BINDING_MISMATCH",
    );
  },
);

test(
  "C9D1 factory completion input fingerprint mismatch is refused",
  async () => {
    const value = completion();

    const reader =
      new FakeReader(
        completedRead(
          factoryRecord(
            value,
            {
              inputFingerprint:
                "0".repeat(64),
            },
          ),
          value,
        ),
      );

    const result =
      await new PostgresCanonicalFactoryEvidenceAuthority(
        reader,
      ).verifyFactoryCompletion(
        value,
      );

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.reasonCode,
      "DURABLE_COMPLETION_BINDING_MISMATCH",
    );
  },
);

test(
  "C9D1 factory completion durable result substitution is refused",
  async () => {
    const value = completion();

    const reader =
      new FakeReader(
        completedRead(
          factoryRecord(value),
          {
            ...value,
            outputFingerprint:
              "1".repeat(64),
          },
        ),
      );

    const result =
      await new PostgresCanonicalFactoryEvidenceAuthority(
        reader,
      ).verifyFactoryCompletion(
        value,
      );

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.reasonCode,
      "DURABLE_COMPLETION_RESULT_MISMATCH",
    );
  },
);

test(
  "C9D1 exact durable canonical assurance proof is verified",
  async () => {
    const value = proof();

    const reader =
      new FakeReader(
        completedRead(
          proofRecord(value),
          structuredClone(value),
        ),
      );

    const result =
      await new PostgresCanonicalFactoryEvidenceAuthority(
        reader,
      ).verifyProof(
        value,
      );

    assert.ok(
      result.ok,
      result.reasonCode,
    );

    assert.equal(
      reader.reads,
      1,
    );
  },
);

test(
  "C9D1 assurance proof with attacker-selected result ref is refused before PostgreSQL",
  async () => {
    const value = {
      ...proof(),
      resultRef:
        "pgop:attacker-selected",
    };

    const reader =
      new FakeReader({
        ok: false,
        status: "REFUSED",
        reasonCode:
          "operation-not-found",
      });

    const result =
      await new PostgresCanonicalFactoryEvidenceAuthority(
        reader,
      ).verifyProof(
        value,
      );

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.reasonCode,
      "DURABLE_PROOF_REFERENCE_MISMATCH",
    );

    assert.equal(
      reader.reads,
      0,
    );
  },
);

test(
  "C9D1 assurance proof cannot reuse another stage authority scope",
  async () => {
    const value = proof();

    const reader =
      new FakeReader(
        completedRead(
          proofRecord(
            value,
            {
              authorityScope:
                "CANONICAL_ASSURANCE/DEVOPS",
            },
          ),
          value,
        ),
      );

    const result =
      await new PostgresCanonicalFactoryEvidenceAuthority(
        reader,
      ).verifyProof(
        value,
      );

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.reasonCode,
      "DURABLE_PROOF_BINDING_MISMATCH",
    );
  },
);

test(
  "C9D1 assurance proof input fingerprint mismatch is refused",
  async () => {
    const value = proof();

    const reader =
      new FakeReader(
        completedRead(
          proofRecord(
            value,
            {
              inputFingerprint:
                "f".repeat(64),
            },
          ),
          value,
        ),
      );

    const result =
      await new PostgresCanonicalFactoryEvidenceAuthority(
        reader,
      ).verifyProof(
        value,
      );

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.reasonCode,
      "DURABLE_PROOF_BINDING_MISMATCH",
    );
  },
);

test(
  "C9D1 assurance proof durable result substitution is refused",
  async () => {
    const value = proof();

    const reader =
      new FakeReader(
        completedRead(
          proofRecord(value),
          {
            ...value,
            candidateId:
              "candidate-substituted",
          },
        ),
      );

    const result =
      await new PostgresCanonicalFactoryEvidenceAuthority(
        reader,
      ).verifyProof(
        value,
      );

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.reasonCode,
      "DURABLE_PROOF_RESULT_MISMATCH",
    );
  },
);
