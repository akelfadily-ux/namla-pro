import test from "node:test";
import assert from "node:assert/strict";

import type {
  OperationExecutionRecord,
} from "../v2/kernel/executionAuthority";

import {
  fingerprintOperationIdentity,
} from "../v2/kernel/operationIdentity";

import {
  V2_CANONICAL_FACTORY_COMPLETION_SCHEMA,
  type CanonicalFactoryCompletion,
} from "../v2/runtime/durableCanonicalRuntimeOrchestrator";

import {
  canonicalDurableResultRef,
  canonicalFactoryAuthorityScope,
  canonicalFactoryAuthorityTaskId,
  canonicalFactoryCompletionOperationKey,
} from "../v2/persistence/postgresCanonicalFactoryEvidenceAuthority";

import {
  CANONICAL_FACTORY_OUTPUT_OPERATION_TYPE,
  canonicalFactoryOutputInputFingerprint,
  canonicalFactoryOutputOperationKey,
  fingerprintCanonicalFactoryOutput,
  readCanonicalFactoryOutput,
} from "../v2/runtime/canonicalFactoryDurableOutput";

import type {
  PostgresCompletedOperationReadResult,
} from "../v2/persistence/postgresExecutionAuthorityStore";

const MISSION =
  "c9e1a-mission";

function output() {
  return {
    success:
      true,
    reasonCode:
      "OK",
    nested: {
      z:
        2,
      a:
        1,
    },
    evidence: [
      "ev-1",
      "ev-2",
    ],
  };
}

function completion(
  value:
    unknown = output(),
): CanonicalFactoryCompletion {
  const outputFingerprint =
    fingerprintCanonicalFactoryOutput(
      "EER",
      value,
    );

  const operationKey =
    canonicalFactoryCompletionOperationKey({
      missionId:
        MISSION,
      factoryId:
        "EER",
      checkpointVersion:
        1,
      cursorStepVersion:
        1,
    });

  return {
    schemaVersion:
      V2_CANONICAL_FACTORY_COMPLETION_SCHEMA,
    missionId:
      MISSION,
    factoryId:
      "EER",
    checkpointVersion:
      1,
    cursorStepVersion:
      1,
    operationKey,
    resultRef:
      canonicalDurableResultRef(
        operationKey,
      ),
    outputFingerprint,
  };
}

function record(
  cp:
    CanonicalFactoryCompletion,
  overrides:
    Partial<OperationExecutionRecord> = {},
): OperationExecutionRecord {
  const operationKey =
    canonicalFactoryOutputOperationKey(
      cp,
    );

  const scope =
    canonicalFactoryAuthorityScope(
      cp.factoryId,
    );

  return {
    operationKey,
    missionId:
      cp.missionId,
    taskId:
      canonicalFactoryAuthorityTaskId(
        cp.factoryId,
      ),
    authorityScope:
      scope,
    operationType:
      CANONICAL_FACTORY_OUTPUT_OPERATION_TYPE,
    inputFingerprint:
      fingerprintOperationIdentity({
        missionId:
          cp.missionId,
        authorityScope:
          scope,
        operationType:
          CANONICAL_FACTORY_OUTPUT_OPERATION_TYPE,
        value:
          cp,
      }),
    status:
      "COMPLETED",
    claimOwnerWorkerId:
      "worker-c9e1a",
    claimTaskLeaseToken:
      "lease-c9e1a",
    claimTaskLeaseEpoch:
      1,
    claimToken:
      "claim-c9e1a",
    claimEpoch:
      1,
    claimExpiresAt:
      9_000_000_000_000,
    createdAt:
      1000,
    updatedAt:
      2000,
    finishedAt:
      2000,
    ...overrides,
  };
}

class Reader {
  public constructor(
    private readonly result:
      PostgresCompletedOperationReadResult,
  ) {}

  public async readCompletedOperation():
    Promise<PostgresCompletedOperationReadResult> {
    return this.result;
  }
}

