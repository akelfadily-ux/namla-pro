/**
 * Ant Intelligence Deepening V1 — the bounded AntMind and cognitive profile.
 *
 * Every worker gets an `AntMind`: a strictly BOUNDED private cognitive state
 * derived deterministically from the ant's genome profile and its accumulated
 * G1-G7 experience (reliability, success/failure history, age, energy). It is
 * the same discipline as the rest of the colony — one reusable model, hundreds
 * of distinct instances from genome + experience, never a class per ant, never
 * a field that reaches the whole colony.
 *
 * BOUNDEDNESS is load-bearing and mechanically checkable (see
 * `mindWithinBounds`): working memory, episodic summaries, strategy patterns,
 * and unresolved questions each have a hard cap, and old episodic detail is
 * COMPACTED into summaries rather than retained. No unbounded event history,
 * no roster, no reference to another ant or to the colony.
 *
 * A `CognitiveProfile` is the ant's distinct aptitude vector across 15
 * dimensions. It is seeded by the genome but shifted by real experience, so
 * two ants with different histories diverge — `profileDigest` quantizes it so
 * that divergence is countable at any scale (O(N), never O(N^2)).
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 17 (Ant Intelligence Deepening V1).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state,
 * no external call of any kind.
 */

import type { AntAgent } from "./antAgent";
import type { SkillTendency, TaskCategory } from "./colonyTypes";
import { TASK_CATEGORIES, clamp, createSeededRandom, roundTo } from "./colonyTypes";

// --- hard bounds (checked at runtime, never exceeded) ----------------------
export const MIND_WORKING_MEMORY_CAP = 8 as const;
export const MIND_EPISODIC_SUMMARY_CAP = 6 as const;
export const MIND_STRATEGY_PATTERN_CAP = 6 as const;
export const MIND_UNRESOLVED_QUESTION_CAP = 5 as const;

/** The 15 aptitude dimensions every ant develops a distinct profile across. */
export const COGNITIVE_DIMENSIONS = [
  "analytical",
  "creative",
  "precision",
  "implementation",
  "debugging",
  "testing",
  "security",
  "documentation",
  "architectural",
  "memoryRetrieval",
  "communication",
  "skepticism",
  "speed",
  "patience",
  "riskTolerance",
] as const;

export type CognitiveDimension = (typeof COGNITIVE_DIMENSIONS)[number];
export type CognitiveProfile = Readonly<Record<CognitiveDimension, number>>;

/** One compacted episodic summary — a span of ticks reduced to safe scalars. */
export interface EpisodicSummary {
  readonly spanStartTick: number;
  readonly spanEndTick: number;
  readonly successRate: number;
  readonly dominantCategory: TaskCategory;
  readonly episodeCount: number;
}

/** A remembered strategy pattern (success or failure), referenced by code. */
export interface StrategyPattern {
  readonly category: TaskCategory;
  readonly strategyCode: string;
  readonly weight: number;
}

/** One item of short-term working memory. Bounded; oldest evicted first. */
export interface WorkingMemoryItem {
  readonly tick: number;
  readonly noteCode: string;
}

export interface AntMind {
  readonly antId: string;
  readonly cognitiveProfile: CognitiveProfile;

  // --- bounded memory surfaces ---
  readonly workingMemory: readonly WorkingMemoryItem[];
  readonly episodicSummaries: readonly EpisodicSummary[];
  readonly successPatterns: readonly StrategyPattern[];
  readonly failurePatterns: readonly StrategyPattern[];

  // --- current cognition ---
  readonly currentHypothesisCode: string;
  readonly hasLocalPlan: boolean;
  readonly confidence: number;
  readonly uncertainty: number;
  readonly curiosity: number;
  readonly caution: number;
  readonly persistence: number;
  readonly flexibility: number;

  // --- social cognition (bounded scalars only, never a roster) ---
  readonly socialTrust: number;
  readonly peerReputation: number;

  // --- affect / physiology-derived ---
  readonly fatigue: number;
  readonly frustration: number;
  readonly recoveryNeed: number;

