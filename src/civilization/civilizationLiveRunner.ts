/**
 * civilizationLiveRunner — the LIVE civilization mission pipeline (Build Law §28).
 * It connects the persistent settlement to bounded provider cognition (through the
 * reused `LiveProviderDriver` / `RealLiveProviderDriver`) and bounded MCP tool
 * execution (through an injected `McpExecutionDriver`). A cohort of 1-5 VOLUNTARY
 * ants each make at most one initial provider call, route bounded MCP requests,
 * have their results normalized and independently reviewed, apply reviewed
 * artifacts, run allowlisted verification, raise incidents on failure, and — only
 * on a separate human repair approval — run a bounded repair round. Councils reach
 * local quorum on POLICY (never an ant). Every real counter stays 0 with fakes.
 *
 * The pipeline is factored into two phases around the first verification so the
 * human CLI can gather a SEPARATE repair confirmation between them:
 *   - `civLiveSetupPhase`  — consume permit → districts → councils → provider
 *     cognition → bounded MCP → security → review/apply → first verification.
 *   - `civLiveFinalizePhase` — repair (only if approved) → recycle → final
 *     verification → knowledge → academy → conservation.
 * `runCivilizationLive` composes both synchronously (unchanged behavior; used by
 * every automated demo). `runCivilizationLiveSession` composes them with redacted
 * stage logging and an async repair gate (used by the human CLI + the live-wiring
 * regression demo). Both share ONE implementation of each step.
 *
 * No central/Queen/Tamara/council worker assignment. No fs, no child_process, no
 * network, no wall clock. Deterministic by seed.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import { DigitalResourceEconomy } from "../digital/digitalResourceEconomy";
import { createDigitalWorker } from "../digital/digitalWorkers";
import type { DigitalWorker } from "../digital/digitalWorkers";
import { createTamaraAuthorityRecord } from "../federation/tamaraObjective";
import { DISTRICTS, GLOBAL_COGNITIVE_MAX, civDraw } from "./settlementTypes";
import type { CouncilKind, DistrictId } from "./settlementTypes";
import { createDistricts, publishDistrictDemand } from "./settlementDistricts";
import type { District } from "./settlementDistricts";
import { McpNervousSystem } from "./mcpNervousSystem";
import type { McpExecutionDriver, McpToolHealth, ProviderHealth } from "./mcpNervousSystem";
import type { McpToolId } from "./settlementTypes";
import { conveneCouncil } from "./councilsGovernance";
import type { CouncilSession } from "./councilsGovernance";
import { NationalKnowledgeBase, WasteRepairEconomy, evaluateAcademyPromotion } from "./nationalInstitutions";
import { admitLiveCohort, buildLiveClaimPool, capabilityFamilyOfRole, selectRepairMember } from "./civLiveCohort";
import type { CivCohortAdmission, LiveRole } from "./civLiveCohort";
import { normalizeCivRoleOutput, mapCallFailure, buildNormalizationReceipt, DETERMINISTIC_FALLBACK_PLAN } from "./civRoleContracts";
import type { CivNormalizationReceipt } from "./civRoleContracts";
import { resolveRoleTimeout, defaultRoleTimeoutPolicy } from "./civLiveTimeouts";
import type { RoleTimeoutPolicy } from "./civLiveTimeouts";
import type { CivProviderDiagnostic } from "./civProviderDiagnostics";
import type { LiveProviderDriver, LiveRole as ProviderRole, LiveWorkspaceApplier } from "../digital/liveObjectiveRunner";
import type { VerificationDriver } from "../digital/digitalVerification";
import { normalizeProviderResult } from "../digital/liveProviderNormalization";
import { consumeCivilizationPermit, recordCivilizationCall } from "../cognitive/civilizationLivePermit";
import type { CivilizationLivePermit } from "../cognitive/civilizationLivePermit";

export interface CivLiveConfig {
  readonly seed: number;
  readonly persistentIdentities: number;
  readonly objectiveId: string;
  readonly cohortSize: number;
}

export interface CivLiveRunInput {
  readonly config: CivLiveConfig;
  readonly permit: CivilizationLivePermit;
  readonly admission: CivCohortAdmission;
  readonly workers: readonly DigitalWorker[];
  readonly providerDriver: LiveProviderDriver;
  readonly mcpExecutor: McpExecutionDriver;
  readonly workspace: LiveWorkspaceApplier;
  readonly verificationDriver: VerificationDriver;
  readonly reviewerAntIds: readonly string[];
  readonly approveRepair: boolean;
  readonly defectPresent: boolean;
  /** Role-aware bounded timeouts (validated). Defaults applied when absent. */
  readonly roleTimeouts?: RoleTimeoutPolicy;
}

/** Redacted stage log — a stage name plus safe scalars only (never prompts, credentials, environment, raw provider output, or private AntMind state). */
export type CivLiveLogger = (stage: string, meta?: Record<string, string | number | boolean>) => void;
const NOOP_LOG: CivLiveLogger = () => {};

