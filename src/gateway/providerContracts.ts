/**
 * providerContracts — the multi-provider authentication + capability matrix for
 * the Namla Cognitive Federation Gateway V1. This is a PURE, DETERMINISTIC
 * description layer: it declares what each provider is, how it authenticates,
 * what it can do, and its bounded limits. It executes nothing and reads no
 * secret VALUE.
 *
 * SECRET DISCIPLINE (mechanical): a provider that authenticates by API key stores
 * only the environment-variable NAME (`secretRef`, e.g. "OPENAI_API_KEY") — never
 * the value. Readiness may report the boolean PRESENCE of a configured key
 * (`configured: true/false`) but the value never enters memory, prompts, receipts,
 * command-center projections, logs, Git, or JSON reports. `assertNoSecretLeak`
 * re-checks any value that would be surfaced.
 *
 * No fs, no child_process, no network, no wall clock in this module.
 */

export type ProviderFamily = "codex-cli" | "claude-code-cli" | "chat-advisory" | "gemini-api" | "openai-compatible-api" | "local-openai-compatible" | "ollama";

export type AccessMode = "subscription-cli" | "api-key" | "local-endpoint" | "human-advisory" | "disabled";

export type AuthenticationMode = "codex-chatgpt-login" | "claude-code-account-login" | "api-key-environment-reference" | "local-no-auth" | "human-import" | "unavailable";

export type CognitiveRole = "architecture" | "implementation" | "integration" | "debugging" | "tests" | "code-review" | "security-analysis" | "system-design" | "difficult-reasoning" | "repository-analysis" | "documentation" | "repair" | "research" | "advisory";

export type Modality = "text" | "code" | "structured-json";

export type PrivacyClassification = "public" | "internal" | "sensitive";

export type ParserId = "codex-jsonl" | "claude-code-json" | "openai-chat-json" | "gemini-json" | "ollama-json" | "human-imported-untrusted";

export type OutputFormat = "jsonl" | "json" | "text";

export interface ProviderLimits {
  readonly maxContextTokens: number;
  readonly maxConcurrency: number;
  /** Requests per minute the provider config declares (not a guarantee). */
  readonly ratePerMinute: number;
  readonly dailyRequestLimit: number;
  readonly tokenBudget: number;
  readonly timeoutMs: number;
  /** Cooldown after a circuit trip, in scheduler ticks. */
  readonly cooldownTicks: number;
}

export type CostPolicy = "subscription-included" | "free-tier-not-guaranteed" | "paid-per-token" | "local-compute-only" | "human-time-only";

export interface ProviderHealthState {
  calls: number;
  failures: number;
  timeouts: number;
  malformed: number;
  rateLimited: number;
  /** 0..1 rolling reliability (independently verified quality, not self-claimed). */
  reliability: number;
  qualityHistory: number;
  lastSafeHealthCheckTick: number;
  cooldownUntilTick: number;
  paused: boolean;
  lastFailureCategory: string;
}

export interface ProviderContract {
  readonly providerId: string;
  readonly providerFamily: ProviderFamily;
  readonly accessMode: AccessMode;
  readonly authenticationMode: AuthenticationMode;
  /** Fixed executable id (subscription CLI) OR endpoint URL (api/local). Never mission text. */
  readonly executableOrEndpoint: string;
  /** Environment-variable NAME for an API key — never its value. Null when not key-authed. */
  readonly secretRef: string | null;
  readonly supportedRoles: readonly CognitiveRole[];
  readonly supportedModalities: readonly Modality[];
  readonly limits: ProviderLimits;
  readonly costPolicy: CostPolicy;
  readonly outputFormat: OutputFormat;
  readonly parser: ParserId;
  readonly privacyClassification: PrivacyClassification;
  readonly humanApprovalRequired: boolean;
  /** Free tier is DECLARED, never assumed permanent. */
  readonly freeTierKnown: boolean;
  readonly freeTierNotGuaranteed: boolean;
  /** Scarce national-identity id for subscription masters, else null. */
  readonly masterAntId: string | null;
}

/** A remote endpoint must be HTTPS; local HTTP is allowed only on loopback. */
export function isEndpointAllowed(endpoint: string): { readonly ok: boolean; readonly reasonCode: string } {
  if (endpoint.length === 0) return { ok: true, reasonCode: "no-endpoint" }; // CLI providers
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, reasonCode: "invalid-endpoint" };
  }
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol === "https:") return { ok: true, reasonCode: "https-ok" };
  if (url.protocol === "http:" && isLoopback) return { ok: true, reasonCode: "loopback-http-ok" };
  return { ok: false, reasonCode: url.protocol === "http:" ? "remote-http-refused" : "unsupported-protocol" };
}

