import { AntAllocator } from "../domain/contracts";
import { AntId, AntRole, RunId, TaskId } from "../domain/types";
import { randomUUID } from "crypto";

export class DefaultAntAllocator implements AntAllocator {
  allocate(role: AntRole, runId: RunId, taskId?: TaskId): AntId {
    const idSuffix = taskId ? taskId.slice(0, 8) : randomUUID().slice(0, 8);
    return `ant-${role.toLowerCase()}-${idSuffix}`;
  }
}
