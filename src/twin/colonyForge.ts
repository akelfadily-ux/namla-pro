/**
 * colonyForge — the ClaudeColony and CodexColony runners for the twin-empire
 * foundation. One parameterized forge instantiated with two distinct cultures
 * gives each colony SEPARATE state and a SEPARATE workspace path. Each colony
 * receives ONLY the sealed mission packet (never the competitor's bundle) and
 * independently produces: one architecture proposal, one artifact proposal, one
 * INDEPENDENT review (reviewer ≠ author — self-review refused), and one evidence
 * bundle, which is then FROZEN with an immutable fingerprint.
 *
 * Deterministic and in-memory: no fs, no child_process, no network, no wall clock,
 * no real provider calls. Provider receipts are recorded as `real: false`.
 */

import { civDraw } from "../civilization/settlementTypes";
import type { DigitalWorker } from "../digital/digitalWorkers";
import { bundleCanonicalProjection, fnv1a } from "./twinColonyTypes";
import type { ArtifactManifestEntry, ColonyArchitectureProposal, ColonyArtifactProposal, ColonyCulture, ColonyEvidenceBundle, ColonyId, ColonyProviderReceipt, ColonyReview } from "./twinColonyTypes";
import { ColonyWorkspaceAuthority } from "./colonyWorkspace";

/** The sealed, equivalent mission packet handed to BOTH colonies (no competitor data). */
export interface TwinMissionPacket {
  readonly missionId: string;
  readonly objective: string;
  readonly acceptanceCriteria: readonly string[];
  readonly seed: number;
}

export interface ColonyProfile {
  readonly colonyId: ColonyId;
  readonly culture: ColonyCulture;
  readonly masterAntId: string;
  /** The colony's OWN, disjoint identity slice — never the other colony's ants. */
  readonly workers: readonly DigitalWorker[];
  /** A colony-specific seed offset so the two colonies diverge (no strategy sharing). */
  readonly seedOffset: number;
}

/** Culture-specific, bounded file plans so the two colonies genuinely differ. */
function architectureFor(profile: ColonyProfile, packet: TwinMissionPacket): ColonyArchitectureProposal {
  if (profile.culture === "architecture-first") {
    return {
      architectureSummary: "Layered service architecture: typed domain model first, repository boundary, thin façade; risk-and-maintainability driven.",
      filePlan: ["src/types.ts", "src/repository.ts", "src/taskManager.ts", "ARCHITECTURE.md"],
      acceptanceMapping: packet.acceptanceCriteria.map((c) => `types+repository cover: ${c}`),
      interfaceDecisions: ["Repository<T> interface isolates storage", "TaskManager depends on abstraction, not concretion"],
      risks: ["over-abstraction if scope stays tiny", "interface churn during early iteration"],
    };
  }
  return {
    architectureSummary: "Execution-first vertical slice: working TaskManager + tests immediately, minimal indirection; measurable-result driven.",
    filePlan: ["src/taskManager.ts", "test/taskManager.test.ts", "README.md"],
    acceptanceMapping: packet.acceptanceCriteria.map((c) => `taskManager+tests cover: ${c}`),
    interfaceDecisions: ["single TaskManager module", "in-memory array store, refactor later if needed"],
    risks: ["thin abstraction may need later extraction", "coupling of storage and logic early"],
  };
}

function artifactFor(profile: ColonyProfile, packet: TwinMissionPacket): ColonyArtifactProposal {
  if (profile.culture === "architecture-first") {
    return {
      relativePath: "src/repository.ts",
      content: "export interface Repository<T> { add(item: T): void; list(): readonly T[]; }\nexport class InMemoryRepository<T> implements Repository<T> {\n  private readonly items: T[] = [];\n  add(item: T): void { this.items.push(item); }\n  list(): readonly T[] { return this.items; }\n}\n",
      purpose: "Storage boundary that isolates the domain from persistence.",
      acceptanceCriteriaCovered: packet.acceptanceCriteria.slice(0, 1),
    };
  }
  return {
    relativePath: "src/taskManager.ts",
    content: "export interface Task { id: number; title: string; done: boolean; }\nexport class TaskManager {\n  private tasks: Task[] = [];\n  add(title: string): Task { const t = { id: this.tasks.length + 1, title, done: false }; this.tasks.push(t); return t; }\n  list(): readonly Task[] { return this.tasks; }\n  complete(id: number): boolean { const t = this.tasks.find((x) => x.id === id); if (!t) return false; t.done = true; return true; }\n}\n",
    purpose: "Working task manager delivering CRUD + completion immediately.",
    acceptanceCriteriaCovered: packet.acceptanceCriteria.slice(0, 2),
  };
}

/**
 * Run one colony to a FROZEN evidence bundle. Independence is structural: the
 * function's only inputs are the shared packet + this colony's own profile/ants +
 * an injected in-memory workspace authority; there is no parameter through which
 * the competitor's bundle could enter. Artifacts are written into THIS colony's
 * isolated workspace, from which the artifact manifest is built.
 */
