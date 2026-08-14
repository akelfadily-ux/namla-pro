/**
 * Colony Genesis G0 — mechanical invariant checks.
 *
 * These are structural proofs run against a real ColonyGenesisState, not
 * comments claiming a property holds. Several of them deliberately re-check
 * things the type system already guarantees, because the type system does not
 * survive a cast and this project's threat model includes cast-smuggling.
 *
 * The strongest check here is `no-worker-holds-population-reference`: it walks
 * each ant's actual object graph looking for a colony/population/roster
 * back-reference or an unbounded collection. That is what turns "ants only
 * know what they observed" from a design intention into something a golden can
 * fail on.
 *
 * Pure: no fs, no wall clock, no randomness, no receipts, no mutation of input.
 */

import type { ColonyGenesisState } from "./colonyGenesis";
import { colonyStructuralDigest, createColonyGenesis } from "./colonyGenesis";
import type { AntAgent } from "./antAgent";
import { hasCompleteLocalState, hasCompleteThresholds, hasGenomeProfile } from "./antAgent";
import {
  COLONY_POPULATION_SIZE,
  COLONY_QUEEN_IDENTITY_COUNT,
  COLONY_WORKER_COUNT,
} from "./antPopulation";
import { isKnownChamberId, validateNestGraph } from "./nestGraph";
import { queenHoldsNoAuthority } from "./queenContinuitySystem";

export type ColonyInvariantCode =
  | "total-persistent-identities-300"
  | "queen-identities-1"
  | "worker-identities-299"
  | "unique-ant-ids-300"
  | "every-worker-valid-chamber"
  | "every-worker-genome-profile"
  | "every-worker-thresholds"
  | "every-worker-local-state"
  | "nest-graph-connected"
  | "nest-edges-reference-existing-chambers"
  | "queen-holds-no-task-authority"
  | "central-task-assignments-zero"
  | "queen-task-assignments-zero"
  | "no-worker-holds-population-reference"
  | "no-external-calls"
  | "no-cognitively-active-ants-at-genesis";

export interface ColonyInvariantCheck {
  readonly code: ColonyInvariantCode;
  readonly passed: boolean;
  /** Safe numeric evidence: counts only, never ids, paths, or raw text. */
  readonly observed: number;
  readonly expected: number;
}

export interface ColonyInvariantReport {
  readonly checks: readonly ColonyInvariantCheck[];
  readonly checksRun: number;
  readonly checksPassed: number;
  readonly failedCheckCodes: readonly ColonyInvariantCode[];
  readonly allPassed: boolean;
}

/** Keys that would mean an ant can see beyond its own local observations. */
const FORBIDDEN_ANT_KEYS = [
  "colony",
  "colonyState",
  "population",
  "workers",
  "allPersistentIdentityIds",
  "nestGraph",
  "roster",
  "queen",
  "scheduler",
  "assignedTask",
  "assignedTaskId",
  "taskAssignment",
];

/**
 * An ant's own local memories are bounded (encounter window, candidate
 * assessments). Any array inside an ant at or above this size means the ant is
 * carrying something population-scale.
 */
const MAX_ANT_LOCAL_ARRAY_LENGTH = 64;

function antHoldsGlobalReference(ant: AntAgent): boolean {
  const seen = new WeakSet<object>();

  const walk = (value: unknown, depth: number): boolean => {
    if (depth > 6) return false;

    if (Array.isArray(value)) {
      if (value.length > MAX_ANT_LOCAL_ARRAY_LENGTH) return true;
      return value.some((item) => walk(item, depth + 1));
    }

    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return false;
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_ANT_KEYS.includes(key)) return true;
        if (walk(child, depth + 1)) return true;
      }
    }

    return false;
  };

  return walk(ant as unknown, 0);
}

