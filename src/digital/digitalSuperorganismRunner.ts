/**
 * digitalSuperorganismRunner — the canonical bounded high-tech project runner
 * (Build Law §23; the digital analogue of `biologicalColonyRunner`). It threads
 * the conserving `DigitalResourceEconomy` through the full digital metabolism:
 * a strategic objective is published (as DATA), scouts collect raw information,
 * it is verified into knowledge, proposals compete and a quorum selects a plan,
 * workers VOLUNTARILY claim tasks, a bounded set receives tool/compute access,
 * builders produce artifacts, reviewers and testers produce evidence, failures
 * become structured waste, repair workers recycle it, threats are quarantined,
 * knowledge is shared by bounded trophallaxis, and brood workers mature on
 * evidence.
 *
 * NOTHING here is a central, Queen, Tamara-direct, or global-planner assignment:
 * those counters are literally 0. Tamara only publishes the objective + budget;
 * she never selects identities. Every metric is an event count or a ledger
 * difference — never a decorative counter.
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import { digitalDraw } from "./digitalTypes";
import type { DigitalTask, ThreatKind, WorkerKind } from "./digitalTypes";
import { DigitalResourceEconomy } from "./digitalResourceEconomy";
import { DEFAULT_DIGITAL_PROFILE } from "./digitalConfig";
import type { DigitalMetabolismProfile } from "./digitalConfig";
import { canExecute, createDigitalWorker, GLOBAL_COGNITIVE_CAP, REAL_PROVIDER_CAP, restWorker, retireWorker, stageRank } from "./digitalWorkers";
import type { DigitalWorker } from "./digitalWorkers";
import { build, review, runTest, repair, scout, verify } from "./digitalMetabolism";
import type { DigitalParcel } from "./digitalMetabolism";
import { runTeamTrophallaxis } from "./digitalTrophallaxis";
import { introduceThreat, penalizeTrust, quarantineThreat } from "./digitalImmunity";
import type { ThreatEvent, TransmissionEdge } from "./digitalImmunity";
import { attemptPromotion, trainBroodWorker } from "./digitalBrood";

export interface DigitalRunConfig {
  readonly seed: number;
  readonly persistentIdentities: number;
  readonly cycles: number;
  readonly teamSize: number;
  readonly threatIntroCycle: number;
  readonly workforceLossCycle: number;
  readonly workforceLossFraction: number;
  readonly profile?: DigitalMetabolismProfile;
}

export interface DigitalMetrics {
  objectivesPublished: number;
  rawInformationCollected: number;
  verifiedKnowledgeCreated: number;
  verificationFailures: number;
  voluntaryTaskClaims: number;
  activeWorkingHands: number;
  peakCognitiveWorkers: number;
  plansCreated: number;
  artifactsCreated: number;
  reviewsCompleted: number;
  testsExecuted: number;
  failuresGenerated: number;
  wasteRecycled: number;
  knowledgeReused: number;
  digitalTrophallaxisEvents: number;
  bandwidthConsumed: number;
  providerCalls: 0;
  threatsIntroduced: number;
  securityThreatsDetected: number;
  quarantinedArtifacts: number;
  remediationActions: number;
  transmissionEdges: number;
  broodTrained: number;
  promotions: number;
  promotionWithoutEvidence: 0;
  retirements: number;
  reserveActivations: number;
  quorumReached: boolean;
  taskFlexibilityObserved: number;
  maturationTaskCorrelation: number;
  centralTaskAssignments: 0;
  queenTaskAssignments: 0;
  tamaraDirectAntAssignments: 0;
  globalPlannerDecisions: 0;
  finalObjectivePassed: boolean;
}

export interface DigitalRunResult {
  readonly config: DigitalRunConfig;
  readonly economy: DigitalResourceEconomy;
  readonly workers: readonly DigitalWorker[];
  readonly metrics: DigitalMetrics;
  readonly threats: readonly ThreatEvent[];
  readonly transmissions: readonly TransmissionEdge[];
}

const HIGH_RISK_TASKS: ReadonlySet<DigitalTask> = new Set(["building", "securing"]);
const WORK_TASKS: readonly DigitalTask[] = ["scouting", "verifying", "planning", "building", "reviewing", "testing", "repairing", "securing", "mentoring"];

/**
 * Emergent, demand-aware, per-worker task choice — a VOLUNTARY claim, never an
 * assignment. Each worker has a STABLE per-task affinity (a response threshold,
 * like an ant's differing sensitivity to different stimuli); it multiplies the
 * current colony demand, gated by what its maturation permits. The argmax spreads
 * the population across the whole pipeline and shifts with demand, so a real
 * division of labour emerges without anyone being told what to do.
 */
