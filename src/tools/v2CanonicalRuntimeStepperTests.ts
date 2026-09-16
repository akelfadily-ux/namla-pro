import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_PIPELINE_SEQUENCE,
} from "../v2/architecture/canonicalPipelineRegistry";

import {
  V2_CANONICAL_RUNTIME_CURSOR_SCHEMA,
  advanceCanonicalRuntimeCursor,
  createCanonicalRuntimeCursor,
  inspectCanonicalRuntimeStep,
  restoreCanonicalRuntimeCursor,
  serializeCanonicalRuntimeCursor,
  validateCanonicalRuntimeCursor,
  type CanonicalRuntimeCursor,
} from "../v2/runtime/canonicalRuntimeStepper";

import type {
  GateVerdict,
} from "../v2/types/namlaLoopTypes";

const PASS_VERDICT:
  GateVerdict = Object.freeze({
    status: "PASS",
    nextAction: "NEXT",
    reasonCodes:
      Object.freeze([
        "ALL_GATE_CRITERIA_SATISFIED",
      ]),
    staleEvidenceRefs:
      Object.freeze([]),
    missingEvidence:
      Object.freeze([]),
    failedCriteria:
      Object.freeze([]),
  });

const FAIL_VERDICT:
  GateVerdict = Object.freeze({
    status: "FAIL",
    nextAction: "FIX",
    reasonCodes:
      Object.freeze([
        "MISSING_REQUIRED_EVIDENCE",
      ]),
    staleEvidenceRefs:
      Object.freeze([]),
    missingEvidence:
      Object.freeze([
        "ev-missing",
      ]),
    failedCriteria:
      Object.freeze([
        "EVIDENCE_COMPLETENESS",
      ]),
  });

function indexOfNode(
  id: string,
): number {
  const index =
    CANONICAL_PIPELINE_SEQUENCE
      .findIndex(
        (node) =>
          node.id === id,
      );

  assert.notEqual(
    index,
    -1,
  );

  return index;
}

function cursorAt(
  nodeId: string,
): CanonicalRuntimeCursor {
  const nodeIndex =
    indexOfNode(nodeId);

  const node =
    CANONICAL_PIPELINE_SEQUENCE[
      nodeIndex
    ];

  const proIndex =
    indexOfNode("PRO");

  return Object.freeze({
    schemaVersion:
      V2_CANONICAL_RUNTIME_CURSOR_SCHEMA,
    missionId:
      "mission-stepper",
    nodeIndex,
    nodeId:
      node.id,
    nodeKind:
      node.kind,
    stepVersion:
      nodeIndex + 1,
    contractPhase:
      nodeIndex < proIndex
        ? "PRE_FREEZE"
        : "CONTRACT_BOUND",
  });
}

test(
  "10E5 creates a frozen deterministic initial cursor at canonical EER",
  () => {
    const cursor =
      createCanonicalRuntimeCursor(
        "mission-10e5",
      );

    assert.deepEqual(
      cursor,
      {
        schemaVersion:
          V2_CANONICAL_RUNTIME_CURSOR_SCHEMA,
        missionId:
          "mission-10e5",
        nodeIndex:
          0,
        nodeId:
          "EER",
        nodeKind:
          "FACTORY",
        stepVersion:
          1,
        contractPhase:
          "PRE_FREEZE",
      },
    );

    assert.equal(
      Object.isFrozen(cursor),
      true,
    );

    assert.deepEqual(
      validateCanonicalRuntimeCursor(
        cursor,
      ),
      {
        ok: true,
        reasonCode: "ok",
      },
    );
  },
);

test(
  "10E5 refuses empty mission ids at cursor creation",
  () => {
    assert.throws(
      () =>
        createCanonicalRuntimeCursor(
          "   ",
        ),
      /CANONICAL_RUNTIME_MISSION_ID_EMPTY/,
    );
  },
);

test(
  "10E5 initial cursor resolves EER through its typed runtime adapter",
  () => {
    const decision =
      inspectCanonicalRuntimeStep(
        createCanonicalRuntimeCursor(
          "mission-eer",
        ),
      );

    assert.equal(
      decision.kind,
      "RUN_FACTORY",
    );

    if (
      decision.kind !==
      "RUN_FACTORY"
    ) {
      return;
    }

    assert.equal(
      decision.factoryId,
      "EER",
    );

    assert.equal(
      decision.requiredContextPhase,
      "PRE_FREEZE",
    );

    assert.equal(
      decision.adapterBinding.owner,
      "EerEngine",
    );

    assert.deepEqual(
      decision.adapterBinding.methods,
      ["evaluateObjective"],
    );
  },
);

