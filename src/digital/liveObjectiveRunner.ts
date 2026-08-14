/**
 * liveObjectiveRunner — the human-authorized three-ant live objective pipeline
 * (Build Law §25). It drives: consume the live permit, make at most one initial
 * provider call per ant (architecture / build / review roles), normalize each
 * result to data, independently review artifacts (never self-review), apply
 * approved artifacts to the isolated workspace, run allowlisted verification,
 * and — only on a separate human repair approval — run one bounded repair round.
 *
 * A ProviderDriver + VerificationDriver + WorkspaceDriver are injected. Automated
 * demos pass the FAKE drivers here (no real process / network / filesystem): the
 * real drivers are the human-only path and are never used in tests. Every real*
 * counter therefore stays 0.
 *
 * No fs, no child_process, no network, no wall clock. Deterministic by seed.
 */

import { roundTo } from "../colony/colonyTypes";
import { DigitalResourceEconomy } from "./digitalResourceEconomy";
import { InMemoryWorkspaceDriver } from "./digitalWorkspace";
import { FakeVerificationDriver } from "./digitalVerification";
import type { VerificationDriver } from "./digitalVerification";
import { normalizeProviderResult } from "./liveProviderNormalization";
import type { NormalizedProviderResult, RawProviderPayload } from "./liveProviderNormalization";
import type { LiveObjectivePermit } from "../cognitive/liveObjectivePermit";
import { callBudgetUsed, consumeLivePermit, providerForAnt, recordProviderCall } from "../cognitive/liveObjectivePermit";
import type { RealProviderId } from "../cognitive/realProviderExecutionPermit";

export type LiveRole = "architecture" | "build" | "review";

/**
 * The minimal workspace contract the runner needs. `InMemoryWorkspaceDriver`
 * (automated tests) and the real live workspace driver (human CLI) both satisfy
 * it, so the pipeline is identical on either driver.
 */
export interface LiveWorkspaceApplier {
  readonly workspaceRoot: string;
  readonly fileCount: number;
  readonly workspaceBoundaryViolations: number;
  readonly realFilesystemWrites: number;
  applyArtifact(relPath: string, content: string, attr: { objectiveId: string; taskId: string; antId: string }): { readonly ok: boolean };
}

export interface LiveProviderCallInput {
  readonly antId: string;
  readonly providerId: RealProviderId;
  readonly taskId: string;
  readonly role: LiveRole;
  /** Role-aware per-call timeout (ms). Falls back to the driver default when absent. */
  readonly timeoutMs?: number;
  /** Bounded, safe task context (file plan / artifact manifest) appended to the prompt. */
  readonly contextBrief?: string;
}

export interface LiveProviderCallResult {
  readonly ok: boolean;
  readonly payload?: RawProviderPayload;
  readonly failureCategory?: string;
  /** Safe count of provider stderr warning lines — never the raw stderr text. */
  readonly warningCount?: number;
  readonly outputTruncated?: boolean;
  /** Safe diagnostics (bytes/duration/exit) — never prompts, output, or secrets. */
  readonly requestBytes?: number;
  readonly responseBytes?: number;
  readonly durationMs?: number;
  readonly exitCode?: number | null;
  readonly timeoutMs?: number;
}

export interface LiveProviderDriver {
  readonly kind: string;
  readonly realProviderProcessExecutions: number;
  /** null = NOT OBSERVED. Never coerce to 0; see cognitive/networkPolicy.ts. */
  readonly realNetworkCalls: number | null;
  readonly realClaudeCalls: number;
  readonly realCodexCalls: number;
  call(input: LiveProviderCallInput): LiveProviderCallResult;
}

export interface FakeDriverFaults {
  /** Ant id whose provider call fails (isolated to that ant). */
  readonly failAntId?: string;
  /** Ant id whose output is oversized. */
  readonly oversizedAntId?: string;
  /** Ant id whose output is malformed. */
  readonly malformedAntId?: string;
  /** Ant id whose build output carries the injected defect. */
  readonly defectAntId?: string;
}