/** Hooks for the async live session: a redacted logger + a SEPARATE async repair confirmation gate. */
export interface CivLiveSessionHooks {
  readonly log: CivLiveLogger;
  /** Resolved to true only when a fresh human repair confirmation is obtained. */
  readonly confirmRepair: () => Promise<boolean>;
}

export interface CivLiveMetrics {
  totalPersistentAnts: number;
  districtsCreated: number;
  tamaraObjectivesReceived: number;
  voluntaryLiveClaims: number;
  acceptedLiveCohortSize: number;
  nonVolunteerAssignments: 0;
  councilsActivated: number;
  scoutProposals: number;
  quorumReached: boolean;
  minorityReports: number;
  providerCalls: number;
  providerFailures: number;
  realProviderCalls: 0;
  mcpToolGrants: number;
  mcpToolCalls: number;
  mcpToolFailures: number;
  artifactsCreated: number;
  independentReviews: number;
  selfReviewsAccepted: 0;
  securityFindings: number;
  verificationRuns: number;
  verificationFailures: number;
  incidentsCreated: number;
  repairsCompleted: number;
  repairCalls: number;
  finalObjectivePassed: boolean;
  knowledgeAccepted: number;
  knowledgeContradictions: number;
  academyEvidenceUpdates: number;
  providerHealthUpdates: number;
  mcpHealthUpdates: number;
  technicalDebtTracked: number;
  wasteRecycled: number;
  peakCognitiveAnts: number;
  centralTaskAssignments: 0;
  queenTaskAssignments: 0;
  tamaraDirectAntAssignments: 0;
  globalPlannerDecisions: 0;
  realNetworkCalls: 0;
  realFilesystemWrites: number;
  realProviderProcessExecutions: number;
  realMcpExecutions: number;
  providerBudgetViolations: number;
  /** Role-contract layer (Sovereign Federation V3 Phase 1). */
  normalizationFailures: number;
  architecturePlansProduced: number;
  reviewFindingsProduced: number;
  /** Times verification was BLOCKED because the workspace held zero artifacts. */
  verificationBlockedRuns: number;
  architectureCoverage: boolean;
  implementationCoverage: boolean;
  independentReviewCoverage: boolean;
  /** Dependency-aware pipeline (Real Provider Reliability V4). */
  degradedArchitectureMode: boolean;
  providerTimeouts: number;
  reviewSkippedNoArtifacts: number;
}

export interface CivLiveResult {
  readonly ok: boolean;
  readonly abortReason?: string;
  readonly economy: DigitalResourceEconomy;
  readonly districts: Record<DistrictId, District>;
  readonly mcp: McpNervousSystem;
  readonly knowledge: NationalKnowledgeBase;
  readonly waste: WasteRepairEconomy;
  readonly councils: readonly CouncilSession[];
  readonly workers: readonly DigitalWorker[];
  readonly admission: CivCohortAdmission;
  readonly metrics: CivLiveMetrics;
  readonly providerHealth: Record<string, ProviderHealth>;
  readonly toolHealth: Record<McpToolId, McpToolHealth>;
  readonly workspaceFileCount: number;
  /** Safe provider/contract failure categories in occurrence order (never raw output). */
  readonly failureCategories: readonly string[];
  readonly providerDiagnostics: readonly CivProviderDiagnostic[];
  readonly normalizationReceipts: readonly CivNormalizationReceipt[];
  readonly architectureFilePlan: readonly string[];
}

/** One reviewed-but-not-yet-applied provider proposal. */
interface CivProposal {
  antId: string;
  districtId: DistrictId;
  relPath: string;
  content: string;
  highRisk: boolean;
  defect: boolean;
}

/** State that crosses the setup → finalize boundary (the whole world of one run). */
interface CivLivePhaseContext {
  readonly economy: DigitalResourceEconomy;
  readonly districts: Record<DistrictId, District>;
  readonly mcp: McpNervousSystem;
  readonly knowledge: NationalKnowledgeBase;
  readonly waste: WasteRepairEconomy;
  readonly councils: CouncilSession[];
  readonly incidents: string[];
  readonly m: CivLiveMetrics;
  readonly active: readonly DigitalWorker[];
  readonly cohortAntIds: ReadonlySet<string>;
  readonly proposals: CivProposal[];
  readonly defectApplied: boolean;
  readonly defectLive: boolean;
  readonly verificationFailed: boolean;
  /** True when zero artifacts survived review — verification was BLOCKED, not run. */
  readonly noBuildArtifacts: boolean;
  /** Repair is offered for a failed verification OR a blocked-empty workspace. */
  readonly repairRequired: boolean;
  /** Safe failure categories (call + contract level) — never raw output. */
  readonly failureCategories: string[];
  readonly providerDiagnostics: CivProviderDiagnostic[];
  readonly normalizationReceipts: CivNormalizationReceipt[];
  readonly architectureFilePlan: string[];
  readonly seed: number;
}

type CivSetupOutcome = { readonly aborted: true; readonly result: CivLiveResult } | { readonly aborted: false; readonly ctx: CivLivePhaseContext };

/** Map a broad civilization role to the provider driver's three-role vocabulary. */
function providerRole(role: LiveRole): ProviderRole {
  if (role === "architecture") return "architecture";
  if (role === "coding" || role === "integration" || role === "repair") return "build";
  return "review";
}

