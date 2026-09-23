/**
 * C9B Durable Canonical Runtime Orchestrator.
 *
 * Control-plane responsibilities:
 * - create/resume the complete v2 recovery checkpoint through the hardened
 *   DurableCanonicalRuntimeRecoverySession;
 * - inspect the canonical 10E5 pipeline step;
 * - advance a factory only after a mandatory trusted completion authority
 *   verifies an externally durable result reference;
 * - evaluate NAMLA LOOP from the persisted gate state and persist failure
 *   counters or exact PASS/NEXT advancement;
 * - bind the actual immutable Frozen PlanContract only on the exact
 *   LOOP_AFTER_PLAN_TEST -> PRO crossing.
 *
 * Deliberate boundary:
 * this class does not execute factories and does not pretend that an in-memory
 * callback is execution proof. C9C must bind CanonicalFactoryCompletionAuthority
 * to durable factory operation/result records before a production runtime can
 * advance a factory.
 */

import {
  isDeepStrictEqual,
  types,
} from "node:util";

import {
  CANONICAL_PIPELINE_SEQUENCE,
  type CanonicalFactoryId,
} from "../architecture/canonicalPipelineRegistry";

import {
  NamlaLoopGate,
  V2_NAMLA_LOOP_GATE_STATE_SCHEMA,
  type NamlaLoopGateState,
} from "../loop/namlaLoopGate";

import {
  restoreCanonicalFrozenPlanContract,
  type CanonicalFrozenPlanContractBinding,
  type CanonicalFrozenPlanContractIdentity,
} from "../protocol/canonicalFrozenPlanContract";

import {
  createCanonicalRuntimeLoopBudget,
} from "./canonicalRuntimeLoopBudget";

import {
  advanceCanonicalRuntimeCursor,
  createCanonicalRuntimeCursor,
  inspectCanonicalRuntimeStep,
  type CanonicalRuntimeStepDecision,
} from "./canonicalRuntimeStepper";

import type {
  RuntimeBudgets,
} from "../types/stageContext";

import type {
  GateVerdict,
  StageRecoveryPolicy,
} from "../types/namlaLoopTypes";

import type {
  ArtifactIdentity,
  EnvironmentIdentity,
  EvidenceRecord,
} from "../types/evidence";

import {
  V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA,
  restoreCanonicalRuntimeRecoveryCheckpoint,
  type CanonicalRuntimeRecoveryCheckpoint,
} from "../persistence/canonicalRuntimeRecoveryCheckpoint";

import {
  DurableCanonicalRuntimeRecoverySession,
} from "../persistence/durableCanonicalRuntimeRecoverySession";

import {
  snapshotCanonicalRuntimeRecoveryPin,
  type CanonicalRuntimeRecoveryStore,
} from "../persistence/canonicalRuntimeRecoveryStore";

export const V2_CANONICAL_FACTORY_COMPLETION_SCHEMA =
  "namla-v2-canonical-factory-completion-v1" as const;

export interface CanonicalFactoryCompletion {
  readonly schemaVersion:
    typeof V2_CANONICAL_FACTORY_COMPLETION_SCHEMA;
  readonly missionId: string;
  readonly factoryId: CanonicalFactoryId;
  readonly checkpointVersion: number;
  readonly cursorStepVersion: number;
  readonly operationKey: string;
  /** Durable opaque reference owned by the factory-result authority. */
  readonly resultRef: string;
  readonly outputFingerprint: string;
}

export type CanonicalFactoryCompletionAuthorityResult =
  | {
      readonly ok: true;
      readonly status: "VERIFIED";
      readonly reasonCode: "ok";
      readonly completion: CanonicalFactoryCompletion;
    }
  | {
      readonly ok: false;
      readonly status: "REFUSED";
      readonly reasonCode: string;
    };

export interface CanonicalFactoryCompletionAuthority {
  verifyFactoryCompletion(
    completion: CanonicalFactoryCompletion,
  ): Promise<CanonicalFactoryCompletionAuthorityResult>;
}

export interface DurableCanonicalRuntimeOrchestratorOptions {
  readonly missionId: string;
  readonly store: CanonicalRuntimeRecoveryStore;
  readonly factoryCompletionAuthority:
    CanonicalFactoryCompletionAuthority;
  readonly maxLivelockThreshold?: number;
  readonly clock?: () => number;
}

