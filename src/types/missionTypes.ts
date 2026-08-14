/**
 * Mission types. A ColonyMission is the top-level unit of intent handed to
 * the AntQueen by a human (or, in later phases, a trusted external system).
 */

export type MissionStatus =
  | "received"
  | "safety-checked"
  | "planning"
  | "in-progress"
  | "completed"
  | "blocked"
  | "rejected";

export interface MissionGoal {
  goalId: string;
  description: string;
  successCriteria: string[];
}

export interface ColonyMission {
  missionId: string;
  title: string;
  requestedByHuman: string;
  rawInstruction: string;
  goals: MissionGoal[];
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
}