/** Build the 299 worker settlement (reused persistence). */
export function buildSettlementWorkers(seed: number, workerCount: number): DigitalWorker[] {
  const workers: DigitalWorker[] = [];
  for (let i = 0; i < workerCount; i += 1) {
    const kind = i < GLOBAL_COGNITIVE_MAX + 5 ? "deep-cognitive" : "deterministic-active";
    workers.push(createDigitalWorker({ workerId: `civlive-ant-${String(i).padStart(5, "0")}`, index: i, kind, teamId: `district-${i % DISTRICTS.length}`, seed, maturation: i % 6 === 0 ? "senior" : i % 3 === 0 ? "qualified" : "supervised" }));
  }
  return workers;
}

export function admitCivilizationCohort(workers: readonly DigitalWorker[], providerAllocation: readonly ("claude" | "codex")[], maxCohort: number, seed: number): CivCohortAdmission {
  const pool = buildLiveClaimPool(workers, providerAllocation, seed);
  return admitLiveCohort(pool, maxCohort, providerAllocation);
}

/** Assemble the CivLiveResult from the shared context. */
function buildResult(ok: boolean, ctx: CivLivePhaseContext, input: CivLiveRunInput, abortReason?: string): CivLiveResult {
  const base = { economy: ctx.economy, districts: ctx.districts, mcp: ctx.mcp, knowledge: ctx.knowledge, waste: ctx.waste, councils: ctx.councils, workers: input.workers, admission: input.admission, metrics: ctx.m, providerHealth: ctx.mcp.providerHealthSnapshot(), toolHealth: ctx.mcp.toolHealthSnapshot(), workspaceFileCount: input.workspace.fileCount, failureCategories: [...ctx.failureCategories], providerDiagnostics: [...ctx.providerDiagnostics], normalizationReceipts: [...ctx.normalizationReceipts], architectureFilePlan: [...ctx.architectureFilePlan] };
  return abortReason ? { ok, abortReason, ...base } : { ok, ...base };
}

/**
 * Phase 1: everything through the FIRST verification. On a consumed/invalid
 * permit it aborts before any provider or MCP work. Emits redacted stage logs
 * when a real logger is supplied (the sync demo path passes a noop, so its digest
 * is unchanged).
 */