export interface CanonicalGateEvaluationInput {
  readonly artifactIdentity: ArtifactIdentity;
  readonly environmentIdentity: EnvironmentIdentity;
  readonly policyVersions: readonly string[];
  readonly requiredAttestations: readonly string[];
  readonly requiredAssessments: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly evidencePool: readonly EvidenceRecord[];
  readonly policy: StageRecoveryPolicy;
  /**
   * Present only for the PASS that crosses LOOP_AFTER_PLAN_TEST -> PRO.
   * The pin must originate from an independent trusted authority source.
   */
  readonly frozenContractBoundary?: {
    readonly binding: CanonicalFrozenPlanContractBinding;
    readonly pin: CanonicalFrozenPlanContractIdentity;
  };
}

export type DurableCanonicalRuntimeOrchestratorReason =
  | "session-not-active"
  | "session-refused"
  | "clock-invalid"
  | "budget-invalid"
  | "step-fail-closed"
  | "node-not-factory"
  | "node-not-gate"
  | "factory-unavailable"
  | "factory-completion-invalid"
  | "factory-completion-mismatch"
  | "factory-completion-authority-refused"
  | "factory-completion-authority-invalid"
  | "factory-completion-authority-failed"
  | "stepper-refused"
  | "gate-input-invalid"
  | "gate-evaluation-failed"
  | "gate-state-transition-invalid"
  | "contract-boundary-required"
  | "contract-boundary-unexpected"
  | "contract-boundary-invalid";

export type DurableCanonicalRuntimeOrchestratorResult =
  | {
      readonly ok: true;
      readonly status:
        | "STARTED"
        | "RESUMED"
        | "FACTORY_ADVANCED"
        | "GATE_ADVANCED"
        | "GATE_RECORDED"
        | "GATE_BLOCKED";
      readonly reasonCode: "ok";
      readonly checkpoint: CanonicalRuntimeRecoveryCheckpoint;
      readonly verdict?: GateVerdict;
      readonly persisted?: boolean;
    }
  | {
      readonly ok: false;
      readonly status: "REFUSED";
      readonly reasonCode:
        DurableCanonicalRuntimeOrchestratorReason;
      readonly detailReasonCode?: string;
      readonly checkpoint?: CanonicalRuntimeRecoveryCheckpoint;
      readonly verdict?: GateVerdict;
    };

export type DurableCanonicalRuntimeInspection =
  | {
      readonly ok: true;
      readonly reasonCode: "ok";
      readonly checkpoint: CanonicalRuntimeRecoveryCheckpoint;
      readonly decision: CanonicalRuntimeStepDecision;
    }
  | {
      readonly ok: false;
      readonly reasonCode: "session-not-active";
    };

const COMPLETION_FIELDS = [
  "schemaVersion",
  "missionId",
  "factoryId",
  "checkpointVersion",
  "cursorStepVersion",
  "operationKey",
  "resultRef",
  "outputFingerprint",
] as const;

const FACTORY_IDS =
  new Set<CanonicalFactoryId>(
    CANONICAL_PIPELINE_SEQUENCE.flatMap(
      (node) =>
        node.kind === "FACTORY"
          ? [node.id]
          : [],
    ),
  );

function positive(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function boundedText(
  value: unknown,
  max = 1024,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/u.test(
      value,
    )
  );
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      types.isProxy(value)
    ) {
      return null;
    }

    const prototype: unknown =
      Object.getPrototypeOf(value);

    if (
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      return null;
    }

    if (
      Reflect.ownKeys(value).length !==
      fields.length
    ) {
      return null;
    }

    const out:
      Record<string, unknown> =
        Object.create(null);

    for (const field of fields) {
      const descriptor =
        Object.getOwnPropertyDescriptor(
          value,
          field,
        );

      if (
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        return null;
      }

      out[field] =
        descriptor.value;
    }

    return out;
  } catch {
    return null;
  }
}

