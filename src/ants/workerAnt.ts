// Role façade (engine-active role, wrapper-only class; see
// antRoleRegistry.ts). The canonical runtime scheduler is AntScheduler
// through ColonySimulation; this class remains for compatibility.
/**
 * WorkerAnt is the generic executor role. Phase 0: "executing" a task means
 * producing a plan and a receipt — no real command, file write, or network
 * call happens.
 */

import type { AntIdentity } from "../types/antTypes";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";

export class WorkerAnt {
  readonly identity: AntIdentity;

  constructor(antId: string) {
    this.identity = {
      antId,
      role: "worker",
      displayName: "Worker Ant",
      generation: 0,
      trustLevel: "probationary",
      capabilities: [
        { name: "work-task", description: "Work on a generic task by planning, not executing.", requiresApproval: true },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  work(taskDescription: string): AntFacadeTrace {
    return createFacadeTrace({
      role: "worker",
      action: "work-task",
      status: "completed",
      noteCode: "planned-not-run",
      createdBy: this.identity.antId,
      details: { taskDescriptionLength: taskDescription.length },
    });
  }
}
