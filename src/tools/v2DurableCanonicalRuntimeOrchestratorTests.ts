import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  DurableCanonicalRuntimeOrchestrator,
  V2_CANONICAL_FACTORY_COMPLETION_SCHEMA,
  type CanonicalFactoryCompletion,
  type CanonicalFactoryCompletionAuthority,
  type CanonicalFactoryCompletionAuthorityResult,
  type CanonicalGateEvaluationInput,
} from "../v2/runtime/durableCanonicalRuntimeOrchestrator";

import {
  InMemoryCanonicalRuntimeRecoveryStore,
} from "../v2/persistence/inMemoryCanonicalRuntimeRecoveryStore";

import type {
  CanonicalRuntimeRecoveryStore,
  CanonicalRuntimeRecoveryCasResult,
  CanonicalRuntimeRecoveryCreateResult,
} from "../v2/persistence/canonicalRuntimeRecoveryStore";

import {
  V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA,
  validateCanonicalRuntimeRecoveryTransition,
  type CanonicalRuntimeRecoveryCheckpoint,
} from "../v2/persistence/canonicalRuntimeRecoveryCheckpoint";

import {
  V2_CANONICAL_RUNTIME_CURSOR_SCHEMA,
} from "../v2/runtime/canonicalRuntimeStepper";

import {
  V2_NAMLA_LOOP_GATE_STATE_SCHEMA,
} from "../v2/loop/namlaLoopGate";

import {
  CANONICAL_PIPELINE_SEQUENCE,
} from "../v2/architecture/canonicalPipelineRegistry";

import {
  captureCanonicalFrozenPlanContract,
  type CanonicalFrozenPlanContractIdentity,
} from "../v2/protocol/canonicalFrozenPlanContract";

import type {
  PlanContract,
} from "../v2/types/contracts";

import type {
  EvidenceRecord,
} from "../v2/types/evidence";

const MISSION = "c9b-mission";
const NOW = 1_800_000_000_000;

class CompletionAuthority
  implements CanonicalFactoryCompletionAuthority {
  public calls = 0;
  public allowed = true;
  public mutate:
    ((value: CanonicalFactoryCompletion) =>
      CanonicalFactoryCompletion) |
    null = null;

  public async verifyFactoryCompletion(
    completion: CanonicalFactoryCompletion,
  ): Promise<CanonicalFactoryCompletionAuthorityResult> {
    this.calls += 1;

    if (!this.allowed) {
      return {
        ok: false,
        status: "REFUSED",
        reasonCode: "fixture-refused",
      };
    }

    return {
      ok: true,
      status: "VERIFIED",
      reasonCode: "ok",
      completion:
        this.mutate
          ? this.mutate(
              structuredClone(
                completion,
              ),
            )
          : structuredClone(
              completion,
            ),
    };
  }
}

function completion(
  checkpoint:
    CanonicalRuntimeRecoveryCheckpoint,
): CanonicalFactoryCompletion {
  assert.equal(
    checkpoint.cursor.nodeKind,
    "FACTORY",
  );

  return {
    schemaVersion:
      V2_CANONICAL_FACTORY_COMPLETION_SCHEMA,
    missionId:
      checkpoint.missionId,
    factoryId:
      checkpoint.cursor.nodeId as
        CanonicalFactoryCompletion["factoryId"],
    checkpointVersion:
      checkpoint.checkpointVersion,
    cursorStepVersion:
      checkpoint.cursor.stepVersion,
    operationKey:
      `op-${checkpoint.cursor.nodeId}`,
    resultRef:
      `result://${checkpoint.cursor.nodeId}`,
    outputFingerprint:
      createHash("sha256")
        .update(
          checkpoint.cursor.nodeId,
        )
        .digest("hex"),
  };
}