function readFactoryCompletion(
  value: unknown,
): CanonicalFactoryCompletion | null {
  const data =
    exactRecord(
      value,
      COMPLETION_FIELDS,
    );

  if (
    !data ||
    data.schemaVersion !==
      V2_CANONICAL_FACTORY_COMPLETION_SCHEMA ||
    !boundedText(data.missionId, 512) ||
    typeof data.factoryId !== "string" ||
    !FACTORY_IDS.has(
      data.factoryId as CanonicalFactoryId,
    ) ||
    !positive(data.checkpointVersion) ||
    !positive(data.cursorStepVersion) ||
    !boundedText(data.operationKey, 512) ||
    !boundedText(data.resultRef, 2048) ||
    typeof data.outputFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(
      data.outputFingerprint,
    )
  ) {
    return null;
  }

  return Object.freeze({
    schemaVersion:
      V2_CANONICAL_FACTORY_COMPLETION_SCHEMA,
    missionId:
      data.missionId,
    factoryId:
      data.factoryId as CanonicalFactoryId,
    checkpointVersion:
      data.checkpointVersion,
    cursorStepVersion:
      data.cursorStepVersion,
    operationKey:
      data.operationKey,
    resultRef:
      data.resultRef,
    outputFingerprint:
      data.outputFingerprint,
  });
}

function captureMethod<
  T extends (...args: never[]) => unknown,
>(
  owner: object,
  key: string,
): T {
  if (
    typeof owner !== "object" ||
    owner === null ||
    types.isProxy(owner)
  ) {
    throw new Error(
      "CANONICAL_ORCHESTRATOR_CONFIGURATION_INVALID",
    );
  }

  let at: object | null =
    owner;

  for (
    let depth = 0;
    at !== null && depth < 16;
    depth += 1,
      at = Object.getPrototypeOf(at)
  ) {
    if (types.isProxy(at)) {
      throw new Error(
        "CANONICAL_ORCHESTRATOR_CONFIGURATION_INVALID",
      );
    }

    const descriptor =
      Object.getOwnPropertyDescriptor(
        at,
        key,
      );

    if (!descriptor) {
      continue;
    }

    if (
      !("value" in descriptor) ||
      typeof descriptor.value !==
        "function" ||
      types.isProxy(descriptor.value)
    ) {
      throw new Error(
        "CANONICAL_ORCHESTRATOR_CONFIGURATION_INVALID",
      );
    }

    return descriptor.value.bind(
      owner,
    ) as T;
  }

  throw new Error(
    "CANONICAL_ORCHESTRATOR_CONFIGURATION_INVALID",
  );
}

function freezeCheckpoint(
  checkpoint:
    CanonicalRuntimeRecoveryCheckpoint,
): CanonicalRuntimeRecoveryCheckpoint {
  return Object.freeze({
    ...checkpoint,
    cursor:
      Object.freeze({
        ...checkpoint.cursor,
      }),
    loopBudget:
      Object.freeze({
        ...checkpoint.loopBudget,
      }),
    gateStates:
      Object.freeze(
        checkpoint.gateStates.map(
          (state) =>
            Object.freeze({
              ...state,
            }),
        ),
      ),
    frozenContract:
      checkpoint.frozenContract === null
        ? null
        : Object.freeze({
            ...checkpoint.frozenContract,
          }),
  });
}

export class DurableCanonicalRuntimeOrchestrator {
  private readonly session:
    DurableCanonicalRuntimeRecoverySession;

  private readonly gate:
    NamlaLoopGate;

  private readonly verifyFactory:
    CanonicalFactoryCompletionAuthority[
      "verifyFactoryCompletion"
    ];

  private readonly clock:
    () => number;

  private readonly maxLivelockThreshold:
    number;

  private currentPin:
    CanonicalFrozenPlanContractIdentity | null =
      null;