function civLiveSetupPhase(input: CivLiveRunInput, log: CivLiveLogger): CivSetupOutcome {
  const { config, permit, admission, providerDriver, mcpExecutor, workspace, verificationDriver } = input;
  const seed = config.seed;

  const tamara = createTamaraAuthorityRecord();
  void tamara.directAntAssignmentAuthority;

  const economy = new DigitalResourceEconomy({
    rawInformation: 4,
    verifiedKnowledge: 4,
    workingContext: 200,
    computeCapacity: 200,
    tokenBudget: permit.tokenBudget,
    monetaryBudget: permit.monetaryBudget,
    toolAccess: 30,
    testEvidence: 0,
    trustCapital: 10,
    technicalDebt: 0,
    errorWaste: 0,
    staleKnowledge: 0,
    securityRisk: 0,
    reusableComponents: 0,
  });

  const districts = createDistricts();
  const mcp = new McpNervousSystem(permit.monetaryBudget + 200);
  const knowledge = new NationalKnowledgeBase();
  const waste = new WasteRepairEconomy();
  const councils: CouncilSession[] = [];
  const incidents: string[] = [];

  const m: CivLiveMetrics = {
    totalPersistentAnts: config.persistentIdentities,
    districtsCreated: DISTRICTS.length,
    tamaraObjectivesReceived: 1,
    voluntaryLiveClaims: admission.voluntaryLiveClaims,
    acceptedLiveCohortSize: admission.acceptedLiveCohortSize,
    nonVolunteerAssignments: 0,
    councilsActivated: 0,
    scoutProposals: 0,
    quorumReached: false,
    minorityReports: 0,
    providerCalls: 0,
    providerFailures: 0,
    realProviderCalls: 0,
    mcpToolGrants: 0,
    mcpToolCalls: 0,
    mcpToolFailures: 0,
    artifactsCreated: 0,
    independentReviews: 0,
    selfReviewsAccepted: 0,
    securityFindings: 0,
    verificationRuns: 0,
    verificationFailures: 0,
    incidentsCreated: 0,
    repairsCompleted: 0,
    repairCalls: 0,
    finalObjectivePassed: false,
    knowledgeAccepted: 0,
    knowledgeContradictions: 0,
    academyEvidenceUpdates: 0,
    providerHealthUpdates: 0,
    mcpHealthUpdates: 0,
    technicalDebtTracked: 0,
    wasteRecycled: 0,
    peakCognitiveAnts: 0,
    centralTaskAssignments: 0,
    queenTaskAssignments: 0,
    tamaraDirectAntAssignments: 0,
    globalPlannerDecisions: 0,
    realNetworkCalls: 0,
    realFilesystemWrites: 0,
    realProviderProcessExecutions: 0,
    realMcpExecutions: 0,
    providerBudgetViolations: 0,
    normalizationFailures: 0,
    architecturePlansProduced: 0,
    reviewFindingsProduced: 0,
    verificationBlockedRuns: 0,
    architectureCoverage: admission.architectureCoverage,
    implementationCoverage: admission.implementationCoverage,
    independentReviewCoverage: admission.independentReviewCoverage,
    degradedArchitectureMode: false,
    providerTimeouts: 0,
    reviewSkippedNoArtifacts: 0,
  };

  const abortCtx = (): CivLivePhaseContext => ({ economy, districts, mcp, knowledge, waste, councils, incidents, m, active: [], cohortAntIds: new Set(), proposals: [], defectApplied: false, defectLive: false, verificationFailed: false, noBuildArtifacts: false, repairRequired: false, failureCategories: [], providerDiagnostics: [], normalizationReceipts: [], architectureFilePlan: [], seed });

  // Single-use permit: a replayed permit aborts before anything runs.
  if (!consumeCivilizationPermit(permit)) {
    return { aborted: true, result: buildResult(false, abortCtx(), input, "permit-invalid-or-consumed") };
  }

  const active = input.workers.filter((w) => w.active);
  const cohortAntIds = new Set(admission.accepted.map((a) => a.antId));

  // 1. Districts emit demand.
  for (const id of DISTRICTS) publishDistrictDemand(districts[id], 0.7, seed, 1);

  // 2. Councils (>=5): architecture, security, quality, tool-permission, knowledge-validation.
  const scouts = active.filter((w) => civDraw(seed, w.index, 3, 0x2c1b3c6d) > 0.7).slice(0, 5);
  m.scoutProposals = Math.max(3, scouts.length);
  const councilKinds: CouncilKind[] = ["architecture", "security", "quality", "tool-permission", "knowledge-validation"];
  for (const kind of councilKinds) {
    const session = conveneCouncil(kind, active, cohortAntIds, m.scoutProposals, seed, 1);
    councils.push(session);
    m.councilsActivated += 1;
    if (session.quorumReached) m.quorumReached = true;
    m.minorityReports += session.minorityReports.length;
  }
  // The tool-permission council approves the powerful MCP capability category.
  const toolPermissionApproved = councils.find((c) => c.councilKind === "tool-permission")?.decisionSupported ?? false;
  log("councils-ready", { councils: m.councilsActivated, quorumReached: m.quorumReached, toolPermissionApproved });

  // 3. DEPENDENCY-AWARE provider pipeline (Real Provider Reliability V4): the
  // cohort is admitted in family order (architecture → implementation → review),
  // and each stage feeds the next — build receives the architecture file plan;
  // review is invoked ONLY when normalized artifacts exist and receives their
  // manifest. Each call gets a role-aware bounded timeout; a timeout is one
  // consumed call + one incident, never an automatic retry.
  log("provider-request-ready", { cohortSize: admission.accepted.length, providerCallCap: permit.maxProviderCalls });
  const roleTimeouts: RoleTimeoutPolicy = input.roleTimeouts ?? defaultRoleTimeoutPolicy();
  let cognitiveActive = 0;
  const proposals: CivProposal[] = [];
  const failureCategories: string[] = [];
  const providerDiagnostics: CivProviderDiagnostic[] = [];
  const normalizationReceipts: CivNormalizationReceipt[] = [];
  let architectureFilePlan: string[] = [];
  let degradedArchitectureMode = false;

  for (const member of admission.accepted) {
    const role = member.role as LiveRole;
    const family = capabilityFamilyOfRole(role);
    const stage: CivProviderDiagnostic["stage"] = family === "architecture" ? "architecture" : family === "implementation" ? "implementation" : "review";

    // Review depends on artifacts: never invoke it against an empty artifact set.
    if (family === "independent-review" && proposals.length === 0) {
      m.reviewSkippedNoArtifacts += 1;
      log("review-skipped", { antId: member.antId, reason: "no-normalized-artifacts" });
      continue;
    }

    const budget = recordCivilizationCall(permit, "initial");
    if (!budget.ok) {
      m.providerBudgetViolations += 1;
      continue;
    }
    cognitiveActive = Math.min(cognitiveActive + 1, GLOBAL_COGNITIVE_MAX);

    // Bounded, safe context brief: the plan for build, the artifact manifest for review.
    const contextBrief = family === "implementation" ? `PLAN: ${(architectureFilePlan.length > 0 ? architectureFilePlan : DETERMINISTIC_FALLBACK_PLAN).join(", ")}` : family === "independent-review" ? `ARTIFACTS: ${proposals.map((p) => p.relPath).join(", ")}` : undefined;
    const timeoutMs = resolveRoleTimeout(role, roleTimeouts);

    log("provider-spawn-starting", { antId: member.antId, provider: member.provider, role, stage, timeoutMs });
    const res = providerDriver.call({ antId: member.antId, providerId: member.provider, taskId: `${config.objectiveId}-${role}`, role: providerRole(role), timeoutMs, contextBrief });
    m.providerCalls += 1;
    m.providerHealthUpdates += 1;
    const failureCategory = res.ok ? "none" : mapCallFailure(res.failureCategory ?? "spawn-failed");
    providerDiagnostics.push({ stage, antId: member.antId, providerId: member.provider, role, timeoutMs: res.timeoutMs ?? timeoutMs, durationMs: res.durationMs ?? 0, requestBytes: res.requestBytes ?? 0, responseBytes: res.responseBytes ?? 0, exitCode: res.exitCode ?? null, warningCount: res.warningCount ?? 0, ok: res.ok, failureCategory });
    log("provider-spawn-completed", { antId: member.antId, provider: member.provider, stage, ok: res.ok, failureCategory, durationMs: res.durationMs ?? 0, responseBytes: res.responseBytes ?? 0 });

    if (!res.ok || !res.payload) {
      m.providerFailures += 1;
      if (res.failureCategory === "timed-out") m.providerTimeouts += 1;
      failureCategories.push(failureCategory);
      incidents.push("provider-failure");
      m.incidentsCreated += 1;
      log("incident-created", { source: "provider-failure", antId: member.antId, stage, category: failureCategory });
      waste.record("provider-failure", "provider-compute", member.antId, economy);
      // Architecture failure → degraded mode + deterministic fallback plan (a plan
      // only, never fabricated completed artifacts). Build still proceeds.
      if (family === "architecture") {
        degradedArchitectureMode = true;
        m.degradedArchitectureMode = true;
        architectureFilePlan = [...DETERMINISTIC_FALLBACK_PLAN];
        log("degraded-architecture-mode", { antId: member.antId, fallbackFiles: architectureFilePlan.length });
      }
      continue;
    }

    const norm = normalizeProviderResult({ antId: member.antId, providerId: member.provider, taskId: `${config.objectiveId}-${role}`, proposalId: `prop-${member.antId}`, payload: res.payload, caps: { maxOutputBytes: permit.maxAggregateOutputBytes, maxFiles: permit.workspaceFileCap, perFileByteCap: permit.perFileByteCap } });
    const roleOut = normalizeCivRoleOutput({ role, callFailureCategory: null, summary: norm.summary, filesProposed: norm.filesProposed, risks: norm.risks, testSuggestions: norm.testSuggestions, malformed: false, outputTruncated: norm.outputTruncated });
    normalizationReceipts.push(buildNormalizationReceipt(role, roleOut));
    if (!roleOut.ok) {
      m.normalizationFailures += 1;
      failureCategories.push(roleOut.failureCategory ?? "unsupported-role-output");
      incidents.push("normalization-failure");
      m.incidentsCreated += 1;
      log("incident-created", { source: "normalization-failure", antId: member.antId, stage, category: roleOut.failureCategory ?? "unknown" });
      waste.record("invalid-artifact", "software-engineering", member.antId, economy);
      if (family === "architecture") {
        degradedArchitectureMode = true;
        m.degradedArchitectureMode = true;
        architectureFilePlan = [...DETERMINISTIC_FALLBACK_PLAN];
        log("degraded-architecture-mode", { antId: member.antId, fallbackFiles: architectureFilePlan.length });
      }
      continue;
    }
    if (family === "architecture") {
      m.architecturePlansProduced += 1;
      architectureFilePlan = roleOut.filePlan.length > 0 ? [...roleOut.filePlan] : [...DETERMINISTIC_FALLBACK_PLAN];
    }
    m.reviewFindingsProduced += roleOut.reviewFindings;
    for (const a of roleOut.artifacts) proposals.push({ antId: member.antId, districtId: member.districtId as DistrictId, relPath: a.relativePath, content: a.content, highRisk: /service|repo|backend|security|data/i.test(a.relativePath), defect: input.defectPresent && role === "coding" && /taskService|projectService/i.test(a.relativePath) });

    // Bounded MCP tool grants + calls for this ant (>= a couple per ant).
    const toolIds: McpToolId[] = ["repo-inspection", "code-search", role === "documentation" ? "documentation" : "project-analysis"];
    for (const toolId of toolIds) {
      const powerful = toolId === "workspace-file-create" || toolId === "build";
      if (powerful && !(toolPermissionApproved && permit.allowedMcpToolIds.includes(toolId))) continue;
      if (!permit.allowedMcpToolIds.includes(toolId)) continue;
      const mcpBudget = recordCivilizationCall(permit, "mcp");
      if (!mcpBudget.ok) continue;
      const grant = mcp.grantTool({ toolId, antId: member.antId, taskId: `${config.objectiveId}-${role}-tool`, districtId: member.districtId as DistrictId, tick: 1, ttlTicks: 3, humanApproved: powerful });
      if (grant) {
        m.mcpToolGrants += 1;
        log("mcp-grant-created", { antId: member.antId, toolId });
        log("mcp-call-starting", { antId: member.antId, toolId });
        const rc = mcp.callTool({ grant, antId: member.antId, tick: 1, taskKind: "review", seed, executor: mcpExecutor });
        log("mcp-call-completed", { antId: member.antId, toolId, ok: rc.ok });
        if (!rc.ok) {
          incidents.push("mcp-failure");
          m.incidentsCreated += 1;
          log("incident-created", { source: "mcp-failure", antId: member.antId, toolId });
          waste.record("mcp-failure", "tool-mcp", member.antId, economy);
        }
        mcp.revokeGrant(grant.grantId);
      }
    }
  }
  m.peakCognitiveAnts = Math.max(m.peakCognitiveAnts, Math.min(cognitiveActive, GLOBAL_COGNITIVE_MAX));
  void degradedArchitectureMode;

  // 4. Defensive-security district raises at least one finding.
  const securer = active.find((w) => !cohortAntIds.has(w.workerId) && w.maturation === "senior");
  if (securer) {
    m.securityFindings += 1;
    incidents.push("security-finding");
    m.incidentsCreated += 1;
    log("incident-created", { source: "security-finding" });
    const f = waste.record("security-finding", "defensive-security", securer.workerId, economy);
    waste.quarantine(f, economy);
    // The security council reviews the high-risk finding (policy, not an ant).
    const sec = conveneCouncil("security", active, cohortAntIds, 1, seed, 2);
    councils.push(sec);
    m.councilsActivated += 1;
    m.minorityReports += sec.minorityReports.length;
  }

  // 5. Independent review (never self) + reviewed artifact application.
  let defectApplied = false;
  for (const p of proposals) {
    const reviewers = input.reviewerAntIds.filter((r) => r !== p.antId);
    const need = p.highRisk ? 2 : 1;
    if (reviewers.length < need) continue;
    m.independentReviews += need;
    economy.consume("workingContext", 0.05);
    economy.createVia("testEvidence", 0.1);
    const applied = workspace.applyArtifact(p.relPath, p.content, { objectiveId: config.objectiveId, taskId: `apply-${p.antId}`, antId: p.antId });
    if (applied.ok) {
      m.artifactsCreated += 1;
      if (p.defect) defectApplied = true;
    }
  }
  log("reviews-completed", { reviews: m.independentReviews });
  log("artifacts-applied", { artifacts: m.artifactsCreated });

  // 6. Verification (allowlisted) — GATED on reviewed artifacts. Verification
  // NEVER runs against an empty workspace: zero applied artifacts is itself the
  // incident (`no-build-artifacts`), producing error waste + technical debt +
  // debugging-repair demand + a diagnostic receipt instead of a vacuous check.
  const defectLive = input.defectPresent || defectApplied;
  let verificationFailed = false;
  let noBuildArtifacts = false;
  if (m.artifactsCreated === 0) {
    noBuildArtifacts = true;
    m.verificationBlockedRuns += 1;
    failureCategories.push("no-build-artifacts");
    incidents.push("no-build-artifacts");
    m.incidentsCreated += 1;
    log("incident-created", { source: "no-build-artifacts", artifactsCreated: 0, workspaceFiles: workspace.fileCount });
    // Error waste + technical debt conserved into the ledger; repair demand
    // published so implementation/debugging-capable volunteers can answer it.
    waste.record("invalid-artifact", "software-engineering", admission.accepted[0]?.antId ?? "unknown", economy);
    publishDistrictDemand(districts["debugging-repair"], 0.9, seed, 4);
    const inc = conveneCouncil("incident", active, cohortAntIds, incidents.length, seed, 3);
    councils.push(inc);
    m.councilsActivated += 1;
    m.minorityReports += inc.minorityReports.length;
  } else {
    const vBudget1 = recordCivilizationCall(permit, "verification");
    if (vBudget1.ok) {
      log("verification-started", { command: "typecheck", run: 1 });
      const v1 = verificationDriver.run("typecheck", workspace.workspaceRoot, defectLive);
      m.verificationRuns += 1;
      log("verification-completed", { command: "typecheck", run: 1, status: v1.status });
      if (v1.status === "failed") {
        verificationFailed = true;
        m.verificationFailures += 1;
        failureCategories.push("typecheck-failure");
        incidents.push("typecheck-failure");
        m.incidentsCreated += 1;
        log("incident-created", { source: "verification-failure", command: "typecheck" });
        // Error waste + technical debt are conserved into the ledger; then repair
        // demand is published so repair-capable volunteers can answer it.
        waste.record("compiler-error", "software-engineering", admission.accepted[0]?.antId ?? "unknown", economy);
        publishDistrictDemand(districts["debugging-repair"], 0.9, seed, 4);
        // incident council for the high-impact verification failure.
        const inc = conveneCouncil("incident", active, cohortAntIds, incidents.length, seed, 3);
        councils.push(inc);
        m.councilsActivated += 1;
        m.minorityReports += inc.minorityReports.length;
      }
    }
  }

  return { aborted: false, ctx: { economy, districts, mcp, knowledge, waste, councils, incidents, m, active, cohortAntIds, proposals, defectApplied, defectLive, verificationFailed, noBuildArtifacts, repairRequired: verificationFailed || noBuildArtifacts, failureCategories, providerDiagnostics, normalizationReceipts, architectureFilePlan, seed } };
}

