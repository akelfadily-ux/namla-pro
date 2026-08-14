/**
 * Colony Genesis G0 — deterministic population creation.
 *
 * Produces exactly 299 worker-capable AntAgents from one genome plus one seed.
 * Every ant is distinct because its genome profile is derived from its index;
 * no ant is distinct because someone wrote a class for it.
 *
 * What this module does NOT do, by law and by design: it assigns no task, it
 * returns no schedule, it consults no planner, and it hands no ant a reference
 * to the population it belongs to. Placement puts an ant SOMEWHERE; it never
 * tells it what to do there.
 *
 * Determinism: every stochastic choice draws from a generator seeded by
 * (colonySeed, antIndex, purpose-salt). Because each ant owns its own stream,
 * iteration order cannot change any outcome — which is what will let this
 * scale to thousands of ants, and to parallel evaluation, without the result
 * drifting. Ambient (unseeded) randomness is prohibited here — see the
 * determinism checks in SAFETY_INVARIANTS.md, which grep for it by name.
 *
 * No fs, no wall clock, no module-level mutable counters.
 */

import type { Caste } from "./colonyTypes";
import { createSeededRandom } from "./colonyTypes";
import type { ColonyGenome } from "./colonyGenome";
import type { AntAgent } from "./antAgent";
import { createAntAgent } from "./antAgent";
import type { ChamberId, NestGraph } from "./nestGraph";

/** Exactly 300 persistent identities: 1 queen-system + 299 worker-capable. */
export const COLONY_POPULATION_SIZE = 300 as const;
export const COLONY_QUEEN_IDENTITY_COUNT = 1 as const;
export const COLONY_WORKER_COUNT = 299 as const;

/** Stable id prefixes. Ids are derived from the index — never from a counter. */
const QUEEN_ID_PREFIX = "namla-queen";
const WORKER_ID_PREFIX = "namla-ant";

/** Salts keep the caste, placement, and reserve draws independent per ant. */
const CASTE_SALT = 0x27d4eb2f;
const PLACEMENT_SALT = 0x165667b1;
const RESERVE_SALT = 0x9e3779b1;

export function queenIdentityId(): string {
  return `${QUEEN_ID_PREFIX}-000`;
}

export function workerIdentityId(antIndex: number): string {
  return `${WORKER_ID_PREFIX}-${String(antIndex).padStart(3, "0")}`;
}

function seedFor(colonySeed: number, antIndex: number, salt: number): number {
  // Mix the three inputs so neighboring indices do not produce correlated
  // streams. All arithmetic is 32-bit and platform-independent.
  return (Math.imul(colonySeed ^ salt, 2654435761) ^ Math.imul(antIndex + 1, 40503)) >>> 0;
}

/**
 * Morphological caste distribution. Tendencies only — a caste biases an ant's
 * thresholds and where it starts, and constrains nothing about what it may
 * later choose to do. A soldier that finds strong nursing demand and no danger
 * will nurse.
 */
const CASTE_BANDS: ReadonlyArray<{ readonly caste: Caste; readonly cumulative: number }> = [
  { caste: "scout", cumulative: 0.15 },
  { caste: "soldier", cumulative: 0.33 },
  { caste: "major-worker", cumulative: 0.58 },
  { caste: "minor-worker", cumulative: 1 },
];

function pickCaste(colonySeed: number, antIndex: number): Caste {
  const draw = createSeededRandom(seedFor(colonySeed, antIndex, CASTE_SALT))();
  for (const band of CASTE_BANDS) {
    if (draw < band.cumulative) return band.caste;
  }
  return "minor-worker";
}

/**
 * Where each caste plausibly starts. The queen-chamber is deliberately absent:
 * the queen resides there and G0 places no worker in it.
 */
