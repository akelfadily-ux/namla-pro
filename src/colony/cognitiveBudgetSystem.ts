/**
 * Colony Genesis G7 — cognitive budget and agent activation.
 *
 * Digital adaptation (docs/ant-colony-biological-model.md, section 8) — the
 * least biological element in the whole design, kept honest by one
 * discipline: it DENIES capability, it never DIRECTS behavior. An ant's task
 * choice (`currentBehaviorState`) is already fully decided by the
 * already-authorized G1-G3 `localTaskChoice.chooseWorkState` before anything
 * in this module runs. This module only labels, after the fact, which of
 * that tick's already-self-chosen working ants may additionally be
 * considered for deeper cognition — a rejected ant's task is completely
 * unaffected; it just proceeds with the decision it already made.
 *
 * Every ant computes its own claim from only its own local state (task
 * difficulty, choice ambiguity, recent failures, specialization,
 * reliability, energy, health) — never a population scan. The one
 * necessarily-central step is `resolveCognitionClaims`, which ranks that
 * tick's submitted claims and admits the top `maxSlots` — the same
 * "centralized admission control" the biological-model doc already
 * pre-authorizes for exactly this reason: bounded bulletin-board-style
 * resource admission, not task assignment. It never sets a task, never picks
 * a worker for a role, and never reads or writes any Queen state.
 *
 * Claims are recomputed fresh every tick (stateless): a rejected ant is
 * never excluded from future ticks (no starvation — its score is
 * re-evaluated from current conditions every tick), nothing is queued across
 * ticks (no unbounded waiting queue), and every admission "expires" at the
 * end of the tick it was granted, the simplest faithful reading of "slots
 * release when work ends, energy falls, or the claim expires."
 *
 * Only `"llm-eligible"` is ever set by this module, capped at `MAX_COGNITIVE_BUDGET`
 * by construction (`resolveCognitionClaims` never returns more than
 * `maxSlots` ids). `"deterministic-local"` and `"llm-active"` remain inert,
 * unreached code paths in this pass — a deliberate, conservative scope
 * choice: activating "deterministic-local" for every actively-working ant
 * would trivially blow past the 30-slot budget, since G1-G4 already lets up
 * to 300 ants work simultaneously. A future phase may activate a second
 * tier; this one keeps the existing peak-cognitive-eligibility ceiling
 * mechanically true rather than merely claimed.
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 15 (Colony Genesis G6-G7).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state,
 * no external call of any kind.
 */

import type { AntAgent } from "./antAgent";
import type { TaskCategory } from "./colonyTypes";
import { TASK_CATEGORIES, clamp, createSeededRandom, roundTo } from "./colonyTypes";

/** Hard cap. Not environment-configurable, not ant-changeable, tighten-only. */
export const MAX_COGNITIVE_BUDGET = 30 as const;

export interface CognitionClaim {
  readonly antId: string;
  readonly claimScore: number;
}

const SALT_TIEBREAK = 0x1b56c4e9;

function drawFor(colonySeed: number, antIndex: number, tick: number, salt: number): number {
  const h =
    (Math.imul(colonySeed ^ salt, 2654435761) ^ Math.imul(antIndex + 1, 40503) ^ Math.imul(tick + 1, 2246822519)) >>> 0;
  return createSeededRandom(h)();
}

/** The best and second-best engagement probabilities, for a choice-ambiguity read. */
function topTwoProbabilities(probabilities: Readonly<Record<TaskCategory, number>>): readonly [number, number] {
  let best = -1;
  let second = -1;
  for (const category of TASK_CATEGORIES) {
    const value = probabilities[category];
    if (value > best) {
      second = best;
      best = value;
    } else if (value > second) {
      second = value;
    }
  }
  return [Math.max(0, best), Math.max(0, second)];
}

/**
 * One ant's own cognition claim, from only its own already-local state:
 * task difficulty (its own threshold for the category it just attempted),
 * choice ambiguity (how close the top two categories scored in its own
 * chooseWorkState call), recent failures (its own failure history), its own
 * specialization and reliability, and its own energy/health. Returns null
 * for an ant that attempted no task this tick — nothing to claim cognition
 * for. Reads only the single ant passed in; never a population scan.
 */
export function computeCognitionClaim(
  ant: AntAgent,
  attemptedCategory: TaskCategory | null,
  choiceProbabilities: Readonly<Record<TaskCategory, number>>,
  colonySeed: number,
  tick: number
): CognitionClaim | null {
  if (attemptedCategory === null) return null;

  const taskDifficulty = ant.responseThresholds[attemptedCategory];

  const [top, second] = topTwoProbabilities(choiceProbabilities);
  const ambiguity = clamp(1 - Math.abs(top - second), 0, 1);

  const attempts = ant.successHistory[attemptedCategory] + ant.failureHistory[attemptedCategory];
  const recentFailureRate = attempts === 0 ? 0 : ant.failureHistory[attemptedCategory] / attempts;

  const specialization = clamp(1 - taskDifficulty, 0, 1);

  const jitter = (drawFor(colonySeed, ant.antIndex, tick, SALT_TIEBREAK) - 0.5) * 0.01;

  const claimScore = clamp(
    taskDifficulty * 0.25 +
      ambiguity * 0.25 +
      recentFailureRate * 0.15 +
      specialization * 0.1 +
      ant.reliability * 0.1 +
      ant.energy * 0.1 +
      ant.health * 0.05 +
      jitter,
    0,
    1
  );

  return { antId: ant.antId, claimScore: roundTo(claimScore, 6) };
}

/**
 * The one necessarily-central step: rank this tick's submitted claims and
 * admit the top `maxSlots`. Deterministic ordering by score, then by antId
 * (a stable tiebreak, never population-order-dependent). Never assigns a
 * task — the returned set only says WHO may additionally be labeled
 * cognitively eligible this tick, nothing about WHAT any ant does.
 */
export function resolveCognitionClaims(
  claims: readonly CognitionClaim[],
  maxSlots: number = MAX_COGNITIVE_BUDGET
): ReadonlySet<string> {
  const sorted = [...claims].sort((a, b) => b.claimScore - a.claimScore || a.antId.localeCompare(b.antId));
  return new Set(sorted.slice(0, Math.max(0, maxSlots)).map((claim) => claim.antId));
}

// --- Future-facing cognitive worker contract (type-only; never implemented or called) ---

export type CognitiveWorkerProviderId = "claude" | "codex" | "openai" | "anthropic" | "local-model";

export interface CognitionRequestContext {
  readonly antId: string;
  readonly taskCategory: TaskCategory;
  readonly claimScore: number;
}

export interface CognitionResponse {
  readonly recommendedAction: string;
  readonly confidence: number;
}

/**
 * The shape a real cognitive worker would satisfy, so a later, separately
 * authorized phase can attach one without redesigning this module. No
 * implementation of this interface exists anywhere in Namla Pro, nothing
 * constructs one, and nothing calls `requestCognition` — provider-ready, not
 * provider-active. `externalLlmCalls` stays literal-zero as long as that
 * remains true.
 */
export interface CognitiveWorkerContract {
  readonly providerId: CognitiveWorkerProviderId;
  requestCognition(context: CognitionRequestContext): CognitionResponse;
}
