/**
 * antRoleRegistry: the canonical metadata source for every ant role.
 *
 * Architecture Hardening 2 established that the runtime spine schedules
 * ROLES (strings on tasks, matched by AntScheduler), while the twenty ant
 * class files in this folder are façades of varying standing. This
 * registry makes that standing explicit and queryable, so nobody has to
 * infer it from twenty near-identical files.
 *
 * Pure data: no fs, no process, no network, no timers, no receipts. The
 * registry is typed Record<AntRole, AntRoleSpec>, so covering every role
 * in the union — no more, no fewer — is enforced by the compiler.
 *
 * Categories:
 * - "engine-active": the engine's default task pipelines schedule this
 *   role (or use it as the picker fallback).
 * - "capability-facade": the role's class packages an injected capability
 *   beyond the default pipelines.
 * - "legacy-facade": the role's real function is owned by a core component
 *   now; the class remains for compatibility.
 * - "future-facing": a reserved role concept with no runtime use yet.
 */

import type { AntRole } from "../types/antTypes";

export type AntRoleCategory =
  | "engine-active"
  | "capability-facade"
  | "legacy-facade"
  | "future-facing";

export type AntClassFileStatus = "wired-facade" | "wrapper-only" | "duplicate-of-core";

/**
 * Whether a role class participates in the Colony Genesis runtime. Exactly
 * one value is currently used: Colony Genesis is a second runtime and takes
 * part of none of these façades.
 */
export type AntColonyGenesisStanding = "not-part-of-colony-genesis";

export interface AntRoleSpec {
  role: AntRole;
  displayName: string;
  category: AntRoleCategory;
  /** What the role actually does in the runtime spine today. */
  currentRuntimeUse: string;
  /** The component that canonically owns this role's function. */
  canonicalRuntimeOwner: string;
  /** Standing of the class file in src/ants/. */
  classFileStatus: AntClassFileStatus;
  /**
   * Colony Genesis (Build Law S12) standing. Every role below is
   * "not-part-of-colony-genesis": src/colony/ imports none of these classes
   * and routes through none of them. In Colony Genesis a role is a
   * behavioral STATE an ant enters, derived from its own local observations
   * — not a class it belongs to and not something assigned to it.
   */
  colonyGenesisStanding: AntColonyGenesisStanding;
  notes: string;
}

