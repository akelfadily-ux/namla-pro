/**
 * Core identity and role types shared by every ant in the colony.
 * Phase 0: descriptive shapes only, no behavior.
 */

export type AntRole =
  | "queen"
  | "commander"
  | "strategist"
  | "scout"
  | "planner"
  | "worker"
  | "builder"
  | "tester"
  | "auditor"
  | "guard"
  | "memory"
  | "repair"
  | "messenger"
  | "forager"
  | "cleaner"
  | "optimizer"
  | "archivist"
  | "nurse"
  | "architect"
  | "reporter";

export type AntGeneration = number;

export type AntTrustLevel = "untrusted" | "probationary" | "trusted" | "core";

export type AntEnergyState = "idle" | "active" | "tired" | "resting" | "offline";

export interface AntCapability {
  name: string;
  description: string;
  requiresApproval: boolean;
}

export interface AntIdentity {
  antId: string;
  role: AntRole;
  displayName: string;
  generation: AntGeneration;
  trustLevel: AntTrustLevel;
  capabilities: AntCapability[];
  createdAt: string;
}

export interface AntState {
  identity: AntIdentity;
  energy: AntEnergyState;
  currentTaskId?: string;
  lastActiveAt?: string;
}
