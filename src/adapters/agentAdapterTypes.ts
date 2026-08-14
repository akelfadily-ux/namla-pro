/**
 * Phase 7 agent-adapter types. An adapter is a DATA CONTRACT describing how
 * the colony would talk to a future worker tool (Claude Code, Codex, Kimi,
 * a local script). In Phase 7 every adapter is simulated: `simulated: true`
 * is a literal type on every response and every capability profile, so a
 * "real" response is unrepresentable.
 *
 * Deliberately NOT modeled, by law (Phase 7 amendment): credentials, API
 * keys, tokens, auth fields, endpoints, URLs. `credentialsMode` is the
 * literal "not-modeled", and `networkAccess`/`processAccess` are the
 * literal false — a profile claiming otherwise is a compile error.
 */

import type { SafetyDecision } from "../types/safetyTypes";
import type { ActionReceipt } from "../types/receiptTypes";

export type AgentKind = "claude-code" | "codex" | "kimi" | "local-script";

export type AgentPurpose = "propose-build" | "analyze" | "summarize";

export interface AgentRequest {
  requestId: string;
  missionId: string;
  taskId: string;
  agentKind: AgentKind;
  purpose: AgentPurpose;
  promptText: string;
  /** What the caller wants back, e.g. "code-proposal-draft". */
  requestedCapability: string;
  createdAt: string;
}

export interface AgentResponse {
  responseId: string;
  requestId: string;
  agentKind: AgentKind;
  simulated: true;
  responseText: string;
  /** The SafetyGuard decision that allowed this exchange. */
  safetyDecision: SafetyDecision;
  receiptId: string;
  createdAt: string;
}

export interface AgentCapabilityProfile {
  agentKind: AgentKind;
  displayName: string;
  supportedPurposes: AgentPurpose[];
  /** Future-facing permission names as plain strings; grants nothing. */
  declaredPermissions: string[];
  simulated: true;
  credentialsMode: "not-modeled";
  networkAccess: false;
  processAccess: false;
}

export interface AgentAdapterRefusal {
  refusalId: string;
  requestId: string;
  /** Machine-readable reason, e.g. "safety-blocked", "unsupported-purpose". */
  reasonCode: string;
  receiptId: string;
  refusedAt: string;
}

export type AgentAdapterResult =
  | { ok: true; response: AgentResponse; receipt: ActionReceipt }
  | { ok: false; refusal: AgentAdapterRefusal; receipt: ActionReceipt };
