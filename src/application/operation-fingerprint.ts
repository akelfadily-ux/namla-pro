import { createHash } from "crypto";

export function canonicalize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Non-finite numbers are not valid operation inputs");
    }
    return value;
  }

  if (typeof value === "bigint") {
    return {
      $type: "bigint",
      value: value.toString(),
    };
  }

  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    throw new Error(`Unsupported operation input type: ${typeof value}`);
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      throw new Error("Cyclic operation input is not supported");
    }

    seen.add(value);

    try {
      const record = value as Record<string, unknown>;
      const output: Record<string, unknown> = {};

      for (const key of Object.keys(record).sort()) {
        output[key] = canonicalize(record[key], seen);
      }

      return output;
    } finally {
      seen.delete(value);
    }
  }

  throw new Error("Unsupported operation input");
}

export function fingerprintOperation(input: {
  runId: string;
  taskId: string;
  toolName: string;
  value: unknown;
}): string {
  const canonical = canonicalize({
    version: 1,
    runId: input.runId,
    taskId: input.taskId,
    toolName: input.toolName,
    input: input.value,
  });

  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}
