/**
 * Namla Digital Civilization OS V1 — shared settlement types (Build Law §27).
 *
 * The civilization is a persistent digital ant settlement: Tamara is the
 * sovereign strategic intelligence, Namla is the decentralized workforce, and
 * Claude/Codex/local-models/MCP-tools are TEMPORARY bounded cognitive/execution
 * resources used by individual ants. This layer sits ON TOP of the proven
 * `DigitalResourceEconomy`, `createDigitalWorker` persistence, the Tamara
 * federation authority record, the academy, and the provider boundaries — it
 * reuses them, never duplicating them.
 *
 * Everything here is deterministic and bounded: no fs, no child_process, no
 * network, no wall clock, no ambient randomness (all draws go through the seeded
 * `digitalDraw`). Real providers/tools stay at zero in automated runs.
 */

import { digitalDraw } from "../digital/digitalTypes";

/** The twenty districts of the settlement — each is real local state, not a label. */
export const DISTRICTS = [
  "queen-continuity",
  "academy",
  "research",
  "architecture-council",
  "software-engineering",
  "frontend-guild",
  "backend-guild",
  "database-guild",
  "ai-agent-engineering",
  "testing-quality",
  "debugging-repair",
  "defensive-security",
  "devops-infrastructure",
  "knowledge-memory",
  "tool-mcp",
  "provider-compute",
  "operations-command",
  "waste-recycling",
  "reserve-worker",
  "brood-development",
] as const;
export type DistrictId = (typeof DISTRICTS)[number];

/** The kind of work a district publishes as demand. */
export type WorkKind =
  | "research"
  | "architecture"
  | "frontend"
  | "backend"
  | "database"
  | "ai-agent"
  | "testing"
  | "debugging"
  | "security"
  | "devops"
  | "documentation"
  | "review"
  | "repair"
  | "knowledge"
  | "mcp-tooling"
  | "provider-orchestration"
  | "training";

/** Academy domains — the national training system (22). */
export const ACADEMY_DOMAINS = [
  "frontend",
  "backend",
  "databases",
  "mobile",
  "testing",
  "debugging",
  "devops",
  "cloud",
  "it-operations",
  "defensive-security",
  "data-engineering",
  "ai-ml",
  "agent-engineering",
  "architecture",
  "documentation",
  "product-management",
  "code-review",
  "security-review",
  "mcp-engineering",
  "provider-orchestration",
  "computer-automation",
  "research",
] as const;
export type AcademyDomain = (typeof ACADEMY_DOMAINS)[number];

/** Academy levels — trainee → master, evidence-gated at every step. */
export const ACADEMY_LEVELS = ["trainee", "junior", "worker", "specialist", "senior", "mentor", "master"] as const;
export type AcademyLevel = (typeof ACADEMY_LEVELS)[number];

export function academyLevelRank(level: AcademyLevel): number {
  return ACADEMY_LEVELS.indexOf(level);
}

/** Decentralized councils — evidence-based, bounded-term, never a global planner. */
export const COUNCILS = ["architecture", "security", "quality", "academy", "tool-permission", "incident", "knowledge-validation"] as const;
export type CouncilKind = (typeof COUNCILS)[number];

/** MCP tool kinds the nervous system can expose (no ant gets all of them). */
export const MCP_TOOLS = [
  "repo-inspection",
  "bounded-file-read",
  "workspace-file-create",
  "project-analysis",
  "typecheck",
  "tests",
  "build",
  "documentation",
  "code-search",
  "knowledge-retrieval",
  "provider-cognition",
] as const;
export type McpToolId = (typeof MCP_TOOLS)[number];

/** MCP tools considered POWERFUL — require human approval before grant. */
export const POWERFUL_MCP_TOOLS: readonly McpToolId[] = ["workspace-file-create", "build", "provider-cognition"];

export type ProviderName = "claude" | "codex" | "local-model" | "deterministic";

export type KnowledgeState = "raw" | "scouted" | "verified" | "challenged" | "accepted" | "revalidated" | "retired";

export type FailureKind =
  | "compiler-error"
  | "test-failure"
  | "hallucination"
  | "rejected-proposal"
  | "security-finding"
  | "provider-failure"
  | "duplicate-work"
  | "stale-knowledge"
  | "technical-debt"
  | "invalid-artifact"
  | "mcp-failure";

/** Global caps (reused from the digital layer's guarantees). */
export const GLOBAL_COGNITIVE_MAX = 30 as const;
export const INITIAL_REAL_PROVIDER_MAX = 5 as const;

/** Deterministic settlement draw (reuses the house seed-mix). */
export function civDraw(seed: number, a: number, b: number, salt: number): number {
  return digitalDraw(seed, a, b, salt);
}

/** The work kind an academy domain most directly serves. */
export function domainWorkKind(domain: AcademyDomain): WorkKind {
  switch (domain) {
    case "frontend":
      return "frontend";
    case "backend":
    case "cloud":
    case "it-operations":
      return "backend";
    case "databases":
    case "data-engineering":
      return "database";
    case "testing":
      return "testing";
    case "debugging":
      return "debugging";
    case "devops":
      return "devops";
    case "defensive-security":
    case "security-review":
      return "security";
    case "ai-ml":
    case "agent-engineering":
      return "ai-agent";
    case "architecture":
      return "architecture";
    case "documentation":
      return "documentation";
    case "code-review":
      return "review";
    case "mcp-engineering":
      return "mcp-tooling";
    case "provider-orchestration":
      return "provider-orchestration";
    default:
      return "research";
  }
}
