import { createHash } from "node:crypto";
import type { PlanContract } from "../types/contracts";

export const V2_CANONICAL_FROZEN_PLAN_CONTRACT_SCHEMA =
  "namla-v2-canonical-frozen-plan-contract-v1" as const;

export interface CanonicalFrozenPlanContractIdentity {
  readonly missionId: string;
  readonly contractId: string;
  readonly contractVersion: string;
  readonly contractHash: string;
}

/**
 * Preserve the ProtocolEngine v1 hash preimage as a string, not a JSON object.
 * JSONB may reorder object keys. Hashing a reserialized JSONB object therefore
 * cannot reliably reproduce the producer's JSON.stringify(rawContract) hash.
 */
export interface CanonicalFrozenPlanContractBinding
  extends CanonicalFrozenPlanContractIdentity {
  readonly schemaVersion: typeof V2_CANONICAL_FROZEN_PLAN_CONTRACT_SCHEMA;
  readonly rawContractJson: string;
}

export type CanonicalFrozenPlanContractReason =
  | "mission-id-invalid"
  | "contract-data-invalid"
  | "contract-shape-invalid"
  | "contract-mission-mismatch"
  | "contract-hash-mismatch"
  | "contract-size-limit"
  | "binding-invalid"
  | "expected-identity-invalid"
  | "binding-identity-mismatch"
  | "contract-json-invalid"
  | "contract-json-not-lossless"
  | "contract-validation-failed";

export type CanonicalFrozenPlanContractResult =
  | {
      readonly ok: true;
      readonly reasonCode: "ok";
      readonly binding: CanonicalFrozenPlanContractBinding;
      readonly contract: PlanContract;
    }
  | {
      readonly ok: false;
      readonly reasonCode: CanonicalFrozenPlanContractReason;
    };

// Local decoding limits, not execution budgets or permission to execute.
const MAX_RAW_BYTES = 4 * 1024 * 1024;
const MAX_DATA_NODES = 100_000;
const MAX_DATA_DEPTH = 64;
const HASH = /^[0-9a-f]{64}$/;
const RAW_FIELDS = [
  "contractId", "version", "objective", "acceptanceCriteria", "constraints",
  "tasks", "dependencies", "allowedCapabilities", "requiredTests",
  "securityRequirements", "expectedArtifacts", "evidenceRequirements",
  "riskClassification", "completionConditions", "frozenAt",
] as const;
const IDENTITY_FIELDS = [
  "missionId", "contractId", "contractVersion", "contractHash",
] as const;
const BINDING_FIELDS = ["schemaVersion", ...IDENTITY_FIELDS, "rawContractJson"];

type DataRecord = Record<string, unknown>;
class Refusal extends Error {
  constructor(readonly reasonCode: CanonicalFrozenPlanContractReason) {
    super(reasonCode);
  }
}
function refuse(reason: CanonicalFrozenPlanContractReason): never {
  throw new Refusal(reason);
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function text(value: unknown): value is string {
  return typeof value === "string";
}
function nonempty(value: unknown): value is string {
  return text(value) && value.trim().length > 0;
}
function mission(value: unknown): value is string {
  return nonempty(value) && value.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(value);
}
function record(value: unknown): value is DataRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function fields(
  value: unknown, required: readonly string[], optional: readonly string[] = [],
): value is DataRecord {
  if (!record(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}
function strings(value: unknown): boolean {
  return Array.isArray(value) && value.every(nonempty);
}
function oneOf(value: unknown, choices: readonly string[]): boolean {
  return text(value) && choices.includes(value);
}
function optional(value: unknown, check: (value: unknown) => boolean): boolean {
  return value === undefined || check(value);
}
function collection(value: unknown, check: (value: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(check);
}

/**
 * Detach own enumerable data fields without calling getters or toJSON methods.
 * Undefined object values survive until schema validation: only declared
 * optional properties may then be omitted by the producer-compatible JSON.
 * Undefined array entries, holes, exotic prototypes and non-finite numbers
 * are rejected rather than silently normalized.
 */
function copyData(
  value: unknown, state = { nodes: 0, bytes: 0, active: new WeakSet<object>() }, depth = 0,
): unknown {
  if (++state.nodes > MAX_DATA_NODES || depth > MAX_DATA_DEPTH) {
    return refuse("contract-size-limit");
  }
  if (value === null || value === undefined || typeof value === "boolean") return value;
  if (typeof value === "string") {
    state.bytes += Buffer.byteLength(value, "utf8");
    if (state.bytes > MAX_RAW_BYTES) return refuse("contract-size-limit");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) return refuse("contract-data-invalid");
    return value;
  }
  if (typeof value !== "object") return refuse("contract-data-invalid");
  const proto: unknown = Object.getPrototypeOf(value);
  const array = Array.isArray(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) {
    return refuse("contract-data-invalid");
  }
  if (state.active.has(value)) return refuse("contract-data-invalid");
  state.active.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAX_DATA_NODES) return refuse("contract-size-limit");
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value as unknown;
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
        keys.length !== length + 1) return refuse("contract-data-invalid");
      const detached: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const d = Object.getOwnPropertyDescriptor(value, String(index));
        if (!d || !("value" in d) || !d.enumerable || d.value === undefined) {
          return refuse("contract-data-invalid");
        }
        detached.push(copyData(d.value, state, depth + 1));
      }
      return detached;
    }
    const detached: DataRecord = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string") return refuse("contract-data-invalid");
      state.bytes += Buffer.byteLength(key, "utf8");
      if (state.bytes > MAX_RAW_BYTES) return refuse("contract-size-limit");
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !("value" in d) || !d.enumerable) return refuse("contract-data-invalid");
      detached[key] = copyData(d.value, state, depth + 1);
    }
    return detached;
  } finally {
    state.active.delete(value);
  }
}

