/**
 * FileAdapter is how an ant would eventually read or write files. In Phase 0
 * it never touches the real filesystem — it only returns a PlannedAction
 * describing the intended file action, after checking FileBoundaryPolicy.
 */

import type { FileAdapter as FileAdapterShape, PlannedAction } from "../types/bodyTypes";
import { buildPlannedAction } from "./toolAdapter";
import { isInsideProjectRoot } from "../policies/fileBoundaryPolicy";

export class FileAdapter implements FileAdapterShape {
  readonly adapterId: string;
  readonly toolName = "file-adapter";

  constructor(private readonly projectRoot: string, adapterId = "file-adapter-default") {
    this.adapterId = adapterId;
  }

  describeCapability(): string {
    return "Would read or write files in a future phase. In Phase 0, only planning is performed — no file is ever modified.";
  }

  plan(request: Record<string, unknown>): PlannedAction {
    const targetPath = typeof request.targetPath === "string" ? request.targetPath : "";
    const intent = typeof request.intent === "string" ? request.intent : "read";
    return this.planFileAction(targetPath, intent);
  }

  planFileAction(targetPath: string, intent: string): PlannedAction {
    const inside = isInsideProjectRoot(targetPath, this.projectRoot);

    return buildPlannedAction({
      kind: intent === "write" ? "file-write" : intent === "delete" ? "file-delete" : "file-read",
      description: inside
        ? `Planned (not executed) file action "${intent}" on ${targetPath}.`
        : `Refused: target path is outside the project root: ${targetPath}`,
      requestedByAntId: "file-adapter",
      targetPath,
      requiresHumanApproval: true,
    });
  }
}
