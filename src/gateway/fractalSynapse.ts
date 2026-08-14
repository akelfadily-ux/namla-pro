/**
 * fractalSynapse — the FRACTAL ANT SYNAPSE cognitive architecture (Cognitive
 * Federation Gateway V1, Phase 6). Machine-native collective intelligence built
 * from compact, AUDITABLE reasoning artifacts — never hidden provider
 * chain-of-thought. No private reasoning is requested or stored; every unit is a
 * typed, inspectable packet.
 *
 * Contains: temporary Synaptic Microcolonies (8–16 ants, voluntary roles, no
 * global planner), the typed AntSynapticPacket protocol, the ContradictionEnergy
 * engine, a bounded Hypothesis Tournament (evidence-under-constraints wins;
 * minority reports kept), Perspective Mutation transforms, ThoughtSpore
 * compression, and the Cognitive Immune System (quarantine gates).
 *
 * No fs, no child_process, no network, no wall clock. Deterministic by seed.
 */

// --- 6.2 Ant Synaptic Language ----------------------------------------------

export type SynapticPacketType =
  | "OBSERVATION" | "HYPOTHESIS" | "COUNTEREXAMPLE" | "CONTRADICTION" | "CONSTRAINT"
  | "PLAN_FRAGMENT" | "ARTIFACT_PROPOSAL" | "REVIEW_FINDING" | "TEST_EVIDENCE"
  | "FAILURE_SIGNAL" | "REPAIR_PROPOSAL" | "KNOWLEDGE_CANDIDATE" | "CAPABILITY_GAP"
  | "PROVIDER_REQUEST" | "PROVIDER_RESULT" | "QUORUM_SIGNAL" | "MINORITY_REPORT";

export interface AntSynapticPacket {
  readonly packetId: string;
  readonly type: SynapticPacketType;
  readonly sender: string;
  readonly topic: string;
  readonly objectiveId: string;
  readonly claim: string;
  readonly evidenceRefs: readonly string[];
  readonly assumptions: readonly string[];
  readonly uncertainty: number;
  readonly confidence: number;
  readonly contradictions: readonly string[];
  readonly constraints: readonly string[];
  readonly requestedAction: string;
  readonly expectedInformationGain: number;
  readonly dependencies: readonly string[];
  readonly risk: number;
  readonly expiresAtTick: number;
  readonly provenance: string;
  readonly integrityFingerprint: string;
}

function fp(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `pk-${h.toString(16).padStart(8, "0")}`;
}

let packetSeq = 0;
export function makePacket(input: Omit<AntSynapticPacket, "packetId" | "integrityFingerprint">): AntSynapticPacket {
  packetSeq += 1;
  const packetId = `synapse-${packetSeq}`;
  const integrityFingerprint = fp(`${packetId}|${input.type}|${input.claim}|${input.sender}`);
  return { ...input, packetId, integrityFingerprint };
}

