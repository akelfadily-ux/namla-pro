/**
 * capabilityFabric — the bounded Universal Computer Capability Fabric (Sovereign
 * Federation V3, Phase 3). The goal is NOT magical mastery: it is a measurable
 * capability system where every authorized computer-work capability is scoped,
 * evidence-gated, budgeted, verified, revocable, and receipted.
 *
 * Hard rules encoded here:
 *   - NO generic unrestricted shell; NO "control computer" capability; NO
 *     credential access; NO arbitrary network. Every capability maps to a fixed
 *     tool id (an existing bounded MCP tool, an existing bounded execution
 *     boundary, or `future-approved-mcp`, which is NOT grantable until a human +
 *     council approve a concrete scoped tool).
 *   - Grants are ant/task/workspace-scoped, call-budgeted, revocable, receipted.
 *   - Provider cognition is a TEMPORARY BRAIN: routing is evidence-based and its
 *     output is always a proposal — never authority.
 *   - Mastery requires repeated missions, independent review, exams, freshness —
 *     never one model's say-so.
 *
 * No fs, no child_process, no network, no wall clock. Deterministic.
 */

import { roundTo } from "../colony/colonyTypes";
import type { McpToolId } from "./settlementTypes";
import type { ProviderHealth } from "./mcpNervousSystem";

export const CAPABILITY_FAMILIES = [
  "software-architecture",
  "frontend-engineering",
  "backend-engineering",
  "database-design",
  "testing",
  "debugging",
  "code-review",
  "defensive-security-review",
  "documentation",
  "git-inspection",
  "ci-analysis",
  "build-systems",
  "package-analysis",
  "logs-diagnostics",
  "data-processing",
  "local-file-operations",
  "safe-terminal-operations",
  "browser-research",
  "desktop-interaction",
  "cloud-infrastructure-planning",
  "api-integration",
  "mcp-engineering",
  "agent-engineering",
  "provider-orchestration",
  "project-management",
  "product-requirements",
  "accessibility",
  "performance-analysis",
  "reliability-engineering",
  "incident-response",
] as const;
export type CapabilityFamilyId = (typeof CAPABILITY_FAMILIES)[number];

export type CapabilityRisk = "read-only" | "bounded-write" | "bounded-execute" | "future-approval-required";

export interface CapabilityDescriptor {
  readonly capabilityId: string;
  readonly family: CapabilityFamilyId;
  readonly requiredSkillEvidence: number;
  /** Fixed tool id — an existing MCP tool, an authorized boundary, or `future-approved-mcp`. */
  readonly requiredToolId: McpToolId | "verification-boundary" | "workspace-boundary" | "future-approved-mcp";
  readonly inputSchema: string;
  readonly outputSchema: string;
  readonly workspaceScope: "run-workspace-only";
  readonly riskLevel: CapabilityRisk;
  readonly humanApprovalRequired: boolean;
  readonly councilApprovalRequired: boolean;
  readonly callBudget: number;
  readonly timeoutMs: number;
  readonly costModel: number;
  readonly verificationMethod: "receipt" | "independent-review" | "allowlisted-verification";
  readonly revocationRule: "on-task-end" | "on-failure" | "immediate-on-violation";
}

function cap(capabilityId: string, family: CapabilityFamilyId, requiredToolId: CapabilityDescriptor["requiredToolId"], riskLevel: CapabilityRisk, opts?: Partial<CapabilityDescriptor>): CapabilityDescriptor {
  return {
    capabilityId,
    family,
    requiredSkillEvidence: 0.4,
    requiredToolId,
    inputSchema: `${family}-input-v1`,
    outputSchema: `${family}-output-v1`,
    workspaceScope: "run-workspace-only",
    riskLevel,
    humanApprovalRequired: riskLevel !== "read-only",
    councilApprovalRequired: riskLevel === "bounded-execute" || riskLevel === "future-approval-required",
    callBudget: riskLevel === "read-only" ? 20 : 6,
    timeoutMs: 60000,
    costModel: riskLevel === "read-only" ? 0.05 : 0.3,
    verificationMethod: riskLevel === "bounded-execute" ? "allowlisted-verification" : riskLevel === "bounded-write" ? "independent-review" : "receipt",
    revocationRule: riskLevel === "read-only" ? "on-task-end" : "immediate-on-violation",
    ...opts,
  };
}