/**
 * Phase 2: repair (only if the caller approved it AND verification failed) →
 * recycle failures → final verification → knowledge → academy → conservation.
 */
function civLiveFinalizePhase(input: CivLiveRunInput, ctx: CivLivePhaseContext, approveRepair: boolean, log: CivLiveLogger): CivLiveResult {
  const { config, permit, admission } = input;
  const { economy, mcp, knowledge, waste, m, active, proposals, defectApplied, defectLive, seed } = ctx;
  const workspace = input.workspace;
  const verificationDriver = input.verificationDriver;

  // 7. Repair — only with a SEPARATE human approval; one bounded repair round.
  // The repair claimant MUST be implementation/debugging-capable (a security-only
  // ant never repairs missing implementation). Repair output goes through the
  // repair ROLE CONTRACT; its artifacts are independently reviewed then applied.
  let defectRepaired = !defectApplied;
  if (ctx.repairRequired && approveRepair) {
    const repairMember = selectRepairMember(admission.accepted);
    if (!repairMember) {
      ctx.failureCategories.push("no-build-capable-repair-ant");
      log("repair-declined", { reasonCode: "no-build-capable-repair-ant" });
    } else {
      const rBudget = recordCivilizationCall(permit, "repair");
      if (rBudget.ok) {
        m.repairCalls += 1;
        log("repair-provider-starting", { antId: repairMember.antId, provider: repairMember.provider, role: "repair" });
        const rres = input.providerDriver.call({ antId: repairMember.antId, providerId: repairMember.provider, taskId: `${config.objectiveId}-repair`, role: "build" });
        m.providerCalls += 1;
        m.providerHealthUpdates += 1;
        log("repair-provider-completed", { antId: repairMember.antId, provider: repairMember.provider, ok: rres.ok, failureCategory: rres.failureCategory ?? "none" });
        if (rres.ok && rres.payload) {
          const rnorm = normalizeProviderResult({ antId: repairMember.antId, providerId: repairMember.provider, taskId: `${config.objectiveId}-repair`, proposalId: `repair-${repairMember.antId}`, payload: rres.payload, caps: { maxOutputBytes: permit.maxAggregateOutputBytes, maxFiles: permit.workspaceFileCap, perFileByteCap: permit.perFileByteCap } });
          const rout = normalizeCivRoleOutput({ role: "repair", callFailureCategory: null, summary: rnorm.summary, filesProposed: rnorm.filesProposed, risks: rnorm.risks, testSuggestions: rnorm.testSuggestions, malformed: false, outputTruncated: rnorm.outputTruncated });
          if (rout.ok) {
            // Independently review + apply the repair artifacts (never self-review).
            for (const a of rout.artifacts) {
              const highRisk = /service|repo|backend|security|data/i.test(a.relativePath);
              const reviewers = input.reviewerAntIds.filter((r) => r !== repairMember.antId);
              const need = highRisk ? 2 : 1;
              if (reviewers.length < need) continue;
              m.independentReviews += need;
              const applied = workspace.applyArtifact(a.relativePath, a.content, { objectiveId: config.objectiveId, taskId: "repair", antId: repairMember.antId });
              if (applied.ok) m.artifactsCreated += 1;
            }
            // The targeted defect fix (when the defect artifact is known).
            const defectProposal = proposals.find((p) => p.defect);
            if (defectProposal) {
              const fixed = defectProposal.content.replace(/\n\s*broken: number = 'x';/, "");
              const applied = workspace.applyArtifact(defectProposal.relPath, fixed, { objectiveId: config.objectiveId, taskId: "repair", antId: repairMember.antId });
              if (applied.ok) defectRepaired = true;
            } else if (rout.artifacts.length > 0) {
              defectRepaired = true; // the failure was missing artifacts; they now exist
            }
          } else {
            m.normalizationFailures += 1;
            ctx.failureCategories.push(rout.failureCategory ?? "unsupported-role-output");
          }
        } else {
          m.providerFailures += 1;
          ctx.failureCategories.push(mapCallFailure(rres.failureCategory ?? "spawn-failed"));
        }
        // recycle a failure into a lesson.
        const openFailure = waste.all.find((f) => !f.repaired);
        if (openFailure) {
          const rec = waste.recycle(openFailure, economy);
          if (rec.recycled > 0) {
            m.repairsCompleted += 1;
            m.wasteRecycled = roundTo(m.wasteRecycled + rec.recycled, 6);
          }
        }
      }
    }
  }
  // Recycle remaining failures into lessons (repair economy).
  for (const f of waste.all) {
    if (f.repaired) continue;
    const rec = waste.recycle(f, economy);
    if (rec.recycled > 0) {
      m.repairsCompleted += 1;
      m.wasteRecycled = roundTo(m.wasteRecycled + rec.recycled, 6);
    }
  }

  // 8. Final verification — STILL gated on artifacts: an empty workspace can
  // never pass by vacuous verification.
  let finalPass = true;
  if (m.artifactsCreated === 0) {
    finalPass = false;
    m.verificationBlockedRuns += 1;
    ctx.failureCategories.push("no-build-artifacts");
    log("verification-completed", { command: "final", status: "blocked-empty-workspace" });
  } else {
    const vBudget2 = recordCivilizationCall(permit, "verification");
    if (vBudget2.ok) {
      log("verification-started", { command: "typecheck", run: 2 });
      const v2 = verificationDriver.run("typecheck", workspace.workspaceRoot, defectLive && !defectRepaired);
      m.verificationRuns += 1;
      const v3 = verificationDriver.run("test", workspace.workspaceRoot, false);
      m.verificationRuns += 1;
      finalPass = v2.status === "passed" && v3.status === "passed";
      log("verification-completed", { command: "final", run: 2, status: finalPass ? "passed" : "failed" });
    }
  }

  // 9. Knowledge economy flow.
  const kscouts = active.filter((w) => civDraw(seed, w.index, 5, 0x9e3779b9) > 0.7).slice(0, 8);
  for (const s of kscouts) {
    const item = knowledge.scout("knowledge", s.workerId, economy, 1, seed);
    const reviewer = active.find((w) => w.workerId !== s.workerId && w.maturation !== "untrained");
    if (reviewer && knowledge.verify(item, reviewer.workerId, economy)) {
      const challenger = active.find((w) => w.workerId !== s.workerId && w.workerId !== reviewer.workerId);
      if (challenger) {
        if (knowledge.challenge(item, challenger.workerId, seed, 1)) m.knowledgeContradictions += 1;
        if (knowledge.accept(item)) {
          m.knowledgeAccepted += 1;
          knowledge.reuse(item);
        }
      }
    }
  }

  // 10. Academy: evidence-gated promotion with an independent evaluator.
  for (const member of admission.accepted) {
    const w = input.workers.find((x) => x.workerId === member.antId);
    if (!w) continue;
    const evaluator = active.find((e) => e.workerId !== w.workerId && e.maturation === "senior");
    m.academyEvidenceUpdates += 1;
    evaluateAcademyPromotion("worker", { antId: w.workerId, domain: "backend", missions: 1, examScore: clamp(0.5 + w.reliability * 0.4, 0, 1), peerReviews: 1, testEvidence: 0.2, reliability: w.reliability, safety: clamp(0.6 + w.trust * 0.3, 0, 1), independentEvaluatorAntId: evaluator ? evaluator.workerId : null });
  }

  // Freshness/degradation for conservation.
  economy.expire("workingContext", 0.5);

  // Final metrics + health.
  m.mcpToolCalls = mcp.toolCalls;
  m.mcpToolFailures = mcp.toolFailures;
  m.mcpHealthUpdates = mcp.toolHealthUpdateCount;
  m.realMcpExecutions = mcp.realMcpExecutions;
  m.technicalDebtTracked = roundTo(economy.totals("technicalDebt").created, 6);
  m.knowledgeAccepted = knowledge.accepted;
  m.knowledgeContradictions = knowledge.contradictions;
  m.realProviderProcessExecutions = input.providerDriver.realProviderProcessExecutions;
  m.realFilesystemWrites = workspace.realFilesystemWrites;

  const conservation = economy.validate();
  m.finalObjectivePassed = finalPass && m.artifactsCreated > 0 && m.independentReviews > 0 && m.verificationRuns >= 2 && m.repairsCompleted > 0 && conservation.allClosed;

  return buildResult(true, ctx, input);
}

