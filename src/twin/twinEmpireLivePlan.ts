/**
 * twinEmpireLivePlan — the deterministic, human-readable plan for a live twin
 * empire run, plus the orchestration seam (`TwinEmpireLiveSession`) the CLI calls
 * after the exact confirmation. Building the plan and displaying it performs ZERO
 * real action; authorizing a session mints the empire + colony provider permits
 * but this milestone stops before any real provider/MCP/workspace execution.
 *
 * No fs, no child_process, no network, no wall clock, no real provider calls.
 */

import type { DigitalWorker } from "../digital/digitalWorkers";
import type { HumanConfirmation, RealProviderId } from "../cognitive/realProviderExecutionPermit";
import { mintHumanTwinEmpirePermit, mintHumanTwinColonyProviderPermitBatch, TWIN_MAX_CLAUDE_CONCURRENCY, TWIN_MAX_CODEX_CONCURRENCY, TWIN_MAX_TOTAL_PROVIDER_CALLS, TWIN_MAX_DEEP_COGNITION } from "../cognitive/twinEmpireLivePermit";
import type { TwinColonyId, TwinEmpireLivePermit, TwinColonyProviderPermit, TwinEmpireLiveScope } from "../cognitive/twinEmpireLivePermit";

export const TWIN_CONFIRMATION_PHRASE = "RUN NAMOLA TWIN EMPIRE" as const;
export const TWIN_REPAIR_PHRASE = "RUN ONE NAMOLA MERGE REPAIR" as const;
export type TwinColonyRole = "architecture" | "implementation" | "review";

export interface TwinCohortMember {
  readonly antId: string;
  readonly role: TwinColonyRole;
  readonly provider: RealProviderId;
}

export interface TwinCapabilityCoverage {
  readonly architecture: boolean;
  readonly implementation: boolean;
  readonly review: boolean;
  readonly complete: boolean;
}

export interface TwinEmpireLivePlan {
  readonly missionId: string;
  readonly objective: string;
  readonly acceptanceCriteria: readonly string[];
  readonly providers: readonly RealProviderId[];
  readonly claudeCohort: readonly TwinCohortMember[];
  readonly codexCohort: readonly TwinCohortMember[];
  readonly coverage: { readonly claude: TwinCapabilityCoverage; readonly codex: TwinCapabilityCoverage };
  readonly providerAssignments: readonly { readonly colony: TwinColonyId; readonly provider: RealProviderId }[];
  readonly workspaceRoots: { readonly claude: string; readonly codex: string; readonly silentWitness: string; readonly mergeForge: string; readonly finalEvidence: string };
  readonly isolationPolicy: readonly string[];
  readonly limits: {
    readonly maxClaudeConcurrency: number;
    readonly maxCodexConcurrency: number;
    readonly maxTotalProviderCalls: number;
    readonly maxDeepCognitionAnts: number;
    readonly maxMcpCalls: number;
    readonly perFileByteCap: number;
    readonly workspaceFileCap: number;
    readonly maxStdinBytes: number;
    readonly maxStdoutBytes: number;
    readonly perCallTimeoutMs: number;
  };
  readonly verificationCommands: readonly string[];
  readonly confirmationPhrase: string;
  readonly repairPhrase: string;
}

const ROLES: readonly TwinColonyRole[] = ["architecture", "implementation", "review"];

function cohortFor(colony: TwinColonyId, workers: readonly DigitalWorker[], provider: RealProviderId): TwinCohortMember[] {
  const qualified = workers.filter((w) => w.active && (w.maturation === "senior" || w.maturation === "qualified"));
  const pool = qualified.length >= 3 ? qualified : workers.filter((w) => w.active);
  return ROLES.map((role, i) => ({ antId: (pool[i] ?? workers[i]).workerId, role, provider }));
}

function coverageOf(cohort: readonly TwinCohortMember[]): TwinCapabilityCoverage {
  const architecture = cohort.some((m) => m.role === "architecture");
  const implementation = cohort.some((m) => m.role === "implementation");
  const review = cohort.some((m) => m.role === "review");
  return { architecture, implementation, review, complete: architecture && implementation && review };
}