test(
  "C9E1A canonical factory output fingerprint is deterministic across object key order",
  () => {
    const left = {
      a:
        1,
      b: {
        y:
          2,
        x:
          3,
      },
    };

    const right = {
      b: {
        x:
          3,
        y:
          2,
      },
      a:
        1,
    };

    assert.equal(
      fingerprintCanonicalFactoryOutput(
        "EER",
        left,
      ),
      fingerprintCanonicalFactoryOutput(
        "EER",
        right,
      ),
    );
  },
);

test(
  "C9E1C output operation key is stable per canonical step while input fingerprint remains output-bound",
  async () => {
    const value =
      output();

    const first =
      completion(value);

    const second = {
      ...first,
      outputFingerprint:
        "f".repeat(64),
    };

    assert.equal(
      canonicalFactoryOutputOperationKey(
        first,
      ),
      canonicalFactoryOutputOperationKey(
        second,
      ),
    );

    assert.notEqual(
      canonicalFactoryOutputInputFingerprint(
        first,
      ),
      canonicalFactoryOutputInputFingerprint(
        second,
      ),
    );

    const result =
      await readCanonicalFactoryOutput(
        new Reader({
          ok:
            true,
          status:
            "COMPLETED",
          reasonCode:
            "ok",
          record:
            record(first),
          completedValue:
            value,
        }),
        second,
      );

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.reasonCode,
      "output-binding-mismatch",
    );
  },
);

test(
  "C9E1A exact completed durable output is recovered and verified",
  async () => {
    const value =
      output();

    const cp =
      completion(value);

    const reader =
      new Reader({
        ok:
          true,
        status:
          "COMPLETED",
        reasonCode:
          "ok",
        record:
          record(cp),
        completedValue:
          structuredClone(
            value,
          ),
      });

    const result =
      await readCanonicalFactoryOutput(
        reader,
        cp,
      );

    assert.ok(
      result.ok,
      result.reasonCode,
    );

    if (!result.ok) return;

    assert.deepEqual(
      result.output,
      value,
    );
  },
);

test(
  "C9E1A durable output from another authority scope is refused",
  async () => {
    const value =
      output();

    const cp =
      completion(value);

    const reader =
      new Reader({
        ok:
          true,
        status:
          "COMPLETED",
        reasonCode:
          "ok",
        record:
          record(
            cp,
            {
              authorityScope:
                "CANONICAL_FACTORY/PLAN",
            },
          ),
        completedValue:
          value,
      });

    const result =
      await readCanonicalFactoryOutput(
        reader,
        cp,
      );

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.reasonCode,
      "output-binding-mismatch",
    );
  },
);

test(
  "C9E1A durable output substitution is refused by fingerprint",
  async () => {
    const cp =
      completion(
        output(),
      );

    const reader =
      new Reader({
        ok:
          true,
        status:
          "COMPLETED",
        reasonCode:
          "ok",
        record:
          record(cp),
        completedValue: {
          forged:
            true,
        },
      });

    const result =
      await readCanonicalFactoryOutput(
        reader,
        cp,
      );

    assert.equal(
      result.ok,
      false,
    );

    assert.equal(
      result.reasonCode,
      "output-fingerprint-mismatch",
    );
  },
);

test(
  "C9E1A non-completed durable output fails closed",
  async () => {
    const cp =
      completion();

    const result =
      await readCanonicalFactoryOutput(
        new Reader({
          ok:
            false,
          status:
            "REFUSED",
          reasonCode:
            "operation-not-completed",
        }),
        cp,
      );

    assert.deepEqual(
      result,
      {
        ok:
          false,
        status:
          "REFUSED",
        reasonCode:
          "output-not-completed",
      },
    );

    assert.match(
      canonicalFactoryOutputInputFingerprint(
        cp,
      ),
      /^[0-9a-f]{64}$/u,
    );
  },
);
