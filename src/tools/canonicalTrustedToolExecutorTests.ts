import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  CanonicalTrustedToolExecutor,
  CANONICAL_FILESYSTEM_READ_TOOL,
  CANONICAL_FILESYSTEM_WRITE_TOOL,
  CANONICAL_TRUSTED_FILESYSTEM_BINDINGS,
} from "../application/canonicalTrustedToolExecutor";

import {
  PRODUCTIZATION_TOOL_OPERATION_TYPE,
  type ClaimedToolRequest,
} from "../application/tool-gateway";

import { TrustedKernel } from "../v2/kernel/trustedKernel";

import {
  CANONICAL_PIPELINE_SEQUENCE,
} from "../v2/architecture/canonicalPipelineRegistry";

import {
  V2_CANONICAL_RUNTIME_CURSOR_SCHEMA,
} from "../v2/runtime/canonicalRuntimeStepper";

import {
  V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA,
  validateCanonicalRuntimeRecoveryTransition,
  type CanonicalRuntimeRecoveryCheckpoint,
} from "../v2/persistence/canonicalRuntimeRecoveryCheckpoint";

import {
  V2_NAMLA_LOOP_GATE_STATE_SCHEMA,
} from "../v2/loop/namlaLoopGate";

import {
  captureCanonicalFrozenPlanContract,
  type CanonicalFrozenPlanContractIdentity,
} from "../v2/protocol/canonicalFrozenPlanContract";

import type {
  PlanContract,
} from "../v2/types/contracts";

import type {
  PostgresOperationClaimValidationResult,
  ValidateDurableOperationClaimInput,
} from "../v2/persistence/postgresExecutionAuthorityStore";

const NOW = 1_800_000_000_000;
const MISSION = "c9a-mission";
const TASK = "task-1";

function frozen(
  writeReadOnly = false,
) {
  const raw = {
    contractId:
      `contract-${MISSION}`,
    version:
      "v1.0.0",
    objective:
      "Exercise the canonical trusted tool executor",
    acceptanceCriteria: [
      {
        id: "ac-1",
        description:
          "Trusted effects are fenced",
        verificationMethod:
          "TEST" as const,
        required:
          true,
      },
    ],
    constraints: [],
    tasks: [
      {
        id: TASK,
        name: "Effect",
        description:
          "Write and read one file",
        targetFiles: [
          "src/out.txt",
        ],
        dependencies: [],
        capabilityRequirements: [
          "filesystem.read",
          "filesystem.write",
        ],
      },
    ],
    dependencies: [],
    allowedCapabilities: [
      {
        capability:
          "filesystem.read",
        target:
          "*",
        readOnly:
          false,
      },
      {
        capability:
          "filesystem.write",
        target:
          "*",
        readOnly:
          writeReadOnly,
      },
    ],
    requiredTests: [],
    securityRequirements: [],
    expectedArtifacts: [],
    evidenceRequirements: [],
    riskClassification:
      "LOW" as const,
    completionConditions: [],
    frozenAt:
      NOW - 10_000,
  };

  const rawJson =
    JSON.stringify(raw);

  const contractHash =
    createHash("sha256")
      .update(rawJson)
      .digest("hex");

  const contract:
    PlanContract = {
      ...raw,
      contractHash,
    };

  const captured =
    captureCanonicalFrozenPlanContract(
      MISSION,
      contract,
    );

  assert.ok(
    captured.ok,
    captured.reasonCode,
  );

  const pin:
    CanonicalFrozenPlanContractIdentity =
      Object.freeze({
        missionId:
          MISSION,
        contractId:
          contract.contractId,
        contractVersion:
          contract.version,
        contractHash,
      });

  return {
    binding:
      captured.binding,
    contract:
      captured.contract,
    pin,
  };
}

