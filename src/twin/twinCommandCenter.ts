/**
 * twinCommandCenter — a safe operational projection of the twin empire, derived
 * ONLY from real runtime state (frozen bundles, witness report, cross-examination
 * summary, contradiction energy, dominance decisions, Namola receipt, merge forge
 * evidence, delivery status). No decorative or hard-coded counters; every alert
 * traces to an actual event/receipt. It never exposes credentials, tokens,
 * prompts, raw provider output, private AntMind, environment, or hidden reasoning.
 *
 * No fs, no child_process, no network, no provider calls.
 */

import type { ColonyEvidenceBundle } from "./twinColonyTypes";
import type { WitnessIntegrityReport } from "./silentWitness";
import type { NamolaDecisionReceipt } from "./namolaSovereignCourt";
import type { EnergyBand } from "./differentialTruth";
import { evaluateNetworkCapability, projectNetwork, TOOL_NETWORK_DECLARATIONS, NoProcessNetworkProvider, type NetworkPolicy, type NetworkObservation, type NetworkObservationStatus } from "../cognitive/networkPolicy";
import { projectSandbox, detectContainerRuntime, type SandboxCapabilityState, type SandboxReasonCode } from "../cognitive/sandboxPolicy";

export type AlertSeverity = "info" | "warning" | "critical";

export interface TwinCommandCenterAlert {
  readonly alertCode: string;
  readonly severity: AlertSeverity;
  readonly sourceEvent: string;
  readonly evidenceRefs: readonly string[];
  readonly safeSummary: string;
  readonly resolved: boolean;
}

export interface TwinCommandCenter {
  readonly missionId: string;
  readonly totalPersistentAnts: number;
  readonly claudeColonyStatus: string;
  readonly codexColonyStatus: string;
  readonly namolaCourtStatus: string;
  readonly silentWitnessStatus: string;
  readonly workspaceIsolationStatus: string;
  readonly leakageAttempts: number;
  readonly leakageQuarantined: number;
  readonly claudeFingerprint: string;
  readonly codexFingerprint: string;
  readonly bundlesValid: boolean;
  readonly crossExamAttacks: number;
  readonly crossExamRebuttals: number;
  readonly strengthsAcknowledged: number;
  readonly unresolvedContradictions: number;
  readonly contradictionEnergyBand: EnergyBand | "none";
  readonly decisiveTests: number;
  readonly evidenceDominanceDecisions: number;
  readonly namolaDecision: string;
  readonly approvedMergeComponents: number;
  readonly rejectedMergeComponents: number;
  readonly mergeIncidents: number;
  readonly repairs: number;
  readonly verificationRuns: number;
  readonly finalVerificationPassed: boolean;
  readonly residualUncertainty: number;
  readonly customerDeliveryReady: boolean;
  readonly customerDeliveryStatus: string;
  readonly realProviderCalls: 0;
  readonly realFilesystemWrites: 0;
  /**
   * Honest network position. The command centre previously showed a hard 0,
   * which read as "proven no network" when nothing had measured it.
   */
  readonly networkPolicy: NetworkPolicy;
  readonly networkObservation: NetworkObservation;
  readonly networkObservationStatus: NetworkObservationStatus;
  readonly networkEvidenceAvailable: boolean;
  readonly observedNetworkCallCount: number | null;
  /**
   * Honest sandbox position. This must NEVER read as "sandboxed" without a
   * verified backend, so every field derives from the real capability report.
   */
  readonly sandboxBackend: string;
  readonly sandboxCapabilityState: SandboxCapabilityState;
  readonly sandboxVerified: boolean;
  readonly sandboxAvailable: boolean;
  readonly sandboxNetworkPolicy: NetworkPolicy;
  readonly sandboxMountPolicy: string;
  readonly sandboxLimits: string;
  readonly sandboxExecutionBlocked: boolean;
  readonly sandboxReasonCode: SandboxReasonCode;
  readonly processExecutions: 0;
  readonly alerts: readonly TwinCommandCenterAlert[];
}

/** Twin runs use deterministic fakes: no child process exists, so observed-none is PROVEN. */
export const TWIN_COMMAND_CENTER_NETWORK = projectNetwork(
  evaluateNetworkCapability({
    declaration: TOOL_NETWORK_DECLARATIONS["fake-provider"],
    grantedPolicy: "denied",
    observationProvider: new NoProcessNetworkProvider(),
    sequence: 0,
  })
);

/**
 * Twin runs are deterministic fakes and execute no generated code, so no
 * sandbox is required - but the projection still reports the REAL capability of
 * this host rather than implying protection that does not exist.
 */
export const TWIN_COMMAND_CENTER_SANDBOX = projectSandbox(detectContainerRuntime());

