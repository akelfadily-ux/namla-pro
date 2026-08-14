/**
 * Digital Superorganism Metabolism V1 — shared types (Build Law §23).
 *
 * This layer TRANSLATES the frozen biological colony mechanisms (src/biology,
 * now a research reference) into a causal DIGITAL economy for software, AI, IT,
 * security, data, and DevOps work. The mapping is deliberate:
 *
 *   food / carbohydrate / protein   -> information, fast context, durable skills
 *   water                            -> memory + context + communication bandwidth
 *   oxygen                           -> tools, APIs, permissions, compute access
 *   energy                           -> token / compute / time / money budget
 *   working hands                    -> executing AntAgents + cognitive workers
 *   trophallaxis                     -> bounded local context/knowledge transfer
 *   metabolism                       -> raw info -> plans, code, tests, artifacts
 *   CO2 / waste                      -> errors, failures, debt, dead knowledge
 *   disease / immunity               -> poisoned data / review, tests, quarantine
 *   brood / maturation               -> untrained skills -> evidence-based promotion
 *   Queen                            -> colony identity + policy, never assignment
 *
 * Every quantity here is a REAL conserved digital resource or bounded state that
 * changes only through explicit, event-sourced transitions. Nothing appears from
 * nowhere: `digitalResourceEconomy.ts` is an event-sourced ledger and the report
 * validates conservation + causality.
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

/** The fifteen conserved digital resources. Every unit is tracked source->sink. */
export const DIGITAL_RESOURCES = [
  "rawInformation", // scouted, unverified signal (analogous to foraged food)
  "verifiedKnowledge", // information that passed verification (durable protein-like)
  "workingContext", // fast consumable context / short-term tokens (carbohydrate-like)
  "computeCapacity", // compute slots (oxygen-like execution capability)
  "tokenBudget", // model token budget (energy-like)
  "monetaryBudget", // money budget (energy-like)
  "toolAccess", // bounded, revocable tool/API/permission grants (oxygen-like)
  "skillAssets", // durable individual skills (protein-like)
  "reusableComponents", // libraries, tools, tested components (protein-like)
  "testEvidence", // evidence produced by tests/reviews (immunity substrate)
  "trustCapital", // reliability/trust accrued through evidence
  "technicalDebt", // tracked debt (a taxed waste that must be serviced)
  "errorWaste", // failed attempts, rejected work (CO2-like)
  "staleKnowledge", // expired / obsolete knowledge (waste-like)
  "securityRisk", // active threat load (disease-like)
] as const;
export type DigitalResource = (typeof DIGITAL_RESOURCES)[number];

/** Budget resources are only ever CONSUMED (never created) — no infinite work. */
export const BUDGET_RESOURCES: readonly DigitalResource[] = ["computeCapacity", "tokenBudget", "monetaryBudget", "workingContext"];

/** The behavioural state a worker settles into — emergent, never assigned. */
export type DigitalTask =
  | "scouting" // collect raw information
  | "verifying" // turn raw information into verified knowledge
  | "planning" // turn knowledge + context into a plan
  | "building" // turn a plan into artifacts / reusable components
  | "reviewing" // inspect artifacts (immune response)
  | "testing" // produce test evidence
  | "repairing" // recycle failure into lessons + remediation
  | "securing" // detect/quarantine threats (immune response)
  | "mentoring" // mature brood workers
  | "resting"; // insufficient budget: rest / wait

export type WorkerKind = "deterministic-active" | "deep-cognitive" | "real-provider";

/** Brood -> maturation. No instant experts: promotion needs evidence. */
export type MaturationStage = "untrained" | "training" | "supervised" | "qualified" | "senior" | "retired";

/** Digital disease vectors. Defensive only — no offensive capability anywhere. */
export type ThreatKind =
  | "prompt-injection"
  | "poisoned-knowledge"
  | "secret-leak"
  | "malicious-artifact"
  | "vulnerable-dependency"
  | "false-success"
  | "unreliable-provider"
  | "unsafe-command"
  | "stale-assumption";

/** Structured CO2 / waste categories. */
export type WasteKind =
  | "compiler-error"
  | "test-failure"
  | "security-finding"
  | "hallucination"
  | "invalid-path"
  | "rejected-architecture"
  | "duplicate-work"
  | "obsolete-knowledge"
  | "technical-debt";

/** Access policy that travels with a knowledge/artifact parcel. */
export type AccessPolicy = "public-colony" | "team-local" | "restricted" | "quarantined";

export type DigitalProvenance =
  | "biological-mechanism" // exists in the frozen biology layer
  | "digital-mapping" // the conceptual translation
  | "fully-implemented" // real runtime state + reader + event evidence + invariant
  | "partial" // implemented but shallow in one dimension
  | "postponed-real-provider"; // deferred to a future human-gated live pilot

export type DigitalFidelityStatus = "fully-mechanistic" | "partially-mechanistic" | "placeholder" | "postponed";

/** Deterministic per-entity draw. Mirrors the house colony seed-mix (bioDraw). */
export function digitalDraw(seed: number, a: number, b: number, salt: number): number {
  const h = (Math.imul(seed ^ salt, 2654435761) ^ Math.imul(a + 1, 40503) ^ Math.imul(b + 1, 2246822519)) >>> 0;
  let t = h;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function zeroedResourceRecord(): Record<DigitalResource, number> {
  const r = {} as Record<DigitalResource, number>;
  for (const c of DIGITAL_RESOURCES) r[c] = 0;
  return r;
}
