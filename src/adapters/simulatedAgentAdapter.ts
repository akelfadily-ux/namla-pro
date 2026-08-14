/**
 * SimulatedAgentAdapter: one deterministic, canned-response adapter per
 * AgentKind. Claude Code, Codex, Kimi, and local-script exist here as
 * future tool *identities* — names with capability profiles — not as
 * integrations. No adapter calls anything: the response text below is a
 * lookup table, audited word by word against SafetyGuard's indicator
 * substrings (the same discipline as receipt literals — e.g. "informative"
 * is avoided because it contains "format").
 *
 * When a ProposalFactory is injected, a propose-build exchange can also
 * yield a placeholder CodeProposal — factory-gated like every proposal,
 * applied: false forever in this phase.
 */

import type {
  AgentAdapterResult,
  AgentCapabilityProfile,
  AgentKind,
  AgentPurpose,
  AgentRequest,
} from "./agentAdapterTypes";
import type { CodeProposal } from "../generation/codeProposal";
import { AgentAdapterBase } from "./agentAdapterBase";
import { SafetyGuard } from "../core/safetyGuard";
import { ReceiptLog } from "../core/receiptLog";
import { ProposalFactory } from "../generation/proposalFactory";

const DISPLAY_NAMES: Record<AgentKind, string> = {
  "claude-code": "Claude Code (simulated)",
  codex: "Codex (simulated)",
  kimi: "Kimi (simulated)",
  "local-script": "Local Script (simulated)",
};

/** Canned text per kind and purpose. Deterministic; audited at write time. */
const CANNED_RESPONSES: Record<AgentKind, Record<AgentPurpose, string>> = {
  "claude-code": {
    "propose-build":
      "Simulated plan: create one focused file with a short overview and a worked example. Nothing was touched.",
    analyze: "Simulated analysis: the structure is coherent; two sections could use worked examples.",
    summarize: "Simulated summary: the material covers its topic in small, readable pieces.",
  },
  codex: {
    "propose-build": "Simulated draft: a concise outline with numbered steps and a small usage sample.",
    analyze: "Simulated analysis: naming is consistent; one section repeats an idea and could be merged.",
    summarize: "Simulated summary: a compact list of the main points, ordered by importance.",
  },
  kimi: {
    "propose-build": "Simulated plan: a short document with key points first and details after.",
    analyze: "Simulated analysis: the flow reads well; the closing section could state next steps.",
    summarize: "Simulated summary: key points listed with one-line explanations for operators.",
  },
  "local-script": {
    "propose-build": "Simulated dry-run outline: the steps a local helper would take, with nothing run.",
    analyze: "Simulated check: inputs and outputs are described; edge cases are listed as notes.",
    summarize: "Simulated digest: counts and headings collected into a short overview.",
  },
};

export class SimulatedAgentAdapter extends AgentAdapterBase {
  private readonly kind: AgentKind;
  private readonly proposalFactory?: ProposalFactory;

  constructor(
    safetyGuard: SafetyGuard,
    receiptLog: ReceiptLog,
    kind: AgentKind,
    proposalFactory?: ProposalFactory
  ) {
    super(safetyGuard, receiptLog);
    this.kind = kind;
    this.proposalFactory = proposalFactory;
  }

  get profile(): AgentCapabilityProfile {
    return {
      agentKind: this.kind,
      displayName: DISPLAY_NAMES[this.kind],
      supportedPurposes: ["propose-build", "analyze", "summarize"],
      declaredPermissions: ["read-project-snapshot-data", "produce-code-proposal-data"],
      simulated: true,
      credentialsMode: "not-modeled",
      networkAccess: false,
      processAccess: false,
    };
  }

  protected buildSimulatedResponseText(request: AgentRequest): string {
    // Deterministic: kind + purpose select the canned line; the task id is
    // appended for traceability. No model, no randomness, no variation.
    return `${CANNED_RESPONSES[this.kind][request.purpose]} [for ${request.taskId}]`;
  }

  /**
   * A propose-build exchange that also yields a placeholder CodeProposal
   * when a factory was injected. The proposal goes through every factory
   * gate and stays applied: false; refusals surface through the factory's
   * own receipts.
   */
  fulfillBuildTask(request: AgentRequest): { result: AgentAdapterResult; proposal?: CodeProposal } {
    const result = this.handle(request);

    if (!result.ok || !this.proposalFactory || request.purpose !== "propose-build") {
      return { result };
    }

    const creation = this.proposalFactory.create({
      missionId: request.missionId,
      taskId: request.taskId,
      targetRelativePath: `docs/simulated/${request.taskId}-${this.kind}.md`,
      changeKind: "create",
      proposedContent: `# Simulated ${DISPLAY_NAMES[this.kind]} output\n\n${result.response.responseText}\n`,
      rationale: "Simulated adapter output for a build task.",
    });

    return { result, proposal: creation.ok ? creation.proposal : undefined };
  }
}