  public constructor(
    options:
      DurableCanonicalRuntimeOrchestratorOptions,
  ) {
    if (
      !Number.isSafeInteger(
        options.maxLivelockThreshold ?? 3,
      ) ||
      (options.maxLivelockThreshold ?? 3) < 0
    ) {
      throw new Error(
        "CANONICAL_ORCHESTRATOR_LIVELOCK_THRESHOLD_INVALID",
      );
    }

    this.maxLivelockThreshold =
      options.maxLivelockThreshold ?? 3;

    this.session =
      new DurableCanonicalRuntimeRecoverySession(
        options.store,
        options.missionId,
      );

    this.gate =
      new NamlaLoopGate({
        maxLivelockThreshold:
          this.maxLivelockThreshold,
      });

    this.verifyFactory =
      captureMethod<
        CanonicalFactoryCompletionAuthority[
          "verifyFactoryCompletion"
        ]
      >(
        options.factoryCompletionAuthority as object,
        "verifyFactoryCompletion",
      );

    if (
      options.clock !== undefined &&
      (
        typeof options.clock !== "function" ||
        types.isProxy(options.clock)
      )
    ) {
      throw new Error(
        "CANONICAL_ORCHESTRATOR_CLOCK_INVALID",
      );
    }

    this.clock =
      options.clock ?? Date.now;
  }

  public getSnapshot():
    CanonicalRuntimeRecoveryCheckpoint | null {
    return this.session.getSnapshot();
  }

  public inspectCurrentStep():
    DurableCanonicalRuntimeInspection {
    const checkpoint =
      this.session.getSnapshot();

    if (!checkpoint) {
      return Object.freeze({
        ok: false as const,
        reasonCode:
          "session-not-active" as const,
      });
    }

    return Object.freeze({
      ok: true as const,
      reasonCode:
        "ok" as const,
      checkpoint,
      decision:
        inspectCanonicalRuntimeStep(
          checkpoint.cursor,
        ),
    });
  }

