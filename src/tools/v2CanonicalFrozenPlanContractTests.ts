import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ProtocolEngine } from "../v2/protocol/protocolEngine";
import type { DraftPlan, PlanContract } from "../v2/types/contracts";
import type { PreFreezeStageContext } from "../v2/types/stageContext";
import {
  captureCanonicalFrozenPlanContract as capture,
  restoreCanonicalFrozenPlanContract as restore,
  V2_CANONICAL_FROZEN_PLAN_CONTRACT_SCHEMA,
  type CanonicalFrozenPlanContractBinding,
  type CanonicalFrozenPlanContractIdentity,
  type CanonicalFrozenPlanContractResult,
} from "../v2/protocol/canonicalFrozenPlanContract";

// Genuine ProtocolEngine output, but test input is not proof of PLAN_TEST approval.
const MISSION = "frozen-contract-test";
function fixture(projectClass?: PreFreezeStageContext["projectClass"]) {
  const draft: DraftPlan = {
    draftId: "draft-1", objective: "Build a deterministic library",
    tasks: [{ description: "Implement the library", id: "task-1", name: "Library",
      targetFiles: ["src/index.ts"], dependencies: [], capabilityRequirements: ["WRITE"] }],
    acceptanceCriteria: [{ id: "ac-1", description: "Tests pass", verificationMethod: "TEST",
      required: true, requiredRequirementId: "test-verif-suite" }],
    riskClassification: "LOW",
    estimatedBudgets: { maxVirtualTicks: 10, maxProviderCalls: 2, maxFixAttempts: 1 },
  };
  const context: PreFreezeStageContext = {
    missionId: MISSION, authoritativeInputs: [draft.objective], policyVersions: ["policy-v1"],
    budgets: { virtualTicks: 10, providerCalls: 2, maxFixAttempts: 1 },
    evidenceRefs: [], missionStateRef: "PLANNING", contractPhase: "PRE_FREEZE",
    ...(projectClass ? { projectClass } : {}),
  };
  const result = new ProtocolEngine().freezePlanContract(draft, context);
  assert.equal(result.success, true);
  assert.ok(result.frozenContract);
  return { contract: result.frozenContract, draft };
}
function success(result: CanonicalFrozenPlanContractResult) {
  assert.ok(result.ok, result.reasonCode);
  return result;
}
function failure(result: CanonicalFrozenPlanContractResult, reasonCode: string) {
  assert.deepEqual(result, { ok: false, reasonCode });
}
function identity(binding: CanonicalFrozenPlanContractBinding): CanonicalFrozenPlanContractIdentity {
  return { missionId: binding.missionId, contractId: binding.contractId,
    contractVersion: binding.contractVersion, contractHash: binding.contractHash };
}
function sha(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function captured() {
  return success(capture(MISSION, fixture().contract));
}
// Test-only: simulate corrupted storage or another self-consistent payload.
// Supplying a matching self-computed hash does NOT prove trusted provenance.
function rehashed(contract: PlanContract): PlanContract {
  const { contractHash: _discarded, ...raw } = contract;
  return { ...raw, contractHash: sha(JSON.stringify(raw)) };
}

test("10E6 frozen binding preserves the ProtocolEngine hash and exact raw JSON preimage", () => {
  const original = fixture().contract;
  const result = success(capture(MISSION, original));
  const { contractHash, ...raw } = original;
  assert.equal(result.binding.schemaVersion, V2_CANONICAL_FROZEN_PLAN_CONTRACT_SCHEMA);
  assert.equal(result.binding.rawContractJson, JSON.stringify(raw));
  assert.equal(result.binding.contractHash, contractHash);
  assert.equal(sha(result.binding.rawContractJson), contractHash);
  assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(result.binding.rawContractJson), "contractHash"), false);
});

test("10E6 frozen binding accepts all project-class variants of the existing producer", () => {
  const classes = ["TYPESCRIPT_LIBRARY", "CLI_APPLICATION", "REST_API", "WEB_APPLICATION",
    "DATABASE_SERVICE", "FULLSTACK_APPLICATION", "DOCKERIZED_SERVICE"] as const;
  for (const projectClass of classes) {
    const result = success(capture(MISSION, fixture(projectClass).contract));
    assert.ok(result.contract.requiredTests.length >= 3);
  }
});

