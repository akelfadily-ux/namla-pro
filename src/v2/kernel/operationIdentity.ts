import { createHash } from "node:crypto";

export const NAMLA_OPERATION_IDENTITY_VERSION = 1 as const;
export const NAMLA_OPERATION_IDENTITY_DOMAIN =
  "NAMLA_V2_OPERATION_IDENTITY" as const;

const MAX_CANONICAL_DEPTH = 64;
const MAX_CANONICAL_NODES = 100_000;
const MAX_IDENTITY_PART_LENGTH = 512;

type CanonicalNode =
  | readonly ["null"]
  | readonly ["string", string]
  | readonly ["boolean", boolean]
  | readonly ["number", string]
  | readonly ["bigint", string]
  | readonly ["date", string]
  | readonly ["bytes", string]
  | readonly ["array", readonly CanonicalNode[]]
  | readonly ["object", readonly (readonly [string, CanonicalNode])[]];

interface CanonicalizationState {
  readonly active: WeakSet<object>;
  nodes: number;
}

export interface NamlaOperationIdentityInput {
  readonly missionId: string;
  readonly authorityScope: string;
  readonly operationType: string;
  readonly value: unknown;
}

function consumeNode(state: CanonicalizationState, depth: number): void {
  if (depth > MAX_CANONICAL_DEPTH) {
    throw new Error(
      `Operation input exceeds maximum canonical depth ${MAX_CANONICAL_DEPTH}`,
    );
  }

  state.nodes += 1;

  if (state.nodes > MAX_CANONICAL_NODES) {
    throw new Error(
      `Operation input exceeds maximum canonical node count ${MAX_CANONICAL_NODES}`,
    );
  }
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("Non-finite numbers are not valid NAMLA operation inputs");
  }

  return Object.is(value, -0) ? "-0" : String(value);
}

function canonicalizeNode(
  value: unknown,
  state: CanonicalizationState,
  depth: number,
): CanonicalNode {
  consumeNode(state, depth);

  if (value === null) return ["null"];

  switch (typeof value) {
    case "string":
      return ["string", value];
    case "boolean":
      return ["boolean", value];
    case "number":
      return ["number", canonicalNumber(value)];
    case "bigint":
      return ["bigint", value.toString(10)];
    case "undefined":
    case "function":
    case "symbol":
      throw new Error(`Unsupported NAMLA operation input type: ${typeof value}`);
    case "object":
      break;
    default:
      throw new Error("Unsupported NAMLA operation input");
  }

  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new Error("Invalid Date is not a valid NAMLA operation input");
    }
    return ["date", value.toISOString()];
  }

  if (value instanceof Uint8Array) {
    return ["bytes", Buffer.from(value).toString("base64")];
  }

  if (state.active.has(value)) {
    throw new Error("Cyclic NAMLA operation input is not supported");
  }

  if (Array.isArray(value)) {
    state.active.add(value);
    try {
      return [
        "array",
        value.map((item) => canonicalizeNode(item, state, depth + 1)),
      ];
    } finally {
      state.active.delete(value);
    }
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(
      "Only plain objects, arrays, Date, and Uint8Array are valid NAMLA operation objects",
    );
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(
      "Symbol-keyed properties are not valid NAMLA operation inputs",
    );
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries: Array<readonly [string, CanonicalNode]> = [];

  state.active.add(value);
  try {
    for (const key of Object.keys(descriptors).sort()) {
      const descriptor = descriptors[key];

      if (!descriptor.enumerable) {
        throw new Error(
          `Non-enumerable property '${key}' is not a valid NAMLA operation input`,
        );
      }

      if (
        typeof descriptor.get === "function" ||
        typeof descriptor.set === "function"
      ) {
        throw new Error(
          `Accessor property '${key}' is not a valid NAMLA operation input`,
        );
      }

      entries.push([
        key,
        canonicalizeNode(descriptor.value, state, depth + 1),
      ]);
    }
  } finally {
    state.active.delete(value);
  }

  return ["object", entries];
}

export function canonicalizeOperationValue(value: unknown): string {
  return JSON.stringify(
    canonicalizeNode(
      value,
      { active: new WeakSet<object>(), nodes: 0 },
      0,
    ),
  );
}

function assertIdentityPart(name: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  if (value.length > MAX_IDENTITY_PART_LENGTH) {
    throw new Error(
      `${name} exceeds maximum length ${MAX_IDENTITY_PART_LENGTH}`,
    );
  }

  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${name} contains forbidden control characters`);
  }
}

export function fingerprintOperationIdentity(
  input: NamlaOperationIdentityInput,
): string {
  assertIdentityPart("missionId", input.missionId);
  assertIdentityPart("authorityScope", input.authorityScope);
  assertIdentityPart("operationType", input.operationType);

  const canonicalValue = canonicalizeOperationValue(input.value);

  const envelope = JSON.stringify([
    NAMLA_OPERATION_IDENTITY_DOMAIN,
    NAMLA_OPERATION_IDENTITY_VERSION,
    input.missionId,
    input.authorityScope,
    input.operationType,
    canonicalValue,
  ]);

  return createHash("sha256")
    .update(envelope, "utf8")
    .digest("hex");
}