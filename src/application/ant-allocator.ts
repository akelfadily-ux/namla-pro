/**
 * C3 adaptation of Productization 44977cf. Opaque agent identifiers only.
 * This does not register an agent, schedule work, or issue execution authority.
 * Persist allocated IDs; never regenerate legacy IDs during recovery.
 */
import { createHash, randomUUID } from "node:crypto";
import type { AntAllocator } from "../domain/contracts";
import { ConfigurationError } from "../domain/errors";
import { AntRole, type AntId, type RunId, type TaskId } from "../domain/types";

const ROLES: ReadonlySet<string> = new Set(Object.values(AntRole));

function requireIdentity(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ConfigurationError("Invalid agent allocation identity");
  }
}

export class DefaultAntAllocator implements AntAllocator {
  allocate(role: AntRole, runId: RunId, taskId?: TaskId): AntId {
    if (typeof role !== "string" || !ROLES.has(role)) {
      throw new ConfigurationError("Invalid agent allocation role");
    }
    requireIdentity(runId);
    if (taskId !== undefined) requireIdentity(taskId);

    // A complete role/run/task tuple stays deterministic, as in the donor's
    // task-bound mode. Separate tuple fields cannot alias by delimiter joining.
    // Task-less allocations remain fresh, using a full random UUID as a nonce.
    const scope = taskId === undefined ? ["unbound", randomUUID()] : ["task", taskId];
    const input = JSON.stringify(["NAMLA_PRODUCTIZATION_ANT_ID", 2, role, runId, scope]);
    const digest = createHash("sha256").update(input, "utf8").digest("hex");
    return `ant-${role.toLowerCase()}-v2-${digest}`;
  }
}