/** The registry: every major computer-work domain, each bounded and mapped. */
export function buildCapabilityRegistry(): readonly CapabilityDescriptor[] {
  return [
    cap("cap-architecture-plan", "software-architecture", "project-analysis", "read-only"),
    cap("cap-frontend-build", "frontend-engineering", "workspace-file-create", "bounded-write"),
    cap("cap-backend-build", "backend-engineering", "workspace-file-create", "bounded-write"),
    cap("cap-database-design", "database-design", "project-analysis", "read-only"),
    cap("cap-test-authoring", "testing", "workspace-file-create", "bounded-write"),
    cap("cap-test-execution", "testing", "verification-boundary", "bounded-execute"),
    cap("cap-debugging", "debugging", "code-search", "read-only"),
    cap("cap-code-review", "code-review", "bounded-file-read", "read-only"),
    cap("cap-security-review", "defensive-security-review", "code-search", "read-only"),
    cap("cap-documentation", "documentation", "documentation", "bounded-write"),
    cap("cap-git-inspection", "git-inspection", "repo-inspection", "read-only"),
    cap("cap-ci-analysis", "ci-analysis", "project-analysis", "read-only"),
    cap("cap-build-systems", "build-systems", "verification-boundary", "bounded-execute"),
    cap("cap-package-analysis", "package-analysis", "project-analysis", "read-only"),
    cap("cap-logs-diagnostics", "logs-diagnostics", "bounded-file-read", "read-only"),
    cap("cap-data-processing", "data-processing", "project-analysis", "read-only"),
    cap("cap-local-file-ops", "local-file-operations", "workspace-boundary", "bounded-write"),
    cap("cap-safe-terminal", "safe-terminal-operations", "verification-boundary", "bounded-execute"),
    cap("cap-browser-research", "browser-research", "future-approved-mcp", "future-approval-required"),
    cap("cap-desktop-interaction", "desktop-interaction", "future-approved-mcp", "future-approval-required"),
    cap("cap-cloud-planning", "cloud-infrastructure-planning", "project-analysis", "read-only"),
    cap("cap-api-integration", "api-integration", "project-analysis", "read-only"),
    cap("cap-mcp-engineering", "mcp-engineering", "project-analysis", "read-only"),
    cap("cap-agent-engineering", "agent-engineering", "project-analysis", "read-only"),
    cap("cap-provider-orchestration", "provider-orchestration", "knowledge-retrieval", "read-only"),
    cap("cap-project-management", "project-management", "knowledge-retrieval", "read-only"),
    cap("cap-product-requirements", "product-requirements", "knowledge-retrieval", "read-only"),
    cap("cap-accessibility", "accessibility", "bounded-file-read", "read-only"),
    cap("cap-performance-analysis", "performance-analysis", "project-analysis", "read-only"),
    cap("cap-reliability-engineering", "reliability-engineering", "project-analysis", "read-only"),
    cap("cap-incident-response", "incident-response", "knowledge-retrieval", "read-only"),
  ];
}

// --- grants (scoped + revocable + receipted) ---------------------------------

export interface CapabilityGrant {
  readonly grantId: string;
  readonly capabilityId: string;
  readonly antId: string;
  readonly taskId: string;
  readonly workspaceId: string;
  readonly callBudget: number;
  callsUsed: number;
  revoked: boolean;
}

export interface CapabilityGrantReceipt {
  readonly grantId: string;
  readonly capabilityId: string;
  readonly antId: string;
  readonly event: "granted" | "denied" | "revoked" | "budget-exhausted";
  readonly reason: string;
}

export class CapabilityFabric {
  private readonly registry = new Map<string, CapabilityDescriptor>();
  private readonly grants = new Map<string, CapabilityGrant>();
  private readonly receipts: CapabilityGrantReceipt[] = [];
  private readonly health = new Map<string, { calls: number; failures: number }>();
  private grantSeq = 0;

  constructor(descriptors: readonly CapabilityDescriptor[] = buildCapabilityRegistry()) {
    for (const d of descriptors) this.registry.set(d.capabilityId, d);
  }

