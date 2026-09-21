/**
 * C4 adaptation: Productization input identity, using the canonical V2 codec.
 * Version 2 is NOT compatible with donor v1 hashes. No fallback, persistence,
 * claim, replay, permission, or data migration is performed by this module.
 */
import { types } from "node:util";
import { ConfigurationError } from "../domain/errors";
import {
  canonicalizeOperationValue,
  fingerprintOperationIdentity,
} from "../v2/kernel/operationIdentity";

export const PRODUCTIZATION_OPERATION_FINGERPRINT_VERSION = 2 as const;
export const PRODUCTIZATION_OPERATION_FINGERPRINT_DOMAIN =
  "NAMLA_PRODUCTIZATION_TOOL_INPUT" as const;

export interface OperationFingerprintInput {
  readonly runId: string;
  readonly taskId: string;
  readonly toolName: string;
  readonly value: unknown;
}

const MAX_DEPTH = 48;
const MAX_NODES = 10_000;
const MAX_TEXT_UNITS = 1_048_576;
const MAX_BYTES = 65_536;
const INPUT_FIELDS = ["runId", "taskId", "toolName", "value"] as const;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "length")!.get!;
const byteBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
interface CaptureState { active: WeakSet<object>; nodes: number; textUnits: number; bytes: number; }
function invalid(): never { throw new ConfigurationError("Invalid Productization operation input"); }

function chargeText(text: string, state: CaptureState): void {
  state.textUnits += text.length;
  if (state.textUnits > MAX_TEXT_UNITS) invalid();
}
function data(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) invalid();
  return descriptor.value;
}
function plain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function identity(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(value)) invalid();
  return value;
}

/**
 * Copy accepted data, not a second canonical serializer. Reject accessors,
 * proxies, lossy shapes, cycles and shared byte storage before the V2 codec.
 * This assumes trusted built-in prototypes; it is not an execution sandbox.
 */
function capture(value: unknown, state: CaptureState, depth: number): unknown {
  if (depth > MAX_DEPTH || ++state.nodes > MAX_NODES) invalid();
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") { chargeText(value, state); return value; }
  if (typeof value === "number") { if (!Number.isFinite(value)) invalid(); return value; }
  if (typeof value === "bigint") { chargeText(value.toString(10), state); return value; }
  if (typeof value !== "object" || types.isProxy(value)) invalid();

  const prototype = Object.getPrototypeOf(value);
  if (types.isDate(value)) {
    if (prototype !== Date.prototype || Reflect.ownKeys(value).length !== 0) invalid();
    const time = Date.prototype.getTime.call(value);
    if (!Number.isFinite(time)) invalid();
    return new Date(time);
  }
  if (types.isUint8Array(value)) {
    if (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) invalid();
    if (types.isSharedArrayBuffer(Reflect.apply(byteBuffer, value, []))) invalid();
    // The intrinsic validates even zero-length/detached views, without species.
    Uint8Array.prototype.values.call(value);
    const length: number = Reflect.apply(byteLength, value, []);
    state.bytes += length;
    if (state.bytes > MAX_BYTES || Reflect.ownKeys(value).length !== length) invalid();
    const result = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      const item = data(value, String(index));
      if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 255) invalid();
      result[index] = item;
    }
    return result;
  }

  if (state.active.has(value)) invalid();
  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) invalid();
      const length: unknown = Object.getOwnPropertyDescriptor(value, "length")?.value;
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
          length > MAX_NODES - state.nodes || Reflect.ownKeys(value).length !== length + 1) invalid();
      const result: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        result.push(capture(data(value, String(index)), state, depth + 1));
      }
      return result;
    }
    if (prototype !== Object.prototype && prototype !== null) invalid();
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAX_NODES - state.nodes) invalid();
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string") invalid();
      chargeText(key, state);
      result[key] = capture(data(value, key), state, depth + 1);
    }
    return result;
  } finally {
    state.active.delete(value);
  }
}
function snapshot(value: unknown, active = new WeakSet<object>()): unknown {
  if (types.isProxy(active) || !types.isWeakSet(active) ||
      Object.getPrototypeOf(active) !== WeakSet.prototype || Reflect.ownKeys(active).length !== 0) invalid();
  return capture(value, {active, nodes: 0, textUnits: 0, bytes: 0}, 0);
}

/**
 * Keeps the donor call shape, but returns the canonical tagged JSON value,
 * NOT a donor-v1 object. JSON.stringify(result) equals the V2 codec's string.
 * The optional active set is restored on success/failure, not a result cache.
 */
export function canonicalize(value: unknown, seen = new WeakSet<object>()): unknown {
  try { return JSON.parse(canonicalizeOperationValue(snapshot(value, seen))); }
  catch { return invalid(); }
}

/** Pure input binding only; identical fingerprints do not authorize replay. */
export function fingerprintOperation(input: OperationFingerprintInput): string {
  try {
    if (!plain(input) || Reflect.ownKeys(input).length !== INPUT_FIELDS.length) invalid();
    const fields = Object.create(null) as Record<typeof INPUT_FIELDS[number], unknown>;
    for (const key of INPUT_FIELDS) fields[key] = data(input, key);
    const runId = identity(fields.runId);
    const taskId = identity(fields.taskId);
    const toolName = identity(fields.toolName);
    const value = snapshot(fields.value);
    return fingerprintOperationIdentity({
      missionId: runId,
      // Data namespace only. This does NOT prove an effective authority scope.
      authorityScope: taskId,
      operationType: "productization.tool-input.v2",
      value: [PRODUCTIZATION_OPERATION_FINGERPRINT_DOMAIN,
        PRODUCTIZATION_OPERATION_FINGERPRINT_VERSION, toolName, value],
    });
  } catch { return invalid(); }
}