  public async start(
    limits: RuntimeBudgets,
  ): Promise<
    DurableCanonicalRuntimeOrchestratorResult
  > {
    const budget =
      createCanonicalRuntimeLoopBudget(
        limits,
      );

    if (!budget.ok) {
      return this.refused(
        "budget-invalid",
        budget.reasonCode,
      );
    }

    const savedAt =
      this.now();

    if (savedAt === null) {
      return this.refused(
        "clock-invalid",
      );
    }

    const cursor =
      createCanonicalRuntimeCursor(
        this.session.missionId,
      );

    const gateStates:
      readonly NamlaLoopGateState[] =
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
                          this.session.missionId,
                        stageId:
                          node.id,
                        workPackageId:
                          null,
                        maxLivelockThreshold:
                          this.maxLivelockThreshold,
                        livelockCounter:
                          0,
                      }),
                    ]
                  : [],
            ),
        );

    const checkpoint =
      freezeCheckpoint({
        schemaVersion:
          V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA,
        missionId:
          this.session.missionId,
        checkpointVersion:
          1,
        cursor,
        savedAt,
        loopBudget:
          budget.budget,
        gateStates,
        failureCount:
          0,
        frozenContract:
          null,
      });

    const created =
      await this.session
        .createInitial(
          checkpoint,
        );

    if (!created.ok) {
      return this.refused(
        "session-refused",
        created.reasonCode,
      );
    }

    this.currentPin =
      null;

    return Object.freeze({
      ok: true as const,
      status:
        "STARTED" as const,
      reasonCode:
        "ok" as const,
      checkpoint:
        created.checkpoint,
    });
  }

  public async resume(
    expectedContract:
      CanonicalFrozenPlanContractIdentity | null,
  ): Promise<
    DurableCanonicalRuntimeOrchestratorResult
  > {
    const captured =
      snapshotCanonicalRuntimeRecoveryPin(
        expectedContract,
      );

    if (
      !captured.ok ||
      (
        captured.pin !== null &&
        captured.pin.missionId !==
          this.session.missionId
      )
    ) {
      return this.refused(
        "session-refused",
        "expected-contract-pin-invalid",
      );
    }

    const resumed =
      await this.session.resume(
        captured.pin,
      );

    if (!resumed.ok) {
      return this.refused(
        "session-refused",
        resumed.reasonCode,
      );
    }

    this.currentPin =
      captured.pin;

    return Object.freeze({
      ok: true as const,
      status:
        "RESUMED" as const,
      reasonCode:
        "ok" as const,
      checkpoint:
        resumed.checkpoint,
    });
  }

  public async commitFactoryCompletion(
    candidate: unknown,
  ): Promise<
    DurableCanonicalRuntimeOrchestratorResult
  > {
    const current =
      this.session.getSnapshot();

    if (!current) {
      return this.refused(
        "session-not-active",
      );
    }

    const decision =
      inspectCanonicalRuntimeStep(
        current.cursor,
      );

    if (
      decision.kind ===
        "FACTORY_UNAVAILABLE"
    ) {
      return this.refused(
        "factory-unavailable",
        decision.reasonCode,
        current,
      );
    }

    if (
      decision.kind ===
        "FAIL_CLOSED"
    ) {
      return this.refused(
        "step-fail-closed",
        decision.reasonCode,
        current,
      );
    }

    if (
      decision.kind !==
        "RUN_FACTORY"
    ) {
      return this.refused(
        "node-not-factory",
        decision.kind,
        current,
      );
    }

    const completion =
      readFactoryCompletion(
        candidate,
      );

    if (!completion) {
      return this.refused(
        "factory-completion-invalid",
        undefined,
        current,
      );
    }

    if (
      completion.missionId !==
        current.missionId ||
      completion.factoryId !==
        decision.factoryId ||
      completion.checkpointVersion !==
        current.checkpointVersion ||
      completion.cursorStepVersion !==
        current.cursor.stepVersion
    ) {
      return this.refused(
        "factory-completion-mismatch",
        undefined,
        current,
      );
    }

    let rawAuthority:
      CanonicalFactoryCompletionAuthorityResult;

    try {
      rawAuthority =
        await this.verifyFactory(
          completion,
        );
    } catch {
      return this.refused(
        "factory-completion-authority-failed",
        undefined,
        current,
      );
    }

    if (
      rawAuthority.ok === false
    ) {
      return this.refused(
        "factory-completion-authority-refused",
        undefined,
        current,
      );
    }

    const verified =
      readFactoryCompletion(
        rawAuthority.completion,
      );

    if (
      rawAuthority.status !==
        "VERIFIED" ||
      rawAuthority.reasonCode !==
        "ok" ||
      !verified ||
      !isDeepStrictEqual(
        verified,
        completion,
      )
    ) {
      return this.refused(
        "factory-completion-authority-invalid",
        undefined,
        current,
      );
    }

    const advanced =
      advanceCanonicalRuntimeCursor(
        current.cursor,
        {
          expectedStepVersion:
            current.cursor.stepVersion,
          completion:
            {
              kind:
                "FACTORY_COMPLETED",
              factoryId:
                decision.factoryId,
            },
        },
      );

    if (!advanced.ok) {
      return this.refused(
        "stepper-refused",
        advanced.reasonCode,
        current,
      );
    }

    const next =
      freezeCheckpoint({
        ...current,
        checkpointVersion:
          current.checkpointVersion + 1,
        cursor:
          advanced.cursor,
        savedAt:
          this.nextSavedAt(
            current.savedAt,
          ),
      });

    return this.persist(
      next,
      this.currentPin,
      "FACTORY_ADVANCED",
    );
  }

  public async evaluateGate(
    input:
      CanonicalGateEvaluationInput,
  ): Promise<
    DurableCanonicalRuntimeOrchestratorResult
  > {
    const current =
      this.session.getSnapshot();

    if (!current) {
      return this.refused(
        "session-not-active",
      );
    }

    const decision =
      inspectCanonicalRuntimeStep(
        current.cursor,
      );

    if (
      decision.kind ===
        "FAIL_CLOSED"
    ) {
      return this.refused(
        "step-fail-closed",
        decision.reasonCode,
        current,
      );
    }

    if (
      decision.kind !==
        "EVALUATE_NAMLA_LOOP"
    ) {
      return this.refused(
        "node-not-gate",
        decision.kind,
        current,
      );
    }

    const restored =
      restoreCanonicalRuntimeRecoveryCheckpoint(
        current,
        this.currentPin,
      );

    if (!restored.ok) {
      return this.refused(
        "session-refused",
        restored.reasonCode,
        current,
      );
    }

    const stateIndex =
      current.gateStates
        .findIndex(
          (state) =>
            state.stageId ===
            decision.gateInstanceId,
        );

    const state =
      current.gateStates[
        stateIndex
      ];

    if (
      stateIndex < 0 ||
      !state ||
      input.policy.stageId !==
        decision.gateInstanceId ||
      input.policy.maxRetriesPerStage !==
        state.maxLivelockThreshold ||
      input.artifactIdentity.missionId !==
        current.missionId
    ) {
      return this.refused(
        "gate-input-invalid",
        undefined,
        current,
      );
    }

    const crossing =
      current.cursor.nodeId ===
        "LOOP_AFTER_PLAN_TEST";

    if (
      !crossing &&
      input.frozenContractBoundary !==
        undefined
    ) {
      return this.refused(
        "contract-boundary-unexpected",
        undefined,
        current,
      );
    }

    const gateInput =
      current.cursor.contractPhase ===
        "PRE_FREEZE"
        ? {
            missionId:
              current.missionId,
            stageId:
              decision.gateInstanceId,
            artifactIdentity:
              input.artifactIdentity,
            policyVersions:
              Object.freeze([
                ...input.policyVersions,
              ]),
            environmentIdentity:
              input.environmentIdentity,
            requiredAttestations:
              Object.freeze([
                ...input.requiredAttestations,
              ]),
            requiredAssessments:
              Object.freeze([
                ...input.requiredAssessments,
              ]),
            evidenceRefs:
              Object.freeze([
                ...input.evidenceRefs,
              ]),
            budget:
              current.loopBudget,
            phase:
              "PRE_CONTRACT" as const,
          }
        : {
            missionId:
              current.missionId,
            stageId:
              decision.gateInstanceId,
            artifactIdentity:
              input.artifactIdentity,
            policyVersions:
              Object.freeze([
                ...input.policyVersions,
              ]),
            environmentIdentity:
              input.environmentIdentity,
            requiredAttestations:
              Object.freeze([
                ...input.requiredAttestations,
              ]),
            requiredAssessments:
              Object.freeze([
                ...input.requiredAssessments,
              ]),
            evidenceRefs:
              Object.freeze([
                ...input.evidenceRefs,
              ]),
            budget:
              current.loopBudget,
            phase:
              "CONTRACT_BOUND" as const,
            contractVersion:
              restored.contract!.version,
          };

    const gateResult =
      this.gate.evaluateGateWithState(
        gateInput,
        input.evidencePool,
        input.policy,
        state,
      );

    if (!gateResult.ok) {
      return this.refused(
        "gate-evaluation-failed",
        gateResult.reasonCode,
        current,
      );
    }

    const nextStates =
      Object.freeze(
        current.gateStates.map(
          (candidateState, index) =>
            index === stateIndex
              ? gateResult.nextState
              : candidateState,
        ),
      );

    if (
      gateResult.verdict.status !==
        "PASS" ||
      gateResult.verdict.nextAction !==
        "NEXT"
    ) {
      if (
        gateResult.nextState
          .livelockCounter ===
          state.livelockCounter
      ) {
        return Object.freeze({
          ok: true as const,
          status:
            "GATE_BLOCKED" as const,
          reasonCode:
            "ok" as const,
          checkpoint:
            current,
          verdict:
            gateResult.verdict,
          persisted:
            false,
        });
      }

      if (
        gateResult.nextState
          .livelockCounter !==
        state.livelockCounter + 1
      ) {
        return this.refused(
          "gate-state-transition-invalid",
          undefined,
          current,
          gateResult.verdict,
        );
      }

      const next =
        freezeCheckpoint({
          ...current,
          checkpointVersion:
            current.checkpointVersion + 1,
          savedAt:
            this.nextSavedAt(
              current.savedAt,
            ),
          gateStates:
            nextStates,
          failureCount:
            current.failureCount + 1,
        });

      return this.persist(
        next,
        this.currentPin,
        "GATE_RECORDED",
        gateResult.verdict,
        true,
      );
    }

    let nextPin =
      this.currentPin;

    let nextBinding =
      current.frozenContract;

    let boundaryAttestation:
      | {
          readonly boundaryId:
            "FROZEN_PLAN_CONTRACT";
          readonly established:
            true;
        }
      | undefined;

    if (crossing) {
      const boundary =
        input.frozenContractBoundary;

      if (!boundary) {
        return this.refused(
          "contract-boundary-required",
          undefined,
          current,
          gateResult.verdict,
        );
      }

      const pinSnapshot =
        snapshotCanonicalRuntimeRecoveryPin(
          boundary.pin,
        );

      if (
        !pinSnapshot.ok ||
        pinSnapshot.pin === null ||
        pinSnapshot.pin.missionId !==
          current.missionId
      ) {
        return this.refused(
          "contract-boundary-invalid",
          undefined,
          current,
          gateResult.verdict,
        );
      }

      const checkedContract =
        restoreCanonicalFrozenPlanContract(
          boundary.binding,
          pinSnapshot.pin,
        );

      if (
        !checkedContract.ok ||
        checkedContract.binding.missionId !==
          current.missionId
      ) {
        return this.refused(
          "contract-boundary-invalid",
          checkedContract.ok
            ? undefined
            : checkedContract.reasonCode,
          current,
          gateResult.verdict,
        );
      }

      nextPin =
        pinSnapshot.pin;

      nextBinding =
        checkedContract.binding;

      boundaryAttestation =
        Object.freeze({
          boundaryId:
            "FROZEN_PLAN_CONTRACT" as const,
          established:
            true as const,
        });
    }

    const advanced =
      advanceCanonicalRuntimeCursor(
        current.cursor,
        {
          expectedStepVersion:
            current.cursor.stepVersion,
          completion:
            {
              kind:
                "GATE_VERDICT",
              gateInstanceId:
                decision.gateInstanceId,
              verdict:
                gateResult.verdict,
              ...(boundaryAttestation
                ? {
                    authorityBoundary:
                      boundaryAttestation,
                  }
                : {}),
            },
        },
      );

    if (!advanced.ok) {
      return this.refused(
        "stepper-refused",
        advanced.reasonCode,
        current,
        gateResult.verdict,
      );
    }

    const next =
      freezeCheckpoint({
        ...current,
        checkpointVersion:
          current.checkpointVersion + 1,
        cursor:
          advanced.cursor,
        savedAt:
          this.nextSavedAt(
            current.savedAt,
          ),
        gateStates:
          nextStates,
        frozenContract:
          nextBinding,
      });

    const persisted =
      await this.persist(
        next,
        nextPin,
        "GATE_ADVANCED",
        gateResult.verdict,
        true,
      );

    if (persisted.ok) {
      this.currentPin =
        nextPin;
    }

    return persisted;
  }

  private now(): number | null {
    try {
      const value =
        this.clock();

      return positive(value)
        ? value
        : null;
    } catch {
      return null;
    }
  }

  private nextSavedAt(
    current: number,
  ): number {
    const now =
      this.now();

    if (now === null) {
      return current;
    }

    return Math.max(
      current,
      now,
    );
  }

  private async persist(
    next:
      CanonicalRuntimeRecoveryCheckpoint,
    nextPin:
      CanonicalFrozenPlanContractIdentity | null,
    status:
      | "FACTORY_ADVANCED"
      | "GATE_ADVANCED"
      | "GATE_RECORDED",
    verdict?: GateVerdict,
    persisted = true,
  ): Promise<
    DurableCanonicalRuntimeOrchestratorResult
  > {
    const result =
      await this.session.advance(
        next,
        nextPin,
      );

    if (!result.ok) {
      return this.refused(
        "session-refused",
        result.reasonCode,
        this.session.getSnapshot() ??
          undefined,
        verdict,
      );
    }

    return Object.freeze({
      ok: true as const,
      status,
      reasonCode:
        "ok" as const,
      checkpoint:
        result.checkpoint,
      ...(verdict
        ? {
            verdict,
          }
        : {}),
      persisted,
    });
  }

  private refused(
    reasonCode:
      DurableCanonicalRuntimeOrchestratorReason,
    detailReasonCode?: string,
    checkpoint?:
      CanonicalRuntimeRecoveryCheckpoint,
    verdict?: GateVerdict,
  ): DurableCanonicalRuntimeOrchestratorResult {
    return Object.freeze({
      ok: false as const,
      status:
        "REFUSED" as const,
      reasonCode,
      ...(detailReasonCode
        ? {
            detailReasonCode,
          }
        : {}),
      ...(checkpoint
        ? {
            checkpoint,
          }
        : {}),
      ...(verdict
        ? {
            verdict,
          }
        : {}),
    });
  }
}
