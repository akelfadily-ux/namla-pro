/**
 * Colony Genesis G0 — deterministic graph-based nest topology.
 *
 * The nest is a graph, not a flat list, because locality is what makes a
 * decentralized colony tractable: an ant reads signals from the chamber it
 * occupies and (later, in G1+) a degraded summary of adjacent chambers. That
 * bounds every future interaction to a neighborhood instead of the whole
 * population, and it is the structural reason encounters can never become an
 * all-to-all O(N^2) sweep.
 *
 * G0 builds and validates the graph only. No ant moves, no signal is
 * deposited, and no chamber carries state yet.
 *
 * Determinism: chamber ids and the edge list are fixed code constants. No fs,
 * no wall clock, no randomness, no module-level mutable state. Building the
 * graph twice yields structurally identical output.
 */

/** Canonical chamber ids. Stable strings — never generated, never indexed by number. */
export const CHAMBER_IDS = [
  "queen-chamber",
  "brood-chamber",
  "nursery",
  "entrance",
  "defense-gate",
  "workshop",
  "food-storage",
  "knowledge-storage",
  "repair-chamber",
  "waste-chamber",
  "foraging-zone-1",
  "foraging-zone-2",
  "foraging-zone-3",
] as const;

export type ChamberId = (typeof CHAMBER_IDS)[number];

/**
 * Coarse chamber purpose. Used in G0 only to place ants plausibly; it grants
 * no capability and assigns no task. A chamber's purpose biases WHERE an ant
 * starts, never WHAT it will do — task choice is a G2 concern and is made by
 * the ant, not by the nest.
 */
export type ChamberPurpose =
  | "royal"
  | "brood"
  | "storage"
  | "work"
  | "threshold"
  | "external";

export interface NestChamber {
  readonly chamberId: ChamberId;
  readonly purpose: ChamberPurpose;
  /** Neighbors, sorted, deterministic. */
  readonly adjacentChamberIds: readonly ChamberId[];
}

export interface NestGraph {
  readonly chambers: readonly NestChamber[];
  /** Undirected edges as ordered pairs, deduplicated and sorted. */
  readonly edges: readonly (readonly [ChamberId, ChamberId])[];
  readonly chamberCount: number;
  readonly edgeCount: number;
  /** Directed adjacency entries: exactly 2 x edgeCount for a valid graph. */
  readonly adjacencyEntryCount: number;
}

const CHAMBER_PURPOSES: Record<ChamberId, ChamberPurpose> = {
  "queen-chamber": "royal",
  "brood-chamber": "brood",
  nursery: "brood",
  entrance: "threshold",
  "defense-gate": "threshold",
  workshop: "work",
  "food-storage": "storage",
  "knowledge-storage": "storage",
  "repair-chamber": "work",
  "waste-chamber": "work",
  "foraging-zone-1": "external",
  "foraging-zone-2": "external",
  "foraging-zone-3": "external",
};

/**
 * The undirected edge list. Written once, deliberately: the deep nest
 * (queen/brood/nursery) is reachable from the outside world only through
 * storage and work chambers, so future foraging pressure has to propagate
 * inward through the colony rather than teleport.
 */
const UNDIRECTED_EDGES: ReadonlyArray<readonly [ChamberId, ChamberId]> = [
  ["entrance", "foraging-zone-1"],
  ["entrance", "foraging-zone-2"],
  ["entrance", "foraging-zone-3"],
  ["entrance", "defense-gate"],
  ["entrance", "workshop"],
  ["entrance", "food-storage"],
  ["workshop", "defense-gate"],
  ["workshop", "food-storage"],
  ["workshop", "knowledge-storage"],
  ["workshop", "repair-chamber"],
  ["repair-chamber", "waste-chamber"],
  ["food-storage", "nursery"],
  ["nursery", "brood-chamber"],
  ["nursery", "queen-chamber"],
  ["brood-chamber", "queen-chamber"],
  ["queen-chamber", "knowledge-storage"],
];

export type NestValidationCode =
  | "nest-valid"
  | "edge-references-unknown-chamber"
  | "edge-is-self-loop"
  | "duplicate-edge"
  | "graph-not-connected"
  | "adjacency-not-symmetric";

export interface NestValidation {
  readonly valid: boolean;
  readonly code: NestValidationCode;
  readonly connected: boolean;
  readonly reachableChamberCount: number;
  readonly chamberCount: number;
}