test(
  "10E5 exact factory completion advances one canonical node only",
  () => {
    const cursor =
      createCanonicalRuntimeCursor(
        "mission-advance",
      );

    const result =
      advanceCanonicalRuntimeCursor(
        cursor,
        {
          expectedStepVersion:
            1,
          completion: {
            kind:
              "FACTORY_COMPLETED",
            factoryId:
              "EER",
          },
        },
      );

    assert.equal(
      result.ok,
      true,
    );

    if (!result.ok) {
      return;
    }

    assert.equal(
      result.cursor.nodeId,
      "LOOP_AFTER_EER",
    );

    assert.equal(
      result.cursor.nodeKind,
      "GATE",
    );

    assert.equal(
      result.cursor.nodeIndex,
      1,
    );

    assert.equal(
      result.cursor.stepVersion,
      2,
    );

    assert.equal(
      result.cursor.contractPhase,
      "PRE_FREEZE",
    );
  },
);

test(
  "10E5 gate nodes require explicit NAMLA LOOP evaluation",
  () => {
    const decision =
      inspectCanonicalRuntimeStep(
        cursorAt(
          "LOOP_AFTER_EER",
        ),
      );

    assert.deepEqual(
      decision,
      {
        kind:
          "EVALUATE_NAMLA_LOOP",
        gateInstanceId:
          "LOOP_AFTER_EER",
        afterFactory:
          "EER",
        nodeIndex:
          indexOfNode(
            "LOOP_AFTER_EER",
          ),
        contractPhase:
          "PRE_FREEZE",
      },
    );
  },
);

test(
  "10E5 PASS NEXT gate verdict advances exactly to the next factory",
  () => {
    const cursor =
      cursorAt(
        "LOOP_AFTER_EER",
      );

    const result =
      advanceCanonicalRuntimeCursor(
        cursor,
        {
          expectedStepVersion:
            cursor.stepVersion,
          completion: {
            kind:
              "GATE_VERDICT",
            gateInstanceId:
              "LOOP_AFTER_EER",
            verdict:
              PASS_VERDICT,
          },
        },
      );

    assert.equal(
      result.ok,
      true,
    );

    if (!result.ok) {
      return;
    }

    assert.equal(
      result.cursor.nodeId,
      "PLAN",
    );

    assert.equal(
      result.cursor.nodeKind,
      "FACTORY",
    );
  },
);

test(
  "10E5 non-pass gate verdict never advances the cursor",
  () => {
    const cursor =
      cursorAt(
        "LOOP_AFTER_EER",
      );

    const result =
      advanceCanonicalRuntimeCursor(
        cursor,
        {
          expectedStepVersion:
            cursor.stepVersion,
          completion: {
            kind:
              "GATE_VERDICT",
            gateInstanceId:
              "LOOP_AFTER_EER",
            verdict:
              FAIL_VERDICT,
          },
        },
      );

    assert.equal(
      result.ok,
      false,
    );

    if (result.ok) {
      return;
    }

    assert.equal(
      result.reasonCode,
      "gate-verdict-not-pass",
    );

    assert.equal(
      result.gateNextAction,
      "FIX",
    );

    assert.deepEqual(
      result.cursor,
      cursor,
    );
  },
);

test(
  "10E5 stale step versions fail closed without advancing",
  () => {
    const cursor =
      createCanonicalRuntimeCursor(
        "mission-stale",
      );

    const result =
      advanceCanonicalRuntimeCursor(
        cursor,
        {
          expectedStepVersion:
            99,
          completion: {
            kind:
              "FACTORY_COMPLETED",
            factoryId:
              "EER",
          },
        },
      );

    assert.equal(
      result.ok,
      false,
    );

    if (result.ok) {
      return;
    }

    assert.equal(
      result.reasonCode,
      "stale-step-version",
    );

    assert.deepEqual(
      result.cursor,
      cursor,
    );
  },
);