/** Validate the declared PlanContract shape, not policy compliance or DAG safety. */
function validRawContract(raw: unknown): raw is DataRecord {
  if (!fields(raw, RAW_FIELDS)) return false;
  if (!nonempty(raw.contractId) || !nonempty(raw.version) || !text(raw.objective) ||
    !positive(raw.frozenAt) || !oneOf(raw.riskClassification, ["LOW", "MEDIUM", "HIGH", "CRITICAL"])) {
    return false;
  }
  if (!collection(raw.acceptanceCriteria, (v) =>
    fields(v, ["id", "description", "verificationMethod", "required"], ["requiredRequirementId"]) &&
    nonempty(v.id) && text(v.description) && typeof v.required === "boolean" &&
    oneOf(v.verificationMethod, ["TEST", "INVARIANT", "INSPECTION", "SECURITY_CHECK"]) &&
    optional(v.requiredRequirementId, nonempty))) return false;
  if (!collection(raw.tasks, (v) =>
    fields(v, ["id", "name", "description", "targetFiles", "dependencies", "capabilityRequirements"]) &&
    nonempty(v.id) && text(v.name) && text(v.description) && strings(v.targetFiles) &&
    strings(v.dependencies) && strings(v.capabilityRequirements))) return false;
  // Preserve the producer's nonempty-plan and unique-task-ID invariants.
  const tasks = raw.tasks as DataRecord[];
  if (tasks.length === 0 || (raw.acceptanceCriteria as unknown[]).length === 0 ||
    new Set(tasks.map((task) => task.id)).size !== tasks.length) return false;
  return collection(raw.constraints, (v) =>
    fields(v, ["id", "type", "description", "strict"]) && nonempty(v.id) &&
    oneOf(v.type, ["RESOURCE", "SECURITY", "ARCHITECTURAL", "ENVIRONMENT"]) &&
    text(v.description) && typeof v.strict === "boolean") &&
    collection(raw.dependencies, (v) =>
      fields(v, ["taskId", "dependsOnTaskId"]) && nonempty(v.taskId) && nonempty(v.dependsOnTaskId)) &&
    collection(raw.allowedCapabilities, (v) =>
      fields(v, ["capability", "target", "readOnly"]) && nonempty(v.capability) &&
      nonempty(v.target) && typeof v.readOnly === "boolean") &&
    collection(raw.requiredTests, (v) =>
      fields(v, ["id", "name", "command", "expectedExitCode"], ["type", "verifier", "provesCriterionIds"]) &&
      nonempty(v.id) && text(v.name) && text(v.command) &&
      typeof v.expectedExitCode === "number" && Number.isSafeInteger(v.expectedExitCode) &&
      optional(v.type, (t) => oneOf(t, ["BUILD", "TYPECHECK", "TEST", "INTEGRATION_TEST", "SMOKE", "DOCKER_BUILD"])) &&
      optional(v.verifier, (t) => oneOf(t, ["BUILD_VERIFIER", "TYPECHECK_VERIFIER", "TEST_SUITE_VERIFIER",
        "SMOKE_VERIFIER", "INTEGRATION_VERIFIER", "DOCKER_BUILD_VERIFIER"])) &&
      optional(v.provesCriterionIds, strings)) &&
    collection(raw.securityRequirements, (v) =>
      fields(v, ["id", "rule", "failClosed"], ["provesCriterionIds"]) && nonempty(v.id) &&
      text(v.rule) && typeof v.failClosed === "boolean" && optional(v.provesCriterionIds, strings)) &&
    collection(raw.expectedArtifacts, (v) =>
      fields(v, ["path", "description", "optional"]) && nonempty(v.path) &&
      text(v.description) && typeof v.optional === "boolean") &&
    collection(raw.evidenceRequirements, (v) =>
      fields(v, ["type", "requiredProducer"]) && nonempty(v.type) && nonempty(v.requiredProducer)) &&
    collection(raw.completionConditions, (v) =>
      fields(v, ["id", "predicate"]) && nonempty(v.id) && text(v.predicate));
}