/** Patterns that look like leaked secret VALUES — never allowed into any output. */
const SECRET_VALUE_PATTERN = /sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{10,}/;

/** Assert a value about to be surfaced carries no secret-looking content. */
export function assertNoSecretLeak(value: string): boolean {
  return !SECRET_VALUE_PATTERN.test(value);
}

export interface ProviderReadiness {
  readonly providerId: string;
  readonly accessMode: AccessMode;
  readonly installed: boolean;
  /** For key/CLI providers: authenticated or authentication-required. */
  readonly authState: "authenticated" | "authentication-required" | "not-applicable";
  /** True only when the env var NAME is present in the environment — value never read. */
  readonly configured: boolean;
  readonly available: boolean;
  readonly degraded: boolean;
  readonly rateLimited: boolean;
  readonly disabled: boolean;
  readonly lastSafeHealthCheckTick: number;
  readonly safeFailureCategory: string;
}

/**
 * A SAFE local detector: injected so tests never touch a real executable, key
 * value, or network. It reports only booleans (installed / key-name-present /
 * login-state) — never a secret value.
 */
export interface SafeLocalDetector {
  /** True if the CLI executable resolves locally (name only). */
  isExecutableInstalled(executableId: string): boolean;
  /** True if the CLI reports a logged-in account WITHOUT exposing tokens. */
  isSubscriptionLoggedIn(providerId: string): boolean;
  /** True if the environment variable NAME is set (presence only, value never read). */
  isEnvNamePresent(secretRef: string): boolean;
  /** True if a local endpoint answers a safe health probe (no prompt, no cost). */
  isLocalEndpointReachable(endpoint: string): boolean;
}

export function newProviderHealth(): ProviderHealthState {
  return { calls: 0, failures: 0, timeouts: 0, malformed: 0, rateLimited: 0, reliability: 0.7, qualityHistory: 0.5, lastSafeHealthCheckTick: 0, cooldownUntilTick: 0, paused: false, lastFailureCategory: "none" };
}

/** Compute readiness from SAFE local detection only. Never executes a paid prompt. */
export function checkProviderReadiness(contract: ProviderContract, detector: SafeLocalDetector, health: ProviderHealthState, tick: number): ProviderReadiness {
  const disabled = contract.accessMode === "disabled";
  let installed = false;
  let authState: ProviderReadiness["authState"] = "not-applicable";
  let configured = false;

  if (contract.accessMode === "subscription-cli") {
    installed = detector.isExecutableInstalled(contract.executableOrEndpoint);
    authState = installed && detector.isSubscriptionLoggedIn(contract.providerId) ? "authenticated" : "authentication-required";
  } else if (contract.accessMode === "api-key") {
    installed = true; // library/HTTP client always "installed"
    configured = contract.secretRef ? detector.isEnvNamePresent(contract.secretRef) : false;
    authState = configured ? "authenticated" : "authentication-required";
  } else if (contract.accessMode === "local-endpoint") {
    installed = detector.isLocalEndpointReachable(contract.executableOrEndpoint);
    authState = "not-applicable";
  } else if (contract.accessMode === "human-advisory") {
    installed = true; // the human is the transport
    authState = "not-applicable";
  }

  const rateLimited = health.rateLimited > 0 && health.cooldownUntilTick > tick;
  const degraded = health.paused || (health.calls > 0 && health.reliability < 0.5) || health.cooldownUntilTick > tick;
  const available = !disabled && !health.paused && health.cooldownUntilTick <= tick && (contract.accessMode === "human-advisory" || contract.accessMode === "subscription-cli" ? authState === "authenticated" : contract.accessMode === "api-key" ? configured : installed);

  return {
    providerId: contract.providerId,
    accessMode: contract.accessMode,
    installed,
    authState,
    configured,
    available: contract.accessMode === "human-advisory" ? !disabled : available,
    degraded,
    rateLimited,
    disabled,
    lastSafeHealthCheckTick: tick,
    safeFailureCategory: health.lastFailureCategory,
  };
}