export interface TwinCommandCenterInput {
  readonly missionId: string;
  readonly totalPersistentAnts: number;
  readonly claude: ColonyEvidenceBundle;
  readonly codex: ColonyEvidenceBundle;
  readonly bundlesValid: boolean;
  readonly witness: WitnessIntegrityReport;
  readonly crossExam: { readonly attacks: number; readonly rebuttals: number; readonly strengths: number; readonly unresolvedContradictions: number };
  readonly contradictionEnergyBand: EnergyBand | "none";
  readonly decisiveTests: number;
  readonly evidenceDominanceDecisions: number;
  readonly namolaReceipt: NamolaDecisionReceipt;
  readonly mergeIncidents: readonly { readonly incidentId: string }[];
  readonly repairRan: boolean;
  readonly verificationRuns: number;
  readonly finalMergePassed: boolean;
  readonly rejectedMergeComponents: number;
  readonly residualUncertainty: readonly string[];
  readonly customerDeliveryReady: boolean;
  readonly customerDeliveryStatus: string;
}

/** Build the safe projection + real-state alerts (each alert traces to a real event). */
export function buildTwinCommandCenter(input: TwinCommandCenterInput): TwinCommandCenter {
  const w = input.witness;
  const alerts: TwinCommandCenterAlert[] = [];
  const add = (alertCode: string, severity: AlertSeverity, sourceEvent: string, evidenceRefs: readonly string[], safeSummary: string, resolved: boolean) => alerts.push({ alertCode, severity, sourceEvent, evidenceRefs, safeSummary, resolved });

  if (w.leakageAttempts > 0) add("colony-leakage", "warning", "isolation-boundary", [`quarantined=${w.leakageQuarantined}/${w.leakageAttempts}`], "cross-colony leakage attempt(s) were quarantined", w.leakageQuarantined >= w.leakageAttempts);
  if (!input.bundlesValid) add("bundle-invalid", "critical", "frozen-bundle-validator", [input.claude.fingerprint, input.codex.fingerprint], "a frozen bundle failed validation", false);
  if (!w.integrityIntact) add("witness-integrity-failed", "critical", "silent-witness", ["integrity=false"], "process integrity is compromised", false);
  if (input.namolaReceipt.decision === "REJECT_BOTH") add("reject-both", "warning", "namola-court", [input.namolaReceipt.decisionId], "Namola rejected both solutions", true);
  if (input.mergeIncidents.length > 0) add("merge-failed", "warning", "merge-forge", input.mergeIncidents.map((i) => i.incidentId), "a merge integration stage failed", input.finalMergePassed);
  if (input.repairRan) add("repair-required", "info", "merge-forge", input.mergeIncidents.map((i) => i.incidentId), "a separately-authorized repair was executed", input.finalMergePassed);
  if (!input.finalMergePassed) add("verification-failed", "critical", "merge-forge", [`runs=${input.verificationRuns}`], "final merge verification did not pass", false);
  if (!input.customerDeliveryReady) add("customer-delivery-blocked", "warning", "delivery-gate", [input.customerDeliveryStatus], "customer delivery is blocked", false);
  if (input.residualUncertainty.length > 0) add("residual-risk-disclosure-required", "info", "residual-uncertainty", [...input.residualUncertainty], "residual uncertainty must be disclosed to the customer", false);
  if (input.crossExam.unresolvedContradictions > 0 && (input.contradictionEnergyBand === "high" || input.contradictionEnergyBand === "critical") && input.decisiveTests === 0) add("unresolved-high-energy-contradiction", "warning", "differential-truth", ["no-decisive-test"], "a high-energy contradiction has no decisive test", false);

  return {
    missionId: input.missionId,
    totalPersistentAnts: input.totalPersistentAnts,
    claudeColonyStatus: input.claude.frozen ? "frozen" : "in-progress",
    codexColonyStatus: input.codex.frozen ? "frozen" : "in-progress",
    namolaCourtStatus: input.namolaReceipt.decision,
    silentWitnessStatus: w.integrityIntact ? "integrity-intact" : "integrity-breach",
    workspaceIsolationStatus: w.leakageQuarantined >= w.leakageAttempts ? "isolated" : "contaminated",
    leakageAttempts: w.leakageAttempts,
    leakageQuarantined: w.leakageQuarantined,
    claudeFingerprint: input.claude.fingerprint,
    codexFingerprint: input.codex.fingerprint,
    bundlesValid: input.bundlesValid,
    crossExamAttacks: input.crossExam.attacks,
    crossExamRebuttals: input.crossExam.rebuttals,
    strengthsAcknowledged: input.crossExam.strengths,
    unresolvedContradictions: input.crossExam.unresolvedContradictions,
    contradictionEnergyBand: input.contradictionEnergyBand,
    decisiveTests: input.decisiveTests,
    evidenceDominanceDecisions: input.evidenceDominanceDecisions,
    namolaDecision: input.namolaReceipt.decision,
    approvedMergeComponents: input.namolaReceipt.approvedComponents.length,
    rejectedMergeComponents: input.rejectedMergeComponents,
    mergeIncidents: input.mergeIncidents.length,
    repairs: input.repairRan ? 1 : 0,
    verificationRuns: input.verificationRuns,
    finalVerificationPassed: input.finalMergePassed,
    residualUncertainty: input.residualUncertainty.length,
    customerDeliveryReady: input.customerDeliveryReady,
    customerDeliveryStatus: input.customerDeliveryStatus,
    realProviderCalls: 0,
    realFilesystemWrites: 0,
    ...TWIN_COMMAND_CENTER_NETWORK,
    ...TWIN_COMMAND_CENTER_SANDBOX,
    processExecutions: 0,
    alerts,
  };
}
