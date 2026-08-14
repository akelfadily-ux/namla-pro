/**
 * ColonyState tracks the live snapshot of the colony: current phase, ant
 * roster, active missions, and overall health. Phase 0 keeps this entirely
 * in memory.
 */

import type { AntState } from "../types/antTypes";
import type { ColonyHealth, ColonyPhase, ColonyState as ColonyStateShape } from "../types/colonyStateTypes";

export class ColonyState {
  private state: ColonyStateShape;

  constructor(colonyId: string, phase: ColonyPhase = "phase-0-foundation") {
    this.state = {
      colonyId,
      phase,
      health: "healthy",
      ants: [],
      activeMissionIds: [],
      updatedAt: new Date().toISOString(),
    };
  }

  snapshot(): ColonyStateShape {
    return { ...this.state, ants: [...this.state.ants], activeMissionIds: [...this.state.activeMissionIds] };
  }

  registerAnt(antState: AntState): void {
    this.state.ants.push(antState);
    this.touch();
  }

  activateMission(missionId: string): void {
    if (!this.state.activeMissionIds.includes(missionId)) {
      this.state.activeMissionIds.push(missionId);
    }
    this.touch();
  }

  completeMission(missionId: string): void {
    this.state.activeMissionIds = this.state.activeMissionIds.filter((id) => id !== missionId);
    this.touch();
  }

  setHealth(health: ColonyHealth): void {
    this.state.health = health;
    this.touch();
  }

  private touch(): void {
    this.state.updatedAt = new Date().toISOString();
  }
}
