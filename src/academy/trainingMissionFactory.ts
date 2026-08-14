/**
 * Ant Academy V1 — deterministic training-mission factory (Build Law §20).
 *
 * Generates bounded learning, practice, and examination missions for every
 * domain and difficulty, plus multi-domain project missions. Missions VARY
 * deterministically by seed (a variant key selects among fixed scenario
 * templates), so a colony re-run is reproducible while ants cannot simply
 * memorize one fixed answer key across runs.
 *
 * Defensive security only: every security scenario is inspection/remediation
 * (unsafe-input detection, access-control review, secret-leak detection,
 * dependency-risk analysis) — never offensive exploitation or unauthorized
 * access.
 *
 * Pure data + arithmetic. No fs, no process, no network, no wall clock.
 */

import type { AcademyDomain, DifficultyLevel } from "./academyDomains";
import { ACADEMY_DOMAINS, DIFFICULTY_LEVELS, DOMAIN_WORK_CATEGORY } from "./academyDomains";
import type { WorkCategory } from "../colonyMission/workDemand";

export type MissionKind = "learning" | "practice" | "examination" | "project";

export interface TrainingMission {
  readonly missionCode: string;
  readonly domain: AcademyDomain;
  readonly workCategory: WorkCategory;
  readonly kind: MissionKind;
  readonly difficulty: DifficultyLevel;
  readonly variantKey: number;
  readonly scenario: string;
  readonly acceptanceCriteria: readonly string[];
  /** The hidden quality bar a student must reach (0..1) — the evaluator uses it. */
  readonly qualityBar: number;
}

/** Fixed, safe scenario templates per domain. Defensive-only for security. */
const DOMAIN_SCENARIOS: Readonly<Record<AcademyDomain, readonly string[]>> = {
  frontend: ["build-accessible-component", "repair-responsive-layout", "review-state-management", "add-tests"],
  backend: ["design-api", "validate-requests", "handle-errors", "test-concurrency-assumptions"],
  databases: ["design-schema", "optimize-query", "identify-migration-risk", "test-integrity-constraints"],
  mobile: ["build-screen", "handle-offline", "review-navigation", "add-ui-tests"],
  testing: ["write-unit-tests", "create-integration-tests", "detect-weak-assertions", "regression-analysis"],
  debugging: ["reproduce-defect", "isolate-root-cause", "propose-repair", "prove-repair"],
  devops: ["inspect-ci-config", "propose-safe-pipeline", "diagnose-failed-build", "verify-release-evidence"],
  cloud: ["review-resource-plan", "cost-awareness-check", "reliability-review", "config-drift-review"],
  "defensive-security": ["identify-unsafe-input", "review-access-control", "detect-secret-leak", "dependency-risk-analysis"],
  "data-engineering": ["design-pipeline", "validate-data-quality", "handle-schema-evolution", "test-idempotency"],
  "ai-ml": ["design-eval-suite", "detect-data-leakage", "validate-metrics", "review-bias-risk"],
  "agent-engineering": ["design-bounded-prompt", "validate-structured-output", "detect-agent-loop", "enforce-tool-permissions"],
  architecture: ["propose-module-boundary", "review-coupling", "assess-scalability", "document-decision"],
  documentation: ["write-usage-doc", "review-clarity", "add-examples", "check-accuracy"],
  "product-management": ["clarify-requirements", "prioritize-scope", "define-acceptance", "assess-risk"],
  "it-operations": ["write-runbook", "review-monitoring", "diagnose-incident-safely", "verify-recovery"],
  "code-review": ["review-correctness", "review-tests", "review-maintainability", "request-evidence"],
  "security-review": ["review-input-validation", "review-authz", "review-secret-handling", "review-dependencies"],
};

const DIFFICULTY_BAR: Readonly<Record<DifficultyLevel, number>> = {
  intro: 0.45,
  core: 0.6,
  advanced: 0.72,
  mastery: 0.82,
};

function hash(seed: number, a: number, b: number): number {
  return (Math.imul(seed ^ 0x9e3779b9, 2654435761) ^ Math.imul(a + 1, 40503) ^ Math.imul(b + 1, 2246822519)) >>> 0;
}

function pickScenario(domain: AcademyDomain, difficultyIndex: number, seed: number): { scenario: string; variantKey: number } {
  const scenarios = DOMAIN_SCENARIOS[domain];
  const variantKey = hash(seed, ACADEMY_DOMAINS.indexOf(domain), difficultyIndex) % scenarios.length;
  return { scenario: scenarios[variantKey], variantKey };
}

/** All learning + practice + examination missions for one domain. */
export function generateDomainMissions(domain: AcademyDomain, seed: number): readonly TrainingMission[] {
  const missions: TrainingMission[] = [];
  const workCategory = DOMAIN_WORK_CATEGORY[domain];
  DIFFICULTY_LEVELS.forEach((difficulty, i) => {
    const { scenario, variantKey } = pickScenario(domain, i, seed);
    const bar = DIFFICULTY_BAR[difficulty];
    const kinds: MissionKind[] = ["learning", "practice", "examination"];
    for (const kind of kinds) {
      missions.push({
        missionCode: `${domain}-${difficulty}-${kind}-${variantKey}`,
        domain,
        workCategory,
        kind,
        difficulty,
        variantKey,
        scenario,
        acceptanceCriteria: [`Complete ${scenario} at ${difficulty} level`, "Provide reasoning evidence"],
        qualityBar: kind === "examination" ? bar : Math.max(0.3, bar - 0.15),
      });
    }
  });
  return missions;
}

export interface ProjectSpec {
  readonly projectCode: string;
  readonly title: string;
  readonly requiredDomains: readonly AcademyDomain[];
  readonly requiredWorkCategories: readonly WorkCategory[];
  readonly acceptanceCriteria: readonly string[];
}

const PROJECT_TEMPLATES: ReadonlyArray<{ readonly title: string; readonly domains: readonly AcademyDomain[] }> = [
  { title: "full-stack-task-manager", domains: ["frontend", "backend", "databases", "testing"] },
  { title: "rest-api-and-database", domains: ["backend", "databases", "testing", "documentation"] },
  { title: "monitoring-dashboard", domains: ["frontend", "it-operations", "testing"] },
  { title: "secure-login-design", domains: ["backend", "defensive-security", "security-review", "testing"] },
  { title: "data-processing-pipeline", domains: ["data-engineering", "backend", "testing"] },
  { title: "agent-workflow-with-safety", domains: ["agent-engineering", "defensive-security", "documentation"] },
];

/** One deterministic multi-domain project (varies by seed). */
export function generateProjectMission(seed: number): ProjectSpec {
  const template = PROJECT_TEMPLATES[hash(seed, 7, 13) % PROJECT_TEMPLATES.length];
  return {
    projectCode: `project-${template.title}-${seed % 997}`,
    title: template.title,
    requiredDomains: template.domains,
    requiredWorkCategories: template.domains.map((d) => DOMAIN_WORK_CATEGORY[d]),
    acceptanceCriteria: ["Delivers each required domain portion", "Passes review and verification", "Provides evidence"],
  };
}