test("10E6 frozen binding supports producer optional undefined fields without losing defined values", () => {
  const original = fixture().contract;
  assert.ok(original.requiredTests.some((item) => Object.prototype.hasOwnProperty.call(item, "provesCriterionIds") &&
    item.provesCriterionIds === undefined));
  const result = success(capture(MISSION, original));
  assert.deepEqual(result.contract, JSON.parse(JSON.stringify(original)));
  assert.deepEqual(result.contract.requiredTests.find((item) => item.id === "test-verif-suite")
    ?.provesCriterionIds, ["ac-1"]);
});

test("10E6 frozen binding rejects invalid mission IDs and cross-mission capture", () => {
  const original = fixture().contract;
  for (const value of ["", " ", "x\n", "x".repeat(513), undefined, 1]) {
    failure(capture(value as string, original), "mission-id-invalid");
  }
  failure(capture("other-mission", original), "contract-mission-mismatch");
});

test("10E6 frozen binding rejects an invalid or mismatching existing hash without repairing it", () => {
  const original = fixture().contract;
  failure(capture(MISSION, { ...original, contractHash: "h1" }), "contract-shape-invalid");
  const forged = { ...original, contractHash: "0".repeat(64) };
  failure(capture(MISSION, forged), "contract-hash-mismatch");
  assert.equal(forged.contractHash, "0".repeat(64));
});

test("10E6 frozen binding detects nested mutation despite a shallow-frozen contract", () => {
  const { contract, draft } = fixture();
  assert.equal(Object.isFrozen(contract), true);
  Reflect.set(draft.tasks[0], "description", "Changed after freeze");
  failure(capture(MISSION, contract), "contract-hash-mismatch");
});

test("10E6 frozen binding materializes a deeply frozen detached runtime contract", () => {
  const { contract: original, draft } = fixture();
  const result = success(capture(MISSION, original));
  assert.notEqual(result.contract.tasks, draft.tasks);
  for (const value of [result, result.binding, result.contract, result.contract.tasks,
    result.contract.tasks[0], result.contract.tasks[0].targetFiles,
    result.contract.acceptanceCriteria, result.contract.requiredTests,
    result.contract.requiredTests[0]]) assert.equal(Object.isFrozen(value), true);
  assert.equal(Reflect.set(result.contract.tasks[0], "name", "changed"), false);
  assert.equal(Object.isFrozen(draft.tasks), false);
  assert.equal(Object.isFrozen(draft.tasks[0]), false);
  Reflect.set(draft.tasks[0], "name", "Caller mutation");
  assert.equal(result.contract.tasks[0].name, "Library");
});

test("10E6 frozen binding restores the same hash version and frozenAt after JSON round-trip", () => {
  const initial = captured();
  const pin = identity(initial.binding);
  const saved = JSON.parse(JSON.stringify(initial.binding));
  const first = success(restore(saved, pin));
  const second = success(restore(saved, pin));
  assert.deepEqual(first, second);
  assert.equal(first.contract.frozenAt, initial.contract.frozenAt);
  assert.equal(first.contract.version, initial.contract.version);
  assert.equal(first.contract.contractHash, initial.contract.contractHash);
  assert.notEqual(first.contract, second.contract);
});

test("10E6 frozen binding tolerates outer envelope key reordering without reserializing its raw body", () => {
  const initial = captured();
  const reordered = Object.fromEntries(Object.entries(initial.binding).reverse());
  const restored = success(restore(JSON.parse(JSON.stringify(reordered)), identity(initial.binding)));
  assert.equal(restored.binding.rawContractJson, initial.binding.rawContractJson);
  assert.deepEqual(restored.contract, initial.contract);
});

test("10E6 frozen binding refuses a changed raw body under the independently pinned hash", () => {
  const initial = captured();
  failure(restore({ ...initial.binding,
    rawContractJson: initial.binding.rawContractJson.replace("deterministic", "altered") },
    identity(initial.binding)), "contract-hash-mismatch");
});

test("10E6 frozen binding refuses a replacement body and hash when the durable pin is unchanged", () => {
  const initial = captured();
  const replacement = success(capture(MISSION,
    rehashed({ ...initial.contract, objective: "Another plan" })));
  failure(restore(replacement.binding, identity(initial.binding)), "binding-identity-mismatch");
});