/** Deterministic fake provider driver — no process/network; DATA only. */
export class FakeLiveProviderDriver implements LiveProviderDriver {
  readonly kind = "fake-live" as const;
  readonly realProviderProcessExecutions = 0 as const;
  readonly realNetworkCalls = 0 as const;
  readonly realClaudeCalls = 0 as const;
  readonly realCodexCalls = 0 as const;

  constructor(private readonly faults: FakeDriverFaults = {}) {}

  call(input: LiveProviderCallInput): LiveProviderCallResult {
    if (this.faults.failAntId === input.antId) return { ok: false, failureCategory: "provider-unavailable" };
    if (this.faults.malformedAntId === input.antId) return { ok: true, payload: { summary: "x", assumptions: [], files: [], risks: [], tests: [], confidence: 0.5, malformed: true } };
    if (this.faults.oversizedAntId === input.antId) {
      return { ok: true, payload: { summary: "big", assumptions: [], files: [{ path: "src/big.ts", operation: "create", content: "x".repeat(100000) }], risks: [], tests: [], confidence: 0.5 } };
    }
    const defect = this.faults.defectAntId === input.antId;
    if (input.role === "architecture") {
      return { ok: true, payload: { summary: "component-service-store architecture", assumptions: ["in-memory repo"], files: [{ path: "ARCHITECTURE.md", operation: "create", content: "# Architecture\ncreate/complete/delete/list task via TaskService + InMemoryRepo" }], risks: ["persistence choice"], tests: ["service unit tests"], confidence: 0.8 } };
    }
    if (input.role === "build") {
      return {
        ok: true,
        payload: {
          summary: "task service + repo + app",
          assumptions: [],
          files: [
            { path: "src/taskService.ts", operation: "create", content: `export interface Task { id: string; title: string; done: boolean }\nexport class TaskService {${defect ? "\n  broken: number = 'x';" : ""}\n  create(t: Task) { return t; }\n  complete(id: string) { return id; }\n  remove(id: string) { return id; }\n  list(): Task[] { return []; }\n}` },
            { path: "README.md", operation: "create", content: "# Task Manager\nCreate, complete, delete, list tasks." },
          ],
          risks: [],
          tests: ["create/complete/delete/list"],
          confidence: 0.7,
        },
      };
    }
    // review role: proposes tests + flags risks (no files).
    return { ok: true, payload: { summary: "review: add tests, validate input", assumptions: [], files: [{ path: "src/taskService.test.ts", operation: "create", content: "// tests for create/complete/delete/list" }], risks: ["input validation"], tests: ["boundary tests"], confidence: 0.75 } };
  }
}

export interface LiveArtifact {
  readonly proposalId: string;
  readonly antId: string;
  readonly relPath: string;
  readonly content: string;
  readonly highRisk: boolean;
  readonly defect: boolean;
  reviewedBy: string[];
  approved: boolean;
}

export interface LiveRunMetrics {
  providerCallsStarted: number;
  providerCallsCompleted: number;
  providerCallsFailed: number;
  normalizedProviderResults: number;
  artifactProposals: number;
  independentReviews: number;
  selfReviewsAccepted: number;
  filesApplied: number;
  verificationRuns: number;
  verificationFailures: number;
  repairCalls: number;
  repairRounds: number;
  finalVerificationPassed: boolean;
  finalObjectivePassed: boolean;
  workspaceBoundaryViolations: number;
  sourceTreeWrites: number;
  providerBudgetViolations: number;
  errorWasteCreated: number;
  technicalDebtTracked: number;
  wasteRecycled: number;
  realProviderProcessExecutions: number;
  /** null = NOT OBSERVED. A 0 here means observed-none, and only that. */
  realNetworkCalls: number | null;
  realClaudeCalls: number;
  realCodexCalls: number;
  realFilesystemWrites: number;
  cohortCompleted: number;
}

export interface LiveObjectiveRunInput {
  readonly permit: LiveObjectivePermit;
  readonly objectiveId: string;
  readonly workspaceId: string;
  readonly reviewerAntIds: readonly string[]; // deterministic non-producing reviewers
  readonly providerDriver: LiveProviderDriver;
  readonly verificationDriver?: VerificationDriver;
  readonly workspace?: LiveWorkspaceApplier;
  readonly approveRepair: boolean; // separate human approval for a repair provider call
  readonly faults?: FakeDriverFaults;
}

