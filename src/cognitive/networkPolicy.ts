/**
 * networkPolicy — honest accounting for network behaviour we do not control.
 *
 * The runtime previously reported `realNetworkCalls: 0` from every driver,
 * including the REAL provider driver, on the reasoning that "this driver never
 * opens a socket; the provider CLI owns its own session". That reasoning is
 * true and the number is still wrong: spawning the Claude or Codex CLI causes
 * network traffic, and reporting 0 states as fact something the runtime never
 * measured. A zero that means "we didn't look" is indistinguishable in a
 * receipt from a zero that means "we looked and there was nothing", which makes
 * the audit record worse than having no field at all.
 *
 * So this module separates two things that were conflated:
 *
 *   POLICY      — what we INTEND to allow. We control this.
 *   OBSERVATION — what actually happened. We control this only when something
 *                 is genuinely monitoring, and otherwise it is `unknown`.
 *
 * `unknown` is never silently converted to 0 or false. `observedNetworkCallCount`
 * is `number | null`, and `null` is the honest answer whenever nothing observed.
 *
 * Destination handling is class-only: a receipt records `provider-service` or
 * `package-registry`, never a URL, query string, cookie, header, or credential.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import { redactedText } from "./safeRedactor";

/** What we intend to permit. Ordered from most to least restrictive. */
export type NetworkPolicy = "denied" | "loopback-only" | "provider-only" | "allowlisted" | "allowed";

/** What was actually seen. `unknown` means nothing was watching — not zero. */
export type NetworkObservation = "observed-none" | "observed-some" | "unknown";

/** Why the observation has the value it does. */
export type NetworkObservationStatus = "verified" | "unavailable" | "enforcement-failed";

/** Safe destination classes. A receipt never carries a URL. */
export type DestinationClass = "loopback" | "provider-service" | "package-registry" | "approved-api" | "unknown-external";

export type NetworkReasonCode = "ok" | "network-policy-denied" | "unexpected-network-observed" | "network-observation-unavailable" | "network-destination-not-allowed" | "network-policy-escalation-refused";

/** Permissiveness rank — a higher grant than declared is an escalation. */
const POLICY_RANK: Readonly<Record<NetworkPolicy, number>> = { denied: 0, "loopback-only": 1, "provider-only": 2, allowlisted: 3, allowed: 4 };

/** Destination classes each policy may reach. */
const POLICY_ALLOWED_CLASSES: Readonly<Record<NetworkPolicy, readonly DestinationClass[]>> = {
  denied: [],
  "loopback-only": ["loopback"],
  "provider-only": ["loopback", "provider-service"],
  allowlisted: ["loopback", "provider-service", "package-registry", "approved-api"],
  allowed: ["loopback", "provider-service", "package-registry", "approved-api", "unknown-external"],
};

/** What one tool or provider declares about its own network needs. */
export interface ToolNetworkDeclaration {
  readonly toolId: string;
  readonly requiredNetworkPolicy: NetworkPolicy;
  readonly networkRequired: boolean;
  readonly allowedDestinationClasses: readonly DestinationClass[];
}

/**
 * The declarations. A subscription CLI genuinely needs the network and we
 * genuinely cannot observe it from here — that combination is legitimate, and
 * it must be RECORDED rather than papered over with a zero.
 */
export const TOOL_NETWORK_DECLARATIONS: Readonly<Record<string, ToolNetworkDeclaration>> = {
  claude: { toolId: "claude", requiredNetworkPolicy: "provider-only", networkRequired: true, allowedDestinationClasses: ["provider-service"] },
  codex: { toolId: "codex", requiredNetworkPolicy: "provider-only", networkRequired: true, allowedDestinationClasses: ["provider-service"] },
  ollama: { toolId: "ollama", requiredNetworkPolicy: "loopback-only", networkRequired: true, allowedDestinationClasses: ["loopback"] },
  "fake-provider": { toolId: "fake-provider", requiredNetworkPolicy: "denied", networkRequired: false, allowedDestinationClasses: [] },
  "verification-command": { toolId: "verification-command", requiredNetworkPolicy: "denied", networkRequired: false, allowedDestinationClasses: [] },
};