test("10E6 frozen binding requires a complete explicit expected identity on restore", () => {
  const initial = captured();
  for (const value of [undefined, null, {}, { missionId: MISSION }]) {
    failure(restore(initial.binding, value as CanonicalFrozenPlanContractIdentity),
      "expected-identity-invalid");
  }
  for (const key of Object.keys(identity(initial.binding))) {
    const pin = Object.fromEntries(Object.entries(identity(initial.binding)).filter(([k]) => k !== key));
    failure(restore(initial.binding, pin as unknown as CanonicalFrozenPlanContractIdentity),
      "expected-identity-invalid");
  }
});

test("10E6 frozen binding refuses missing extra or unknown envelope fields", () => {
  const initial = captured();
  for (const key of Object.keys(initial.binding)) {
    const missing = Object.fromEntries(Object.entries(initial.binding).filter(([k]) => k !== key));
    failure(restore(missing, identity(initial.binding)), "binding-invalid");
  }
  for (const value of [undefined, null, {}, [], { ...initial.binding, extra: 1 },
    { ...initial.binding, schemaVersion: "unknown" }]) {
    failure(restore(value, identity(initial.binding)), "binding-invalid");
  }
});

test("10E6 frozen binding compares every independently pinned identity dimension", () => {
  const initial = captured();
  for (const key of ["missionId", "contractId", "contractVersion"] as const) {
    failure(restore(initial.binding, { ...identity(initial.binding), [key]: "different" }),
      "binding-identity-mismatch");
  }
  failure(restore(initial.binding, { ...identity(initial.binding), contractHash: "f".repeat(64) }),
    "binding-identity-mismatch");
});

test("10E6 frozen binding validates raw identity instead of trusting envelope labels", () => {
  const initial = captured();
  const mislabeled = { ...initial.binding, contractVersion: "v9" };
  failure(restore(mislabeled, identity(mislabeled)), "binding-identity-mismatch");
  const crossMission = { ...initial.binding, missionId: "another" };
  failure(restore(crossMission, identity(crossMission)), "contract-mission-mismatch");
});

test("10E6 frozen binding rejects malformed JSON even with a self-consistent hash", () => {
  const initial = captured();
  const binding = { ...initial.binding, rawContractJson: "{invalid", contractHash: sha("{invalid") };
  failure(restore(binding, identity(binding)), "contract-json-invalid");
});

test("10E6 frozen binding rejects duplicate JSON keys and non-lossless encodings", () => {
  const initial = captured();
  const json = initial.binding.rawContractJson;
  const duplicate = json.replace('{"contractId":', '{"contractId":"duplicate","contractId":');
  for (const rawContractJson of [duplicate, " " + json, json.replace('"frozenAt":', '\n"frozenAt":')]) {
    const binding = { ...initial.binding, rawContractJson, contractHash: sha(rawContractJson) };
    failure(restore(binding, identity(binding)), "contract-json-not-lossless");
  }
});

test("10E6 frozen binding validates every top-level contract field rather than trusting its hash", () => {
  const original = fixture().contract;
  for (const key of Object.keys(original).filter((key) => key !== "contractHash")) {
    const missing = Object.fromEntries(Object.entries(original).filter(([k]) => k !== key));
    failure(capture(MISSION, missing as unknown as PlanContract), "contract-shape-invalid");
  }
  failure(capture(MISSION, { ...original, unexpected: 1 } as PlanContract), "contract-shape-invalid");
});

test("10E6 frozen binding rejects malformed nested records even with matching recomputed hashes", () => {
  const original = fixture().contract;
  const cases: [string, unknown][] = [
    ["acceptanceCriteria", [{ ...original.acceptanceCriteria[0], required: "true" }]],
    ["tasks", [{ ...original.tasks[0], dependencies: [1] }]],
    ["constraints", [{ ...original.constraints[0], strict: "true" }]],
    ["dependencies", [{ taskId: 1, dependsOnTaskId: "task-1" }]],
    ["allowedCapabilities", [{ capability: "WRITE", target: "*", readOnly: "false" }]],
    ["requiredTests", [{ ...original.requiredTests[0], expectedExitCode: "0" }]],
    ["securityRequirements", [{ ...original.securityRequirements[0], failClosed: "true" }]],
    ["expectedArtifacts", [{ ...original.expectedArtifacts[0], optional: null }]],
    ["evidenceRequirements", [{ type: "BUILD_RECEIPT", requiredProducer: 1 }]],
    ["completionConditions", [{ id: "done", predicate: false }]],
    ["frozenAt", 0], ["riskClassification", "UNKNOWN"],
  ];
  for (const [key, value] of cases) {
    failure(capture(MISSION, rehashed({ ...original, [key]: value })), "contract-shape-invalid");
  }
});