function gateInput(
  stageId: string,
  options: {
    readonly evidenceRefs?: readonly string[];
    readonly evidencePool?: readonly EvidenceRecord[];
    readonly frozenContractBoundary?:
      CanonicalGateEvaluationInput[
        "frozenContractBoundary"
      ];
  } = {},
): CanonicalGateEvaluationInput {
  return {
    artifactIdentity: {
      artifactId: "art-1",
      path: "src/out.txt",
      sha256: "a".repeat(64),
      sizeBytes: 5,
      missionId: MISSION,
    },

    environmentIdentity: {
      platform: "test",
      nodeVersion: "test",
      cwd: "/workspace",
      envFingerprint: "b".repeat(64),
    },

    policyVersions: ["policy-v1"],
    requiredAttestations: [],
    requiredAssessments: [],
    evidenceRefs:
      options.evidenceRefs ?? [],
    evidencePool:
      options.evidencePool ?? [],

    policy: {
      stageId,
      allowedActions: [
        "FIX",
        "REWORK_AB",
        "REPLAN",
        "FAIL_CLOSED",
        "HUMAN_REQUIRED",
      ],
      maxRetriesPerStage: 3,
    },

    ...(options.frozenContractBoundary
      ? {
          frozenContractBoundary:
            options.frozenContractBoundary,
        }
      : {}),
  };
}

function evidence(
  id: string,
): EvidenceRecord {
  return {
    evidenceId: id,
    producer: "fixture",
    missionId: MISSION,
    stageId: "LOOP_AFTER_EER",
    environmentIdentity: {
      platform: "test",
      nodeVersion: "test",
      cwd: "/workspace",
      envFingerprint: "b".repeat(64),
    },
    timestamp: NOW,
    sequenceNumber: 1,
    status: "VALID",
    details: {},
    hash: "c".repeat(64),
  };
}

function orchestrator(
  store:
    CanonicalRuntimeRecoveryStore =
      new InMemoryCanonicalRuntimeRecoveryStore(),
  authority =
    new CompletionAuthority(),
) {
  return {
    store,
    authority,
    runtime:
      new DurableCanonicalRuntimeOrchestrator({
        missionId: MISSION,
        store,
        factoryCompletionAuthority:
          authority,
        maxLivelockThreshold: 3,
        clock: () => NOW,
      }),
  };
}

async function started() {
  const f =
    orchestrator();

  const start =
    await f.runtime.start({
      virtualTicks: 20,
      providerCalls: 10,
      maxFixAttempts: 3,
    });

  assert.ok(
    start.ok,
    start.reasonCode,
  );

  return f;
}

