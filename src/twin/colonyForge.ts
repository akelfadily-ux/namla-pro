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
    const content = "export interface Repository<T> { add(item: T): void; list(): readonly T[]; }\nexport class InMemoryRepository<T> implements Repository<T> {\n  private readonly items: T[] = [];\n  add(item: T): void { this.items.push(item); }\n  list(): readonly T[] { return this.items; }\n}\n";
    return {
      relativePath: "src/repository.ts",
      content,
      purpose: "Storage boundary that isolates the domain from persistence.",
      acceptanceCriteriaCovered: packet.acceptanceCriteria.slice(0, 1),
      operation: {
        kind: "ADD",
        targetRelativePath: "src/repository.ts",
        sourceArtifactSha256: fnv1a(`src/repository.ts|${content}`),
      },
    };
  }
  const content = "export interface Task { id: number; title: string; done: boolean; }\nexport class TaskManager {\n  private tasks: Task[] = [];\n  add(title: string): Task { const t = { id: this.tasks.length + 1, title, done: false }; this.tasks.push(t); return t; }\n  list(): readonly Task[] { return this.tasks; }\n  complete(id: number): boolean { const t = this.tasks.find((x) => x.id === id); if (!t) return false; t.done = true; return true; }\n}\n";
  return {
    relativePath: "src/taskManager.ts",
    content,
    purpose: "Working task manager delivering CRUD + completion immediately.",
    acceptanceCriteriaCovered: packet.acceptanceCriteria.slice(0, 2),
    operation: {
      kind: "ADD",
      targetRelativePath: "src/taskManager.ts",
      sourceArtifactSha256: fnv1a(`src/taskManager.ts|${content}`),
    },
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

/**
 * Freeze a bundle: compute the immutable fingerprint and deep-freeze the object.
 *
 * WHY EVERY NESTED STRUCTURE IS SEALED, NOT JUST THE NAMED ONES. `Object.freeze`
 * is shallow. Anything that reached the result through the `...draft` spread kept
 * its ORIGINAL reference and stayed mutable, and a shallow `Object.freeze({...x})`
 * left x's own arrays mutable too. That made `frozen: true` a claim the object
 * could not keep: a post-freeze `bundle.verification.finalStatus = "VERIFIED"`
 * succeeded silently even under strict mode, flipped `isVerifiedCandidate` from
 * false to true, and changed the court's verdict - while the stored AND recomputed
 * fingerprints stayed identical, so no integrity check could see it.
 *
 * Every decision-relevant structure is therefore copied and frozen here. Copying
 * matters as much as freezing: sealing the caller's own object would otherwise
 * make the draft unusable afterwards, and sharing it would leave a live handle
 * to "frozen" evidence.
 */
export function freezeBundle(draft: Omit<ColonyEvidenceBundle, "fingerprint" | "frozen">): ColonyEvidenceBundle {
  const fingerprint = fnv1a(bundleCanonicalProjection(draft));
  const frozenList = <T>(items: readonly T[]): readonly T[] => Object.freeze(items.map((i) => Object.freeze({ ...i })));
  const frozenStrings = (items: readonly string[]): readonly string[] => Object.freeze([...items]);
  const frozen: ColonyEvidenceBundle = {
    ...draft,
    architecture: Object.freeze({
      ...draft.architecture,
      filePlan: frozenStrings(draft.architecture.filePlan),
      acceptanceMapping: frozenStrings(draft.architecture.acceptanceMapping),
      interfaceDecisions: frozenStrings(draft.architecture.interfaceDecisions),
      risks: frozenStrings(draft.architecture.risks),
    }),
    artifacts: Object.freeze(draft.artifacts.map((a) => Object.freeze({ ...a, acceptanceCriteriaCovered: frozenStrings(a.acceptanceCriteriaCovered) }))),
    artifactManifest: frozenList(draft.artifactManifest),
    reviews: Object.freeze(draft.reviews.map((r) => Object.freeze({ ...r, findings: frozenStrings(r.findings), securityFindings: frozenStrings(r.securityFindings) }))),
    testEvidence: Object.freeze({ ...draft.testEvidence }),
    securityEvidence: Object.freeze({ ...draft.securityEvidence, findings: frozenStrings(draft.securityEvidence.findings) }),
    performanceEvidence: frozenList(draft.performanceEvidence),
    riskRegister: frozenStrings(draft.riskRegister),
    failureRegister: frozenStrings(draft.failureRegister),
    uncertaintyRegister: frozenStrings(draft.uncertaintyRegister),
    minorityReports: frozenStrings(draft.minorityReports),
    providerReceipts: frozenList(draft.providerReceipts),
    costReport: Object.freeze({ ...draft.costReport }),
    reproductionInstructions: frozenStrings(draft.reproductionInstructions),
    // v2 only. `undefined` stays `undefined` so a v1 bundle is byte-identical to
    // what it was before this seal.
    verification: draft.verification === undefined ? undefined : Object.freeze({
      ...draft.verification,
      stageReceipts: frozenList(draft.verification.stageReceipts),
      repairReceipts: frozenList(draft.verification.repairReceipts),
    }),
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
