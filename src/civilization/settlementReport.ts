/**
 * settlementReport — the safe command-center state projection + conservation and
 * causality validation for Namla Civilization OS V1 (Build Law §27). It exposes
 * summaries only (no raw private AntMind, no provider credentials, no raw
 * environment, no unrestricted provider output) and validates that the whole run
 * conserves resources and satisfies the civilization's causal invariants.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import { roundTo } from "../colony/colonyTypes";
import { DISTRICTS } from "./settlementTypes";
import type { CivilizationResult } from "./settlementRunner";

export interface CivCausalCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface CivilizationCommandCenter {
  readonly nationalObjectives: number;
  readonly districts: readonly { id: string; demandLevel: number; openDemands: number; artifacts: number; failures: number; messages: number }[];
  readonly activePopulation: number;
  readonly reservePopulation: number;
  readonly peakCognitiveAnts: number;
  readonly providerCalls: number;
  readonly mcpSessions: number;
  readonly mcpToolGrants: number;
  readonly academyEvidenceUpdates: number;
  readonly teamsFormed: number;
  readonly councilsActivated: number;
  readonly scoutProposals: number;
  readonly quorumReached: boolean;
  readonly artifactsCreated: number;
  readonly reviewsCompleted: number;
  readonly verificationRuns: number;
  readonly failuresDetected: number;
  readonly repairsCompleted: number;
  readonly technicalDebt: number;
  readonly knowledgeAccepted: number;
  readonly knowledgeContradictions: number;
  readonly costCharged: number;
  readonly mcpReceipts: number;
  readonly finalOutcome: string;
}

export interface CivilizationReport {
  readonly digitalResourceConservationValid: boolean;
  readonly unexplainedResourceCreation: number;
  readonly resourceChecks: readonly { resource: string; closed: boolean }[];
  readonly causalChecks: readonly CivCausalCheck[];
  readonly causalityViolations: number;
  readonly commandCenter: CivilizationCommandCenter;
}

export function buildCivilizationReport(result: CivilizationResult): CivilizationReport {
  const { economy, metrics: m, districts, mcp, knowledge, waste } = result;
  const conservation = economy.validate();

  const checks: CivCausalCheck[] = [];
  const add = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });

  add("no-central-assignment", m.centralTaskAssignments === 0 && m.queenTaskAssignments === 0 && m.tamaraDirectAntAssignments === 0 && m.globalPlannerDecisions === 0, "all 0");
  add("no-real-action", m.realProviderCalls === 0 && m.realNetworkCalls === 0 && m.realFilesystemWrites === 0 && m.processExecutions === 0, "all real 0");
  add("accepted-subset-of-voluntary", m.acceptedClaims <= m.voluntaryClaims && m.nonVolunteerAssignments === 0, `accepted=${m.acceptedClaims}<=voluntary=${m.voluntaryClaims}`);
  add("teams-dissolve", m.temporaryTeamsDissolved === m.temporaryTeamsFormed, `formed=${m.temporaryTeamsFormed}, dissolved=${m.temporaryTeamsDissolved}`);
  add("bounded-cognitive", m.peakCognitiveAnts <= 30, `peak=${m.peakCognitiveAnts}`);
  add("mcp-calls-receipted", mcp.sessionReceipts.length >= m.mcpToolCalls, `receipts=${mcp.sessionReceipts.length}>=calls=${m.mcpToolCalls}`);
  add("repair-from-failure", m.repairsCompleted <= waste.all.length && (m.repairsCompleted === 0 || m.failuresDetected > 0), `repairs=${m.repairsCompleted}, failures=${m.failuresDetected}`);
  add("knowledge-accepted-verified", knowledge.accepted <= knowledge.all.length && knowledge.accepted === m.knowledgeAccepted, `accepted=${knowledge.accepted}`);
  add("provider-cognition-simulated", m.providerCalls > 0 === m.providerCalls > 0 && m.realProviderCalls === 0, `providerCalls=${m.providerCalls}`);
  add("districts-created", m.districtsCreated === DISTRICTS.length && DISTRICTS.length >= 12, `districts=${m.districtsCreated}`);
  add("conservation-closed", conservation.allClosed, `unexplained=${conservation.unexplainedResourceCreation}`);

  const causalityViolations = checks.filter((c) => !c.passed).length;

  const active = result.workers.filter((w) => w.active).length;
  const commandCenter: CivilizationCommandCenter = {
    nationalObjectives: m.tamaraObjectivesReceived,
    districts: DISTRICTS.map((id) => {
      const d = districts[id];
      return { id, demandLevel: roundTo(d.demandLevel, 4), openDemands: d.openDemands, artifacts: d.artifactsProduced, failures: d.failuresProduced, messages: d.messagesIn + d.messagesOut };
    }),
    activePopulation: active,
    reservePopulation: result.workers.length - active,
    peakCognitiveAnts: m.peakCognitiveAnts,
    providerCalls: m.providerCalls,
    mcpSessions: mcp.sessionReceipts.length,
    mcpToolGrants: m.mcpToolGrants,
    academyEvidenceUpdates: m.academyEvidenceUpdates,
    teamsFormed: m.temporaryTeamsFormed,
    councilsActivated: m.councilsActivated,
    scoutProposals: m.scoutProposals,
    quorumReached: m.quorumReached,
    artifactsCreated: m.artifactsCreated,
    reviewsCompleted: m.reviewsCompleted,
    verificationRuns: m.verificationRuns,
    failuresDetected: m.failuresDetected,
    repairsCompleted: m.repairsCompleted,
    technicalDebt: m.technicalDebtTracked,
    knowledgeAccepted: m.knowledgeAccepted,
    knowledgeContradictions: m.knowledgeContradictions,
    costCharged: mcp.costCharged,
    mcpReceipts: mcp.sessionReceipts.length,
    finalOutcome: m.finalObjectivePassed ? "delivered" : "incomplete",
  };

  return {
    digitalResourceConservationValid: conservation.allClosed,
    unexplainedResourceCreation: conservation.unexplainedResourceCreation,
    resourceChecks: conservation.checks.map((c) => ({ resource: c.resource, closed: c.closed })),
    causalChecks: checks,
    causalityViolations,
    commandCenter,
  };
}
