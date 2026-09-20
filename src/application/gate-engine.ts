/**
 * C3 adaptation of Productization 44977cf: sequential local check aggregation.
 * Gate callbacks are trusted in-process plugins, NOT sandboxed by this class.
 * Neither a result nor passed() authenticates evidence, grants a permit, checks
 * task ownership, or authorizes a canonical cursor/status transition.
 */
import { ConfigurationError, GateRejectedError } from "../domain/errors";
import type { Artifact, TaskRecord } from "../domain/types";

export interface GateContext {
  task: TaskRecord;
  artifacts: readonly Artifact[];
  workspacePath: string;
}

export interface GateResult {
  gate: string;
  passed: boolean;
  reason: string;
  evidence: readonly string[];
  requiredFixes: readonly string[];
}

export interface Gate {
  readonly name: string;
  evaluate(context: GateContext): Promise<GateResult>;
}

const RESULT_FIELDS = ["gate", "passed", "reason", "evidence", "requiredFixes"] as const;
function failShape(): never { throw new Error("Invalid gate data shape"); }

/** Capture dense ordinary arrays through own data descriptors, not iterators. */
function arrayValues(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) failShape();
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length: unknown = lengthDescriptor?.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) failShape();
  if (Reflect.ownKeys(value).length !== length + 1) failShape();
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) failShape();
    result.push(descriptor.value);
  }
  return result;
}

function stringValues(value: unknown): readonly string[] {
  const items = arrayValues(value);
  if (!items.every((item) => typeof item === "string")) failShape();
  return Object.freeze(items as string[]);
}

function captureResult(value: unknown, expectedName?: string): GateResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) failShape();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) failShape();
  if (Reflect.ownKeys(value).length !== RESULT_FIELDS.length) failShape();
  const record: Record<string, unknown> = Object.create(null);
  for (const key of RESULT_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) failShape();
    record[key] = descriptor.value;
  }
  if (typeof record.gate !== "string" || record.gate.trim().length === 0 ||
      (expectedName !== undefined && record.gate !== expectedName) ||
      typeof record.passed !== "boolean" || typeof record.reason !== "string") failShape();
  return Object.freeze({
    gate: record.gate,
    passed: record.passed,
    reason: record.reason,
    evidence: stringValues(record.evidence),
    requiredFixes: stringValues(record.requiredFixes),
  });
}

/** Allows ordinary class methods, but does not invoke configuration getters. */
function dataMember(value: object, key: string): unknown {
  let current: object | null = value;
  const seen = new Set<object>();
  while (current !== null) {
    if (seen.has(current) || seen.size >= 64) failShape();
    seen.add(current);
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) {
      if (!("value" in descriptor)) failShape();
      return descriptor.value;
    }
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

interface RegisteredGate {
  readonly name: string;
  readonly run: (context: GateContext) => Promise<GateResult>;
}

export class GateEngine {
  private readonly gates: readonly RegisteredGate[];

  constructor(gates: readonly Gate[]) {
    try {
      const names = new Set<string>();
      this.gates = Object.freeze(arrayValues(gates).map((gate): RegisteredGate => {
        if (gate === null || typeof gate !== "object") failShape();
        const name = dataMember(gate, "name");
        const evaluate = dataMember(gate, "evaluate");
        if (typeof name !== "string" || name.trim().length === 0 || names.has(name) ||
            typeof evaluate !== "function") failShape();
        names.add(name);
        return Object.freeze({name, run: (context: GateContext) => Reflect.apply(evaluate, gate, [context])});
      }));
    } catch {
      throw new ConfigurationError("Invalid gate configuration");
    }
  }

  async evaluate(context: GateContext): Promise<GateResult[]> {
    const results: GateResult[] = [];
    for (const gate of this.gates) {
      // Callback errors remain errors; no synthetic successful result is produced.
      const raw: unknown = await gate.run(context);
      let result: GateResult;
      try { result = captureResult(raw, gate.name); }
      catch { throw new GateRejectedError("Invalid gate result"); }
      results.push(result);
      if (result.passed === false) break;
    }
    return results;
  }

  /**
   * Structural summary only. Cannot prove expected-check coverage, provenance,
   * receipt authenticity, or that the supplied results came from this engine.
   */
  static passed(results: readonly GateResult[]): boolean {
    try {
      const items = arrayValues(results);
      if (items.length === 0) return false;
      const names = new Set<string>();
      for (const item of items) {
        const result = captureResult(item);
        if (result.passed !== true || names.has(result.gate)) return false;
        names.add(result.gate);
      }
      return true;
    } catch {
      return false;
    }
  }
}