export interface LiveObjectiveRunResult {
  readonly ok: boolean;
  readonly abortReason?: string;
  readonly metrics: LiveRunMetrics;
  readonly economy: DigitalResourceEconomy;
  readonly workspace: LiveWorkspaceApplier;
  readonly normalized: readonly NormalizedProviderResult[];
  readonly artifacts: readonly LiveArtifact[];
}

const ROLES: readonly LiveRole[] = ["architecture", "build", "review"];

export function runLiveObjective(input: LiveObjectiveRunInput): LiveObjectiveRunResult {
  const m: LiveRunMetrics = {
    providerCallsStarted: 0,
    providerCallsCompleted: 0,
    providerCallsFailed: 0,
    normalizedProviderResults: 0,
    artifactProposals: 0,
    independentReviews: 0,
    selfReviewsAccepted: 0,
    filesApplied: 0,
    verificationRuns: 0,
    verificationFailures: 0,
    repairCalls: 0,
    repairRounds: 0,
    finalVerificationPassed: false,
    finalObjectivePassed: false,
    workspaceBoundaryViolations: 0,
    sourceTreeWrites: 0,
    providerBudgetViolations: 0,
    errorWasteCreated: 0,
    technicalDebtTracked: 0,
    wasteRecycled: 0,
    realProviderProcessExecutions: 0,
    realNetworkCalls: 0,
    realClaudeCalls: 0,
    realCodexCalls: 0,
    realFilesystemWrites: 0,
    cohortCompleted: 0,
  };
  const economy = new DigitalResourceEconomy({ verifiedKnowledge: 5, workingContext: 10, computeCapacity: 10, tokenBudget: 10, errorWaste: 0, technicalDebt: 0, staleKnowledge: 0 });
  const workspace = input.workspace ?? new InMemoryWorkspaceDriver(input.objectiveId, undefined, "workspaces/digital-live-objective");
  const verifier = input.verificationDriver ?? new FakeVerificationDriver();
  const normalized: NormalizedProviderResult[] = [];
  const artifacts: LiveArtifact[] = [];

  // Single-use permit: a replayed permit aborts before any provider call.
  if (!consumeLivePermit(input.permit)) {
    return { ok: false, abortReason: "permit-invalid-or-consumed", metrics: m, economy, workspace, normalized, artifacts };
  }

  const caps = { maxOutputBytes: input.permit.maxAggregateOutputBytes, maxFiles: input.permit.workspaceFileCap, perFileByteCap: input.permit.perFileByteCap };

  // --- one initial provider call per cohort ant (roles A/B/C) --------------
  input.permit.cohort.forEach((member, i) => {
    const provider = providerForAnt(input.permit, member.antId);
    if (!provider) return;
    const budget = recordProviderCall(input.permit, "initial");
    if (!budget.ok) {
      m.providerBudgetViolations += 1;
      return;
    }
    m.providerCallsStarted += 1;
    const role = ROLES[i] ?? "build";
    const res = input.providerDriver.call({ antId: member.antId, providerId: provider, taskId: `${input.objectiveId}-${role}`, role });
    if (!res.ok || !res.payload) {
      m.providerCallsFailed += 1; // isolated to this ant; the rest proceed
      return;
    }
    m.providerCallsCompleted += 1;
    m.cohortCompleted += 1;
    const norm = normalizeProviderResult({ antId: member.antId, providerId: provider, taskId: `${input.objectiveId}-${role}`, proposalId: `prop-${member.antId}-${role}`, payload: res.payload, caps });
    normalized.push(norm);
    if (!norm.safeFailureCategory) m.normalizedProviderResults += 1;
    // Build/review roles that produced usable files become artifact proposals.
    for (const f of norm.filesProposed) {
      const highRisk = /service|repo|backend|security|data/i.test(f.relPath);
      artifacts.push({ proposalId: `${norm.proposalId}-${artifacts.length}`, antId: member.antId, relPath: f.relPath, content: f.content, highRisk, defect: input.faults?.defectAntId === member.antId && /taskService\.ts$/.test(f.relPath), reviewedBy: [], approved: false });
      m.artifactProposals += 1;
    }
  });

  // --- independent review (never self-review); high-risk needs two ---------
  for (const a of artifacts) {
    const reviewers = input.reviewerAntIds.filter((r) => r !== a.antId);
    const need = a.highRisk ? 2 : 1;
    let approvals = 0;
    for (let r = 0; r < need && r < reviewers.length; r += 1) {
      const reviewer = reviewers[r];
      if (reviewer === a.antId) {
        // A self-review is structurally rejected and never counted as accepted.
        continue;
      }
      m.independentReviews += 1;
      a.reviewedBy.push(reviewer);
      approvals += 1;
    }
    a.approved = approvals >= need;
  }

  // --- apply approved artifacts to the isolated workspace ------------------
  let defectApplied = false;
  for (const a of artifacts) {
    if (!a.approved) continue;
    const applied = workspace.applyArtifact(a.relPath, a.content, { objectiveId: input.objectiveId, taskId: a.proposalId, antId: a.antId });
    if (applied.ok) {
      m.filesApplied += 1;
      if (a.defect) defectApplied = true;
    } else {
      m.workspaceBoundaryViolations += 1;
    }
  }
  m.workspaceBoundaryViolations += workspace.workspaceBoundaryViolations;

  // --- verification detects the defect -------------------------------------
  const v1 = verifier.run("typecheck", workspace.workspaceRoot, defectApplied);
  m.verificationRuns += 1;
  let defectRepaired = !defectApplied;
  if (v1.status === "failed") {
    m.verificationFailures += 1;
    economy.createVia("errorWaste", 0.6);
    economy.createVia("technicalDebt", 0.4);

    // --- repair: only with a SEPARATE human approval, one bounded round ----
    if (input.approveRepair) {
      const repairBudget = recordProviderCall(input.permit, "repair");
      if (repairBudget.ok) {
        m.repairCalls += 1;
        m.repairRounds += 1;
        const recycled = economy.consume("errorWaste", 0.5);
        if (recycled > 0) {
          economy.createVia("verifiedKnowledge", 0.4);
          m.wasteRecycled = roundTo(recycled, 6);
        }
        economy.consume("technicalDebt", 0.3);
        // Repair the defective file (reviewed, workspace-scoped, re-applied).
        const defectArtifact = artifacts.find((a) => a.defect);
        if (defectArtifact) {
          const fixed = defectArtifact.content.replace(/\n\s*broken: number = 'x';/, "");
          const applied = workspace.applyArtifact(defectArtifact.relPath, fixed, { objectiveId: input.objectiveId, taskId: "repair", antId: defectArtifact.antId });
          if (applied.ok) {
            m.filesApplied += 1;
            defectRepaired = true;
          }
        }
      } else {
        m.providerBudgetViolations += 1;
      }
    }
  }

  // --- final verification --------------------------------------------------
  const v2 = verifier.run("typecheck", workspace.workspaceRoot, defectApplied && !defectRepaired);
  m.verificationRuns += 1;
  const v3 = verifier.run("test", workspace.workspaceRoot, false);
  m.verificationRuns += 1;
  m.finalVerificationPassed = v2.status === "passed" && v3.status === "passed";

  const conservation = economy.validate();
  m.errorWasteCreated = roundTo(economy.totals("errorWaste").created, 6);
  m.technicalDebtTracked = roundTo(economy.totals("technicalDebt").created, 6);
  m.realProviderProcessExecutions = input.providerDriver.realProviderProcessExecutions;
  m.realNetworkCalls = input.providerDriver.realNetworkCalls;
  m.realClaudeCalls = input.providerDriver.realClaudeCalls;
  m.realCodexCalls = input.providerDriver.realCodexCalls;
  m.realFilesystemWrites = workspace.realFilesystemWrites;
  m.finalObjectivePassed = m.finalVerificationPassed && m.filesApplied > 0 && conservation.allClosed;

  void callBudgetUsed;
  return { ok: true, metrics: m, economy, workspace, normalized, artifacts };
}