function normalizeEdge(a: ChamberId, b: ChamberId): readonly [ChamberId, ChamberId] {
  return a <= b ? [a, b] : [b, a];
}

/** Build the canonical nest. Pure: same output structure on every call. */
export function createNestGraph(): NestGraph {
  const known = new Set<string>(CHAMBER_IDS);

  // Deduplicate and canonically order every edge before deriving adjacency,
  // so adjacency is symmetric by construction rather than by convention.
  const edgeKeys = new Set<string>();
  const edges: Array<readonly [ChamberId, ChamberId]> = [];
  for (const [a, b] of UNDIRECTED_EDGES) {
    if (!known.has(a) || !known.has(b) || a === b) continue;
    const edge = normalizeEdge(a, b);
    const key = `${edge[0]}|${edge[1]}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push(edge);
  }
  edges.sort((x, y) => (x[0] === y[0] ? x[1].localeCompare(y[1]) : x[0].localeCompare(y[0])));

  const neighbors = new Map<ChamberId, ChamberId[]>();
  for (const chamberId of CHAMBER_IDS) neighbors.set(chamberId, []);
  for (const [a, b] of edges) {
    neighbors.get(a)!.push(b);
    neighbors.get(b)!.push(a);
  }

  const chambers: NestChamber[] = CHAMBER_IDS.map((chamberId) => ({
    chamberId,
    purpose: CHAMBER_PURPOSES[chamberId],
    adjacentChamberIds: [...neighbors.get(chamberId)!].sort(),
  }));

  return {
    chambers,
    edges,
    chamberCount: chambers.length,
    edgeCount: edges.length,
    adjacencyEntryCount: chambers.reduce((sum, c) => sum + c.adjacentChamberIds.length, 0),
  };
}

/**
 * Validate structure: every edge references a real chamber, no self-loops or
 * duplicates survive, adjacency is symmetric, and the graph is connected. A
 * disconnected nest would silently strand a sub-population, so connectivity
 * is checked rather than assumed.
 */
export function validateNestGraph(graph: NestGraph): NestValidation {
  const known = new Set<string>(graph.chambers.map((c) => c.chamberId));
  const chamberCount = graph.chambers.length;

  const fail = (code: NestValidationCode, reachable: number): NestValidation => ({
    valid: false,
    code,
    connected: reachable === chamberCount && chamberCount > 0,
    reachableChamberCount: reachable,
    chamberCount,
  });

  const seenEdges = new Set<string>();
  for (const [a, b] of graph.edges) {
    if (!known.has(a) || !known.has(b)) return fail("edge-references-unknown-chamber", 0);
    if (a === b) return fail("edge-is-self-loop", 0);
    const key = `${a}|${b}`;
    if (seenEdges.has(key)) return fail("duplicate-edge", 0);
    seenEdges.add(key);
  }

  const adjacency = new Map<string, Set<string>>();
  for (const chamber of graph.chambers) {
    for (const neighbor of chamber.adjacentChamberIds) {
      if (!known.has(neighbor)) return fail("edge-references-unknown-chamber", 0);
      if (!adjacency.has(chamber.chamberId)) adjacency.set(chamber.chamberId, new Set());
      adjacency.get(chamber.chamberId)!.add(neighbor);
    }
  }
  for (const [chamberId, neighborSet] of adjacency) {
    for (const neighbor of neighborSet) {
      if (!adjacency.get(neighbor)?.has(chamberId)) return fail("adjacency-not-symmetric", 0);
    }
  }

  // Breadth-first reachability from the first chamber.
  const start = graph.chambers[0]?.chamberId;
  const visited = new Set<string>();
  if (start) {
    const queue: string[] = [start];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  if (visited.size !== chamberCount) return fail("graph-not-connected", visited.size);

  return {
    valid: true,
    code: "nest-valid",
    connected: true,
    reachableChamberCount: visited.size,
    chamberCount,
  };
}

export function isKnownChamberId(value: string): value is ChamberId {
  return (CHAMBER_IDS as readonly string[]).includes(value);
}

/** Chambers grouped by purpose — used for deterministic genesis placement only. */
export function chambersWithPurpose(graph: NestGraph, purpose: ChamberPurpose): readonly ChamberId[] {
  return graph.chambers.filter((c) => c.purpose === purpose).map((c) => c.chamberId);
}