  // --- task cognition ---
  readonly taskUnderstanding: number;
  readonly progressEstimate: number;
  readonly selfEvaluation: number;
  readonly recentContradictionCount: number;
  readonly unresolvedQuestions: readonly string[];
}

/**
 * An ant paired with its derived mind. The canonical unit the intelligence
 * layer passes around: full access to the ant's own real state (index, caste,
 * reliability, chamber, history) plus its bounded cognitive state — and
 * nothing beyond one ant, preserving the anti-omniscience rule.
 */
export interface AntWithMind {
  readonly ant: AntAgent;
  readonly mind: AntMind;
}

const SALT_PROFILE = 0x51ed270b;
const SALT_MIND = 0x2545f491;

/** Deterministic per-ant draw. Mirrors the house seed-mix used across colony/. */
export function mindDraw(colonySeed: number, antIndex: number, salt: number): number {
  const h = (Math.imul(colonySeed ^ salt, 2654435761) ^ Math.imul(antIndex + 1, 40503)) >>> 0;
  return createSeededRandom(h)();
}

/** Which genome skill tendency seeds each cognitive dimension. */
const DIMENSION_SKILL_SOURCE: Record<CognitiveDimension, SkillTendency> = {
  analytical: "research",
  creative: "research",
  precision: "testing",
  implementation: "coding",
  debugging: "debugging",
  testing: "testing",
  security: "security",
  documentation: "documentation",
  architectural: "planning",
  memoryRetrieval: "memory-management",
  communication: "orchestration",
  skepticism: "security",
  speed: "coding",
  patience: "documentation",
  riskTolerance: "research",
};

function failureRate(ant: AntAgent): number {
  let success = 0;
  let failure = 0;
  for (const category of TASK_CATEGORIES) {
    success += ant.successHistory[category];
    failure += ant.failureHistory[category];
  }
  const total = success + failure;
  return total === 0 ? 0 : failure / total;
}

function bestSpecialization(ant: AntAgent): { category: TaskCategory; strength: number } {
  let category: TaskCategory = TASK_CATEGORIES[0];
  let strength = -1;
  for (const c of TASK_CATEGORIES) {
    const s = 1 - ant.responseThresholds[c];
    if (s > strength) {
      strength = s;
      category = c;
    }
  }
  return { category, strength: clamp(strength, 0, 1) };
}

/**
 * Derive an ant's cognitive profile: genome-seeded, experience-shifted. Two
 * ants that started identical but lived different histories (different
 * reliability, success/failure balance, age) end with different profiles —
 * that divergence is the whole point.
 */
export function deriveCognitiveProfile(ant: AntAgent, colonySeed: number): CognitiveProfile {
  const fRate = failureRate(ant);
  const reliabilityShift = (ant.reliability - 0.5) * 0.24;
  const spec = bestSpecialization(ant);
  const profile = {} as Record<CognitiveDimension, number>;

  for (let i = 0; i < COGNITIVE_DIMENSIONS.length; i += 1) {
    const dimension = COGNITIVE_DIMENSIONS[i];
    const base = ant.skillTendencies[DIMENSION_SKILL_SOURCE[dimension]];
    const jitter = (mindDraw(colonySeed, ant.antIndex, SALT_PROFILE ^ (i * 2654435761)) - 0.5) * 0.3;

    // Experience shapes specific dimensions from real history.
    let experience = reliabilityShift;
    if (dimension === "skepticism" || dimension === "security") experience += fRate * 0.2;
    if (dimension === "precision" || dimension === "testing") experience += (1 - fRate) * 0.12;
    if (dimension === "patience") experience += clamp(ant.age / 400, 0, 1) * 0.15;
    if (dimension === "implementation") experience += spec.strength * 0.15;
    if (dimension === "riskTolerance") experience += ant.genomeProfile.exploration * 0.2 - fRate * 0.1;
    if (dimension === "speed") experience += (ant.energy - 0.5) * 0.15;

    profile[dimension] = roundTo(clamp(base + jitter + experience, 0, 1), 4);
  }

  return profile;
}