/** One observation result. `count` is null whenever the observation is unknown. */
export interface NetworkObservationResult {
  readonly observation: NetworkObservation;
  readonly count: number | null;
  readonly destinationClasses: readonly DestinationClass[];
  readonly status: NetworkObservationStatus;
  /** Where the evidence came from, e.g. "sandbox-netns" or "none". Never a URL. */
  readonly evidenceSource: string;
}

/**
 * Something that can report on network activity. A host with no monitoring
 * returns `unknown` — it must never return `observed-none`, because "nothing
 * was watching" and "nothing happened" are different facts.
 */
export interface NetworkObservationProvider {
  readonly id: string;
  readonly capable: boolean;
  observe(sequence: number): NetworkObservationResult;
}

/** The honest default on an unmonitored host: unknown, count null. */
export class UnobservedNetworkProvider implements NetworkObservationProvider {
  readonly id = "unobserved";
  readonly capable = false;
  observe(): NetworkObservationResult {
    return { observation: "unknown", count: null, destinationClasses: [], status: "unavailable", evidenceSource: "none" };
  }
}

/**
 * A provider for genuinely isolated execution: nothing ran that could reach the
 * network, so `observed-none` with count 0 is a PROVEN fact, not an assumption.
 * Only use this where no child process exists at all (deterministic fakes).
 */
export class NoProcessNetworkProvider implements NetworkObservationProvider {
  readonly id = "no-process";
  readonly capable = true;
  observe(): NetworkObservationResult {
    return { observation: "observed-none", count: 0, destinationClasses: [], status: "verified", evidenceSource: "no-child-process-spawned" };
  }
}

/** A deterministic provider for tests: reports exactly what it is told to. */
export class StubNetworkObservationProvider implements NetworkObservationProvider {
  readonly id: string;
  readonly capable: boolean;
  constructor(private readonly result: NetworkObservationResult, id = "stub") {
    this.id = id;
    this.capable = result.status === "verified";
  }
  observe(): NetworkObservationResult {
    return this.result;
  }
}

/** The safe, persistable record of ONE tool's network capability decision. */
export interface NetworkCapabilityReceipt {
  readonly toolId: string;
  readonly requiredNetworkPolicy: NetworkPolicy;
  readonly networkRequired: boolean;
  readonly allowedDestinationClasses: readonly DestinationClass[];
  readonly grantedNetworkPolicy: NetworkPolicy;
  readonly observationCapable: boolean;
  readonly networkObservation: NetworkObservation;
  readonly networkObservationStatus: NetworkObservationStatus;
  readonly networkEvidenceAvailable: boolean;
  /** null whenever the observation is unknown. NEVER coerced to 0. */
  readonly observedNetworkCallCount: number | null;
  readonly observedDestinationClasses: readonly DestinationClass[];
  readonly evidenceSource: string;
  readonly sequence: number;
  readonly blocked: boolean;
  readonly safeReasonCode: NetworkReasonCode;
}

export interface EvaluateNetworkInput {
  readonly declaration: ToolNetworkDeclaration;
  readonly grantedPolicy: NetworkPolicy;
  readonly observationProvider: NetworkObservationProvider;
  /** Deterministic ordering value — this module never reads a clock. */
  readonly sequence: number;
}

/**
 * Evaluate one tool's network capability and produce an honest receipt.
 * Fails CLOSED: a policy violation blocks rather than being noted and ignored.
 */