/** The default national provider matrix. All secrets are references only. */
export function defaultProviderMatrix(): ProviderContract[] {
  const base = (over: Partial<ProviderLimits>): ProviderLimits => ({ maxContextTokens: 128000, maxConcurrency: 1, ratePerMinute: 20, dailyRequestLimit: 500, tokenBudget: 200000, timeoutMs: 600000, cooldownTicks: 6, ...over });
  return [
    { providerId: "codex-master-ant", providerFamily: "codex-cli", accessMode: "subscription-cli", authenticationMode: "codex-chatgpt-login", executableOrEndpoint: "codex", secretRef: null, supportedRoles: ["implementation", "integration", "debugging", "tests", "code-review", "repair"], supportedModalities: ["text", "code", "structured-json"], limits: base({ maxConcurrency: 1, timeoutMs: 600000 }), costPolicy: "subscription-included", outputFormat: "jsonl", parser: "codex-jsonl", privacyClassification: "internal", humanApprovalRequired: true, freeTierKnown: false, freeTierNotGuaranteed: true, masterAntId: "codex-master-ant" },
    { providerId: "claude-code-master-ant", providerFamily: "claude-code-cli", accessMode: "subscription-cli", authenticationMode: "claude-code-account-login", executableOrEndpoint: "claude", secretRef: null, supportedRoles: ["architecture", "difficult-reasoning", "system-design", "repository-analysis", "debugging", "security-analysis", "code-review", "repair"], supportedModalities: ["text", "code", "structured-json"], limits: base({ maxConcurrency: 1, timeoutMs: 600000 }), costPolicy: "subscription-included", outputFormat: "json", parser: "claude-code-json", privacyClassification: "internal", humanApprovalRequired: true, freeTierKnown: false, freeTierNotGuaranteed: true, masterAntId: "claude-code-master-ant" },
    { providerId: "gemini-api", providerFamily: "gemini-api", accessMode: "api-key", authenticationMode: "api-key-environment-reference", executableOrEndpoint: "https://generativelanguage.googleapis.com", secretRef: "GEMINI_API_KEY", supportedRoles: ["research", "difficult-reasoning", "code-review", "documentation"], supportedModalities: ["text", "structured-json"], limits: base({ maxConcurrency: 2, ratePerMinute: 15, dailyRequestLimit: 1000, timeoutMs: 120000 }), costPolicy: "free-tier-not-guaranteed", outputFormat: "json", parser: "gemini-json", privacyClassification: "internal", humanApprovalRequired: false, freeTierKnown: true, freeTierNotGuaranteed: true, masterAntId: null },
    { providerId: "openai-compatible", providerFamily: "openai-compatible-api", accessMode: "api-key", authenticationMode: "api-key-environment-reference", executableOrEndpoint: "https://api.openai.com", secretRef: "OPENAI_API_KEY", supportedRoles: ["research", "code-review", "documentation", "difficult-reasoning"], supportedModalities: ["text", "structured-json"], limits: base({ maxConcurrency: 2, timeoutMs: 120000 }), costPolicy: "paid-per-token", outputFormat: "json", parser: "openai-chat-json", privacyClassification: "internal", humanApprovalRequired: false, freeTierKnown: false, freeTierNotGuaranteed: true, masterAntId: null },
    { providerId: "deepseek", providerFamily: "openai-compatible-api", accessMode: "api-key", authenticationMode: "api-key-environment-reference", executableOrEndpoint: "https://api.deepseek.com", secretRef: "DEEPSEEK_API_KEY", supportedRoles: ["research", "code-review", "difficult-reasoning"], supportedModalities: ["text", "structured-json"], limits: base({ maxConcurrency: 2, timeoutMs: 120000 }), costPolicy: "free-tier-not-guaranteed", outputFormat: "json", parser: "openai-chat-json", privacyClassification: "internal", humanApprovalRequired: false, freeTierKnown: true, freeTierNotGuaranteed: true, masterAntId: null },
    { providerId: "qwen", providerFamily: "openai-compatible-api", accessMode: "api-key", authenticationMode: "api-key-environment-reference", executableOrEndpoint: "https://dashscope.aliyuncs.com", secretRef: "QWEN_API_KEY", supportedRoles: ["research", "documentation", "code-review"], supportedModalities: ["text", "structured-json"], limits: base({ maxConcurrency: 2, timeoutMs: 120000 }), costPolicy: "free-tier-not-guaranteed", outputFormat: "json", parser: "openai-chat-json", privacyClassification: "internal", humanApprovalRequired: false, freeTierKnown: true, freeTierNotGuaranteed: true, masterAntId: null },
    { providerId: "groq", providerFamily: "openai-compatible-api", accessMode: "api-key", authenticationMode: "api-key-environment-reference", executableOrEndpoint: "https://api.groq.com", secretRef: "GROQ_API_KEY", supportedRoles: ["research", "difficult-reasoning"], supportedModalities: ["text", "structured-json"], limits: base({ maxConcurrency: 3, ratePerMinute: 30, timeoutMs: 60000 }), costPolicy: "free-tier-not-guaranteed", outputFormat: "json", parser: "openai-chat-json", privacyClassification: "internal", humanApprovalRequired: false, freeTierKnown: true, freeTierNotGuaranteed: true, masterAntId: null },
    { providerId: "openrouter", providerFamily: "openai-compatible-api", accessMode: "api-key", authenticationMode: "api-key-environment-reference", executableOrEndpoint: "https://openrouter.ai", secretRef: "OPENROUTER_API_KEY", supportedRoles: ["research", "code-review", "documentation"], supportedModalities: ["text", "structured-json"], limits: base({ maxConcurrency: 2, timeoutMs: 120000 }), costPolicy: "free-tier-not-guaranteed", outputFormat: "json", parser: "openai-chat-json", privacyClassification: "internal", humanApprovalRequired: false, freeTierKnown: true, freeTierNotGuaranteed: true, masterAntId: null },
    { providerId: "ollama-local", providerFamily: "ollama", accessMode: "local-endpoint", authenticationMode: "local-no-auth", executableOrEndpoint: "http://127.0.0.1:11434", secretRef: null, supportedRoles: ["research", "code-review", "documentation", "debugging", "implementation"], supportedModalities: ["text", "code", "structured-json"], limits: base({ maxConcurrency: 4, ratePerMinute: 120, dailyRequestLimit: 100000, timeoutMs: 300000 }), costPolicy: "local-compute-only", outputFormat: "json", parser: "ollama-json", privacyClassification: "sensitive", humanApprovalRequired: false, freeTierKnown: true, freeTierNotGuaranteed: false, masterAntId: null },
    { providerId: "vllm-local", providerFamily: "local-openai-compatible", accessMode: "local-endpoint", authenticationMode: "local-no-auth", executableOrEndpoint: "http://127.0.0.1:8000", secretRef: null, supportedRoles: ["research", "code-review", "implementation"], supportedModalities: ["text", "code", "structured-json"], limits: base({ maxConcurrency: 4, ratePerMinute: 120, dailyRequestLimit: 100000, timeoutMs: 300000 }), costPolicy: "local-compute-only", outputFormat: "json", parser: "openai-chat-json", privacyClassification: "sensitive", humanApprovalRequired: false, freeTierKnown: true, freeTierNotGuaranteed: false, masterAntId: null },
    { providerId: "llamacpp-local", providerFamily: "local-openai-compatible", accessMode: "local-endpoint", authenticationMode: "local-no-auth", executableOrEndpoint: "http://127.0.0.1:8080", secretRef: null, supportedRoles: ["research", "documentation", "code-review"], supportedModalities: ["text", "code", "structured-json"], limits: base({ maxConcurrency: 2, ratePerMinute: 60, dailyRequestLimit: 50000, timeoutMs: 300000 }), costPolicy: "local-compute-only", outputFormat: "json", parser: "openai-chat-json", privacyClassification: "sensitive", humanApprovalRequired: false, freeTierKnown: true, freeTierNotGuaranteed: false, masterAntId: null },
    { providerId: "chatgpt-advisory", providerFamily: "chat-advisory", accessMode: "human-advisory", authenticationMode: "human-import", executableOrEndpoint: "", secretRef: null, supportedRoles: ["advisory", "difficult-reasoning"], supportedModalities: ["text"], limits: base({ maxConcurrency: 1, ratePerMinute: 1, dailyRequestLimit: 20, timeoutMs: 0 }), costPolicy: "human-time-only", outputFormat: "text", parser: "human-imported-untrusted", privacyClassification: "sensitive", humanApprovalRequired: true, freeTierKnown: false, freeTierNotGuaranteed: true, masterAntId: null },
    { providerId: "claude-chat-advisory", providerFamily: "chat-advisory", accessMode: "human-advisory", authenticationMode: "human-import", executableOrEndpoint: "", secretRef: null, supportedRoles: ["advisory", "difficult-reasoning"], supportedModalities: ["text"], limits: base({ maxConcurrency: 1, ratePerMinute: 1, dailyRequestLimit: 20, timeoutMs: 0 }), costPolicy: "human-time-only", outputFormat: "text", parser: "human-imported-untrusted", privacyClassification: "sensitive", humanApprovalRequired: true, freeTierKnown: false, freeTierNotGuaranteed: true, masterAntId: null },
  ];
}

/** A detector that reports NOTHING as installed/configured — the safe default for automated tests. */
export function offlineSafeDetector(): SafeLocalDetector {
  return { isExecutableInstalled: () => false, isSubscriptionLoggedIn: () => false, isEnvNamePresent: () => false, isLocalEndpointReachable: () => false };
}