test(
  "10E5 mismatched factory completion fails closed",
  () => {
    const cursor =
      createCanonicalRuntimeCursor(
        "mission-factory-mismatch",
      );

    const result =
      advanceCanonicalRuntimeCursor(
        cursor,
        {
          expectedStepVersion:
            cursor.stepVersion,
          completion: {
            kind:
              "FACTORY_COMPLETED",
            factoryId:
              "PLAN",
          },
        },
      );

    assert.equal(
      result.ok,
      false,
    );

    if (result.ok) {
      return;
    }

    assert.equal(
      result.reasonCode,
      "factory-id-mismatch",
    );
  },
);

test(
  "10E5 mismatched gate completion fails closed",
  () => {
    const cursor =
      cursorAt(
        "LOOP_AFTER_EER",
      );

    const result =
      advanceCanonicalRuntimeCursor(
        cursor,
        {
          expectedStepVersion:
            cursor.stepVersion,
          completion: {
            kind:
              "GATE_VERDICT",
            gateInstanceId:
              "LOOP_AFTER_PLAN",
            verdict:
              PASS_VERDICT,
          },
        },
      );

    assert.equal(
      result.ok,
      false,
    );

    if (result.ok) {
      return;
    }

    assert.equal(
      result.reasonCode,
      "gate-id-mismatch",
    );
  },
);

test(
  "10E5 PLAN_TEST remains explicit and unavailable instead of being aliased to PROTOCOL",
  () => {
    const cursor =
      cursorAt(
        "PLAN_TEST",
      );

    const decision =
      inspectCanonicalRuntimeStep(
        cursor,
      );

    assert.deepEqual(
      decision,
      {
        kind:
          "FACTORY_UNAVAILABLE",
        factoryId:
          "PLAN_TEST",
        nodeIndex:
          indexOfNode(
            "PLAN_TEST",
          ),
        executionPolicy:
          "FAIL_CLOSED",
        reasonCode:
          "CANONICAL_FACTORY_RUNTIME_UNIMPLEMENTED",
      },
    );

    const advance =
      advanceCanonicalRuntimeCursor(
        cursor,
        {
          expectedStepVersion:
            cursor.stepVersion,
          completion: {
            kind:
              "FACTORY_COMPLETED",
            factoryId:
              "PLAN_TEST",
          },
        },
      );

    assert.equal(
      advance.ok,
      false,
    );

    if (advance.ok) {
      return;
    }

    assert.equal(
      advance.reasonCode,
      "factory-runtime-unimplemented",
    );
  },
);

test(
  "10E5 frozen plan contract attestation is mandatory on the exact PLAN_TEST to PRO crossing",
  () => {
    const cursor =
      cursorAt(
        "LOOP_AFTER_PLAN_TEST",
      );

    const refused =
      advanceCanonicalRuntimeCursor(
        cursor,
        {
          expectedStepVersion:
            cursor.stepVersion,
          completion: {
            kind:
              "GATE_VERDICT",
            gateInstanceId:
              "LOOP_AFTER_PLAN_TEST",
            verdict:
              PASS_VERDICT,
          },
        },
      );

    assert.equal(
      refused.ok,
      false,
    );

    if (!refused.ok) {
      assert.equal(
        refused.reasonCode,
        "frozen-plan-contract-required",
      );
    }

    const accepted =
      advanceCanonicalRuntimeCursor(
        cursor,
        {
          expectedStepVersion:
            cursor.stepVersion,
          completion: {
            kind:
              "GATE_VERDICT",
            gateInstanceId:
              "LOOP_AFTER_PLAN_TEST",
            verdict:
              PASS_VERDICT,
            authorityBoundary: {
              boundaryId:
                "FROZEN_PLAN_CONTRACT",
              established:
                true,
            },
          },
        },
      );

    assert.equal(
      accepted.ok,
      true,
    );

    if (!accepted.ok) {
      return;
    }

    assert.equal(
      accepted.cursor.nodeId,
      "PRO",
    );

    assert.equal(
      accepted.cursor.contractPhase,
      "CONTRACT_BOUND",
    );
  },
);

