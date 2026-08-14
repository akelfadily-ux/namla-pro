/**
 * mcpNervousSystem — the settlement's MCP nervous system (Build Law §27). It
 * connects Tamara ↔ Namla ↔ Codex/Claude/local-models ↔ tools ↔ workspaces ↔
 * knowledge as a real, bounded, receipted capability fabric. No ant receives all
 * tools; every grant is task-scoped, ant-scoped, time-bounded, revocable,
 * receipted, costed, allowlisted, and human-approved when powerful. No raw
 * mission text becomes a command — every tool is an enum id resolved against a
 * hard-coded registry, and every call returns a validated, bounded, simulated
 * result. Deterministic in automated runs: `realProviderCalls`,
 * `realNetworkCalls`, `realProcessExecutions` all stay 0.
 *
 * No fs, no child_process, no network, no wall clock, no ambient randomness.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import { MCP_TOOLS, POWERFUL_MCP_TOOLS, civDraw } from "./settlementTypes";
import type { DistrictId, McpToolId, ProviderName, WorkKind } from "./settlementTypes";

export interface McpToolDescriptor {
  readonly toolId: McpToolId;
  readonly description: string;
  readonly powerful: boolean;
  readonly costPerCall: number;
  readonly baseFailureRate: number;
}

export const MCP_TOOL_REGISTRY: Readonly<Record<McpToolId, McpToolDescriptor>> = {
  "repo-inspection": { toolId: "repo-inspection", description: "read-only repository structure inspection", powerful: false, costPerCall: 0.1, baseFailureRate: 0.05 },
  "bounded-file-read": { toolId: "bounded-file-read", description: "read a bounded workspace file", powerful: false, costPerCall: 0.05, baseFailureRate: 0.04 },
  "workspace-file-create": { toolId: "workspace-file-create", description: "create a reviewed workspace file", powerful: true, costPerCall: 0.3, baseFailureRate: 0.08 },
  "project-analysis": { toolId: "project-analysis", description: "static project analysis", powerful: false, costPerCall: 0.2, baseFailureRate: 0.06 },
  typecheck: { toolId: "typecheck", description: "allowlisted typecheck", powerful: false, costPerCall: 0.15, baseFailureRate: 0.1 },
  tests: { toolId: "tests", description: "allowlisted test run", powerful: false, costPerCall: 0.2, baseFailureRate: 0.12 },
  build: { toolId: "build", description: "allowlisted build", powerful: true, costPerCall: 0.35, baseFailureRate: 0.1 },
  documentation: { toolId: "documentation", description: "documentation generation", powerful: false, costPerCall: 0.1, baseFailureRate: 0.05 },
  "code-search": { toolId: "code-search", description: "bounded code search", powerful: false, costPerCall: 0.08, baseFailureRate: 0.05 },
  "knowledge-retrieval": { toolId: "knowledge-retrieval", description: "task-relevant knowledge retrieval", powerful: false, costPerCall: 0.1, baseFailureRate: 0.05 },
  "provider-cognition": { toolId: "provider-cognition", description: "bounded provider cognition for one ant", powerful: true, costPerCall: 0.5, baseFailureRate: 0.15 },
};

export interface McpToolGrant {
  readonly grantId: string;
  readonly toolId: McpToolId;
  readonly antId: string;
  readonly taskId: string;
  readonly districtId: DistrictId;
  readonly issuedTick: number;
  readonly expiresTick: number;
  readonly humanApproved: boolean;
  readonly costBudget: number;
}

export interface McpSessionReceipt {
  readonly receiptId: string;
  readonly grantId: string;
  readonly toolId: McpToolId;
  readonly antId: string;
  readonly taskId: string;
  readonly tick: number;
  readonly ok: boolean;
  readonly failureCategory: string | null;
  readonly costCharged: number;
  readonly resultFingerprint: string;
  readonly resultValid: boolean;
  readonly provider: ProviderName | null;
}

export interface McpToolHealth {
  calls: number;
  failures: number;
  healthScore: number;
}

/** Deterministic provider routing signal, per provider. */
export interface ProviderHealth {
  calls: number;
  failures: number;
  healthScore: number;
  qualityHistory: number;
}

/** The outcome of executing one MCP tool through an injected driver. */
export interface McpExecutionResult {
  readonly ok: boolean;
  readonly failureCategory: string | null;
  readonly resultValid: boolean;
}

export interface McpExecutionInput {
  readonly toolId: McpToolId;
  readonly antId: string;
  readonly districtId: DistrictId;
  readonly taskId: string;
  readonly tick: number;
}

/**
 * Pluggable MCP tool executor. Automated runs inject a FAKE (isReal=false) so
 * `realMcpExecutions` stays 0; the human live run injects a real driver that
 * routes file tools through the authorized workspace boundary and verification
 * through the one child_process importer. When no executor is supplied, the
 * nervous system uses its own deterministic simulation (Civilization OS V1).
 */