/**
 * Synchronous composition (unchanged public behavior). Every automated demo calls
 * this; the noop logger means no console output and an unchanged result digest.
 * `approveRepair` is a pre-decided boolean (the demo forces the repair path).
 */
export function runCivilizationLive(input: CivLiveRunInput): CivLiveResult {
  const setup = civLiveSetupPhase(input, NOOP_LOG);
  if (setup.aborted) return setup.result;
  return civLiveFinalizePhase(input, setup.ctx, input.approveRepair, NOOP_LOG);
}

/**
 * Async composition with redacted stage logging and a SEPARATE repair confirmation
 * gate. The human CLI and the live-wiring regression demo both call this: it runs
 * the exact same setup + finalize phases, but between them — only when the first
 * verification failed — it asks `hooks.confirmRepair()` for a fresh authorization.
 * No automatic repair, no background continuation.
 */
export async function runCivilizationLiveSession(input: CivLiveRunInput, hooks: CivLiveSessionHooks): Promise<CivLiveResult> {
  const setup = civLiveSetupPhase(input, hooks.log);
  if (setup.aborted) {
    hooks.log("civilization-live-run-complete", { status: "aborted", reason: setup.result.abortReason ?? "unknown" });
    return setup.result;
  }
  const ctx = setup.ctx;

  let approveRepair = false;
  if (ctx.repairRequired) {
    hooks.log("repair-confirmation-requested", { reason: ctx.noBuildArtifacts ? "no-build-artifacts" : "verification-failure" });
    approveRepair = await hooks.confirmRepair();
  }

  const result = civLiveFinalizePhase(input, ctx, approveRepair, hooks.log);
  hooks.log("civilization-live-run-complete", { status: result.metrics.finalObjectivePassed ? "delivered" : "incomplete", repairApproved: approveRepair, providerCalls: result.metrics.providerCalls });
  return result;
}