  get registrySize(): number {
    return this.registry.size;
  }
  get familiesCovered(): number {
    return new Set([...this.registry.values()].map((d) => d.family)).size;
  }
  get grantReceipts(): readonly CapabilityGrantReceipt[] {
    return this.receipts;
  }
  get activeGrantCount(): number {
    return [...this.grants.values()].filter((g) => !g.revoked).length;
  }
  descriptor(capabilityId: string): CapabilityDescriptor | null {
    return this.registry.get(capabilityId) ?? null;
  }

  /** Grant a capability — refused for future-approval tools and weak evidence. */
  grant(input: { capabilityId: string; antId: string; taskId: string; workspaceId: string; skillEvidence: number; humanApproved: boolean; councilApproved: boolean }): CapabilityGrant | null {
    const d = this.registry.get(input.capabilityId);
    const deny = (reason: string): null => {
      this.receipts.push({ grantId: "none", capabilityId: input.capabilityId, antId: input.antId, event: "denied", reason });
      return null;
    };
    if (!d) return deny("unknown-capability");
    if (d.requiredToolId === "future-approved-mcp") return deny("future-approval-required");
    if (input.skillEvidence < d.requiredSkillEvidence) return deny("insufficient-skill-evidence");
    if (d.humanApprovalRequired && !input.humanApproved) return deny("human-approval-missing");
    if (d.councilApprovalRequired && !input.councilApproved) return deny("council-approval-missing");
    this.grantSeq += 1;
    const grant: CapabilityGrant = { grantId: `capgrant-${this.grantSeq}`, capabilityId: d.capabilityId, antId: input.antId, taskId: input.taskId, workspaceId: input.workspaceId, callBudget: d.callBudget, callsUsed: 0, revoked: false };
    this.grants.set(grant.grantId, grant);
    this.receipts.push({ grantId: grant.grantId, capabilityId: d.capabilityId, antId: input.antId, event: "granted", reason: "scoped-grant" });
    return grant;
  }

  /** Record one bounded use; auto-revokes at budget exhaustion. */
  recordUse(grant: CapabilityGrant, ok: boolean): boolean {
    if (grant.revoked || grant.callsUsed >= grant.callBudget) return false;
    grant.callsUsed += 1;
    const h = this.health.get(grant.capabilityId) ?? { calls: 0, failures: 0 };
    h.calls += 1;
    if (!ok) h.failures += 1;
    this.health.set(grant.capabilityId, h);
    if (grant.callsUsed >= grant.callBudget) {
      grant.revoked = true;
      this.receipts.push({ grantId: grant.grantId, capabilityId: grant.capabilityId, antId: grant.antId, event: "budget-exhausted", reason: "call-budget" });
    }
    return true;
  }

  revoke(grantId: string, reason: string): void {
    const g = this.grants.get(grantId);
    if (g && !g.revoked) {
      g.revoked = true;
      this.receipts.push({ grantId, capabilityId: g.capabilityId, antId: g.antId, event: "revoked", reason });
    }
  }

  revokeAll(reason: string): void {
    for (const g of this.grants.values()) if (!g.revoked) this.revoke(g.grantId, reason);
  }

  capabilityHealth(capabilityId: string): { calls: number; failures: number; reliability: number } {
    const h = this.health.get(capabilityId) ?? { calls: 0, failures: 0 };
    return { ...h, reliability: h.calls === 0 ? 1 : roundTo(1 - h.failures / h.calls, 4) };
  }
  get healthUpdates(): number {
    return [...this.health.values()].reduce((s, h) => s + h.calls, 0);
  }
}

// --- capability gap analysis → Academy/recruitment demand --------------------

export interface CapabilityGap {
  readonly family: CapabilityFamilyId;
  readonly volunteersAvailable: number;
  readonly demandLevel: number;
}

/** Gaps become Academy training / recruitment demand — never forced assignment. */
export function analyzeCapabilityGaps(required: readonly CapabilityFamilyId[], volunteerFamilies: ReadonlyMap<CapabilityFamilyId, number>): CapabilityGap[] {
  return required.filter((f) => (volunteerFamilies.get(f) ?? 0) === 0).map((f) => ({ family: f, volunteersAvailable: 0, demandLevel: 1 }));
}

// --- evidence-based provider routing -----------------------------------------