function checkpoint(
  pinData = frozen(),
): CanonicalRuntimeRecoveryCheckpoint {
  const index =
    CANONICAL_PIPELINE_SEQUENCE
      .findIndex(
        (node) =>
          node.id === "PRO",
      );

  assert.ok(index >= 0);

  return Object.freeze({
    schemaVersion:
      V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA,

    missionId:
      MISSION,

    checkpointVersion:
      index + 1,

    cursor:
      Object.freeze({
        schemaVersion:
          V2_CANONICAL_RUNTIME_CURSOR_SCHEMA,
        missionId:
          MISSION,
        nodeIndex:
          index,
        nodeId:
          "PRO" as const,
        nodeKind:
          "FACTORY" as const,
        stepVersion:
          index + 1,
        contractPhase:
          "CONTRACT_BOUND" as const,
      }),

    savedAt:
      NOW - 100,

    loopBudget:
      Object.freeze({
        maxTicks: 10,
        remainingTicks: 5,
        maxFixAttempts: 3,
        remainingFixAttempts: 3,
        maxProviderCalls: 5,
        remainingProviderCalls: 5,
      }),

    gateStates:
      Object.freeze(
        CANONICAL_PIPELINE_SEQUENCE
          .flatMap(
            (node) =>
              node.kind === "GATE"
                ? [
                    Object.freeze({
                      schemaVersion:
                        V2_NAMLA_LOOP_GATE_STATE_SCHEMA,
                      missionId:
                        MISSION,
                      stageId:
                        node.id,
                      workPackageId:
                        null,
                      maxLivelockThreshold:
                        3,
                      livelockCounter:
                        0,
                    }),
                  ]
                : [],
          ),
      ),

    failureCount:
      0,

    frozenContract:
      pinData.binding,
  });
}

class RecoveryPort {
  public current:
    CanonicalRuntimeRecoveryCheckpoint;

  public conflict = false;

  public constructor(
    current:
      CanonicalRuntimeRecoveryCheckpoint,
    private readonly pin:
      CanonicalFrozenPlanContractIdentity,
  ) {
    this.current =
      structuredClone(current);
  }

  public async load(
    missionId: string,
    expected:
      CanonicalFrozenPlanContractIdentity | null,
  ) {
    assert.equal(
      missionId,
      MISSION,
    );

    assert.deepEqual(
      expected,
      this.pin,
    );

    return structuredClone(
      this.current,
    );
  }

  public async compareAndSet(
    missionId: string,
    expectedVersion: number,
    next:
      CanonicalRuntimeRecoveryCheckpoint,
    currentPin:
      CanonicalFrozenPlanContractIdentity | null,
    nextPin:
      CanonicalFrozenPlanContractIdentity | null,
  ) {
    assert.equal(
      missionId,
      MISSION,
    );

    assert.deepEqual(
      currentPin,
      this.pin,
    );

    assert.deepEqual(
      nextPin,
      this.pin,
    );

    if (
      this.conflict ||
      expectedVersion !==
        this.current.checkpointVersion
    ) {
      return {
        status:
          "VERSION_CONFLICT" as const,
        currentCheckpointVersion:
          this.current.checkpointVersion,
      };
    }

    const validation =
      validateCanonicalRuntimeRecoveryTransition(
        this.current,
        next,
        this.pin,
        this.pin,
      );

    assert.ok(
      validation.ok,
      validation.reasonCode,
    );

    this.current =
      structuredClone(next);

    return {
      status:
        "UPDATED" as const,
      checkpointVersion:
        next.checkpointVersion,
    };
  }
}

class FencePort {
  public calls = 0;
  public failOnCall:
    number | null = null;

  public constructor(
    public readonly record:
      ClaimedToolRequest["claim"],
  ) {}

  public async validateOperationClaim(
    _input:
      ValidateDurableOperationClaimInput,
  ): Promise<
    PostgresOperationClaimValidationResult
  > {
    this.calls += 1;

    if (
      this.failOnCall ===
      this.calls
    ) {
      return {
        ok: false,
        status: "REFUSED",
        reasonCode:
          "claim-expired",
      };
    }

    return {
      ok: true,
      status: "VALID",
      reasonCode: "ok",
      record:
        structuredClone(
          this.record,
        ),
      now:
        NOW,
    };
  }
}

function request(
  toolName:
    | typeof CANONICAL_FILESYSTEM_READ_TOOL
    | typeof CANONICAL_FILESYSTEM_WRITE_TOOL,
  input: Record<string, unknown>,
): ClaimedToolRequest {
  const fingerprint =
    "a".repeat(64);

  const authority =
    Object.freeze({
      missionId:
        MISSION,
      taskId:
        TASK,
      workerId:
        "worker-1",
      authorityScope:
        `PRO/COLONY_A/${TASK}`,
      leaseToken:
        "lease-1",
      leaseEpoch:
        1,
      expiresAt:
        NOW + 60_000,
    });

  const claim =
    Object.freeze({
      operationKey:
        "op-1",
      missionId:
        MISSION,
      taskId:
        TASK,
      authorityScope:
        authority.authorityScope,
      operationType:
        PRODUCTIZATION_TOOL_OPERATION_TYPE,
      inputFingerprint:
        fingerprint,
      status:
        "RUNNING" as const,
      claimOwnerWorkerId:
        authority.workerId,
      claimTaskLeaseToken:
        authority.leaseToken,
      claimTaskLeaseEpoch:
        authority.leaseEpoch,
      claimToken:
        "claim-1",
      claimEpoch:
        1,
      claimExpiresAt:
        NOW + 30_000,
      createdAt:
        NOW - 100,
      updatedAt:
        NOW - 100,
    });

  return Object.freeze({
    toolName,
    bindingRevision:
      toolName ===
      CANONICAL_FILESYSTEM_READ_TOOL
        ? "canonical-filesystem-read-v1"
        : "canonical-filesystem-write-v1",

    input:
      input as never,

    context:
      Object.freeze({
        runId:
          MISSION,
        taskId:
          TASK,
        antId:
          "ant-1",
        traceId:
          "trace-1",
        operationId:
          "op-1",
        permissions:
          Object.freeze([
            `tool:${toolName}`,
          ]),
        authority,
      }),

    permissionRequests:
      Object.freeze([
        Object.freeze({
          capability:
            `tool:${toolName}`,
          resource:
            String(input.path),
        }),
      ]),

    inputFingerprint:
      fingerprint,

    claim,
  });
}