export function checkColonyGenesisInvariants(state: ColonyGenesisState): ColonyInvariantReport {
  const checks: ColonyInvariantCheck[] = [];
  const add = (code: ColonyInvariantCode, observed: number, expected: number) =>
    checks.push({ code, passed: observed === expected, observed, expected });

  const workers = state.workers;
  const uniqueIds = new Set(state.allPersistentIdentityIds);

  add("total-persistent-identities-300", state.allPersistentIdentityIds.length, COLONY_POPULATION_SIZE);
  add("queen-identities-1", state.queen ? 1 : 0, COLONY_QUEEN_IDENTITY_COUNT);
  add("worker-identities-299", workers.length, COLONY_WORKER_COUNT);
  add("unique-ant-ids-300", uniqueIds.size, COLONY_POPULATION_SIZE);

  add(
    "every-worker-valid-chamber",
    workers.filter((ant) => isKnownChamberId(ant.chamberId)).length,
    workers.length
  );
  add("every-worker-genome-profile", workers.filter(hasGenomeProfile).length, workers.length);
  add("every-worker-thresholds", workers.filter(hasCompleteThresholds).length, workers.length);
  add("every-worker-local-state", workers.filter(hasCompleteLocalState).length, workers.length);

  const nestValidation = validateNestGraph(state.nestGraph);
  add("nest-graph-connected", nestValidation.connected ? 1 : 0, 1);
  add("nest-edges-reference-existing-chambers", nestValidation.valid ? 1 : 0, 1);

  add("queen-holds-no-task-authority", queenHoldsNoAuthority(state.queen) ? 1 : 0, 1);
  add("central-task-assignments-zero", state.centralTaskAssignments, 0);
  add("queen-task-assignments-zero", state.queenTaskAssignments + state.queen.queenTaskAssignments, 0);

  add(
    "no-worker-holds-population-reference",
    workers.filter((ant) => antHoldsGlobalReference(ant)).length,
    0
  );

  add(
    "no-external-calls",
    state.externalLlmCalls + state.realFilesystemWrites + state.networkCalls + state.processExecutions,
    0
  );

  // Genesis has produced no stimulus, so no ant has any reason to be thinking.
  // This is also what keeps the future cognitive budget trivially satisfied at
  // tick 0: the peak starts at zero and G7 has to justify every increment.
  add(
    "no-cognitively-active-ants-at-genesis",
    workers.filter(
      (ant) =>
        ant.activationMode === "deterministic-local" ||
        ant.activationMode === "llm-eligible" ||
        ant.activationMode === "llm-active"
    ).length,
    0
  );

  const failed = checks.filter((c) => !c.passed);

  return {
    checks,
    checksRun: checks.length,
    checksPassed: checks.length - failed.length,
    failedCheckCodes: failed.map((c) => c.code),
    allPassed: failed.length === 0,
  };
}

export interface DeterminismCheck {
  readonly matches: boolean;
  readonly firstDigestLength: number;
  readonly secondDigestLength: number;
  readonly firstDivergentLineIndex: number;
}

/**
 * Build the same colony twice from identical inputs and compare structural
 * digests. Reports the first divergent line index (a number, never content) so
 * a failure is locatable without leaking colony data.
 */
export function checkDeterministicRerun(input: {
  readonly colonyId: string;
  readonly seed: number;
  readonly generation?: number;
}): DeterminismCheck {
  const first = colonyStructuralDigest(createColonyGenesis(input));
  const second = colonyStructuralDigest(createColonyGenesis(input));

  if (first === second) {
    return {
      matches: true,
      firstDigestLength: first.length,
      secondDigestLength: second.length,
      firstDivergentLineIndex: -1,
    };
  }

  const firstLines = first.split("\n");
  const secondLines = second.split("\n");
  let divergentIndex = Math.min(firstLines.length, secondLines.length);
  for (let i = 0; i < Math.min(firstLines.length, secondLines.length); i += 1) {
    if (firstLines[i] !== secondLines[i]) {
      divergentIndex = i;
      break;
    }
  }

  return {
    matches: false,
    firstDigestLength: first.length,
    secondDigestLength: second.length,
    firstDivergentLineIndex: divergentIndex,
  };
}
