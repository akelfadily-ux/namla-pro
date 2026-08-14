/**
 * Ant Intelligence Deepening V1 — bounded colony knowledge and learning.
 *
 * A BOUNDED, in-memory knowledge store (no filesystem, no database). Ants
 * contribute verified patterns, disproven patterns, reusable strategies, known
 * risks, heuristics, review evidence, and repair lessons. A contribution is
 * admitted only after passing source attribution, a confidence threshold, a
 * bounded peer-review signal, a contradiction check, and versioning. The store
 * has a hard capacity: the stalest low-value entry is retired when it is full.
 *
 * Two hard rules make this safe at any scale:
 *  - an ant retrieves only task-RELEVANT knowledge, capped — no ant ever pulls
 *    the whole store into local memory;
 *  - contradictory knowledge stays VISIBLE (both entries flagged) until an ant
 *    resolves it with evidence, never silently overwritten.
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 17 (Ant Intelligence Deepening V1).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state,
 * no external call of any kind.
 */

import type { TaskCategory } from "./colonyTypes";
import { clamp, roundTo } from "./colonyTypes";

export const KNOWLEDGE_KINDS = [
  "verified-pattern",
  "disproven-pattern",
  "reusable-strategy",
  "known-risk",
  "heuristic",
  "review-evidence",
  "repair-lesson",
] as const;

export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export const KNOWLEDGE_STORE_CAPACITY = 64 as const;
export const KNOWLEDGE_CONFIDENCE_THRESHOLD = 0.5 as const;
export const MAX_KNOWLEDGE_RETRIEVAL = 5 as const;

export type KnowledgeStatus = "active" | "contradicted" | "retired";

export interface KnowledgeEntry {
  readonly entryId: string;
  readonly kind: KnowledgeKind;
  readonly category: TaskCategory;
  readonly claimCode: string;
  readonly sourceAntId: string;
  readonly confidence: number;
  readonly version: number;
  readonly supportCount: number;
  readonly refuteCount: number;
  readonly status: KnowledgeStatus;
  readonly lastTouchedTick: number;
  /** True for a claim asserting the opposite of an existing claim. */
  readonly polarityPositive: boolean;
}

export interface ColonyKnowledgeStore {
  readonly entries: readonly KnowledgeEntry[];
  readonly nextEntryOrdinal: number;
}

export function createKnowledgeStore(): ColonyKnowledgeStore {
  return { entries: [], nextEntryOrdinal: 0 };
}

export interface KnowledgeProposal {
  readonly kind: KnowledgeKind;
  readonly category: TaskCategory;
  readonly claimCode: string;
  readonly sourceAntId: string;
  readonly confidence: number;
  readonly peerReviewScore: number;
  readonly polarityPositive: boolean;
  readonly tick: number;
}

export interface ProposeKnowledgeResult {
  readonly store: ColonyKnowledgeStore;
  readonly accepted: boolean;
  readonly rejectedReasonCode: string;
  readonly contradictionDetected: boolean;
  readonly reinforcedExisting: boolean;
  readonly retiredStaleEntry: boolean;
}

function keyOf(category: TaskCategory, claimCode: string): string {
  return `${category}|${claimCode}`;
}

/**
 * Propose one knowledge contribution. Rejected for missing attribution, low
 * confidence, or a failed peer-review signal. A claim matching an existing one
 * reinforces it (support++, version++); a claim of OPPOSITE polarity to an
 * existing active claim flags BOTH as contradicted and is not silently merged.
 */