export interface McpExecutionDriver {
  readonly kind: string;
  readonly isReal: boolean;
  execute(input: McpExecutionInput): McpExecutionResult;
}

export class McpNervousSystem {
  private readonly grants = new Map<string, McpToolGrant>();
  private readonly revoked = new Set<string>();
  private readonly spendByGrant = new Map<string, number>();
  private readonly receipts: McpSessionReceipt[] = [];
  private readonly toolHealth: Record<McpToolId, McpToolHealth>;
  private readonly providerHealth: Record<ProviderName, ProviderHealth>;
  private grantSeq = 0;
  private receiptSeq = 0;
  private grantsDenied = 0;
  private totalCostCharged = 0;
  private realMcpExecs = 0;
  private toolHealthUpdates = 0;
  private providerHealthUpdates = 0;

  constructor(private readonly totalCostBudget: number) {
    this.toolHealth = {} as Record<McpToolId, McpToolHealth>;
    for (const t of MCP_TOOLS) this.toolHealth[t] = { calls: 0, failures: 0, healthScore: 1 };
    this.providerHealth = {
      claude: { calls: 0, failures: 0, healthScore: 1, qualityHistory: 0.8 },
      codex: { calls: 0, failures: 0, healthScore: 1, qualityHistory: 0.78 },
      "local-model": { calls: 0, failures: 0, healthScore: 1, qualityHistory: 0.6 },
      deterministic: { calls: 0, failures: 0, healthScore: 1, qualityHistory: 0.7 },
    };
  }

  get sessionReceipts(): readonly McpSessionReceipt[] {
    return this.receipts;
  }
  get toolCalls(): number {
    return MCP_TOOLS.reduce((s, t) => s + this.toolHealth[t].calls, 0);
  }
  get toolFailures(): number {
    return MCP_TOOLS.reduce((s, t) => s + this.toolHealth[t].failures, 0);
  }
  get grantsIssued(): number {
    return this.grantSeq;
  }
  get grantsRevoked(): number {
    return this.revoked.size;
  }
  get grantsDeniedCount(): number {
    return this.grantsDenied;
  }
  get costCharged(): number {
    return roundTo(this.totalCostCharged, 6);
  }
  get realMcpExecutions(): number {
    return this.realMcpExecs;
  }
  get toolHealthUpdateCount(): number {
    return this.toolHealthUpdates;
  }
  get providerHealthUpdateCount(): number {
    return this.providerHealthUpdates;
  }
  toolHealthSnapshot(): Record<McpToolId, McpToolHealth> {
    return JSON.parse(JSON.stringify(this.toolHealth));
  }
  providerHealthSnapshot(): Record<ProviderName, ProviderHealth> {
    return JSON.parse(JSON.stringify(this.providerHealth));
  }

  /**
   * Grant a scoped tool permit. Powerful tools require `humanApproved`; a grant
   * is refused (counted) if not allowlisted for powerful use without approval or
   * if the aggregate cost budget is exhausted.
   */
  grantTool(input: { toolId: McpToolId; antId: string; taskId: string; districtId: DistrictId; tick: number; ttlTicks: number; humanApproved: boolean }): McpToolGrant | null {
    const desc = MCP_TOOL_REGISTRY[input.toolId];
    if (desc.powerful && !input.humanApproved) {
      this.grantsDenied += 1;
      return null;
    }
    if (this.totalCostCharged >= this.totalCostBudget) {
      this.grantsDenied += 1;
      return null;
    }
    const grant: McpToolGrant = {
      grantId: `mcp-grant-${this.grantSeq++}`,
      toolId: input.toolId,
      antId: input.antId,
      taskId: input.taskId,
      districtId: input.districtId,
      issuedTick: input.tick,
      expiresTick: input.tick + input.ttlTicks,
      humanApproved: input.humanApproved,
      costBudget: desc.costPerCall * 3,
    };
    this.grants.set(grant.grantId, grant);
    this.spendByGrant.set(grant.grantId, 0);
    return grant;
  }

  revokeGrant(grantId: string): void {
    if (this.grants.has(grantId)) this.revoked.add(grantId);
  }

