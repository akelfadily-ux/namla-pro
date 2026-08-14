/**
 * Colony Genesis G0 — the pure genesis function.
 *
 * `createColonyGenesis` assembles one complete colony: genome, nest, queen,
 * and 299 workers. It is a pure function of (colonyId, seed, generation): call
 * it twice with the same inputs and you get structurally identical colonies.
 *
 * There is no tick loop. Nothing runs after this function returns, because
 * there is nothing to run — G0 creates identity and topology, not behavior.
 *
 * The six zero-typed counters are literal `0`, not merely initialized to zero.
 * A colony that performed a central assignment, a queen assignment, an LLM
 * call, a filesystem write, a network call, or a process execution cannot be
 * expressed in this type, so a golden asserting them cannot be quietly broken
 * by a later phase widening a number.
 *
 * No fs, no wall clock, no randomness beyond the seeded generators, no
 * module-level mutable state.
 */

import type { ColonyGenome } from "./colonyGenome";
import { createDefaultColonyGenome } from "./colonyGenome";
import type { AntAgent } from "./antAgent";
import type { NestGraph } from "./nestGraph";
import { createNestGraph } from "./nestGraph";
import type { QueenContinuityRecord } from "./queenContinuitySystem";
import { createQueenContinuitySystem } from "./queenContinuitySystem";
import {
  COLONY_WORKER_COUNT,
  createWorkerPopulation,
  queenIdentityId,
} from "./antPopulation";

/** The first tick of any colony. G0 never advances past it. */
export const GENESIS_TICK = 0 as const;

export interface ColonyGenesisState {
  readonly colonyId: string;
  readonly seed: number;
  readonly generation: number;
  readonly genome: ColonyGenome;
  readonly queen: QueenContinuityRecord;
  readonly nestGraph: NestGraph;
  readonly workers: readonly AntAgent[];
  /** Every persistent identity in the colony: queen first, then workers. */
  readonly allPersistentIdentityIds: readonly string[];
  readonly createdAtTick: 0;

  // --- literal-zero authority counters (unrepresentable as nonzero) ---
  readonly centralTaskAssignments: 0;
  readonly queenTaskAssignments: 0;
  readonly externalLlmCalls: 0;
  readonly realFilesystemWrites: 0;
  readonly networkCalls: 0;
  readonly processExecutions: 0;
}

export interface CreateColonyGenesisInput {
  readonly colonyId: string;
  readonly seed: number;
  /** Genesis is generation 1 unless a later lineage phase says otherwise. */
  readonly generation?: number;
  /** Optional genome override; defaults to the Colony Genesis V1 genome. */
  readonly genome?: ColonyGenome;
  /** Optional worker-count override, for invariant tests that prove the cap. */
  readonly workerCount?: number;
}

export function createColonyGenesis(input: CreateColonyGenesisInput): ColonyGenesisState {
  const generation = input.generation ?? 1;
  const genome = input.genome ?? createDefaultColonyGenome();
  const nestGraph = createNestGraph();

  const queen = createQueenContinuitySystem({
    queenId: queenIdentityId(),
    colonyId: input.colonyId,
    generation,
    genomeId: genome.genomeId,
    // A genome parameter the queen CARRIES; brood production itself is G6.
    broodCapacityPerGeneration: COLONY_WORKER_COUNT,
    chamberId: "queen-chamber",
  });

  const workers = createWorkerPopulation({
    colonySeed: input.seed,
    genome,
    nestGraph,
    generation,
    workerCount: input.workerCount,
  });

  return {
    colonyId: input.colonyId,
    seed: input.seed,
    generation,
    genome,
    queen,
    nestGraph,
    workers,
    allPersistentIdentityIds: [queen.queenId, ...workers.map((ant) => ant.antId)],
    createdAtTick: GENESIS_TICK,

    centralTaskAssignments: 0,
    queenTaskAssignments: 0,
    externalLlmCalls: 0,
    realFilesystemWrites: 0,
    networkCalls: 0,
    processExecutions: 0,
  };
}

/**
 * A stable, structural fingerprint of everything a rerun must reproduce:
 * identity ids in order, each ant's caste, chamber, activation mode, and
 * rounded thresholds, plus the nest shape and queen lineage.
 *
 * Deliberately excludes nothing unstable, because nothing unstable exists —
 * there are no timestamps, no random ids, and no wall-clock values anywhere in
 * a colony. That is the point of the determinism law.
 */
export function colonyStructuralDigest(state: ColonyGenesisState): string {
  const parts: string[] = [
    `colony:${state.colonyId}`,
    `seed:${state.seed}`,
    `generation:${state.generation}`,
    `genome:${state.genome.genomeId}`,
    `tick:${state.createdAtTick}`,
    `queen:${state.queen.queenId}:${state.queen.lineageDepth}:${state.queen.chamberId}`,
    `chambers:${state.nestGraph.chamberCount}`,
    `edges:${state.nestGraph.edgeCount}`,
    `identities:${state.allPersistentIdentityIds.length}`,
  ];

  for (const ant of state.workers) {
    const thresholds = Object.entries(ant.responseThresholds)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, value]) => `${category}=${value}`)
      .join(",");
    parts.push(
      `${ant.antId}|${ant.caste}|${ant.chamberId}|${ant.activationMode}|${ant.currentBehaviorState}|${ant.taskSwitchCost}|${thresholds}`
    );
  }

  return parts.join("\n");
}