test("10E6 frozen binding retains nonempty plans and unique task IDs", () => {
  const original = fixture().contract;
  for (const changes of [{ tasks: [] }, { acceptanceCriteria: [] },
    { tasks: [original.tasks[0], original.tasks[0]] }]) {
    failure(capture(MISSION, rehashed({ ...original, ...changes })), "contract-shape-invalid");
  }
});

test("10E6 frozen binding rejects accessors without invoking getters at either nesting level", () => {
  let reads = 0;
  for (const nested of [false, true]) {
    const contract = structuredClone(fixture().contract);
    Object.defineProperty(nested ? contract.tasks[0] : contract, nested ? "name" : "objective", {
      enumerable: true, get() { reads += 1; return "must-not-run"; },
    });
    failure(capture(MISSION, contract), "contract-data-invalid");
  }
  assert.equal(reads, 0);
});

test("10E6 frozen binding rejects executable serialization hooks and exotic prototypes", () => {
  let calls = 0;
  const original = fixture().contract;
  const toJSON = { ...original, toJSON() { calls += 1; return original; } };
  failure(capture(MISSION, toJSON), "contract-data-invalid");
  failure(capture(MISSION, Object.assign(Object.create({ inherited: true }), original)),
    "contract-data-invalid");
  assert.equal(calls, 0);
});

test("10E6 frozen binding rejects hidden symbol and unknown undefined properties", () => {
  const original = fixture().contract;
  failure(capture(MISSION, { ...original, [Symbol("extra")]: 1 }), "contract-data-invalid");
  const hidden = { ...original };
  Object.defineProperty(hidden, "hidden", { value: 1, enumerable: false });
  failure(capture(MISSION, hidden), "contract-data-invalid");
  failure(capture(MISSION, { ...original, unknown: undefined } as PlanContract), "contract-shape-invalid");
});

test("10E6 frozen binding refuses sparse arrays cycles and non-JSON values", () => {
  const original = fixture().contract;
  const cycle: unknown[] = []; cycle.push(cycle);
  const sparse = new Array(1);
  for (const tasks of [cycle, sparse, [undefined], [() => 1]]) {
    failure(capture(MISSION, { ...original, tasks } as unknown as PlanContract), "contract-data-invalid");
  }
  for (const frozenAt of [NaN, Infinity, -0, BigInt(1), new Date()]) {
    failure(capture(MISSION, { ...original, frozenAt } as unknown as PlanContract), "contract-data-invalid");
  }
});

test("10E6 frozen binding refuses oversized payloads without producing a replacement binding", () => {
  failure(capture(MISSION, { ...fixture().contract, objective: "x".repeat(4 * 1024 * 1024 + 1) }),
    "contract-size-limit");
});

test("10E6 frozen binding accepts null-prototype data and refuses reflection exceptions", () => {
  const original = fixture().contract;
  assert.ok(capture(MISSION, Object.assign(Object.create(null), original)).ok);
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  failure(capture(MISSION, revoked.proxy as PlanContract), "contract-validation-failed");
});

test("10E6 frozen binding refuses binding and expected-identity getters without executing them", () => {
  const initial = captured();
  let calls = 0;
  const binding = { ...initial.binding };
  Object.defineProperty(binding, "rawContractJson", { enumerable: true,
    get() { calls += 1; return initial.binding.rawContractJson; } });
  failure(restore(binding, identity(initial.binding)), "binding-invalid");
  const pin = { ...identity(initial.binding) };
  Object.defineProperty(pin, "contractHash", { enumerable: true,
    get() { calls += 1; return initial.binding.contractHash; } });
  failure(restore(initial.binding, pin), "expected-identity-invalid");
  assert.equal(calls, 0);
});

test("10E6 frozen binding restores Unicode data without issuing a new freeze timestamp", () => {
  const original = fixture().contract;
  const contract = rehashed({ ...original, objective: "נמלה — نملة — Dortmund 🐜" });
  const initial = success(capture(MISSION, contract));
  const restored = success(restore(JSON.parse(JSON.stringify(initial.binding)), identity(initial.binding)));
  assert.equal(restored.contract.objective, contract.objective);
  assert.equal(restored.contract.frozenAt, contract.frozenAt);
});