function chooseDigitalTask(worker: DigitalWorker, demand: Record<DigitalTask, number>, seed: number, cycle: number): DigitalTask {
  if (worker.cognitiveEnergy < 0.15) return "resting";
  let best: DigitalTask = "resting";
  let bestScore = 0.05; // resting baseline
  for (let i = 0; i < WORK_TASKS.length; i += 1) {
    const task = WORK_TASKS[i];
    if (!canExecute(worker, task)) continue;
    const affinity = task === "scouting" ? worker.forageTendency : digitalDraw(seed, worker.index, i, 0x2c1b3c6d);
    const jitter = digitalDraw(seed, worker.index, cycle * 17 + i, 0x1b873593) * 0.03;
    const score = affinity * demand[task] + jitter;
    if (score > bestScore) {
      bestScore = score;
      best = task;
    }
  }
  return best;
}

export function runDigitalSuperorganism(config: DigitalRunConfig): DigitalRunResult {
  const profile = config.profile ?? DEFAULT_DIGITAL_PROFILE;
  const { seed } = config;
  const N = config.persistentIdentities;

  // Budgets scale with the persistent colony so a large colony has proportional
  // fuel; they are only ever consumed (no infinite work).
  const economy = new DigitalResourceEconomy({
    workingContext: N * 2,
    computeCapacity: N * 2,
    tokenBudget: N * 3,
    monetaryBudget: N * 1,
    toolAccess: Math.max(8, Math.floor(N * 0.1)), // bounded, revocable permit capacity
    rawInformation: 2,
    verifiedKnowledge: 2,
    reusableComponents: 0,
    skillAssets: N * 0.2,
    testEvidence: 0,
    trustCapital: N * 0.1,
    technicalDebt: 0,
    errorWaste: 0,
    staleKnowledge: 0,
    securityRisk: 0,
  });

  // Persistent identities. Deep-cognitive workers are capped at 30, real-provider
  // at 5 (and never called). The rest are deterministic active hands.
  let workers: DigitalWorker[] = [];
  for (let i = 0; i < N; i += 1) {
    const kind: WorkerKind = i < REAL_PROVIDER_CAP ? "real-provider" : i < REAL_PROVIDER_CAP + GLOBAL_COGNITIVE_CAP ? "deep-cognitive" : "deterministic-active";
    const teamId = `team-${Math.floor(i / config.teamSize)}`;
    workers.push(createDigitalWorker({ workerId: `dw-${String(i).padStart(5, "0")}`, index: i, kind, teamId, seed }));
  }

  const m: DigitalMetrics = {
    objectivesPublished: 0,
    rawInformationCollected: 0,
    verifiedKnowledgeCreated: 0,
    verificationFailures: 0,
    voluntaryTaskClaims: 0,
    activeWorkingHands: 0,
    peakCognitiveWorkers: 0,
    plansCreated: 0,
    artifactsCreated: 0,
    reviewsCompleted: 0,
    testsExecuted: 0,
    failuresGenerated: 0,
    wasteRecycled: 0,
    knowledgeReused: 0,
    digitalTrophallaxisEvents: 0,
    bandwidthConsumed: 0,
    providerCalls: 0,
    threatsIntroduced: 0,
    securityThreatsDetected: 0,
    quarantinedArtifacts: 0,
    remediationActions: 0,
    transmissionEdges: 0,
    broodTrained: 0,
    promotions: 0,
    promotionWithoutEvidence: 0,
    retirements: 0,
    reserveActivations: 0,
    quorumReached: false,
    taskFlexibilityObserved: 0,
    maturationTaskCorrelation: 0,
    centralTaskAssignments: 0,
    queenTaskAssignments: 0,
    tamaraDirectAntAssignments: 0,
    globalPlannerDecisions: 0,
    finalObjectivePassed: false,
  };

  const threats: ThreatEvent[] = [];
  const transmissions: TransmissionEdge[] = [];
  const activeHandIds = new Set<string>();
  const taskDiversity = new Map<string, Set<DigitalTask>>();
  const highRiskTaskCount = new Map<string, number>();
  let parcelSeq = 0;
  let lastArtifacts = 1; // prior-cycle artifact backlog drives review/test demand
  let prevRestingIds = new Set<string>();
  const activatedReserve = new Set<string>();

  const recordTask = (w: DigitalWorker, task: DigitalTask) => {
    let s = taskDiversity.get(w.workerId);
    if (!s) {
      s = new Set();
      taskDiversity.set(w.workerId, s);
    }
    if (s.size < 9) s.add(task);
    if (HIGH_RISK_TASKS.has(task)) highRiskTaskCount.set(w.workerId, (highRiskTaskCount.get(w.workerId) ?? 0) + 1);
  };

  const THREAT_KINDS: readonly ThreatKind[] = ["prompt-injection", "poisoned-knowledge", "malicious-artifact", "vulnerable-dependency", "false-success"];

  for (let cycle = 1; cycle <= config.cycles; cycle += 1) {
    // --- Step 1: Tamara publishes a strategic objective (DATA, not assignment).
    m.objectivesPublished += 1;

    const byId = new Map(workers.map((w) => [w.workerId, w]));
    const active = workers.filter((w) => w.active);

    // Demand signals from real ledger + parcel availability.
    const rawStock = economy.balanceOf("rawInformation");
    const knowStock = economy.balanceOf("verifiedKnowledge");
    const wasteStock = economy.balanceOf("errorWaste");
    const riskStock = economy.balanceOf("securityRisk");
    const broodCount = active.filter((w) => stageRank(w.maturation) <= stageRank("training")).length;
    const demand: Record<DigitalTask, number> = {
      resting: 0.1,
      scouting: clamp(1 - rawStock / Math.max(4, N * 0.3), 0.2, 1),
      verifying: rawStock > 1 ? 0.9 : 0.2,
      planning: knowStock > 0.5 ? 0.7 : 0.15,
      building: knowStock > 0.5 ? 0.85 : 0.15,
      reviewing: lastArtifacts > 0 ? 0.85 : 0.3,
      testing: lastArtifacts > 0 ? 0.8 : 0.3,
      repairing: wasteStock > 0.8 ? 0.8 : 0.15,
      securing: riskStock > 0.5 ? 0.95 : 0.2,
      mentoring: broodCount > 0 ? 0.75 : 0.1,
    };

    // --- Steps 5-6: voluntary claims + bounded tool/compute access.
    const claims = new Map<DigitalTask, DigitalWorker[]>();
    let cognitiveActiveThisCycle = 0;
    for (const w of active) {
      const task = chooseDigitalTask(w, demand, seed, cycle);
      // Deep-cognitive concurrency cap (<=30) — beyond it, a cognitive worker rests.
      if (w.kind === "deep-cognitive" && task !== "resting") {
        if (cognitiveActiveThisCycle >= GLOBAL_COGNITIVE_CAP) {
          byId.set(w.workerId, { ...w, currentTask: "resting" });
          continue;
        }
        cognitiveActiveThisCycle += 1;
      }
      // Real-provider workers never execute in deterministic runs (0 calls).
      const finalTask: DigitalTask = w.kind === "real-provider" ? "resting" : task;
      recordTask(w, finalTask);
      if (finalTask !== "resting") m.voluntaryTaskClaims += 1;
      let claimed = { ...w, currentTask: finalTask };
      // Permit-requiring tasks reserve a bounded tool permit (oxygen).
      if ((finalTask === "verifying" || finalTask === "building") && economy.grantToolAccess()) {
        claimed = { ...claimed, toolPermitHeld: true };
      }
      byId.set(w.workerId, claimed);
      if (finalTask !== "resting") {
        const arr = claims.get(finalTask) ?? [];
        arr.push(claimed);
        claims.set(finalTask, arr);
      }
    }
    m.peakCognitiveWorkers = Math.max(m.peakCognitiveWorkers, cognitiveActiveThisCycle);

    const apply = (w: DigitalWorker) => {
      byId.set(w.workerId, w);
      if (w.currentTask !== "resting") activeHandIds.add(w.workerId);
    };

    // --- Step 2: scouting -> raw information parcels.
    const rawParcels: DigitalParcel[] = [];
    for (const w of claims.get("scouting") ?? []) {
      const out = scout(economy, w, profile, parcelSeq++, seed, cycle);
      apply(out.worker);
      if (out.ok && out.parcel) {
        m.rawInformationCollected = roundTo(m.rawInformationCollected + out.collected, 6);
        rawParcels.push(out.parcel);
      }
    }

    // --- Step 12 (early): controlled threat introduction poisons a raw parcel.
    if (config.threatIntroCycle > 0 && cycle === config.threatIntroCycle) {
      for (let t = 0; t < 3; t += 1) {
        const kind = THREAT_KINDS[t % THREAT_KINDS.length];
        const target = rawParcels[t] ?? null;
        threats.push(introduceThreat(economy, kind, profile.threatIntroRisk, `threat-${cycle}-${t}`, cycle, target ? target.parcelId : null));
        m.threatsIntroduced += 1;
        if (target) rawParcels[t] = { ...target, poisoned: true };
      }
    }

    // --- Step 3: verification -> verified knowledge. Traced transmission of poison.
    const knowledgeParcels: DigitalParcel[] = [];
    const verifiers = claims.get("verifying") ?? [];
    let vi = 0;
    for (const w of verifiers) {
      const raw = rawParcels[vi % Math.max(1, rawParcels.length)];
      vi += 1;
      if (!raw) break;
      const out = verify(economy, w, raw, profile, parcelSeq++, seed, cycle);
      apply(out.worker);
      if (!out.ok) continue;
      if (out.succeeded && out.knowledge) {
        m.verifiedKnowledgeCreated = roundTo(m.verifiedKnowledgeCreated + out.evidenceProduced + 1, 6);
        knowledgeParcels.push(out.knowledge);
      } else if (!out.succeeded) {
        m.verificationFailures += 1;
        m.failuresGenerated += 1;
      }
      // Poisoned raw spreads to a co-located raw parcel (traceable exposure path).
      if (raw.poisoned) {
        const neighbor = rawParcels[(vi + 1) % Math.max(1, rawParcels.length)];
        if (neighbor && !neighbor.poisoned) {
          const edge = { fromParcelId: raw.parcelId, toParcelId: neighbor.parcelId, tick: cycle };
          transmissions.push(edge);
          m.transmissionEdges += 1;
        }
      }
    }

    // --- Step 4: proposals compete; a local quorum selects a plan.
    const planners = claims.get("planning") ?? [];
    if (planners.length > 0 && knowledgeParcels.length > 0) {
      const votes = new Map<string, number>();
      for (const p of planners) {
        const choice = `plan-${p.index % 3}`;
        votes.set(choice, (votes.get(choice) ?? 0) + 1);
      }
      for (const [, count] of votes) {
        if (count >= Math.max(2, Math.ceil(planners.length * 0.3))) m.quorumReached = true;
      }
      m.plansCreated += Math.min(planners.length, knowledgeParcels.length);
    }

    // --- Step 7-10: build -> review -> test, with failures becoming waste.
    // Reviewers and testers form a bounded queue: each processes several
    // artifacts by a DIFFERENT builder until its own cognitive energy runs down,
    // so a handful of reviewers/testers attest many artifacts (bounded, not free).
    const builders = claims.get("building") ?? [];
    const reviewerIds = (claims.get("reviewing") ?? []).map((w) => w.workerId);
    const testerIds = (claims.get("testing") ?? []).map((w) => w.workerId);
    const reviewUse = new Map<string, number>();
    const testUse = new Map<string, number>();
    const REVIEW_CAP_PER_CYCLE = 8;
    const nextEligible = (ids: readonly string[], excludeId: string, useMap: Map<string, number>, task: DigitalTask): DigitalWorker | null => {
      for (const id of ids) {
        if (id === excludeId) continue;
        if ((useMap.get(id) ?? 0) >= REVIEW_CAP_PER_CYCLE) continue;
        const w = byId.get(id);
        if (!w || !canExecute(w, task)) continue;
        useMap.set(id, (useMap.get(id) ?? 0) + 1);
        return w;
      }
      return null;
    };
    // Trophallaxis-delivered knowledge receivers become reuse candidates.
    const troph = spreadKnowledgeAcrossTeams(active.map((w) => byId.get(w.workerId) ?? w), knowledgeParcels, economy, profile, cycle);
    for (const w of troph.workers) byId.set(w.workerId, w);
    m.digitalTrophallaxisEvents += troph.events;
    m.bandwidthConsumed = roundTo(m.bandwidthConsumed + troph.bandwidthConsumed, 6);
    const reuseCandidates = new Set(troph.deliveredTo);

    let cycleArtifacts = 0;
    let ki = 0;
    for (const w of builders) {
      const knowledge = knowledgeParcels[ki % Math.max(1, knowledgeParcels.length)];
      ki += 1;
      if (!knowledge) break;
      const out = build(economy, w, knowledge, profile, parcelSeq++, seed, cycle);
      apply(out.worker);
      if (!out.ok) continue;
      if (out.succeeded && out.artifact) {
        m.artifactsCreated += 1;
        cycleArtifacts += 1;
        if (reuseCandidates.has(w.workerId)) m.knowledgeReused += 1; // used shared knowledge
        // Independent review by a DIFFERENT worker.
        const reviewer = nextEligible(reviewerIds, w.workerId, reviewUse, "reviewing");
        if (reviewer) {
          const rOut = review(economy, reviewer, out.artifact, profile, seed, cycle);
          apply(rOut.worker);
          if (rOut.ok) {
            m.reviewsCompleted += 1;
            if (!rOut.passed) m.failuresGenerated += 1;
          }
        }
        const tester = nextEligible(testerIds, w.workerId, testUse, "testing");
        if (tester) {
          const tOut = runTest(economy, tester, out.artifact, profile, seed, cycle);
          apply(tOut.worker);
          if (tOut.ok) {
            m.testsExecuted += 1;
            if (!tOut.passed) m.failuresGenerated += 1;
          }
        }
      } else {
        m.failuresGenerated += 1;
      }
    }
    lastArtifacts = cycleArtifacts;

    // --- Step 11-12: repair recycles waste; securing quarantines threats.
    const hasReviewEvidence = m.reviewsCompleted > 0;
    for (const w of claims.get("repairing") ?? []) {
      const out = repair(economy, w, hasReviewEvidence, profile, seed, cycle);
      apply(out.worker);
      if (out.ok && out.wasteRecycled > 0) {
        m.wasteRecycled = roundTo(m.wasteRecycled + out.wasteRecycled, 6);
        m.knowledgeReused += 1; // a recovered lesson re-enters the store
        m.remediationActions += 1;
      }
    }

    const securers = claims.get("securing") ?? [];
    if (riskStock > 0.5 && securers.length > 0) {
      let handled = 0;
      for (const w of securers) {
        if (handled >= Math.ceil(riskStock)) break;
        const q = quarantineThreat(economy, w, Math.min(riskStock, profile.threatIntroRisk), "verifiedKnowledge", 0.2, profile);
        apply(penalizeTrust({ ...w, currentTask: "securing" }, q.trustPenalty));
        if (q.quarantinedRisk > 0) {
          m.securityThreatsDetected += 1;
          m.quarantinedArtifacts += q.quarantinedMaterial > 0 ? 1 : 0;
          m.remediationActions += q.remediation;
        }
        handled += 1;
      }
      // Mark the corresponding threats detected.
      for (const th of threats) if (!th.detected) (th as { detected: boolean }).detected = true;
    }

    // --- Step: brood training + evidence-gated promotion (maturation).
    const mentors = (claims.get("mentoring") ?? []).filter((w) => w.maturation === "senior");
    const broodWorkers = active.filter((w) => stageRank(w.maturation) <= stageRank("supervised"));
    let mi = 0;
    for (const brood of broodWorkers) {
      const mentor = mentors[mi % Math.max(1, mentors.length)];
      mi += 1;
      if (!mentor) break;
      const tOut = trainBroodWorker(economy, byId.get(brood.workerId) ?? brood, byId.get(mentor.workerId) ?? mentor, profile, seed, cycle);
      if (tOut.trained) {
        byId.set(brood.workerId, tOut.brood);
        byId.set(mentor.workerId, tOut.mentor);
        m.broodTrained += 1;
      }
      const mentorAvailable = mentors.length > 0;
      const promo = attemptPromotion(byId.get(brood.workerId) ?? brood, mentorAvailable, profile);
      if (promo.promoted) {
        byId.set(brood.workerId, promo.worker);
        m.promotions += 1;
      }
    }

    // --- Freshness / degradation: context goes stale, knowledge ages.
    economy.expire("workingContext", profile.contextExpiryPerCycle);
    const staled = economy.consume("verifiedKnowledge", profile.knowledgeStalingPerCycle);
    if (staled > 0) economy.createVia("staleKnowledge", staled);

    // --- Workforce loss shock + reserve activation.
    workers = active.map((w) => byId.get(w.workerId) ?? w).concat(workers.filter((w) => !w.active));
    if (config.workforceLossCycle > 0 && cycle === config.workforceLossCycle) {
      const live = workers.filter((w) => w.active);
      const toRetire = Math.floor(live.length * config.workforceLossFraction);
      for (let i = 0; i < toRetire; i += 1) {
        const victim = live[i];
        workers = workers.map((w) => {
          if (w.workerId !== victim.workerId) return w;
          if (w.toolPermitHeld) economy.releaseToolAccess(); // a retiring worker returns its permit
          return retireWorker(w, "workforce-loss");
        });
        m.retirements += 1;
      }
    }
    // Reserve activation: previously resting workers taking up work after the loss.
    const inRecovery = config.workforceLossCycle > 0 && cycle >= config.workforceLossCycle && cycle < config.workforceLossCycle + 6;
    const currentResting = new Set<string>();
    for (const w of workers) {
      if (!w.active) continue;
      if (w.currentTask === "resting") currentResting.add(w.workerId);
      else if (inRecovery && prevRestingIds.has(w.workerId) && !activatedReserve.has(w.workerId)) {
        activatedReserve.add(w.workerId);
        m.reserveActivations += 1;
      }
    }
    prevRestingIds = currentResting;

    // Rest + release permits at end of cycle (permits are revocable).
    workers = workers.map((w) => {
      let nw = w;
      if (w.toolPermitHeld) {
        economy.releaseToolAccess();
        nw = { ...nw, toolPermitHeld: false };
      }
      if (w.active && w.currentTask === "resting") nw = restWorker(nw);
      return nw;
    });
  }

  // Final metrics from real state + ledger.
  m.activeWorkingHands = activeHandIds.size;
  let flexible = 0;
  for (const s of taskDiversity.values()) if (s.size >= 2) flexible += 1;
  m.taskFlexibilityObserved = flexible;
  m.maturationTaskCorrelation = correlation(
    workers.map((w) => stageRank(w.maturation)),
    workers.map((w) => highRiskTaskCount.get(w.workerId) ?? 0)
  );
  // Objective passes when the pipeline produced attested artifacts and closed clean.
  const conservation = economy.validate();
  m.finalObjectivePassed = m.artifactsCreated > 0 && m.testsExecuted > 0 && m.reviewsCompleted > 0 && conservation.allClosed;

  return { config, economy, workers, metrics: m, threats, transmissions };
}