export function proposeKnowledge(store: ColonyKnowledgeStore, proposal: KnowledgeProposal): ProposeKnowledgeResult {
  const fail = (reasonCode: string): ProposeKnowledgeResult => ({
    store,
    accepted: false,
    rejectedReasonCode: reasonCode,
    contradictionDetected: false,
    reinforcedExisting: false,
    retiredStaleEntry: false,
  });

  if (!proposal.sourceAntId) return fail("missing-attribution");
  if (proposal.confidence < KNOWLEDGE_CONFIDENCE_THRESHOLD) return fail("below-confidence-threshold");
  if (proposal.peerReviewScore < 0.5) return fail("failed-peer-review");

  const key = keyOf(proposal.category, proposal.claimCode);
  const existingIndex = store.entries.findIndex(
    (e) => keyOf(e.category, e.claimCode) === key && e.status !== "retired"
  );

  // Same claim already present.
  if (existingIndex >= 0) {
    const existing = store.entries[existingIndex];
    if (existing.polarityPositive === proposal.polarityPositive) {
      // Reinforce and version up.
      const updated: KnowledgeEntry = {
        ...existing,
        confidence: roundTo(clamp((existing.confidence + proposal.confidence) / 2 + 0.02, 0, 1), 4),
        version: existing.version + 1,
        supportCount: existing.supportCount + 1,
        lastTouchedTick: proposal.tick,
      };
      const entries = store.entries.map((e, i) => (i === existingIndex ? updated : e));
      return {
        store: { ...store, entries },
        accepted: true,
        rejectedReasonCode: "none",
        contradictionDetected: false,
        reinforcedExisting: true,
        retiredStaleEntry: false,
      };
    }

    // Opposite polarity — a real contradiction. Flag BOTH, keep both visible.
    const flaggedExisting: KnowledgeEntry = {
      ...existing,
      status: "contradicted",
      refuteCount: existing.refuteCount + 1,
      lastTouchedTick: proposal.tick,
    };
    const contradicting: KnowledgeEntry = {
      entryId: `k-${store.nextEntryOrdinal}`,
      kind: proposal.kind,
      category: proposal.category,
      claimCode: proposal.claimCode,
      sourceAntId: proposal.sourceAntId,
      confidence: roundTo(proposal.confidence, 4),
      version: 1,
      supportCount: 1,
      refuteCount: 0,
      status: "contradicted",
      lastTouchedTick: proposal.tick,
      polarityPositive: proposal.polarityPositive,
    };
    const entries = store.entries.map((e, i) => (i === existingIndex ? flaggedExisting : e));
    entries.push(contradicting);
    return {
      store: { ...store, entries, nextEntryOrdinal: store.nextEntryOrdinal + 1 },
      accepted: true,
      rejectedReasonCode: "none",
      contradictionDetected: true,
      reinforcedExisting: false,
      retiredStaleEntry: false,
    };
  }

  // New entry. Retire the stalest active entry first if at capacity.
  let entries = [...store.entries];
  let retiredStaleEntry = false;
  const activeCount = entries.filter((e) => e.status !== "retired").length;
  if (activeCount >= KNOWLEDGE_STORE_CAPACITY) {
    let stalestIndex = -1;
    let stalestScore = Infinity;
    for (let i = 0; i < entries.length; i += 1) {
      if (entries[i].status === "retired") continue;
      const score = entries[i].lastTouchedTick + entries[i].supportCount * 5;
      if (score < stalestScore) {
        stalestScore = score;
        stalestIndex = i;
      }
    }
    if (stalestIndex >= 0) {
      entries[stalestIndex] = { ...entries[stalestIndex], status: "retired" };
      retiredStaleEntry = true;
    }
  }

  entries.push({
    entryId: `k-${store.nextEntryOrdinal}`,
    kind: proposal.kind,
    category: proposal.category,
    claimCode: proposal.claimCode,
    sourceAntId: proposal.sourceAntId,
    confidence: roundTo(proposal.confidence, 4),
    version: 1,
    supportCount: 1,
    refuteCount: 0,
    status: "active",
    lastTouchedTick: proposal.tick,
    polarityPositive: proposal.polarityPositive,
  });

  return {
    store: { ...store, entries, nextEntryOrdinal: store.nextEntryOrdinal + 1 },
    accepted: true,
    rejectedReasonCode: "none",
    contradictionDetected: false,
    reinforcedExisting: false,
    retiredStaleEntry,
  };
}

/**
 * Retrieve only task-relevant, active entries — capped at MAX_KNOWLEDGE_RETRIEVAL.
 * An ant can never pull the whole store: the cap is enforced here, at the one
 * retrieval site.
 */
export function retrieveRelevantKnowledge(
  store: ColonyKnowledgeStore,
  category: TaskCategory,
  limit: number = MAX_KNOWLEDGE_RETRIEVAL
): readonly KnowledgeEntry[] {
  const cap = Math.min(Math.max(0, limit), MAX_KNOWLEDGE_RETRIEVAL);
  return store.entries
    .filter((e) => e.category === category && e.status === "active")
    .sort((a, b) => b.confidence - a.confidence || a.entryId.localeCompare(b.entryId))
    .slice(0, cap);
}

export interface ContradictionResolution {
  readonly store: ColonyKnowledgeStore;
  readonly resolved: boolean;
}

/**
 * Resolve a flagged contradiction using accumulated evidence: whichever claim
 * has more net support survives as active, the other retires. Never resolved
 * by fiat — only by the support/refute counts the ants themselves produced.
 */
export function resolveContradiction(store: ColonyKnowledgeStore, category: TaskCategory, claimCode: string): ContradictionResolution {
  const key = keyOf(category, claimCode);
  const contested = store.entries
    .map((entry, index) => ({ entry, index }))
    .filter((x) => keyOf(x.entry.category, x.entry.claimCode) === key && x.entry.status === "contradicted");

  if (contested.length < 2) return { store, resolved: false };

  let winner = contested[0];
  for (const candidate of contested) {
    const net = candidate.entry.supportCount - candidate.entry.refuteCount;
    const winnerNet = winner.entry.supportCount - winner.entry.refuteCount;
    if (net > winnerNet || (net === winnerNet && candidate.entry.confidence > winner.entry.confidence)) {
      winner = candidate;
    }
  }

  const entries = store.entries.map((entry, index) => {
    if (keyOf(entry.category, entry.claimCode) !== key || entry.status !== "contradicted") return entry;
    return index === winner.index ? { ...entry, status: "active" as const } : { ...entry, status: "retired" as const };
  });

  return { store: { ...store, entries }, resolved: true };
}

export interface KnowledgeStats {
  readonly totalEntries: number;
  readonly activeEntries: number;
  readonly contradictedEntries: number;
  readonly retiredEntries: number;
  readonly withinCapacity: boolean;
}

export function knowledgeStats(store: ColonyKnowledgeStore): KnowledgeStats {
  const active = store.entries.filter((e) => e.status === "active").length;
  const contradicted = store.entries.filter((e) => e.status === "contradicted").length;
  const retired = store.entries.filter((e) => e.status === "retired").length;
  return {
    totalEntries: store.entries.length,
    activeEntries: active,
    contradictedEntries: contradicted,
    retiredEntries: retired,
    withinCapacity: active <= KNOWLEDGE_STORE_CAPACITY,
  };
}