export function runColonyForge(profile: ColonyProfile, packet: TwinMissionPacket, authority: ColonyWorkspaceAuthority = new ColonyWorkspaceAuthority()): ColonyEvidenceBundle {
  const workspacePath = `workspaces/namola-twin/${packet.missionId}/${profile.colonyId}`;
  const architecture = architectureFor(profile, packet);
  const artifact = artifactFor(profile, packet);

  // Write the artifact into this colony's OWN workspace (in-memory, validated).
  authority.write(workspacePath, artifact.relativePath, artifact.content);
  const artifactManifest: ArtifactManifestEntry[] = [artifact].map((a) => ({ relativePath: a.relativePath, bytes: a.content.length, fingerprint: fnv1a(`${a.relativePath}|${a.content}`) }));

  // Author is the colony master ant; reviewer is a DIFFERENT qualified colony ant.
  const authorAntId = profile.masterAntId;
  const reviewer = profile.workers.find((w) => w.active && w.workerId !== authorAntId && (w.maturation === "senior" || w.maturation === "qualified")) ?? profile.workers.find((w) => w.workerId !== authorAntId);
  const reviewerAntId = reviewer?.workerId ?? `${profile.colonyId}-reviewer`;
  const selfReview = reviewerAntId === authorAntId; // structurally false
  const review: ColonyReview = {
    reviewerAntId,
    authorAntId,
    decision: "approve",
    findings: [profile.culture === "architecture-first" ? "boundary is clean; add a list() test" : "logic works; extract storage when it grows"],
    securityFindings: [],
    selfReview,
  };

  const providerReceipts: readonly ColonyProviderReceipt[] = [
    { antId: profile.masterAntId, providerId: profile.colonyId === "claude-forge" ? "claude-code" : "codex", role: "architecture", ok: true, real: false },
    { antId: profile.masterAntId, providerId: profile.colonyId === "claude-forge" ? "claude-code" : "codex", role: "implementation", ok: true, real: false },
  ];

  const draft: Omit<ColonyEvidenceBundle, "fingerprint" | "frozen"> = {
    colonyId: profile.colonyId,
    missionId: packet.missionId,
    culture: profile.culture,
    workspacePath,
    architecture,
    artifacts: [artifact],
    artifactManifest,
    reviews: selfReview ? [] : [review], // an accepted review is NEVER a self-review
    testEvidence: { testsProposed: profile.culture === "implementation-first" ? 2 : 1, independentReviews: selfReview ? 0 : 1, artifactCount: 1 },
    securityEvidence: { findings: [], passed: true },
    performanceEvidence: [{ check: "artifact-size-within-cap", observed: artifact.content.length, budget: 20000, withinBudget: artifact.content.length <= 20000 }],
    riskRegister: [...architecture.risks],
    failureRegister: [`${profile.colonyId}: single-artifact scope is intentionally minimal`],
    uncertaintyRegister: [`residual: ${civDraw(packet.seed, profile.seedOffset, 7, 0x2c1b3c6d).toFixed(3)} normalized uncertainty on scale-up`],
    minorityReports: [profile.culture === "architecture-first" ? "minority: a vertical slice might ship faster" : "minority: an abstraction boundary might age better"],
    providerReceipts,
    costReport: { providerCalls: providerReceipts.length, realProviderCalls: 0 },
    reproductionInstructions: ["npx.cmd tsc --noEmit", "npm.cmd test"],
  };

  return freezeBundle(draft);
}

/** Freeze a bundle: compute the immutable fingerprint and deep-freeze the object. */
export function freezeBundle(draft: Omit<ColonyEvidenceBundle, "fingerprint" | "frozen">): ColonyEvidenceBundle {
  const fingerprint = fnv1a(bundleCanonicalProjection(draft));
  const frozen: ColonyEvidenceBundle = {
    ...draft,
    architecture: Object.freeze({ ...draft.architecture }),
    artifacts: Object.freeze(draft.artifacts.map((a) => Object.freeze({ ...a }))),
    artifactManifest: Object.freeze(draft.artifactManifest.map((m) => Object.freeze({ ...m }))),
    reviews: Object.freeze(draft.reviews.map((r) => Object.freeze({ ...r }))),
    securityEvidence: Object.freeze({ ...draft.securityEvidence, findings: Object.freeze([...draft.securityEvidence.findings]) }),
    performanceEvidence: Object.freeze(draft.performanceEvidence.map((p) => Object.freeze({ ...p }))),
    providerReceipts: Object.freeze(draft.providerReceipts.map((r) => Object.freeze({ ...r }))),
    fingerprint,
    frozen: true,
  };
  return Object.freeze(frozen);
}

/** Attempt a post-freeze modification — proves immutability (never mutates). */
export function attemptPostFreezeModify(bundle: ColonyEvidenceBundle, newArtifactPath: string): { readonly ok: false; readonly reason: string; readonly digestUnchanged: boolean } {
  const before = bundle.fingerprint;
  try {
    // A frozen object refuses this; in strict mode it throws, otherwise it is a no-op.
    (bundle.artifacts as unknown as ColonyArtifactProposal[]).push({ relativePath: newArtifactPath, content: "post-freeze", purpose: "tamper", acceptanceCriteriaCovered: [] });
  } catch {
    /* frozen — mutation refused */
  }
  const recomputed = fnv1a(bundleCanonicalProjection(bundle));
  return { ok: false, reason: "bundle-frozen", digestUnchanged: recomputed === before && Object.isFrozen(bundle) };
}