test(
  "10E5 frozen plan contract attestation is rejected at every unrelated gate",
  () => {
    const cursor =
      cursorAt(
        "LOOP_AFTER_EER",
      );

    const result =
      advanceCanonicalRuntimeCursor(
        cursor,
        {
          expectedStepVersion:
            cursor.stepVersion,
          completion: {
            kind:
              "GATE_VERDICT",
            gateInstanceId:
              "LOOP_AFTER_EER",
            verdict:
              PASS_VERDICT,
            authorityBoundary: {
              boundaryId:
                "FROZEN_PLAN_CONTRACT",
              established:
                true,
            },
          },
        },
      );

    assert.equal(
      result.ok,
      false,
    );

    if (result.ok) {
      return;
    }

    assert.equal(
      result.reasonCode,
      "frozen-plan-contract-boundary-invalid",
    );
  },
);

test(
  "10E5 PRO resolves only in CONTRACT_BOUND phase",
  () => {
    const decision =
      inspectCanonicalRuntimeStep(
        cursorAt(
          "PRO",
        ),
      );

    assert.equal(
      decision.kind,
      "RUN_FACTORY",
    );

    if (
      decision.kind !==
      "RUN_FACTORY"
    ) {
      return;
    }

    assert.equal(
      decision.factoryId,
      "PRO",
    );

    assert.equal(
      decision.requiredContextPhase,
      "CONTRACT_BOUND",
    );

    assert.equal(
      decision.adapterBinding.owner,
      "ProDispatcher",
    );
  },
);

test(
  "10E5 cursor serialization and restore are deterministic and detached",
  () => {
    const original =
      cursorAt(
        "PROMAX",
      );

    const serialized =
      serializeCanonicalRuntimeCursor(
        original,
      );

    const restored =
      restoreCanonicalRuntimeCursor(
        serialized,
      );

    assert.equal(
      restored.ok,
      true,
    );

    if (!restored.ok) {
      return;
    }

    assert.deepEqual(
      restored.cursor,
      original,
    );

    assert.notEqual(
      restored.cursor,
      original,
    );

    assert.equal(
      Object.isFrozen(
        restored.cursor,
      ),
      true,
    );
  },
);

test(
  "10E5 restore rejects malformed JSON and structurally valid cursor tampering",
  () => {
    assert.deepEqual(
      restoreCanonicalRuntimeCursor(
        "{not-json",
      ),
      {
        ok: false,
        reasonCode:
          "cursor-json-invalid",
      },
    );

    const cursor =
      createCanonicalRuntimeCursor(
        "mission-tamper",
      );

    const tampered =
      JSON.stringify({
        ...cursor,
        nodeId:
          "PLAN",
      });

    assert.deepEqual(
      restoreCanonicalRuntimeCursor(
        tampered,
      ),
      {
        ok: false,
        reasonCode:
          "cursor-node-id-mismatch",
      },
    );
  },
);

test(
  "10E5 cursor validator rejects step-version and contract-phase tampering",
  () => {
    const cursor =
      cursorAt(
        "PRO",
      );

    assert.deepEqual(
      validateCanonicalRuntimeCursor({
        ...cursor,
        stepVersion:
          cursor.stepVersion + 1,
      }),
      {
        ok: false,
        reasonCode:
          "cursor-step-version-mismatch",
      },
    );

    assert.deepEqual(
      validateCanonicalRuntimeCursor({
        ...cursor,
        contractPhase:
          "PRE_FREEZE",
      }),
      {
        ok: false,
        reasonCode:
          "cursor-contract-phase-mismatch",
      },
    );
  },
);

test(
  "10E5 terminal DELIVERY is inspectable but never advanceable",
  () => {
    const cursor =
      cursorAt(
        "DELIVERY",
      );

    assert.deepEqual(
      inspectCanonicalRuntimeStep(
        cursor,
      ),
      {
        kind:
          "TERMINAL",
        terminalId:
          "DELIVERY",
        nodeIndex:
          indexOfNode(
            "DELIVERY",
          ),
      },
    );

    const result =
      advanceCanonicalRuntimeCursor(
        cursor,
        {
          expectedStepVersion:
            cursor.stepVersion,
          completion: {
            kind:
              "FACTORY_COMPLETED",
            factoryId:
              "NAMLA_LAB",
          },
        },
      );

    assert.equal(
      result.ok,
      false,
    );

    if (result.ok) {
      return;
    }

    assert.equal(
      result.reasonCode,
      "terminal-boundary",
    );
  },
);