/** Flat persisted envelopes contain strings only; capture without invoking getters. */
function copyStringEnvelope(value: unknown, keys: readonly string[]): DataRecord | null {
  if (!record(value)) return null;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Reflect.ownKeys(value).length !== keys.length) return null;
  const result: DataRecord = Object.create(null);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !("value" in d) || !d.enumerable || typeof d.value !== "string") return null;
    result[key] = d.value;
  }
  return result;
}

function validIdentity(value: unknown): value is DataRecord {
  return fields(value, IDENTITY_FIELDS) && mission(value.missionId) &&
    nonempty(value.contractId) && nonempty(value.contractVersion) &&
    text(value.contractHash) && HASH.test(value.contractHash);
}
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function failure(error: unknown): CanonicalFrozenPlanContractResult {
  return Object.freeze({ ok: false as const,
    reasonCode: error instanceof Refusal ? error.reasonCode : "contract-validation-failed" });
}
function checkedResult(
  binding: CanonicalFrozenPlanContractBinding,
): CanonicalFrozenPlanContractResult {
  const json = binding.rawContractJson;
  if (Buffer.byteLength(json, "utf8") > MAX_RAW_BYTES) return refuse("contract-size-limit");
  const hash = createHash("sha256").update(json, "utf8").digest("hex");
  if (hash !== binding.contractHash) return refuse("contract-hash-mismatch");
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return refuse("contract-json-invalid"); }
  // Reject duplicate keys, lossy numeric encodings and altered JSON formatting.
  if (JSON.stringify(raw) !== json) return refuse("contract-json-not-lossless");
  raw = copyData(raw);
  if (!validRawContract(raw)) return refuse("contract-shape-invalid");
  if (raw.contractId !== `contract-${binding.missionId}`) return refuse("contract-mission-mismatch");
  if (raw.contractId !== binding.contractId || raw.version !== binding.contractVersion) {
    return refuse("binding-identity-mismatch");
  }
  // Construct from the validated JSON, never from mutable caller-owned objects.
  const contract = JSON.parse(json) as Omit<PlanContract, "contractHash">;
  return Object.freeze({ ok: true as const, reasonCode: "ok" as const,
    binding: Object.freeze({ ...binding }),
    contract: deepFreeze({ ...contract, contractHash: binding.contractHash }) });
}

/**
 * Capture a freshly produced ProtocolEngine v1 contract before JSONB storage.
 * Verify its existing hash; never replace a mismatching hash with a new one.
 * This checks data integrity only. It does NOT establish PLAN_TEST success,
 * trusted provenance, gate passage, a lease/claim or permission to execute.
 */
export function captureCanonicalFrozenPlanContract(
  missionId: string, contract: PlanContract,
): CanonicalFrozenPlanContractResult {
  try {
    if (!mission(missionId)) return refuse("mission-id-invalid");
    const data = copyData(contract);
    if (!fields(data, [...RAW_FIELDS, "contractHash"]) ||
      !text(data.contractHash) || !HASH.test(data.contractHash)) return refuse("contract-shape-invalid");
    const raw: DataRecord = Object.create(null);
    // Same top-level field order as ProtocolEngine.rawContract; nested order is
    // preserved from the producer, not sorted or guessed after a DB round trip.
    for (const field of RAW_FIELDS) raw[field] = data[field];
    if (!validRawContract(raw)) return refuse("contract-shape-invalid");
    if (raw.contractId !== `contract-${missionId}`) return refuse("contract-mission-mismatch");
    return checkedResult({ schemaVersion: V2_CANONICAL_FROZEN_PLAN_CONTRACT_SCHEMA,
      missionId, contractId: raw.contractId as string, contractVersion: raw.version as string,
      contractHash: data.contractHash, rawContractJson: JSON.stringify(raw) });
  } catch (error) { return failure(error); }
}

/**
 * The expected identity must come from the independently pinned durable
 * checkpoint/authority record, NOT be copied from the binding being checked.
 * Missing bindings/identities are refused; restore never re-freezes a draft.
 */
export function restoreCanonicalFrozenPlanContract(
  value: unknown, expected: CanonicalFrozenPlanContractIdentity,
): CanonicalFrozenPlanContractResult {
  try {
    const identity = copyStringEnvelope(expected, IDENTITY_FIELDS);
    if (!validIdentity(identity)) return refuse("expected-identity-invalid");
    const binding = copyStringEnvelope(value, BINDING_FIELDS);
    if (!fields(binding, BINDING_FIELDS) ||
      binding.schemaVersion !== V2_CANONICAL_FROZEN_PLAN_CONTRACT_SCHEMA ||
      !text(binding.rawContractJson)) return refuse("binding-invalid");
    for (const field of IDENTITY_FIELDS) {
      if (binding[field] !== identity[field]) return refuse("binding-identity-mismatch");
    }
    return checkedResult(binding as unknown as CanonicalFrozenPlanContractBinding);
  } catch (error) { return failure(error); }
}