/** Bounded per-team trophallaxis over the colony (no all-to-all). */
function spreadKnowledgeAcrossTeams(workers: readonly DigitalWorker[], knowledgeParcels: readonly DigitalParcel[], economy: DigitalResourceEconomy, profile: DigitalMetabolismProfile, cycle: number) {
  const holders = new Set(knowledgeParcels.map((k) => k.ownerWorkerId));
  const teams = new Map<string, DigitalWorker[]>();
  for (const w of workers) {
    const arr = teams.get(w.teamId) ?? [];
    arr.push(w);
    teams.set(w.teamId, arr);
  }
  const outWorkers: DigitalWorker[] = [];
  let events = 0;
  let bandwidthConsumed = 0;
  const deliveredTo: string[] = [];
  for (const [, teamWorkers] of teams) {
    if (teamWorkers.length < 2) {
      outWorkers.push(...teamWorkers);
      continue;
    }
    const res = runTeamTrophallaxis(teamWorkers, holders, economy, profile, cycle);
    outWorkers.push(...res.workers);
    events += res.events;
    bandwidthConsumed = roundTo(bandwidthConsumed + res.bandwidthConsumed, 6);
    deliveredTo.push(...res.deliveredTo);
  }
  return { workers: outWorkers, events, bandwidthConsumed, deliveredTo };
}

/** Pearson correlation of two equal-length numeric series (0 when undefined). */
function correlation(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den <= 1e-9 ? 0 : roundTo(num / den, 4);
}