const CASTE_HOME_CHAMBERS: Record<Caste, readonly ChamberId[]> = {
  queen: ["queen-chamber"],
  scout: ["entrance", "foraging-zone-1", "foraging-zone-2", "foraging-zone-3"],
  soldier: ["defense-gate", "entrance"],
  "major-worker": ["workshop", "food-storage", "repair-chamber"],
  "minor-worker": ["nursery", "brood-chamber", "food-storage", "knowledge-storage", "waste-chamber"],
};

function pickChamber(colonySeed: number, antIndex: number, caste: Caste, graph: NestGraph): ChamberId {
  const known = new Set<string>(graph.chambers.map((c) => c.chamberId));
  const candidates = CASTE_HOME_CHAMBERS[caste].filter((chamberId) => known.has(chamberId));
  // A caste whose home chambers are all absent still has to live somewhere;
  // falling back to the first real chamber keeps "every worker has a valid
  // chamber" true by construction rather than by hope.
  if (candidates.length === 0) return graph.chambers[0].chamberId;
  const draw = createSeededRandom(seedFor(colonySeed, antIndex, PLACEMENT_SALT))();
  return candidates[Math.min(candidates.length - 1, Math.floor(draw * candidates.length))];
}

function startsInReserve(colonySeed: number, antIndex: number, genome: ColonyGenome): boolean {
  const draw = createSeededRandom(seedFor(colonySeed, antIndex, RESERVE_SALT))();
  return draw < genome.reserveFraction;
}

export interface CreateWorkerPopulationInput {
  readonly colonySeed: number;
  readonly genome: ColonyGenome;
  readonly nestGraph: NestGraph;
  readonly generation: number;
  /** Defaults to the law-fixed 299. Present so invariant tests can prove the cap. */
  readonly workerCount?: number;
}

/**
 * Create the worker population in deterministic index order (1..299). The
 * queen occupies index 0 of the identity space, so worker indices start at 1
 * and every one of the 300 ids stays unique.
 */
export function createWorkerPopulation(input: CreateWorkerPopulationInput): readonly AntAgent[] {
  const count = input.workerCount ?? COLONY_WORKER_COUNT;
  const workers: AntAgent[] = [];

  for (let antIndex = 1; antIndex <= count; antIndex += 1) {
    const caste = pickCaste(input.colonySeed, antIndex);
    workers.push(
      createAntAgent({
        antId: workerIdentityId(antIndex),
        antIndex,
        generation: input.generation,
        caste,
        genome: input.genome,
        chamberId: pickChamber(input.colonySeed, antIndex, caste, input.nestGraph),
        startsInReserve: startsInReserve(input.colonySeed, antIndex, input.genome),
      })
    );
  }

  return workers;
}

/** Population shape summary. Counts only — never the ants themselves. */
export interface PopulationCensus {
  readonly workerCount: number;
  readonly casteCounts: Readonly<Record<Caste, number>>;
  readonly reserveCount: number;
  readonly restingCount: number;
  readonly cognitivelyActiveCount: number;
  readonly chambersOccupied: number;
}

export function censusWorkers(workers: readonly AntAgent[]): PopulationCensus {
  const casteCounts = {
    queen: 0,
    "minor-worker": 0,
    "major-worker": 0,
    soldier: 0,
    scout: 0,
  } as Record<Caste, number>;

  const chambers = new Set<string>();
  let reserveCount = 0;
  let restingCount = 0;
  let cognitivelyActiveCount = 0;

  for (const ant of workers) {
    casteCounts[ant.caste] += 1;
    chambers.add(ant.chamberId);
    if (ant.activationMode === "reserve") reserveCount += 1;
    if (ant.activationMode === "resting") restingCount += 1;
    if (
      ant.activationMode === "deterministic-local" ||
      ant.activationMode === "llm-eligible" ||
      ant.activationMode === "llm-active"
    ) {
      cognitivelyActiveCount += 1;
    }
  }

  return {
    workerCount: workers.length,
    casteCounts,
    reserveCount,
    restingCount,
    cognitivelyActiveCount,
    chambersOccupied: chambers.size,
  };
}