function fixture(
  writeReadOnly = false,
) {
  const root =
    mkdtempSync(
      join(
        tmpdir(),
        "namla-c9a-",
      ),
    );

  const contract =
    frozen(writeReadOnly);

  const recovery =
    new RecoveryPort(
      checkpoint(contract),
      contract.pin,
    );

  const req =
    request(
      CANONICAL_FILESYSTEM_WRITE_TOOL,
      {
        path:
          "src/out.txt",
        content:
          "hello",
      },
    );

  const fence =
    new FencePort(
      req.claim,
    );

  const kernel =
    new TrustedKernel({
      workspaceRoot:
        root,
      humanAuthorizationGranted:
        true,
    });

  const executor =
    new CanonicalTrustedToolExecutor({
      kernel,
      authorityStore:
        fence,
      recoveryStore:
        recovery,
      contractPin:
        contract.pin,
      clock:
        () => NOW,
    });

  return {
    root,
    contract,
    recovery,
    req,
    fence,
    kernel,
    executor,
  };
}

function cleanup(
  root: string,
): void {
  rmSync(
    root,
    {
      recursive: true,
      force: true,
    },
  );
}

test(
  "C9A write revalidates the durable claim twice reserves one tick then delegates the effect to TrustedKernel",
  async () => {
    const f = fixture();

    try {
      const result =
        await f.executor.executeClaimed(
          f.req,
          new AbortController().signal,
        );

      assert.equal(
        result.status,
        "SUCCEEDED",
      );

      assert.equal(
        f.fence.calls,
        2,
      );

      assert.equal(
        f.recovery.current.loopBudget
          .remainingTicks,
        4,
      );

      assert.equal(
        readFileSync(
          join(
            f.root,
            "src",
            "out.txt",
          ),
          "utf8",
        ),
        "hello",
      );
    } finally {
      cleanup(f.root);
    }
  },
);

test(
  "C9A write under a read-only contract grant is refused before filesystem mutation",
  async () => {
    const f = fixture(true);

    try {
      const result =
        await f.executor.executeClaimed(
          f.req,
          new AbortController().signal,
        );

      assert.deepEqual(
        result,
        {
          status:
            "REFUSED_BEFORE_EFFECT",
        },
      );

      assert.equal(
        f.recovery.current.loopBudget
          .remainingTicks,
        5,
      );

      assert.equal(
        f.kernel.workspaceFileExists(
          "src/out.txt",
        ),
        false,
      );
    } finally {
      cleanup(f.root);
    }
  },
);

test(
  "C9A read is authorized by a read-write scope after the TrustedKernel readOnly-direction hardening",
  async () => {
    const f = fixture();

    try {
      mkdirSync(
        join(f.root, "src"),
        { recursive: true },
      );

      writeFileSync(
        join(
          f.root,
          "src",
          "input.txt",
        ),
        "hello-read",
        "utf8",
      );

      const req =
        request(
          CANONICAL_FILESYSTEM_READ_TOOL,
          {
            path:
              "src/input.txt",
          },
        );

      const executor =
        new CanonicalTrustedToolExecutor({
          kernel:
            f.kernel,
          authorityStore:
            new FencePort(
              req.claim,
            ),
          recoveryStore:
            f.recovery,
          contractPin:
            f.contract.pin,
          clock:
            () => NOW,
        });

      const result =
        await executor.executeClaimed(
          req,
          new AbortController().signal,
        );

      assert.equal(
        result.status,
        "SUCCEEDED",
      );

      if (
        result.status !==
        "SUCCEEDED"
      ) {
        assert.fail();
      }

      assert.deepEqual(
        result.value,
        {
          content:
            "hello-read",
          truncated:
            false,
        },
      );
    } finally {
      cleanup(f.root);
    }
  },
);