  /**
   * Call a tool under a grant. Validates the grant (owned, not revoked, not
   * expired, ant-scoped, budget), simulates a bounded deterministic result,
   * updates tool health, and mints a session receipt. A failed call is ISOLATED
   * — it degrades only that tool's health, never throws. `provider` is set only
   * for the provider-cognition tool (routed deterministically).
   */
  callTool(input: { grant: McpToolGrant; antId: string; tick: number; taskKind: WorkKind; seed: number; provider?: ProviderName; executor?: McpExecutionDriver }): McpSessionReceipt {
    const { grant } = input;
    const desc = MCP_TOOL_REGISTRY[grant.toolId];
    const mint = (ok: boolean, failureCategory: string | null, costCharged: number, resultValid: boolean, provider: ProviderName | null): McpSessionReceipt => {
      const receipt: McpSessionReceipt = {
        receiptId: `mcp-rcpt-${this.receiptSeq++}`,
        grantId: grant.grantId,
        toolId: grant.toolId,
        antId: input.antId,
        taskId: grant.taskId,
        tick: input.tick,
        ok,
        failureCategory,
        costCharged: roundTo(costCharged, 6),
        resultFingerprint: `fp-${((civDraw(input.seed, this.receiptSeq, grant.toolId.length, 0x2c1b3c6d) * 1e9) | 0).toString(16)}`,
        resultValid,
        provider,
      };
      if (this.receipts.length < 20000) this.receipts.push(receipt);
      return receipt;
    };

    // --- validation gates (no throw; a refusal is a receipt) ---------------
    if (!this.grants.has(grant.grantId)) return mint(false, "invalid-grant", 0, false, null);
    if (this.revoked.has(grant.grantId)) return mint(false, "grant-revoked", 0, false, null);
    if (input.tick > grant.expiresTick) return mint(false, "grant-expired", 0, false, null);
    if (grant.antId !== input.antId) return mint(false, "ant-scope-mismatch", 0, false, null);
    const spent = this.spendByGrant.get(grant.grantId) ?? 0;
    if (spent + desc.costPerCall > grant.costBudget) return mint(false, "grant-budget-exceeded", 0, false, null);
    if (this.totalCostCharged + desc.costPerCall > this.totalCostBudget) return mint(false, "cost-budget-exceeded", 0, false, null);

    // --- deterministic simulated execution + failure isolation -------------
    this.spendByGrant.set(grant.grantId, spent + desc.costPerCall);
    this.totalCostCharged += desc.costPerCall;
    const health = this.toolHealth[grant.toolId];
    health.calls += 1;

    let provider: ProviderName | null = null;
    let failed: boolean;
    let resultValid = true;
    let failureCategory = grant.toolId === "provider-cognition" ? "provider-failure" : "mcp-tool-failure";
    if (grant.toolId === "provider-cognition") {
      provider = input.provider ?? this.routeProvider(input.taskKind, input.seed);
      const ph = this.providerHealth[provider];
      ph.calls += 1;
      failed = civDraw(input.seed, ph.calls, grant.grantId.length, 0x165667b1) < desc.baseFailureRate * (1.4 - ph.healthScore * 0.4);
      if (failed) {
        ph.failures += 1;
        ph.healthScore = clamp(ph.healthScore - 0.08, 0.1, 1);
        ph.qualityHistory = clamp(ph.qualityHistory - 0.03, 0, 1);
      } else {
        ph.healthScore = clamp(ph.healthScore + 0.01, 0, 1);
      }
      this.providerHealthUpdates += 1;
    } else if (input.executor) {
      // Route real (or fake) execution through the injected driver. Only a real
      // driver increments realMcpExecutions; the fake driver keeps it at 0.
      const res = input.executor.execute({ toolId: grant.toolId, antId: input.antId, districtId: grant.districtId, taskId: grant.taskId, tick: input.tick });
      if (input.executor.isReal) this.realMcpExecs += 1;
      failed = !res.ok;
      resultValid = res.resultValid;
      if (res.failureCategory) failureCategory = res.failureCategory;
    } else {
      failed = civDraw(input.seed, health.calls, grant.toolId.length ^ input.tick, 0x27220a95) < desc.baseFailureRate * (1.4 - health.healthScore * 0.4);
    }

    if (failed) {
      health.failures += 1;
      health.healthScore = clamp(health.healthScore - 0.06, 0.1, 1);
      this.toolHealthUpdates += 1;
      return mint(false, failureCategory, desc.costPerCall, false, provider);
    }
    health.healthScore = clamp(health.healthScore + 0.01, 0, 1);
    this.toolHealthUpdates += 1;
    return mint(true, null, desc.costPerCall, resultValid, provider);
  }

  /**
   * Deterministic provider routing: by task type, health, cost, quality history,
   * availability, and prior failures. Never random; a degraded provider is
   * de-preferred. `deterministic` is always available as the safe fallback.
   */
  routeProvider(taskKind: WorkKind, seed: number): ProviderName {
    const candidates: ProviderName[] = taskKind === "ai-agent" || taskKind === "architecture" ? ["claude", "codex", "local-model"] : taskKind === "backend" || taskKind === "database" ? ["codex", "claude", "local-model"] : ["local-model", "claude", "codex"];
    let best: ProviderName = "deterministic";
    let bestScore = 0.5; // deterministic fallback baseline
    for (const p of candidates) {
      const ph = this.providerHealth[p];
      const cost = p === "local-model" ? 0.9 : p === "deterministic" ? 1 : 0.6; // lower cost -> higher score
      const score = ph.healthScore * 0.5 + ph.qualityHistory * 0.3 + cost * 0.2 + civDraw(seed, ph.calls, p.length, 0x9e3779b9) * 0.02;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }
}