/** Build one ant's bounded mind from its evolved state. Pure and deterministic. */
export function deriveAntMind(ant: AntAgent, colonySeed: number): AntMind {
  const cognitiveProfile = deriveCognitiveProfile(ant, colonySeed);
  const fRate = failureRate(ant);
  const spec = bestSpecialization(ant);
  const jitter = (mindDraw(colonySeed, ant.antIndex, SALT_MIND) - 0.5) * 0.2;

  const confidence = clamp(0.4 + (ant.reliability - 0.5) * 0.5 + spec.strength * 0.2 + jitter, 0.05, 0.95);

  // Seed a couple of strategy patterns from the ant's real strongest/weakest
  // categories, so recall has genuine (bounded) content rather than empty lists.
  const successPatterns: StrategyPattern[] = [
    { category: spec.category, strategyCode: `spec-${spec.category}`, weight: roundTo(spec.strength, 4) },
  ];

  return {
    antId: ant.antId,
    cognitiveProfile,

    workingMemory: [],
    episodicSummaries: [],
    successPatterns,
    failurePatterns: [],

    currentHypothesisCode: "none",
    hasLocalPlan: false,
    confidence: roundTo(confidence, 4),
    uncertainty: roundTo(clamp(1 - confidence, 0.05, 0.95), 4),
    curiosity: roundTo(clamp(cognitiveProfile.creative * 0.6 + cognitiveProfile.riskTolerance * 0.4, 0, 1), 4),
    caution: roundTo(clamp(cognitiveProfile.skepticism, 0, 1), 4),
    persistence: roundTo(clamp(cognitiveProfile.patience * 0.7 + ant.reliability * 0.3, 0, 1), 4),
    flexibility: roundTo(clamp(1 - cognitiveProfile.precision * 0.5, 0, 1), 4),

    socialTrust: roundTo(clamp(0.5 + jitter, 0.05, 0.95), 4),
    peerReputation: roundTo(clamp(ant.reliability, 0.05, 0.95), 4),

    fatigue: roundTo(clamp(1 - ant.energy, 0, 1), 4),
    frustration: roundTo(clamp(fRate, 0, 1), 4),
    recoveryNeed: roundTo(clamp(ant.recoveryTicksRemaining > 0 ? 0.7 : 1 - ant.health, 0, 1), 4),

    taskUnderstanding: roundTo(clamp(spec.strength * 0.5 + 0.25, 0, 1), 4),
    progressEstimate: 0,
    selfEvaluation: 0.5,
    recentContradictionCount: 0,
    unresolvedQuestions: [],
  };
}

/**
 * Quantize a profile into a stable digest string (15 dims x 5 levels). Equal
 * digests mean behaviorally-indistinguishable profiles; counting distinct
 * digests over the population is an O(N) diversity measure.
 */
export function profileDigest(profile: CognitiveProfile): string {
  let digest = "";
  for (const dimension of COGNITIVE_DIMENSIONS) {
    const level = Math.min(4, Math.floor(profile[dimension] * 5));
    digest += String(level);
  }
  return digest;
}

/** Mean absolute pairwise difference across a bounded sample — a spread metric. */
export function profileDiversityIndex(profiles: readonly CognitiveProfile[]): number {
  if (profiles.length < 2) return 0;
  // Bounded sample: compare each of the first N against the population mean,
  // O(N) not O(N^2). Mean per dimension, then mean absolute deviation.
  const mean = {} as Record<CognitiveDimension, number>;
  for (const dimension of COGNITIVE_DIMENSIONS) {
    let sum = 0;
    for (const profile of profiles) sum += profile[dimension];
    mean[dimension] = sum / profiles.length;
  }
  let deviation = 0;
  for (const profile of profiles) {
    for (const dimension of COGNITIVE_DIMENSIONS) deviation += Math.abs(profile[dimension] - mean[dimension]);
  }
  return roundTo(deviation / (profiles.length * COGNITIVE_DIMENSIONS.length), 4);
}

