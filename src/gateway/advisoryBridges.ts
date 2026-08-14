/**
 * advisoryBridges — explicit HUMAN advisory bridges for ChatGPT Chat and Claude
 * Chat (Cognitive Federation Gateway V1, Phase 3). Consumer chat products are NOT
 * automated as APIs: there is no browser control, no cookie/token access, no
 * network here at all. Namla emits a bounded `AdvisoryRequestPacket`; the human
 * manually submits it and pastes the response back; the response is marked
 * `human-imported-untrusted-advice`, fingerprinted, and can become evidence ONLY
 * after independent ant review. It never executes or writes files.
 *
 * No fs, no child_process, no network, no wall clock.
 */

export type AdvisoryProvider = "chatgpt-advisory" | "claude-chat-advisory";

export interface AdvisoryRequestPacket {
  readonly requestId: string;
  readonly objectiveId: string;
  readonly provider: AdvisoryProvider;
  /** Bounded, safe context — never private AntMind, never secrets. */
  readonly boundedContext: string;
  readonly exactQuestion: string;
  readonly evidenceRefs: readonly string[];
  readonly desiredOutputSchema: string;
  readonly maxResponseBytes: number;
  readonly prohibitedSecretCategories: readonly string[];
  readonly expiresAtTick: number;
  readonly requestingCouncil: string;
  readonly humanApprovalState: "awaiting-human" | "human-submitted" | "human-imported";
}

export const ADVISORY_MAX_RESPONSE_BYTES = 16000 as const;
const PROHIBITED_SECRETS = ["api-key", "oauth-token", "password", "private-key", "cookie", "session-token"] as const;

let advisorySeq = 0;

export function createAdvisoryRequest(input: { objectiveId: string; provider: AdvisoryProvider; boundedContext: string; exactQuestion: string; evidenceRefs: readonly string[]; desiredOutputSchema: string; requestingCouncil: string; expiresAtTick: number }): AdvisoryRequestPacket {
  advisorySeq += 1;
  return {
    requestId: `advisory-${advisorySeq}`,
    objectiveId: input.objectiveId,
    provider: input.provider,
    boundedContext: input.boundedContext.slice(0, 4000),
    exactQuestion: input.exactQuestion.slice(0, 1000),
    evidenceRefs: input.evidenceRefs.slice(0, 16),
    desiredOutputSchema: input.desiredOutputSchema.slice(0, 500),
    maxResponseBytes: ADVISORY_MAX_RESPONSE_BYTES,
    prohibitedSecretCategories: [...PROHIBITED_SECRETS],
    expiresAtTick: input.expiresAtTick,
    requestingCouncil: input.requestingCouncil,
    humanApprovalState: "awaiting-human",
  };
}

export type AdvisoryRejection =
  | "hidden-command"
  | "absolute-path"
  | "secret-looking-string"
  | "unsupported-executable-instruction"
  | "oversized-content"
  | "missing-provenance"
  | "replayed-response-id"
  | "expired-request"
  | "unknown-request";

export interface ImportedAdvisoryResponse {
  readonly responseId: string;
  readonly requestId: string;
  readonly content: string;
  readonly provenance: string;
}

export interface AdvisoryImportResult {
  readonly accepted: boolean;
  readonly trustLevel: "human-imported-untrusted-advice";
  readonly rejection: AdvisoryRejection | null;
  readonly fingerprint: string;
  readonly requiresIndependentReview: boolean;
}

const HIDDEN_COMMAND = /(^|\n)\s*(\$|>|#!|npm |npx |git |rm |curl |wget |powershell|cmd\.exe|child_process|exec\()/i;
const ABSOLUTE_PATH = /(^|\s)([A-Za-z]:[\\/]|\/(etc|usr|bin|home|root|var)\/)/;
const SECRET_LOOKING = /sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{20,}|-----BEGIN|password\s*[:=]/i;
const EXECUTABLE_INSTRUCTION = /\brun (this|the following)\b|\bexecute\b.*\bcommand\b|apply this patch automatically/i;

function fingerprint(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i += 1) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `adv-fp-${h.toString(16).padStart(8, "0")}-${content.length}`;
}

/**
 * Import a human-pasted advisory response. It is UNTRUSTED by default: rejected on
 * hidden commands / absolute paths / secret-looking strings / executable
 * instructions / oversize / missing provenance / replayed id / expiry, and even
 * when accepted it is marked untrusted and REQUIRES independent ant review before
 * it can become evidence. It never executes or writes anything.
 */
export class AdvisoryBridge {
  private readonly openRequests = new Map<string, AdvisoryRequestPacket>();
  private readonly consumedResponseIds = new Set<string>();

  register(packet: AdvisoryRequestPacket): void {
    this.openRequests.set(packet.requestId, packet);
  }

  get openRequestCount(): number {
    return this.openRequests.size;
  }

  importResponse(response: ImportedAdvisoryResponse, tick: number): AdvisoryImportResult {
    const reject = (rejection: AdvisoryRejection): AdvisoryImportResult => ({ accepted: false, trustLevel: "human-imported-untrusted-advice", rejection, fingerprint: fingerprint(response.content), requiresIndependentReview: true });
    const req = this.openRequests.get(response.requestId);
    if (!req) return reject("unknown-request");
    if (req.expiresAtTick <= tick) return reject("expired-request");
    if (this.consumedResponseIds.has(response.responseId)) return reject("replayed-response-id");
    if (response.provenance.trim().length === 0) return reject("missing-provenance");
    if (response.content.length > req.maxResponseBytes) return reject("oversized-content");
    if (HIDDEN_COMMAND.test(response.content)) return reject("hidden-command");
    if (ABSOLUTE_PATH.test(response.content)) return reject("absolute-path");
    if (SECRET_LOOKING.test(response.content)) return reject("secret-looking-string");
    if (EXECUTABLE_INSTRUCTION.test(response.content)) return reject("unsupported-executable-instruction");

    this.consumedResponseIds.add(response.responseId);
    this.openRequests.delete(response.requestId);
    return { accepted: true, trustLevel: "human-imported-untrusted-advice", rejection: null, fingerprint: fingerprint(response.content), requiresIndependentReview: true };
  }
}

export function newChatGPTAdvisoryBridge(): AdvisoryBridge {
  return new AdvisoryBridge();
}
export function newClaudeChatAdvisoryBridge(): AdvisoryBridge {
  return new AdvisoryBridge();
}