export function evaluateNetworkCapability(input: EvaluateNetworkInput): NetworkCapabilityReceipt {
  const { declaration: decl, grantedPolicy, observationProvider: obs, sequence } = input;
  const result = obs.observe(sequence);

  const base = {
    toolId: decl.toolId,
    requiredNetworkPolicy: decl.requiredNetworkPolicy,
    networkRequired: decl.networkRequired,
    allowedDestinationClasses: decl.allowedDestinationClasses,
    grantedNetworkPolicy: grantedPolicy,
    observationCapable: obs.capable,
    networkObservation: result.observation,
    networkObservationStatus: result.status,
    networkEvidenceAvailable: result.status === "verified",
    // The load-bearing line: an unknown observation carries a null count.
    observedNetworkCallCount: result.observation === "unknown" ? null : result.count,
    observedDestinationClasses: result.destinationClasses,
    evidenceSource: result.evidenceSource,
    sequence,
  };
  const block = (safeReasonCode: NetworkReasonCode): NetworkCapabilityReceipt => ({ ...base, blocked: true, safeReasonCode });

  // 1. A tool declaring local-only while requiring external network is incoherent.
  const declaredLocalOnly = decl.requiredNetworkPolicy === "denied" || decl.requiredNetworkPolicy === "loopback-only";
  const needsExternal = decl.allowedDestinationClasses.some((c) => c !== "loopback");
  if (declaredLocalOnly && decl.networkRequired && needsExternal) return block("network-policy-escalation-refused");

  // 2. A grant more permissive than the declaration is a silent upgrade.
  if (POLICY_RANK[grantedPolicy] > POLICY_RANK[decl.requiredNetworkPolicy]) return block("network-policy-escalation-refused");

  // 3. Denied policy with observed traffic — enforcement failed.
  if (grantedPolicy === "denied" && result.observation === "observed-some") return block("unexpected-network-observed");

  // 4. A destination outside what the granted policy permits.
  const permitted = POLICY_ALLOWED_CLASSES[grantedPolicy];
  const violating = result.destinationClasses.filter((c) => !permitted.includes(c) || !decl.allowedDestinationClasses.includes(c));
  if (violating.length > 0) return block("network-destination-not-allowed");

  // 5. Denied policy on a tool that genuinely requires network cannot proceed.
  if (grantedPolicy === "denied" && decl.networkRequired) return block("network-policy-denied");

  // 6. Not blocking, but the unknown must be visible in the reason code.
  if (result.observation === "unknown") return { ...base, blocked: false, safeReasonCode: "network-observation-unavailable" };
  return { ...base, blocked: false, safeReasonCode: "ok" };
}

/**
 * Classify a destination WITHOUT retaining it. Credentials, query strings,
 * cookies and headers are dropped here and never reach a receipt.
 */
export function classifyDestination(rawUrl: string): DestinationClass {
  let host = "";
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    const m = /^[a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:?#]+)/i.exec(rawUrl);
    host = (m?.[1] ?? "").toLowerCase();
  }
  if (host.length === 0) return "unknown-external";
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost")) return "loopback";
  if (host === "api.anthropic.com" || host === "api.openai.com" || host.endsWith(".anthropic.com") || host.endsWith(".openai.com")) return "provider-service";
  if (host === "registry.npmjs.org" || host.endsWith(".npmjs.org") || host === "registry.yarnpkg.com") return "package-registry";
  return "unknown-external";
}

/**
 * A destination summary safe to persist: scheme + host + class only. Userinfo
 * (`https://user:token@host`), path, and query string are removed BEFORE
 * redaction, so a credential cannot survive even in a mangled form.
 */
export function safeDestinationSummary(rawUrl: string): string {
  const cls = classifyDestination(rawUrl);
  let host = "";
  let scheme = "";
  try {
    const u = new URL(rawUrl);
    host = u.hostname;
    scheme = u.protocol.replace(":", "");
  } catch {
    const m = /^([a-z0-9+.-]*):\/\/(?:[^@/]*@)?([^/:?#]+)/i.exec(rawUrl);
    scheme = m?.[1] ?? "";
    host = m?.[2] ?? "";
  }
  // Redaction is a second line of defence; the structural strip above is first.
  return redactedText(`${scheme}://${host} [${cls}]`, 200);
}

/** Project the honest network fields for a report or command-center row. */
export interface NetworkProjection {
  readonly networkPolicy: NetworkPolicy;
  readonly networkObservation: NetworkObservation;
  readonly networkObservationStatus: NetworkObservationStatus;
  readonly networkEvidenceAvailable: boolean;
  readonly observedNetworkCallCount: number | null;
}

export function projectNetwork(receipt: NetworkCapabilityReceipt): NetworkProjection {
  return {
    networkPolicy: receipt.grantedNetworkPolicy,
    networkObservation: receipt.networkObservation,
    networkObservationStatus: receipt.networkObservationStatus,
    networkEvidenceAvailable: receipt.networkEvidenceAvailable,
    observedNetworkCallCount: receipt.observedNetworkCallCount,
  };
}

/** Human-readable, honest one-liner for a command-center row. */
export function describeNetwork(p: NetworkProjection): string {
  const count = p.observedNetworkCallCount === null ? "unknown" : String(p.observedNetworkCallCount);
  return `policy=${p.networkPolicy} observation=${p.networkObservation} calls=${count}`;
}
