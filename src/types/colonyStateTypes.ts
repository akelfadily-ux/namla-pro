/**
 * Colony state types. ColonyState is the in-memory snapshot of the whole
 * colony: which phase it is in, which ants exist, and how healthy it is.
 */

import type { AntState } from "./antTypes";

export type ColonyPhase =
  | "phase-0-foundation"
  | "phase-1-inspector"
  | "phase-2-mission-planning"
  | "phase-3-code-generation"
  | "phase-4-audit-test-repair"
  | "phase-5-git-integration"
  | "phase-6-multi-agent-simulation"
  | "phase-7-tool-adapters"
  | "phase-8-bot-desktop-automation"
  | "phase-9-robot-iot-abstraction"
  | "phase-10-tamara-integration"
  | "phase-11-server-cloud-colony"
  | "phase-12-distributed-empire";

export type ColonyHealth = "healthy" | "degraded" | "at-risk" | "halted";

export interface ColonyState {
  colonyId: string;
  phase: ColonyPhase;
  health: ColonyHealth;
  ants: AntState[];
  activeMissionIds: string[];
  updatedAt: string;
}