function frozen() {
  const raw = {
    contractId:
      `contract-${MISSION}`,
    version: "v1.0.0",
    objective: "Durable orchestration",
    acceptanceCriteria: [
      {
        id: "ac-1",
        description: "Resume safely",
        verificationMethod:
          "TEST" as const,
        required: true,
      },
    ],
    constraints: [],
    tasks: [
      {
        id: "task-1",
        name: "Orchestrate",
        description:
          "Persist exact canonical transitions",
        targetFiles: ["src/index.ts"],
        dependencies: [],
        capabilityRequirements: [],
      },
    ],
    dependencies: [],
    allowedCapabilities: [],
    requiredTests: [],
    securityRequirements: [],
    expectedArtifacts: [],
    evidenceRequirements: [],
    riskClassification: "LOW" as const,
    completionConditions: [],
    frozenAt: NOW - 10_000,
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
      {
        missionId: MISSION,
        contractId:
          contract.contractId,
        contractVersion:
          contract.version,
        contractHash,
      };

  return {
    binding:
      captured.binding,
    pin,
  };
}

function checkpointAt(
  nodeId:
    typeof CANONICAL_PIPELINE_SEQUENCE[number]["id"],
  contract:
    ReturnType<typeof frozen> | null =
      null,
): CanonicalRuntimeRecoveryCheckpoint {
  const index =
    CANONICAL_PIPELINE_SEQUENCE
      .findIndex(
        (node) =>
          node.id === nodeId,
      );

  assert.ok(index >= 0);

  const proIndex =
    CANONICAL_PIPELINE_SEQUENCE
      .findIndex(
        (node) =>
          node.id === "PRO",
      );

  const contractBound =
    index >= proIndex;

  if (contractBound) {
    assert.ok(contract);
  }

  return {
    schemaVersion:
      V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA,
    missionId: MISSION,
    checkpointVersion:
      index + 1,
    cursor: {
      schemaVersion:
        V2_CANONICAL_RUNTIME_CURSOR_SCHEMA,
      missionId: MISSION,
      nodeIndex: index,
      nodeId,
      nodeKind:
        CANONICAL_PIPELINE_SEQUENCE[index].kind,
      stepVersion:
        index + 1,
      contractPhase:
        contractBound
          ? "CONTRACT_BOUND"
          : "PRE_FREEZE",
    },
    savedAt: NOW - 100,
    loopBudget: {
      maxTicks: 20,
      remainingTicks: 18,
      maxFixAttempts: 3,
      remainingFixAttempts: 3,
      maxProviderCalls: 10,
      remainingProviderCalls: 9,
    },
    gateStates:
      CANONICAL_PIPELINE_SEQUENCE
        .flatMap(
          (node) =>
            node.kind === "GATE"
              ? [
                  {
                    schemaVersion:
                      V2_NAMLA_LOOP_GATE_STATE_SCHEMA,
                    missionId: MISSION,
                    stageId: node.id,
                    workPackageId: null,
                    maxLivelockThreshold: 3,
                    livelockCounter: 0,
                  },
                ]
              : [],
        ),
    failureCount: 0,
    frozenContract:
      contractBound
        ? contract!.binding
        : null,
  };
}

class SeedStore
  implements CanonicalRuntimeRecoveryStore {
  public current:
    CanonicalRuntimeRecoveryCheckpoint;

  public conflict = false;

  public constructor(
    seed:
      CanonicalRuntimeRecoveryCheckpoint,
    private readonly currentPin:
      CanonicalFrozenPlanContractIdentity | null,
  ) {
    this.current =
      structuredClone(seed);
  }

  public async create(
    _checkpoint:
      CanonicalRuntimeRecoveryCheckpoint,
  ): Promise<CanonicalRuntimeRecoveryCreateResult> {
    return "ALREADY_EXISTS";
  }

  public async load(
    missionId: string,
    _expected:
      CanonicalFrozenPlanContractIdentity | null,
  ) {
    assert.equal(
      missionId,
      MISSION,
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
    beforePin:
      CanonicalFrozenPlanContractIdentity | null,
    afterPin:
      CanonicalFrozenPlanContractIdentity | null,
  ): Promise<CanonicalRuntimeRecoveryCasResult> {
    assert.equal(
      missionId,
      MISSION,
    );

    if (
      this.conflict ||
      expectedVersion !==
        this.current.checkpointVersion
    ) {
      return {
        status:
          "VERSION_CONFLICT",
        currentCheckpointVersion:
          this.current.checkpointVersion + 1,
      };
    }

    const validation =
      validateCanonicalRuntimeRecoveryTransition(
        this.current,
        next,
        beforePin,
        afterPin,
      );

    assert.ok(
      validation.ok,
      validation.reasonCode,
    );

    this.current =
      structuredClone(next);

    return {
      status:
        "UPDATED",
      checkpointVersion:
        next.checkpointVersion,
    };
  }
}

test(
  "C9B starts one explicit recovery snapshot and inspects EER as the first factory",
  async () => {
    const f =
      await started();

    const snapshot =
      f.runtime.getSnapshot();

    assert.ok(snapshot);
    assert.equal(
      snapshot.checkpointVersion,
      1,
    );
    assert.equal(
      snapshot.cursor.nodeId,
      "EER",
    );
    assert.equal(
      snapshot.gateStates.length,
      12,
    );

    const inspection =
      f.runtime.inspectCurrentStep();

    assert.ok(inspection.ok);
    if (!inspection.ok) return;

    assert.equal(
      inspection.decision.kind,
      "RUN_FACTORY",
    );
  },
);

test(
  "C9B duplicate mission creation is refused instead of overwriting durable state",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeRecoveryStore();

    const first =
      orchestrator(store);

    assert.ok(
      (
        await first.runtime.start({
          virtualTicks: 10,
          providerCalls: 5,
          maxFixAttempts: 2,
        })
      ).ok,
    );

    const second =
      orchestrator(store);

    const result =
      await second.runtime.start({
        virtualTicks: 999,
        providerCalls: 999,
        maxFixAttempts: 999,
      });

    assert.equal(
      result.ok,
      false,
    );
    assert.equal(
      result.reasonCode,
      "session-refused",
    );
  },
);

test(
  "C9B verified durable factory completion advances exactly one canonical node",
  async () => {
    const f =
      await started();

    const before =
      f.runtime.getSnapshot();

    assert.ok(before);

    const result =
      await f.runtime
        .commitFactoryCompletion(
          completion(before),
        );

    assert.ok(
      result.ok,
      result.reasonCode,
    );

    if (!result.ok) return;

    assert.equal(
      result.status,
      "FACTORY_ADVANCED",
    );
    assert.equal(
      result.checkpoint.cursor.nodeId,
      "LOOP_AFTER_EER",
    );
    assert.equal(
      result.checkpoint.checkpointVersion,
      2,
    );
    assert.equal(
      f.authority.calls,
      1,
    );
  },
);

test(
  "C9B mismatched factory completion is rejected before the completion authority",
  async () => {
    const f =
      await started();

    const current =
      f.runtime.getSnapshot();

    assert.ok(current);

    const forged = {
      ...completion(current),
      checkpointVersion:
        current.checkpointVersion + 1,
    };

    const result =
      await f.runtime
        .commitFactoryCompletion(
          forged,
        );

    assert.equal(
      result.ok,
      false,
    );
    assert.equal(
      result.reasonCode,
      "factory-completion-mismatch",
    );
    assert.equal(
      f.authority.calls,
      0,
    );
  },
);

test(
  "C9B completion authority refusal cannot move the cursor",
  async () => {
    const f =
      await started();

    f.authority.allowed =
      false;

    const current =
      f.runtime.getSnapshot();

    assert.ok(current);

    const result =
      await f.runtime
        .commitFactoryCompletion(
          completion(current),
        );

    assert.equal(
      result.ok,
      false,
    );
    assert.equal(
      result.reasonCode,
      "factory-completion-authority-refused",
    );
    assert.equal(
      f.runtime.getSnapshot()?.cursor.nodeId,
      "EER",
    );
  },
);

test(
  "C9B completion authority cannot substitute another authenticated-looking result",
  async () => {
    const f =
      await started();

    f.authority.mutate =
      (value) => ({
        ...value,
        resultRef:
          "result://substituted",
      });

    const current =
      f.runtime.getSnapshot();

    assert.ok(current);

    const result =
      await f.runtime
        .commitFactoryCompletion(
          completion(current),
        );

    assert.equal(
      result.ok,
      false,
    );
    assert.equal(
      result.reasonCode,
      "factory-completion-authority-invalid",
    );
  },
);

test(
  "C9B PASS at a persisted NAMLA LOOP advances to PLAN",
  async () => {
    const f =
      await started();

    const initial =
      f.runtime.getSnapshot();

    assert.ok(initial);

    assert.ok(
      (
        await f.runtime
          .commitFactoryCompletion(
            completion(initial),
          )
      ).ok,
    );

    const result =
      await f.runtime.evaluateGate(
        gateInput(
          "LOOP_AFTER_EER",
        ),
      );

    assert.ok(
      result.ok,
      result.reasonCode,
    );

    if (!result.ok) return;

    assert.equal(
      result.status,
      "GATE_ADVANCED",
    );
    assert.equal(
      result.checkpoint.cursor.nodeId,
      "PLAN",
    );
    assert.equal(
      result.verdict?.status,
      "PASS",
    );
  },
);

test(
  "C9B missing gate evidence persists one consecutive failure and one lifetime failure",
  async () => {
    const f =
      await started();

    const initial =
      f.runtime.getSnapshot();

    assert.ok(initial);

    await f.runtime
      .commitFactoryCompletion(
        completion(initial),
      );

    const result =
      await f.runtime.evaluateGate(
        gateInput(
          "LOOP_AFTER_EER",
          {
            evidenceRefs:
              ["ev-1"],
          },
        ),
      );

    assert.ok(
      result.ok,
      result.reasonCode,
    );

    if (!result.ok) return;

    assert.equal(
      result.status,
      "GATE_RECORDED",
    );
    assert.equal(
      result.checkpoint.cursor.nodeId,
      "LOOP_AFTER_EER",
    );
    assert.equal(
      result.checkpoint.failureCount,
      1,
    );

    const state =
      result.checkpoint.gateStates
        .find(
          (candidate) =>
            candidate.stageId ===
            "LOOP_AFTER_EER",
        );

    assert.equal(
      state?.livelockCounter,
      1,
    );
  },
);

test(
  "C9B restart preserves a gate failure and PASS resets it while advancing",
  async () => {
    const f =
      await started();

    const initial =
      f.runtime.getSnapshot();

    assert.ok(initial);

    await f.runtime
      .commitFactoryCompletion(
        completion(initial),
      );

    await f.runtime.evaluateGate(
      gateInput(
        "LOOP_AFTER_EER",
        {
          evidenceRefs:
            ["ev-1"],
        },
      ),
    );

    const replacement =
      orchestrator(
        f.store,
      );

    const resumed =
      await replacement.runtime
        .resume(null);

    assert.ok(
      resumed.ok,
      resumed.reasonCode,
    );

    const result =
      await replacement.runtime
        .evaluateGate(
          gateInput(
            "LOOP_AFTER_EER",
            {
              evidenceRefs:
                ["ev-1"],
              evidencePool:
                [evidence("ev-1")],
            },
          ),
        );

    assert.ok(
      result.ok,
      result.reasonCode,
    );

    if (!result.ok) return;

    assert.equal(
      result.checkpoint.cursor.nodeId,
      "PLAN",
    );

    const state =
      result.checkpoint.gateStates
        .find(
          (candidate) =>
            candidate.stageId ===
            "LOOP_AFTER_EER",
        );

    assert.equal(
      state?.livelockCounter,
      0,
    );
    assert.equal(
      result.checkpoint.failureCount,
      1,
    );
  },
);

test(
  "C9C3 activated PLAN_TEST still requires durable completion authority before advancing",
  async () => {
    const store =
      new SeedStore(
        checkpointAt(
          "PLAN_TEST",
        ),
        null,
      );

    const authority =
      new CompletionAuthority();

    const f =
      orchestrator(
        store,
        authority,
      );

    assert.ok(
      (
        await f.runtime.resume(null)
      ).ok,
    );

    const inspection =
      f.runtime.inspectCurrentStep();

    assert.ok(inspection.ok);
    if (!inspection.ok) return;

    assert.equal(
      inspection.decision.kind,
      "RUN_FACTORY",
    );

    const result =
      await f.runtime
        .commitFactoryCompletion(
          completion(
            inspection.checkpoint,
          ),
        );

    assert.ok(
      result.ok,
      result.reasonCode,
    );

    if (!result.ok) return;

    assert.equal(
      result.status,
      "FACTORY_ADVANCED",
    );

    assert.equal(
      result.checkpoint.cursor.nodeId,
      "LOOP_AFTER_PLAN_TEST",
    );

    assert.equal(
      result.checkpoint.cursor.contractPhase,
      "PRE_FREEZE",
    );

    assert.equal(
      authority.calls,
      1,
    );
  },
);

test(
  "C9B exact PLAN_TEST gate crossing binds the independently pinned frozen contract and enters PRO",
  async () => {
    const contract =
      frozen();

    const store =
      new SeedStore(
        checkpointAt(
          "LOOP_AFTER_PLAN_TEST",
        ),
        null,
      );

    const f =
      orchestrator(store);

    assert.ok(
      (
        await f.runtime.resume(null)
      ).ok,
    );

    const result =
      await f.runtime
        .evaluateGate(
          gateInput(
            "LOOP_AFTER_PLAN_TEST",
            {
              frozenContractBoundary:
                contract,
            },
          ),
        );

    assert.ok(
      result.ok,
      result.reasonCode,
    );

    if (!result.ok) return;

    assert.equal(
      result.checkpoint.cursor.nodeId,
      "PRO",
    );
    assert.equal(
      result.checkpoint.cursor.contractPhase,
      "CONTRACT_BOUND",
    );
    assert.equal(
      result.checkpoint.frozenContract?.contractHash,
      contract.pin.contractHash,
    );
  },
);

test(
  "C9B frozen contract is mandatory on the exact crossing",
  async () => {
    const store =
      new SeedStore(
        checkpointAt(
          "LOOP_AFTER_PLAN_TEST",
        ),
        null,
      );

    const f =
      orchestrator(store);

    await f.runtime.resume(null);

    const result =
      await f.runtime.evaluateGate(
        gateInput(
          "LOOP_AFTER_PLAN_TEST",
        ),
      );

    assert.equal(
      result.ok,
      false,
    );
    assert.equal(
      result.reasonCode,
      "contract-boundary-required",
    );
    assert.equal(
      f.runtime.getSnapshot()?.cursor.nodeId,
      "LOOP_AFTER_PLAN_TEST",
    );
  },
);

test(
  "C9B tampered contract pin is refused without crossing",
  async () => {
    const contract =
      frozen();

    const store =
      new SeedStore(
        checkpointAt(
          "LOOP_AFTER_PLAN_TEST",
        ),
        null,
      );

    const f =
      orchestrator(store);

    await f.runtime.resume(null);

    const result =
      await f.runtime.evaluateGate(
        gateInput(
          "LOOP_AFTER_PLAN_TEST",
          {
            frozenContractBoundary: {
              binding:
                contract.binding,
              pin: {
                ...contract.pin,
                contractHash:
                  "0".repeat(64),
              },
            },
          },
        ),
      );

    assert.equal(
      result.ok,
      false,
    );
    assert.equal(
      result.reasonCode,
      "contract-boundary-invalid",
    );
  },
);

test(
  "C9B a frozen-contract boundary supplied at any other gate is refused",
  async () => {
    const contract =
      frozen();

    const f =
      await started();

    const initial =
      f.runtime.getSnapshot();

    assert.ok(initial);

    await f.runtime
      .commitFactoryCompletion(
        completion(initial),
      );

    const result =
      await f.runtime.evaluateGate(
        gateInput(
          "LOOP_AFTER_EER",
          {
            frozenContractBoundary:
              contract,
          },
        ),
      );

    assert.equal(
      result.ok,
      false,
    );
    assert.equal(
      result.reasonCode,
      "contract-boundary-unexpected",
    );
  },
);

test(
  "C9B contract-bound PRO snapshot resumes only under its external contract pin",
  async () => {
    const contract =
      frozen();

    const store =
      new SeedStore(
        checkpointAt(
          "PRO",
          contract,
        ),
        contract.pin,
      );

    const f =
      orchestrator(store);

    const result =
      await f.runtime.resume(
        contract.pin,
      );

    assert.ok(
      result.ok,
      result.reasonCode,
    );

    const inspection =
      f.runtime.inspectCurrentStep();

    assert.ok(inspection.ok);
    if (!inspection.ok) return;

    assert.equal(
      inspection.decision.kind,
      "RUN_FACTORY",
    );
    assert.equal(
      inspection.checkpoint.cursor.nodeId,
      "PRO",
    );
  },
);

test(
  "C9B recovery CAS conflict fails the orchestrator session closed without claiming advancement",
  async () => {
    const store =
      new SeedStore(
        checkpointAt(
          "EER",
        ),
        null,
      );

    const authority =
      new CompletionAuthority();

    const f =
      orchestrator(
        store,
        authority,
      );

    await f.runtime.resume(null);

    store.conflict =
      true;

    const current =
      f.runtime.getSnapshot();

    assert.ok(current);

    const result =
      await f.runtime
        .commitFactoryCompletion(
          completion(current),
        );

    assert.equal(
      result.ok,
      false,
    );
    assert.equal(
      result.reasonCode,
      "session-refused",
    );
    assert.equal(
      f.runtime.getSnapshot()?.cursor.nodeId,
      "EER",
    );

    const again =
      await f.runtime
        .commitFactoryCompletion(
          completion(current),
        );

    assert.equal(
      again.ok,
      false,
    );
    assert.equal(
      again.reasonCode,
      "session-refused",
    );
  },
);

test(
  "C9B terminal DELIVERY is inspectable and cannot be mistaken for executable work",
  async () => {
    const contract =
      frozen();

    const store =
      new SeedStore(
        checkpointAt(
          "DELIVERY",
          contract,
        ),
        contract.pin,
      );

    const f =
      orchestrator(store);

    assert.ok(
      (
        await f.runtime.resume(
          contract.pin,
        )
      ).ok,
    );

    const inspection =
      f.runtime.inspectCurrentStep();

    assert.ok(inspection.ok);
    if (!inspection.ok) return;

    assert.equal(
      inspection.decision.kind,
      "TERMINAL",
    );

    const result =
      await f.runtime
        .commitFactoryCompletion({
          schemaVersion:
            V2_CANONICAL_FACTORY_COMPLETION_SCHEMA,
        });

    assert.equal(
      result.ok,
      false,
    );
    assert.equal(
      result.reasonCode,
      "node-not-factory",
    );
  },
);