/** Build the plan from disjoint colony identity slices. Each colony gets its own provider. */
export function buildTwinEmpireLivePlan(workers: readonly DigitalWorker[], providers: readonly RealProviderId[], missionId: string): TwinEmpireLivePlan {
  const claudeWorkers = workers.slice(0, 440);
  const codexWorkers = workers.slice(440, 880);
  const claudeProvider: RealProviderId = providers.includes("claude") ? "claude" : providers[0] ?? "claude";
  const codexProvider: RealProviderId = providers.includes("codex") ? "codex" : providers[1] ?? "codex";
  const claudeCohort = cohortFor("claude-forge", claudeWorkers, claudeProvider);
  const codexCohort = cohortFor("codex-crucible", codexWorkers, codexProvider);
  const root = `workspaces/namola-twin/${missionId}`;
  return {
    missionId,
    objective: "small TypeScript task manager (projects + tasks CRUD, in-memory storage, tests, docs)",
    acceptanceCriteria: ["tasks CRUD + completion", "in-memory storage", "unit tests present", "README + architecture docs", "security review"],
    providers,
    claudeCohort,
    codexCohort,
    coverage: { claude: coverageOf(claudeCohort), codex: coverageOf(codexCohort) },
    providerAssignments: [{ colony: "claude-forge", provider: claudeProvider }, { colony: "codex-crucible", provider: codexProvider }],
    workspaceRoots: { claude: `${root}/claude-forge`, codex: `${root}/codex-crucible`, silentWitness: `${root}/silent-witness`, mergeForge: `${root}/merge-forge`, finalEvidence: `${root}/final-evidence` },
    isolationPolicy: ["separate workspaces per colony", "no cross-colony reads before both bundles freeze", "no shared provider session", "no provider direct file writes", "no provider direct MCP execution"],
    limits: { maxClaudeConcurrency: TWIN_MAX_CLAUDE_CONCURRENCY, maxCodexConcurrency: TWIN_MAX_CODEX_CONCURRENCY, maxTotalProviderCalls: TWIN_MAX_TOTAL_PROVIDER_CALLS, maxDeepCognitionAnts: TWIN_MAX_DEEP_COGNITION, maxMcpCalls: 50, perFileByteCap: 20000, workspaceFileCap: 32, maxStdinBytes: 8000, maxStdoutBytes: 20000, perCallTimeoutMs: 600000 },
    verificationCommands: ["npx.cmd tsc --noEmit", "npm.cmd test", "npm.cmd run build"],
    confirmationPhrase: TWIN_CONFIRMATION_PHRASE,
    repairPhrase: TWIN_REPAIR_PHRASE,
  };
}

/** Scope derived from the plan for minting the empire permit. */
export function empireScopeFromPlan(plan: TwinEmpireLivePlan): TwinEmpireLiveScope {
  return {
    missionId: plan.missionId,
    objectiveId: plan.missionId,
    claudeWorkspaceId: plan.workspaceRoots.claude,
    codexWorkspaceId: plan.workspaceRoots.codex,
    allowedProviders: plan.providers,
    maxClaudeConcurrency: plan.limits.maxClaudeConcurrency,
    maxCodexConcurrency: plan.limits.maxCodexConcurrency,
    maxTotalProviderCalls: plan.limits.maxTotalProviderCalls,
    maxDeepCognitionAnts: plan.limits.maxDeepCognitionAnts,
    maxMcpCalls: plan.limits.maxMcpCalls,
    perFileByteCap: plan.limits.perFileByteCap,
    workspaceFileCap: plan.limits.workspaceFileCap,
    maxStdinBytes: plan.limits.maxStdinBytes,
    maxStdoutBytes: plan.limits.maxStdoutBytes,
    perCallTimeoutMs: plan.limits.perCallTimeoutMs,
  };
}

export interface TwinEmpireAuthorization {
  readonly ok: boolean;
  readonly reasonCode?: string;
  readonly empirePermit?: TwinEmpireLivePermit;
  readonly claudePermits?: readonly TwinColonyProviderPermit[];
  readonly codexPermits?: readonly TwinColonyProviderPermit[];
}

/**
 * The orchestration SEAM: the CLI calls this after the exact human confirmation.
 * It mints the empire permit + per-colony provider permits (each colony-bound),
 * then returns. Real provider/MCP/workspace execution is NOT performed here in
 * this milestone.
 */
export interface TwinEmpireLiveSession {
  readonly plan: TwinEmpireLivePlan;
  authorize(confirmation: HumanConfirmation): TwinEmpireAuthorization;
}

export function createTwinEmpireLiveSession(plan: TwinEmpireLivePlan): TwinEmpireLiveSession {
  return {
    plan,
    authorize(confirmation: HumanConfirmation): TwinEmpireAuthorization {
      const empirePermit = mintHumanTwinEmpirePermit(empireScopeFromPlan(plan), confirmation);
      if (!empirePermit) return { ok: false, reasonCode: "empire-permit-mint-failed" };
      const claudePermits = mintHumanTwinColonyProviderPermitBatch(
        "claude-forge",
        plan.claudeCohort.map((m) => ({ colonyId: "claude-forge" as TwinColonyId, provider: m.provider, missionId: plan.missionId, workspaceId: plan.workspaceRoots.claude, antId: m.antId, maxInputBytes: plan.limits.maxStdinBytes, maxOutputBytes: plan.limits.maxStdoutBytes, timeoutMs: plan.limits.perCallTimeoutMs })),
        confirmation
      );
      const codexPermits = mintHumanTwinColonyProviderPermitBatch(
        "codex-crucible",
        plan.codexCohort.map((m) => ({ colonyId: "codex-crucible" as TwinColonyId, provider: m.provider, missionId: plan.missionId, workspaceId: plan.workspaceRoots.codex, antId: m.antId, maxInputBytes: plan.limits.maxStdinBytes, maxOutputBytes: plan.limits.maxStdoutBytes, timeoutMs: plan.limits.perCallTimeoutMs })),
        confirmation
      );
      if (!claudePermits || !codexPermits) return { ok: false, reasonCode: "colony-permit-mint-failed" };
      return { ok: true, empirePermit, claudePermits, codexPermits };
    },
  };
}