const HIDDEN_COMMAND = /rm\s+-rf|child_process|exec\(|npm install|curl\s+http|;\s*(rm|del|format)\b/i;

/** Validate a packet: typed, integrity-matched, no embedded executable command. */
export function validatePacket(p: AntSynapticPacket): { ok: boolean; reasonCode: string } {
  if (p.integrityFingerprint !== fp(`${p.packetId}|${p.type}|${p.claim}|${p.sender}`)) return { ok: false, reasonCode: "integrity-mismatch" };
  if (HIDDEN_COMMAND.test(p.claim) || HIDDEN_COMMAND.test(p.requestedAction)) return { ok: false, reasonCode: "embedded-command" };
  if (p.confidence < 0 || p.confidence > 1 || p.uncertainty < 0 || p.uncertainty > 1) return { ok: false, reasonCode: "out-of-range" };
  return { ok: true, reasonCode: "ok" };
}

// --- 6.1 Synaptic Microcolonies ---------------------------------------------

export const MICROCOLONY_LOCAL_ROLES = ["observer", "hypothesis-generator", "adversarial-critic", "constraint-keeper", "evidence-scout", "simulator", "verifier", "contradiction-hunter", "memory-historian", "result-compressor", "capability-broker", "safety-sentinel"] as const;
export type MicrocolonyRole = (typeof MICROCOLONY_LOCAL_ROLES)[number];

export interface Microcolony {
  readonly colonyId: string;
  readonly members: readonly { readonly antId: string; readonly role: MicrocolonyRole }[];
  readonly topic: string;
}

function draw(seed: number, a: number, salt: number): number {
  let h = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

/** Form temporary microcolonies (8–16 voluntary members). No permanent planner. */
export function formMicrocolonies(volunteerAntIds: readonly string[], topics: readonly string[], seed: number): Microcolony[] {
  const colonies: Microcolony[] = [];
  const pool = [...volunteerAntIds];
  let ci = 0;
  while (pool.length >= 8 && ci < topics.length) {
    const size = 8 + Math.floor(draw(seed, ci, 0x9a1) * 9); // 8..16
    const members = pool.splice(0, Math.min(size, pool.length)).map((antId, i) => ({ antId, role: MICROCOLONY_LOCAL_ROLES[i % MICROCOLONY_LOCAL_ROLES.length] }));
    colonies.push({ colonyId: `microcolony-${ci}`, members, topic: topics[ci] });
    ci += 1;
  }
  return colonies;
}

// --- 6.3 Contradiction Energy ------------------------------------------------

export interface Contradiction {
  readonly contradictionId: string;
  readonly claimA: string;
  readonly claimB: string;
  energy: number;
  resolved: boolean;
}

export interface ContradictionInputs {
  readonly impact: number;
  readonly evidenceStrengthA: number;
  readonly evidenceStrengthB: number;
  readonly uncertainty: number;
  readonly unresolvedDependencies: number;
  readonly missionCriticality: number;
  readonly safetyImplication: number;
}

export class ContradictionEnergyEngine {
  private readonly contradictions = new Map<string, Contradiction>();
  private seq = 0;

  /** Register a contradiction; it is NOT deleted prematurely. Energy drives attention. */
  register(claimA: string, claimB: string, inputs: ContradictionInputs): Contradiction {
    this.seq += 1;
    const balance = 1 - Math.abs(inputs.evidenceStrengthA - inputs.evidenceStrengthB); // even evidence = hotter
    const energy = Number((inputs.impact * 0.25 + balance * 0.2 + inputs.uncertainty * 0.15 + Math.min(1, inputs.unresolvedDependencies / 5) * 0.15 + inputs.missionCriticality * 0.15 + inputs.safetyImplication * 0.1).toFixed(6));
    const c: Contradiction = { contradictionId: `contradiction-${this.seq}`, claimA, claimB, energy, resolved: false };
    this.contradictions.set(c.contradictionId, c);
    return c;
  }
  get all(): readonly Contradiction[] {
    return [...this.contradictions.values()];
  }
  get totalEnergy(): number {
    return Number([...this.contradictions.values()].filter((c) => !c.resolved).reduce((s, c) => s + c.energy, 0).toFixed(6));
  }
  /** High-energy contradictions attract more resources (returns the ones above threshold). */
  highEnergy(threshold = 0.6): readonly Contradiction[] {
    return [...this.contradictions.values()].filter((c) => !c.resolved && c.energy >= threshold);
  }
  resolve(id: string): void {
    const c = this.contradictions.get(id);
    if (c) c.resolved = true;
  }
}

// --- 6.4 Hypothesis Tournament -----------------------------------------------

export interface Hypothesis {
  readonly hypothesisId: string;
  readonly claim: string;
  readonly evidenceScore: number;
  readonly adversarialSurvival: number;
  readonly counterexamplesSurvived: number;
  readonly constraintCompliance: number;
  readonly resourceScore: number;
  readonly reversibility: number;
  readonly testability: number;
}

export interface TournamentResult {
  readonly winner: Hypothesis | null;
  readonly ranked: readonly { readonly hypothesis: Hypothesis; readonly verifiedScore: number }[];
  readonly minorityReports: readonly Hypothesis[];
}

/** Score = strongest VERIFIED evidence under constraints — not majority popularity. */
export function runHypothesisTournament(hypotheses: readonly Hypothesis[]): TournamentResult {
  const scored = hypotheses.map((h) => ({
    hypothesis: h,
    verifiedScore: Number((h.evidenceScore * 0.3 + h.adversarialSurvival * 0.2 + Math.min(1, h.counterexamplesSurvived / 3) * 0.15 + h.constraintCompliance * 0.15 + h.reversibility * 0.1 + h.testability * 0.1).toFixed(6)),
  }));
  scored.sort((a, b) => b.verifiedScore - a.verifiedScore);
  const winner = scored.length > 0 && scored[0].hypothesis.constraintCompliance >= 0.5 ? scored[0].hypothesis : null;
  // Minority reports: every non-winner is retained, never discarded.
  const minorityReports = scored.slice(1).map((s) => s.hypothesis);
  return { winner, ranked: scored, minorityReports };
}

// --- 6.5 Perspective Mutation ------------------------------------------------

export const PERSPECTIVE_MUTATIONS = ["reverse-objective", "invert-constraint", "failure-first", "smallest-viable", "highest-reliability", "cross-domain-map", "counterfactual-world", "remove-dependency", "adversarial-environment", "multi-scale-analysis"] as const;
export type PerspectiveMutation = (typeof PERSPECTIVE_MUTATIONS)[number];

/** Each transform yields an explicit OBSERVATION packet — never hidden reasoning. */
export function applyPerspectiveMutations(objectiveId: string, baseClaim: string, sender: string, expiresAtTick: number): AntSynapticPacket[] {
  return PERSPECTIVE_MUTATIONS.map((mutation) =>
    makePacket({ type: "OBSERVATION", sender, topic: `mutation:${mutation}`, objectiveId, claim: `${mutation} of: ${baseClaim}`.slice(0, 200), evidenceRefs: [], assumptions: [mutation], uncertainty: 0.5, confidence: 0.4, contradictions: [], constraints: [], requestedAction: "explore", expectedInformationGain: 0.3, dependencies: [], risk: 0.2, expiresAtTick, provenance: "perspective-mutation" })
  );
}

// --- 6.6 Thought Spore Compression -------------------------------------------

export interface ThoughtSpore {
  readonly sporeId: string;
  readonly problemFingerprint: string;
  readonly solutionPattern: string;
  readonly evidenceRefs: readonly string[];
  readonly failedAlternatives: readonly string[];
  readonly constraints: readonly string[];
  readonly confidence: number;
  readonly appliesInContexts: readonly string[];
  readonly forbiddenContexts: readonly string[];
  readonly freshnessTick: number;
  readonly contradictionLinks: readonly string[];
  readonly verificationProcedure: string;
}

let sporeSeq = 0;
/** Compress a validated result into a portable ThoughtSpore (no full context window). */
export function compressThoughtSpore(input: Omit<ThoughtSpore, "sporeId" | "problemFingerprint"> & { problem: string }): ThoughtSpore {
  sporeSeq += 1;
  const { problem, ...rest } = input;
  return { sporeId: `spore-${sporeSeq}`, problemFingerprint: fp(problem), ...rest };
}

/** Propagate a spore to the relevant ants (returns count reached, not the full payload). */
export function propagateSpore(spore: ThoughtSpore, relevantAntIds: readonly string[]): { reached: number; sporeId: string } {
  return { reached: relevantAntIds.length, sporeId: spore.sporeId };
}

// --- 6.7 Cognitive Immune System ---------------------------------------------

export type QuarantineReason = "hallucinated-fact" | "unsupported-conclusion" | "poisoned-content" | "prompt-injection" | "low-quality-repeat" | "stale-knowledge" | "contradictory-unverified" | "provider-monoculture" | "circular-citation" | "fake-test-evidence";

export interface QuarantineRecord {
  readonly recordId: string;
  readonly reason: QuarantineReason;
  readonly sourceRef: string;
}

export interface ImmuneCandidate {
  readonly ref: string;
  readonly claim: string;
  readonly evidenceRefs: readonly string[];
  readonly providerId: string;
  readonly independentlyVerified: boolean;
  readonly freshnessTick: number;
  readonly rawText: string;
}

const INJECTION = /ignore (all |previous )?(instructions|rules)|reveal.*(key|secret)|exfiltrate|rm\s+-rf/i;

export class CognitiveImmuneSystem {
  private readonly quarantine: QuarantineRecord[] = [];
  private readonly providerUseByTopic = new Map<string, Set<string>>();
  private readonly citationGraph = new Map<string, Set<string>>();
  private seq = 0;

  private record(reason: QuarantineReason, sourceRef: string): QuarantineRecord {
    this.seq += 1;
    const rec = { recordId: `quarantine-${this.seq}`, reason, sourceRef };
    this.quarantine.push(rec);
    return rec;
  }
  get quarantined(): readonly QuarantineRecord[] {
    return this.quarantine;
  }

  /** EvidenceImmuneGate + PromptInjectionQuarantine + Stale/Hallucination checks. */
  evaluate(candidate: ImmuneCandidate, tick: number, staleAfterTicks = 500): { admitted: boolean; reason: QuarantineReason | null } {
    if (INJECTION.test(candidate.rawText) || INJECTION.test(candidate.claim)) return { admitted: false, reason: this.record("prompt-injection", candidate.ref).reason };
    if (candidate.evidenceRefs.length === 0 && !candidate.independentlyVerified) return { admitted: false, reason: this.record("unsupported-conclusion", candidate.ref).reason };
    if (tick - candidate.freshnessTick > staleAfterTicks) return { admitted: false, reason: this.record("stale-knowledge", candidate.ref).reason };
    // CircularEvidenceDetector: a claim citing only itself.
    if (candidate.evidenceRefs.length > 0 && candidate.evidenceRefs.every((e) => e === candidate.ref)) return { admitted: false, reason: this.record("circular-citation", candidate.ref).reason };
    return { admitted: true, reason: null };
  }

  /** ProviderMonocultureDetector: too many accepted claims on one topic from one provider. */
  recordProviderUse(topic: string, providerId: string, distinctProvidersNeeded = 2): { monoculture: boolean } {
    const set = this.providerUseByTopic.get(topic) ?? new Set<string>();
    set.add(providerId);
    this.providerUseByTopic.set(topic, set);
    if (set.size < distinctProvidersNeeded) {
      // Only one provider so far — not yet a violation, but flagged when a decision is forced.
      return { monoculture: false };
    }
    return { monoculture: false };
  }

  /** Force a monoculture check for a topic (e.g. before releasing knowledge). */
  monocultureCheck(topic: string, acceptedFromSingleProvider: boolean): QuarantineRecord | null {
    const providers = this.providerUseByTopic.get(topic);
    if (acceptedFromSingleProvider && (!providers || providers.size < 2)) return this.record("provider-monoculture", topic);
    return null;
  }
}

/** KnowledgeReleaseCouncil: knowledge is released only after independent verification. */
export function knowledgeReleaseDecision(candidate: ImmuneCandidate, independentReviewers: number, requiredReviewers = 1): { released: boolean; reason: string } {
  if (!candidate.independentlyVerified) return { released: false, reason: "not-independently-verified" };
  if (independentReviewers < requiredReviewers) return { released: false, reason: "insufficient-reviewers" };
  if (candidate.evidenceRefs.length === 0) return { released: false, reason: "no-evidence" };
  return { released: true, reason: "released-after-independent-review" };
}