export interface ProviderRouteInput {
  readonly taskDomain: CapabilityFamilyId;
  readonly roleContract: "architecture" | "build" | "review";
  readonly candidates: readonly ("claude" | "codex")[];
  readonly health: Readonly<Record<string, ProviderHealth>>;
  readonly costWeight: number;
  readonly privacySensitive: boolean;
  /** Ant/provider separation: the reviewing provider should differ from the building one when possible. */
  readonly excludeProvider?: "claude" | "codex";
}

/**
 * Route a role to a provider on EVIDENCE: reliability history, timeout/malformed
 * history, cost, and independence — never on a model's self-claim. Output is a
 * routing PROPOSAL; execution still requires permits + human authorization.
 */
export function routeProvider(input: ProviderRouteInput): { provider: "claude" | "codex"; score: number; reason: string } {
  const pool = input.candidates.filter((c) => c !== input.excludeProvider);
  const usable = pool.length > 0 ? pool : input.candidates;
  let best: { provider: "claude" | "codex"; score: number } | null = null;
  for (const p of usable) {
    const h = input.health[p];
    const reliability = h && h.calls > 0 ? 1 - h.failures / h.calls : 0.7;
    const qualityBonus = h ? Math.min(0.2, h.qualityHistory * 0.1) : 0;
    const cost = p === "codex" ? 0.4 : 0.5;
    const score = roundTo(reliability * 0.6 + qualityBonus - cost * input.costWeight * 0.2 + (input.privacySensitive && p === "claude" ? 0.05 : 0), 4);
    if (!best || score > best.score) best = { provider: p, score };
  }
  return { ...(best as { provider: "claude" | "codex"; score: number }), reason: "evidence-scored" };
}

// --- mastery (evidence-gated, never model-declared) --------------------------

export interface CapabilityEvidence {
  readonly antId: string;
  readonly family: CapabilityFamilyId;
  readonly completedMissions: number;
  readonly independentTestsPassed: number;
  readonly independentReviews: number;
  readonly failureRecoveries: number;
  readonly reliability: number;
  readonly safety: number;
  readonly providerDiversity: number;
  readonly evidenceFreshnessTicks: number;
  readonly unresolvedSevereIncidents: number;
  readonly examPassed: boolean;
  readonly independentEvaluatorAntId: string | null;
}

export type MasteryVerdict = "mastered" | "practicing" | "insufficient-evidence" | "blocked-by-incident";

/** Mastery is EARNED: missions + tests + reviews + recovery + exam + evaluator + freshness. */
export function evaluateMastery(e: CapabilityEvidence): MasteryVerdict {
  if (e.unresolvedSevereIncidents > 0) return "blocked-by-incident";
  if (e.independentEvaluatorAntId === null || e.independentEvaluatorAntId === e.antId) return "insufficient-evidence";
  if (!e.examPassed) return "insufficient-evidence";
  if (e.completedMissions < 3 || e.independentTestsPassed < 2 || e.independentReviews < 2) return "practicing";
  if (e.failureRecoveries < 1 || e.reliability < 0.7 || e.safety < 0.8) return "practicing";
  if (e.evidenceFreshnessTicks > 500) return "practicing"; // stale evidence must be re-earned
  return "mastered";
}

export interface CapabilityLearningPlan {
  readonly family: CapabilityFamilyId;
  readonly targetAnts: number;
  readonly trainingMissions: number;
  readonly examRequired: true;
  readonly mentorRequired: true;
}

export function buildLearningPlan(gap: CapabilityGap): CapabilityLearningPlan {
  return { family: gap.family, targetAnts: 3, trainingMissions: 3, examRequired: true, mentorRequired: true };
}

export interface ComputerWorkMissionProfile {
  readonly profileId: string;
  readonly requiredFamilies: readonly CapabilityFamilyId[];
  readonly riskCeiling: CapabilityRisk;
  readonly verificationPolicy: readonly string[];
}

/** The software-build mission profile used by the federation demo + CLI. */
export function softwareBuildProfile(profileId: string): ComputerWorkMissionProfile {
  return { profileId, requiredFamilies: ["software-architecture", "backend-engineering", "testing", "code-review", "defensive-security-review", "documentation"], riskCeiling: "bounded-execute", verificationPolicy: ["typecheck", "test", "build"] };
}