/** Push a working-memory note, evicting the oldest beyond the cap. */
export function rememberNote(mind: AntMind, tick: number, noteCode: string): AntMind {
  const working = [...mind.workingMemory, { tick, noteCode }];
  while (working.length > MIND_WORKING_MEMORY_CAP) working.shift();
  return { ...mind, workingMemory: working };
}

/**
 * Compact working memory into a single episodic summary, clearing the detail.
 * This is the bounded-memory guarantee in action: detail never accumulates —
 * it is periodically reduced to a scalar summary, itself capped.
 */
export function compactEpisodicMemory(
  mind: AntMind,
  spanStartTick: number,
  spanEndTick: number,
  successRate: number,
  dominantCategory: TaskCategory
): AntMind {
  const summaries = [
    ...mind.episodicSummaries,
    { spanStartTick, spanEndTick, successRate: roundTo(successRate, 4), dominantCategory, episodeCount: mind.workingMemory.length },
  ];
  while (summaries.length > MIND_EPISODIC_SUMMARY_CAP) summaries.shift();
  return { ...mind, episodicSummaries: summaries, workingMemory: [] };
}

/** Record a success or failure strategy pattern, keeping each list bounded. */
export function recordStrategyPattern(mind: AntMind, category: TaskCategory, success: boolean, weight: number): AntMind {
  const pattern: StrategyPattern = { category, strategyCode: `${success ? "ok" : "bad"}-${category}`, weight: roundTo(clamp(weight, 0, 1), 4) };
  if (success) {
    const patterns = [...mind.successPatterns, pattern];
    while (patterns.length > MIND_STRATEGY_PATTERN_CAP) patterns.shift();
    return { ...mind, successPatterns: patterns };
  }
  const patterns = [...mind.failurePatterns, pattern];
  while (patterns.length > MIND_STRATEGY_PATTERN_CAP) patterns.shift();
  return { ...mind, failurePatterns: patterns };
}

/** Add a bounded unresolved question. Oldest evicted past the cap. */
export function addUnresolvedQuestion(mind: AntMind, questionCode: string): AntMind {
  if (mind.unresolvedQuestions.includes(questionCode)) return mind;
  const questions = [...mind.unresolvedQuestions, questionCode];
  while (questions.length > MIND_UNRESOLVED_QUESTION_CAP) questions.shift();
  return { ...mind, unresolvedQuestions: questions };
}

/**
 * Apply bounded peer feedback to the mind: it nudges social trust, reputation,
 * caution, and one profile dimension — never overwrites, never unbounded.
 */
export function applyPeerFeedback(
  mind: AntMind,
  dimension: CognitiveDimension,
  positive: boolean
): AntMind {
  const delta = positive ? 0.05 : -0.06;
  const profile = { ...mind.cognitiveProfile, [dimension]: roundTo(clamp(mind.cognitiveProfile[dimension] + delta, 0, 1), 4) };
  return {
    ...mind,
    cognitiveProfile: profile,
    peerReputation: roundTo(clamp(mind.peerReputation + (positive ? 0.03 : -0.04), 0.05, 0.98), 4),
    caution: roundTo(clamp(mind.caution + (positive ? -0.02 : 0.04), 0, 1), 4),
  };
}

/** Every bounded surface is within its hard cap. Checked, never assumed. */
export function mindWithinBounds(mind: AntMind): boolean {
  return (
    mind.workingMemory.length <= MIND_WORKING_MEMORY_CAP &&
    mind.episodicSummaries.length <= MIND_EPISODIC_SUMMARY_CAP &&
    mind.successPatterns.length <= MIND_STRATEGY_PATTERN_CAP &&
    mind.failurePatterns.length <= MIND_STRATEGY_PATTERN_CAP &&
    mind.unresolvedQuestions.length <= MIND_UNRESOLVED_QUESTION_CAP
  );
}