const ANT_ROLE_REGISTRY: Record<AntRole, AntRoleSpec> = {
  queen: {
    role: "queen",
    displayName: "Queen",
    category: "legacy-facade",
    currentRuntimeUse: "Mission gating and intent pheromone are engine-internal; no task routes to this role.",
    canonicalRuntimeOwner: "ColonyEngine (gate); core/antQueen.ts is the legacy path",
    classFileStatus: "duplicate-of-core",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "ants/antQueenRole.ts duplicates the identity of core/antQueen.ts; both predate the engine.",
  },
  commander: {
    role: "commander",
    displayName: "Commander",
    category: "legacy-facade",
    currentRuntimeUse: "Task coordination is owned by the engine's ordered loop; never scheduled.",
    canonicalRuntimeOwner: "ColonySimulation (via ColonyEngine); legacy: ColonyOrchestrator",
    classFileStatus: "wrapper-only",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "Kept for compatibility; a future phase may give commanders sub-mission scope.",
  },
  strategist: {
    role: "strategist",
    displayName: "Strategist",
    category: "future-facing",
    currentRuntimeUse: "Pickable by rolePicker keywords, but engine task templates never produce them.",
    canonicalRuntimeOwner: "none yet",
    classFileStatus: "wrapper-only",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "Reserved for roadmap/strategy tasks in a later phase.",
  },
  scout: {
    role: "scout",
    displayName: "Scout",
    category: "engine-active",
    currentRuntimeUse: "Scheduled for every investigate task in the default pipelines.",
    canonicalRuntimeOwner: "AntScheduler (role match); capability: ProjectInspector by injection",
    classFileStatus: "wired-facade",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "Class packages inspectProject(inspector) for demo-facing use.",
  },
  planner: {
    role: "planner",
    displayName: "Planner",
    category: "engine-active",
    currentRuntimeUse: "Scheduled for every plan-the-approach task.",
    canonicalRuntimeOwner: "AntScheduler; capability: DecompositionEngine by injection",
    classFileStatus: "wired-facade",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "Class packages proposeDecomposition(engine) for demo-facing use.",
  },
  worker: {
    role: "worker",
    displayName: "Worker",
    category: "engine-active",
    currentRuntimeUse: "rolePicker fallback for task text matching no rule.",
    canonicalRuntimeOwner: "rolePicker (fallback)",
    classFileStatus: "wrapper-only",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "The role matters (fallback routing); the class is ceremonial.",
  },
  builder: {
    role: "builder",
    displayName: "Builder",
    category: "engine-active",
    currentRuntimeUse: "Scheduled for every propose-build task; adapter or factory supplies output.",
    canonicalRuntimeOwner: "AntScheduler; capability: ProposalFactory / AdapterRegistry by injection",
    classFileStatus: "wired-facade",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "Class packages proposeCode(factory) for demo-facing use.",
  },
  tester: {
    role: "tester",
    displayName: "Tester",
    category: "engine-active",
    currentRuntimeUse: "Scheduled for every verification-plan task.",
    canonicalRuntimeOwner: "AntScheduler; capability: TestPlanChecker by injection",
    classFileStatus: "wired-facade",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "Class packages checkTestPlan(checker) for demo-facing use.",
  },
  auditor: {
    role: "auditor",
    displayName: "Auditor",
    category: "engine-active",
    currentRuntimeUse: "Scheduled for every review-and-audit task; reviews proposals when injected.",
    canonicalRuntimeOwner: "AntScheduler; capability: ProposalReviewer by injection",
    classFileStatus: "wired-facade",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "Class packages reviewProposal(reviewer) for demo-facing use.",
  },
  guard: {
    role: "guard",
    displayName: "Guard",
    category: "legacy-facade",
    currentRuntimeUse: "Safety gating is SafetyGuard, invoked by the engine and every factory; never scheduled by default templates.",
    canonicalRuntimeOwner: "core/safetyGuard.ts",
    classFileStatus: "wrapper-only",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "The role name survives in rolePicker for explicit safety-check tasks.",
  },
  memory: {
    role: "memory",
    displayName: "Memory",
    category: "legacy-facade",
    currentRuntimeUse: "Colony memory is ColonyMemory, written by the engine at run completion.",
    canonicalRuntimeOwner: "core/colonyMemory.ts",
    classFileStatus: "wrapper-only",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "The role name survives in rolePicker for explicit memory tasks.",
  },
  repair: {
    role: "repair",
    displayName: "Repair",
    category: "capability-facade",
    currentRuntimeUse: "Not in default pipelines; drives RepairProposalFlow when a human-run script asks.",
    canonicalRuntimeOwner: "review/repairProposalFlow.ts by injection",
    classFileStatus: "wired-facade",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "Class packages requestRepairProposal(flow).",
  },
  messenger: {
    role: "messenger",
    displayName: "Messenger",
    category: "engine-active",
    currentRuntimeUse: "Scheduled for the final report-to-human task of every mission.",
    canonicalRuntimeOwner: "AntScheduler (role match)",
    classFileStatus: "wrapper-only",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "The role is load-bearing; the class is ceremonial.",
  },
  forager: {
    role: "forager",
    displayName: "Forager",
    category: "future-facing",
    currentRuntimeUse: "None; never scheduled.",
    canonicalRuntimeOwner: "none yet",
    classFileStatus: "wrapper-only",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "Reserved for external information gathering in a later phase.",
  },
  cleaner: {
    role: "cleaner",
    displayName: "Cleaner",
    category: "future-facing",
    currentRuntimeUse: "None; never scheduled.",
    canonicalRuntimeOwner: "none yet",
    classFileStatus: "wrapper-only",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "Reserved for stale-data cleanup proposals in a later phase.",
  },
  optimizer: {
    role: "optimizer",
    displayName: "Optimizer",
    category: "future-facing",
    currentRuntimeUse: "None; never scheduled.",
    canonicalRuntimeOwner: "none yet",
    classFileStatus: "wrapper-only",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "Reserved for efficiency proposals in a later phase.",
  },
  archivist: {
    role: "archivist",
    displayName: "Archivist",
    category: "capability-facade",
    currentRuntimeUse: "Not in default pipelines; assembles GitCommitProposals when a human-run script asks.",
    canonicalRuntimeOwner: "git/commitProposalFactory.ts by injection",
    classFileStatus: "wired-facade",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "Class packages assembleCommitProposal(factory).",
  },
  nurse: {
    role: "nurse",
    displayName: "Nurse",
    category: "future-facing",
    currentRuntimeUse: "None; never scheduled.",
    canonicalRuntimeOwner: "none yet",
    classFileStatus: "wrapper-only",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "Reserved for ant-health monitoring in a later phase.",
  },
  architect: {
    role: "architect",
    displayName: "Architect",
    category: "future-facing",
    currentRuntimeUse: "None; never scheduled.",
    canonicalRuntimeOwner: "none yet",
    classFileStatus: "wrapper-only",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "Reserved for structural proposals in a later phase.",
  },
  reporter: {
    role: "reporter",
    displayName: "Reporter",
    category: "future-facing",
    currentRuntimeUse: "None; the messenger role owns human reports in the default pipelines.",
    canonicalRuntimeOwner: "none yet",
    classFileStatus: "wrapper-only",
    colonyGenesisStanding: "not-part-of-colony-genesis",
    notes: "May merge with messenger in a later cleanup.",
  },
};

export function getAntRoleSpec(role: AntRole): AntRoleSpec {
  return ANT_ROLE_REGISTRY[role];
}

export function listAntRoleSpecs(): AntRoleSpec[] {
  return Object.values(ANT_ROLE_REGISTRY);
}

export function listEngineActiveRoles(): AntRoleSpec[] {
  return listAntRoleSpecs().filter((spec) => spec.category === "engine-active");
}

export function listFacadeRoles(): AntRoleSpec[] {
  return listAntRoleSpecs().filter(
    (spec) => spec.category === "capability-facade" || spec.category === "legacy-facade"
  );
}

export function isKnownAntRole(role: string): role is AntRole {
  return Object.prototype.hasOwnProperty.call(ANT_ROLE_REGISTRY, role);
}
