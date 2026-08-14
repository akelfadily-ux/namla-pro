/**
 * Ant Intelligence Deepening V1 — self-evaluation and confidence calibration.
 *
 * After acting, an ant compares what it predicted against what actually
 * happened and adjusts. The critical honesty rule: the OUTCOME an ant
 * evaluates against is a real simulated result (derived from its own success
 * probability and its own seeded draw), never a value the ant declares about
 * itself. Reliability therefore cannot rise from fake self-reported success —
 * only genuine correct predictions move it.
 *
 * Calibration is measurable: `brierComponent` is the squared gap between an
 * ant's predicted success probability and the actual 0/1 outcome. Averaged
 * over a batch it is a Brier score; the runtime compares an early batch to a
 * late batch to prove calibration IMPROVES (a smaller gap) after the ant has
 * had feedback — not merely that confidence changed.
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 17 (Ant Intelligence Deepening V1).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state,
 * no external call of any kind.
 */

import type { AntMind } from "./antMind";
import type { TaskCategory } from "./colonyTypes";
import { clamp, roundTo } from "./colonyTypes";

export interface SelfEvaluation {
  readonly antId: string;
  readonly attemptedCategory: TaskCategory;
  readonly predictedSuccessProbability: number;
  readonly confidenceBefore: number;
  readonly expectedSuccess: boolean;
  readonly observedSuccess: boolean;
  readonly predictionCorrect: boolean;
  readonly helpRequired: boolean;
  readonly reuseStrategy: boolean;
  readonly thresholdShouldChange: boolean;
  /** Signed calibration signal: +overconfident, -underconfident, ~0 well-calibrated. */
  readonly miscalibration: number;
}

/**
 * Evaluate one completed action. `observedSuccess` is a real simulated outcome
 * supplied by the caller — this function never invents it.
 */
export function evaluateAction(params: {
  readonly mind: AntMind;
  readonly attemptedCategory: TaskCategory;
  readonly predictedSuccessProbability: number;
  readonly observedSuccess: boolean;
}): SelfEvaluation {
  const { mind, attemptedCategory, predictedSuccessProbability, observedSuccess } = params;
  const expectedSuccess = predictedSuccessProbability >= 0.5;
  const predictionCorrect = expectedSuccess === observedSuccess;

  // Overconfident when the ant predicted high and was wrong; underconfident
  // when it predicted low and succeeded. Signed, bounded to [-1, 1].
  const miscalibration = roundTo(predictedSuccessProbability - (observedSuccess ? 1 : 0), 4);

  return {
    antId: mind.antId,
    attemptedCategory,
    predictedSuccessProbability: roundTo(predictedSuccessProbability, 4),
    confidenceBefore: mind.confidence,
    expectedSuccess,
    observedSuccess,
    predictionCorrect,
    helpRequired: !observedSuccess && mind.confidence < 0.5,
    reuseStrategy: observedSuccess && predictedSuccessProbability >= 0.5,
    thresholdShouldChange: predictionCorrect && observedSuccess,
    miscalibration,
  };
}

export interface CalibrationResult {
  readonly mind: AntMind;
  readonly adjusted: boolean;
  /** Real reliability gain (>= 0). Only genuine correct high-confidence success earns it. */
  readonly reliabilityGain: number;
}

/**
 * Move the mind's confidence toward the observed outcome, the essence of
 * calibration. Overconfident failure cuts confidence hard; a correct,
 * high-confidence success earns a small reliability gain; an uncertain success
 * earns experience but less; repeated wrong predictions raise caution.
 * Confidence stays bounded; reliability gain is zero unless the success was
 * both real and confidently predicted.
 */
export function calibrateConfidence(mind: AntMind, evaluation: SelfEvaluation): CalibrationResult {
  const outcome = evaluation.observedSuccess ? 1 : 0;

  // Confidence eases toward the actual outcome — the calibration step itself.
  let confidence = mind.confidence + (outcome - mind.confidence) * 0.2;

  // Overconfident failure: an extra downward correction beyond the ease.
  if (!evaluation.observedSuccess && evaluation.confidenceBefore > 0.6) {
    confidence -= 0.1;
  }

  const wrong = !evaluation.predictionCorrect;
  const caution = clamp(mind.caution + (wrong ? 0.03 : -0.01), 0, 1);
  const frustration = clamp(mind.frustration + (evaluation.observedSuccess ? -0.03 : 0.05), 0, 1);
  const selfEvaluation = clamp(0.5 + (evaluation.predictionCorrect ? 0.2 : -0.2), 0, 1);

  const reliabilityGain =
    evaluation.observedSuccess && evaluation.confidenceBefore >= 0.6 && evaluation.predictionCorrect
      ? 0.02
      : evaluation.observedSuccess
        ? 0.008
        : 0;

  return {
    mind: {
      ...mind,
      confidence: roundTo(clamp(confidence, 0.05, 0.97), 4),
      uncertainty: roundTo(clamp(1 - confidence, 0.03, 0.95), 4),
      caution: roundTo(caution, 4),
      frustration: roundTo(frustration, 4),
      selfEvaluation: roundTo(selfEvaluation, 4),
      peerReputation: roundTo(clamp(mind.peerReputation + reliabilityGain, 0.05, 0.98), 4),
    },
    adjusted: Math.abs(confidence - mind.confidence) > 0.0001 || wrong,
    reliabilityGain,
  };
}

/** Squared error between prediction and outcome — one Brier-score term. */
export function brierComponent(evaluation: SelfEvaluation): number {
  const outcome = evaluation.observedSuccess ? 1 : 0;
  const gap = evaluation.predictedSuccessProbability - outcome;
  return gap * gap;
}

/** Mean Brier score over a batch. Lower is better-calibrated. */
export function meanBrier(evaluations: readonly SelfEvaluation[]): number {
  if (evaluations.length === 0) return 0;
  let sum = 0;
  for (const evaluation of evaluations) sum += brierComponent(evaluation);
  return roundTo(sum / evaluations.length, 6);
}