test(
  "C9A exhausted recovery budget refuses without a durable reservation or filesystem effect",
  async () => {
    const f = fixture();

    try {
      f.recovery.current =
        Object.freeze({
          ...f.recovery.current,
          loopBudget:
            Object.freeze({
              ...f.recovery.current
                .loopBudget,
              remainingTicks:
                0,
            }),
        });

      const result =
        await f.executor.executeClaimed(
          f.req,
          new AbortController().signal,
        );

      assert.equal(
        result.status,
        "REFUSED_BEFORE_EFFECT",
      );

      assert.equal(
        f.kernel.workspaceFileExists(
          "src/out.txt",
        ),
        false,
      );
    } finally {
      cleanup(f.root);
    }
  },
);

test(
  "C9A recovery CAS conflict refuses before effect",
  async () => {
    const f = fixture();

    try {
      f.recovery.conflict =
        true;

      const result =
        await f.executor.executeClaimed(
          f.req,
          new AbortController().signal,
        );

      assert.equal(
        result.status,
        "REFUSED_BEFORE_EFFECT",
      );

      assert.equal(
        f.kernel.workspaceFileExists(
          "src/out.txt",
        ),
        false,
      );
    } finally {
      cleanup(f.root);
    }
  },
);

test(
  "C9A claim loss before reservation refuses without consuming budget",
  async () => {
    const f = fixture();

    try {
      f.fence.failOnCall =
        1;

      const result =
        await f.executor.executeClaimed(
          f.req,
          new AbortController().signal,
        );

      assert.equal(
        result.status,
        "REFUSED_BEFORE_EFFECT",
      );

      assert.equal(
        f.recovery.current.loopBudget
          .remainingTicks,
        5,
      );
    } finally {
      cleanup(f.root);
    }
  },
);

test(
  "C9A claim loss after durable reservation consumes the conservative tick but performs no external effect",
  async () => {
    const f = fixture();

    try {
      f.fence.failOnCall =
        2;

      const result =
        await f.executor.executeClaimed(
          f.req,
          new AbortController().signal,
        );

      assert.equal(
        result.status,
        "REFUSED_BEFORE_EFFECT",
      );

      assert.equal(
        f.recovery.current.loopBudget
          .remainingTicks,
        4,
      );

      assert.equal(
        f.kernel.workspaceFileExists(
          "src/out.txt",
        ),
        false,
      );
    } finally {
      cleanup(f.root);
    }
  },
);

test(
  "C9A filesystem bindings are explicit pure mappings with no executable callback",
  () => {
    assert.deepEqual(
      CANONICAL_TRUSTED_FILESYSTEM_BINDINGS
        .map(
          (binding) =>
            binding.name,
        ),
      [
        "filesystem.read",
        "filesystem.write",
      ],
    );

    for (
      const binding
      of CANONICAL_TRUSTED_FILESYSTEM_BINDINGS
    ) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(
          binding,
          "execute",
        ),
        false,
      );
    }
  },
);

test(
  "C9A TrustedKernel write authority cannot use a read-only scope while read authority can use a read-write scope",
  () => {
    const root =
      mkdtempSync(
        join(
          tmpdir(),
          "namla-c9a-authority-",
        ),
      );

    try {
      const kernel =
        new TrustedKernel({
          workspaceRoot:
            root,
          humanAuthorizationGranted:
            true,
        });

      const base =
        frozen().contract;

      const readonlyWrite:
        PlanContract = {
          ...base,
          allowedCapabilities: [
            {
              capability:
                "filesystem.write",
              target:
                "*",
              readOnly:
                true,
            },
          ],
        };

      assert.equal(
        kernel.evaluateEffectiveAuthority(
          {
            capability:
              "filesystem.write",
            target:
              "src/a.txt",
            readOnly:
              false,
          },
          readonlyWrite,
          1,
        ).authorized,
        false,
      );

      const readWriteRead:
        PlanContract = {
          ...base,
          allowedCapabilities: [
            {
              capability:
                "filesystem.read",
              target:
                "*",
              readOnly:
                false,
            },
          ],
        };

      assert.equal(
        kernel.evaluateEffectiveAuthority(
          {
            capability:
              "filesystem.read",
            target:
              "src/a.txt",
            readOnly:
              true,
          },
          readWriteRead,
          1,
        ).authorized,
        true,
      );
    } finally {
      cleanup(root);
    }
  },
);
