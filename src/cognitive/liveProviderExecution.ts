/**
 * liveProviderExecution — the REAL live provider driver (Build Law §26). It
 * implements the runner's `LiveProviderDriver` contract by wiring the existing
 * pieces for one ant, one call:
 *
 *   validate the human-approved provider assignment → validate the scoped
 *   single-use RealProviderExecutionPermit → build a bounded ProviderProcessSpec
 *   (fixed executable, fixed args, bounded stdin, timeout, workspace cwd) →
 *   consume the permit immediately before spawn → run EXACTLY ONE process via the
 *   injected `ProviderProcessDriver` → capture bounded stdout → normalize to
 *   structured DATA. No provider can trigger another provider; there is no retry.
 *
 * The real counters increment ONLY when the injected process driver `isReal`.
 * Automated tests inject `FakeProviderProcessDriver`, so `realClaudeCalls`,
 * `realCodexCalls`, and `realProviderProcessExecutions` stay 0 even through this
 * real wiring. The human CLI injects `NodeProviderProcessDriver` — the single
 * `child_process` importer — for the live path.
 *
 * This module imports no fs, no child_process, and no network of its own.
 */

import type { ProviderExecutableId, ProviderProcessDriver, ProviderProcessSpec } from "./providerProcessDriver";
import { buildSafeProviderRequest, type ProviderRequestReceipt } from "./safeProviderRequest";
import { evaluateNetworkCapability, projectNetwork, TOOL_NETWORK_DECLARATIONS, UnobservedNetworkProvider, NoProcessNetworkProvider, type NetworkProjection } from "./networkPolicy";
import { truncateUtf8, utf8Bytes } from "./safeWorkspacePath";
import type { RealProviderExecutionPermit } from "./realProviderExecutionPermit";
import { consumePermit, isConsumed, isValidPermit, permitScopeMatches } from "./realProviderExecutionPermit";

/**
 * A permit limit that can be reasoned about: finite, whole, and positive.
 *
 * Rejecting NaN and Infinity matters more than it looks. `Math.min(x, NaN)` is
 * NaN and every subsequent comparison against it is false, so a single bad
 * field turns a ceiling into an open door.
 */
function isPositiveIntegerLimit(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}
import type { LiveProviderCallInput, LiveProviderCallResult, LiveProviderDriver } from "../digital/liveObjectiveRunner";
import type { RawProviderFile, RawProviderPayload } from "../digital/liveProviderNormalization";

/** Safely coerce an unknown provider JSON body into the bounded raw payload shape. */
export function parseLiveProviderJson(stdout: string, maxBytes: number, maxFiles: number): RawProviderPayload {
  const trimmed = truncateUtf8(stdout, maxBytes).text;
  if (trimmed.trim().length === 0) return malformed();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return malformed();
  }
  if (typeof parsed !== "object" || parsed === null) return malformed();
  const obj = parsed as Record<string, unknown>;
  const files: RawProviderFile[] = [];
  if (Array.isArray(obj.files)) {
    for (const f of obj.files) {
      if (files.length >= maxFiles) break;
      if (typeof f !== "object" || f === null) continue;
      const fo = f as Record<string, unknown>;
      if (typeof fo.path !== "string" || typeof fo.content !== "string") continue;
      files.push({ path: fo.path, operation: fo.operation === "modify" ? "modify" : "create", content: fo.content });
    }
  }
  return {
    summary: typeof obj.summary === "string" ? obj.summary : "",
    assumptions: strArray(obj.assumptions),
    files,
    risks: strArray(obj.risks),
    tests: strArray(obj.tests),
    confidence: typeof obj.confidence === "number" && Number.isFinite(obj.confidence) ? Math.max(0, Math.min(1, obj.confidence)) : 0.5,
    requestedCommands: strArray(obj.requestedCommands),
  };
}

function malformed(): RawProviderPayload {
  return { summary: "", assumptions: [], files: [], risks: [], tests: [], confidence: 0, malformed: true };
}
function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string" && v.length <= 1000) out.push(v);
    if (out.length >= 16) break;
  }
  return out;
}

export type CodexParseStatus = "ok" | "malformed" | "missing";

export interface CodexParseResult {
  readonly status: CodexParseStatus;
  readonly payload?: RawProviderPayload;
  readonly agentMessage?: string;
  readonly usageTokens?: number;
  readonly recognizedEvents: number;
}

/**
 * Bounded JSONL parser for Codex `--json` output. Codex emits ONE JSON object per
 * line (thread.started, turn.started, item.completed, turn.completed, …). This
 * splits stdout into non-empty lines, parses each independently, skips malformed
 * lines safely, and extracts the final usable result from an `item.completed`
 * whose `item.type === "agent_message"` (its `item.text`). It never evaluates the
 * text, never executes commands, never trusts paths, and enforces the byte cap.
 *
 *   - no valid JSON at all            -> "malformed"
 *   - valid JSON but no agent_message -> "missing"
 *   - agent_message present           -> "ok" (+ payload derived from its text)
 */
export function parseCodexJsonl(stdout: string, maxBytes: number, maxFiles: number): CodexParseResult {
  const capped = truncateUtf8(stdout, maxBytes).text;
  const lines = capped.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return { status: "malformed", recognizedEvents: 0 };

  let parsedAny = false;
  let recognizedEvents = 0;
  let agentMessage: string | null = null;
  let usageTokens: number | undefined;

  for (const line of lines) {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // reject a malformed non-empty line safely — skip it
    }
    if (typeof obj !== "object" || obj === null) continue;
    parsedAny = true;
    const o = obj as Record<string, unknown>;
    if (o.type === "thread.started" || o.type === "turn.started" || o.type === "item.completed" || o.type === "turn.completed") recognizedEvents += 1;
    // The final usable result: item.completed with an agent_message item.
    if (o.type === "item.completed" && typeof o.item === "object" && o.item !== null) {
      const item = o.item as Record<string, unknown>;
      if (item.type === "agent_message" && typeof item.text === "string") agentMessage = item.text;
    }
    // Defensive: also accept a flat {type:"agent_message", text} shape.
    if (o.type === "agent_message" && typeof o.text === "string") agentMessage = o.text;
    // Safe usage metadata when available.
    if (o.type === "turn.completed" && typeof o.usage === "object" && o.usage !== null) {
      const u = o.usage as Record<string, unknown>;
      const tot = typeof u.total_tokens === "number" ? u.total_tokens : typeof u.output_tokens === "number" ? u.output_tokens : undefined;
      if (typeof tot === "number") usageTokens = tot;
    }
  }

  if (!parsedAny) return { status: "malformed", recognizedEvents };
  if (agentMessage === null) return { status: "missing", recognizedEvents };
  return { status: "ok", payload: agentMessageToPayload(agentMessage, maxFiles), agentMessage, usageTokens, recognizedEvents };
}

/**
 * Locate ONE bounded JSON object inside real Codex/Claude agent text. Real
 * providers routinely wrap the envelope in a Markdown ```json fence or precede
 * it with prose — the old `startsWith("{")` check missed both, so a valid review
 * response normalized to an empty envelope (the V2 real-run `unsupported-role-
 * output`). This strips optional fences and returns the first balanced top-level
 * object, or null. It never evaluates the text.
 */
export function extractJsonObject(text: string): string | null {
  let t = text.trim();
  // Strip a leading ```json / ``` fence and its closing fence when present.
  const fence = t.match(/```(?:json|json5|ts|typescript)?\s*([\s\S]*?)```/i);
  if (fence && fence[1].trim().length > 0) t = fence[1].trim();
  const start = t.indexOf("{");
  if (start < 0) return null;
  // Scan for the matching closing brace, ignoring braces inside strings.
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i += 1) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return null;
}

/** The agent_message text is either our structured JSON envelope (possibly fenced) or plain text. */
function agentMessageToPayload(text: string, maxFiles: number): RawProviderPayload {
  const jsonObject = extractJsonObject(text);
  if (jsonObject) {
    // utf8Bytes, NOT .length: a UTF-16 count used as a byte budget truncates any
    // Arabic/Hebrew/emoji JSON mid-structure and misreports it as malformed.
    const p = parseLiveProviderJson(jsonObject, utf8Bytes(jsonObject), maxFiles);
    if (!p.malformed) return p;
  }
  // Plain text agent message (e.g. "CODEX_OK"): summary only, no files.
  return { summary: text.slice(0, 2000), assumptions: [], files: [], risks: [], tests: [], confidence: 0.5 };
}

/** Safe count of non-empty stderr warning lines — the raw text is never exposed. */
export function countStderrWarnings(stderr: string): number {
  return stderr.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
}

export interface RealLiveProviderConfig {
  readonly processDriver: ProviderProcessDriver;
  /** One scoped, single-use permit per ant id. */
  readonly permitByAnt: ReadonlyMap<string, RealProviderExecutionPermit>;
  /**
   * TRUSTED EXECUTION CONTEXT (S-12). Supplied by the composition root — the
   * human CLI that also created the workspace — never by a per-call object.
   *
   * A caller announcing "I am mission X in workspace Y" is not evidence of
   * anything: it is a string, and the process still runs wherever
   * `workspaceAbsolutePath` points. Binding all three here, in one immutable
   * object, is what gives `permit.workspaceId` a meaning — the root holds the
   * logical id and the real path together and hands over both at once, so a
   * permit for workspace-A cannot authorize a spawn whose cwd is workspace-B.
   *
   * `LiveProviderCallInput` therefore contributes only genuinely per-call
   * fields (provider, task, ant, role) and CANNOT override these.
   */
  readonly missionId: string;
  readonly workspaceId: string;
  readonly workspaceAbsolutePath: string;
  readonly maxStdinBytes: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly timeoutMs: number;
  /** Fixed, bounded prompt text per role (never a CLI argument). A bounded, safe contextBrief may be appended. */
  readonly promptForRole: (role: string, antId: string, contextBrief?: string) => string;
}

/**
 * The fixed FLAG templates per provider now live in `safeProviderRequest.ts`
 * (§26) alongside the executable map, so argv has exactly ONE definition.
 * Claude receives the bounded prompt on stdin (`--print` reads stdin). Codex is
 * a NON-interactive `exec` run whose bounded prompt is the single FINAL
 * POSITIONAL argument; its stdin is empty and closed. On Windows, Codex
 * `exec --json` without a positional prompt waits on stdin and hangs — passing
 * the prompt positionally with empty stdin is the fix.
 */

export class RealLiveProviderDriver implements LiveProviderDriver {
  readonly kind = "real-live" as const;
  private realExecs = 0;
  private claudeCalls = 0;
  private codexCalls = 0;

  /** The most recent OUTBOUND request receipt (safe fields only, never a prompt). */
  private lastRequestReceipt: ProviderRequestReceipt | null = null;

  constructor(private readonly config: RealLiveProviderConfig) {}

  get outboundRequestReceipt(): ProviderRequestReceipt | null {
    return this.lastRequestReceipt;
  }

  get realProviderProcessExecutions(): number {
    return this.realExecs;
  }
  /**
   * DEPRECATED and deliberately NOT zero. This driver does not open a socket
   * itself, but it spawns a provider CLI that certainly reaches the network, and
   * nothing here observes that. Returning 0 stated as fact something never
   * measured. Callers must read `networkProjection` instead.
   */
  get realNetworkCalls(): number | null {
    // null ONLY when something unobservable actually ran. With a fake process
    // driver no child process exists at all, so zero is genuinely proven and
    // reporting 0 is honest — the dishonesty was only ever in claiming 0 for a
    // REAL provider CLI that nothing was watching.
    return this.config.processDriver.isReal ? null : 0;
  }

  /** The honest network position of this driver: allowed by policy, unobserved. */
  get networkProjection(): NetworkProjection {
    return projectNetwork(
      evaluateNetworkCapability({
        declaration: TOOL_NETWORK_DECLARATIONS[this.config.processDriver.isReal ? "claude" : "fake-provider"],
        grantedPolicy: this.config.processDriver.isReal ? "provider-only" : "denied",
        // A real provider CLI is unobservable from here; a fake spawns nothing.
        observationProvider: this.config.processDriver.isReal ? new UnobservedNetworkProvider() : new NoProcessNetworkProvider(),
        sequence: this.realExecs,
      })
    );
  }
  get realClaudeCalls(): number {
    return this.claudeCalls;
  }
  get realCodexCalls(): number {
    return this.codexCalls;
  }

  call(input: LiveProviderCallInput): LiveProviderCallResult {
    // The map is LOOKUP ONLY. A key and the object stored under it can disagree,
    // so finding a permit at `antId` proves nothing about who it authorizes —
    // `permitScopeMatches` below re-checks `permit.antId` against the call.
    const permit = this.config.permitByAnt.get(input.antId);
    if (!permit || !isValidPermit(permit) || isConsumed(permit)) return { ok: false, failureCategory: "no-valid-permit" };
    // Defense: the REAL process driver may run only a human-cli-origin permit.
    // An automated-test permit can therefore never drive a real provider spawn.
    if (this.config.processDriver.isReal && permit.origin !== "human-cli") return { ok: false, failureCategory: "non-human-permit" };

    // NUMERIC AUTHORIZATION LIMITS (S-12). A permit can be WeakSet-valid and
    // still carry nonsense: NaN and Infinity make every `Math.min` comparison
    // permissive, 0 and negatives make bounded arithmetic meaningless, and a
    // fraction silently becomes a different byte count downstream. Checked
    // before anything is consumed or spawned, and the offending value is never
    // echoed into a receipt.
    if (!isPositiveIntegerLimit(permit.maxInputBytes) || !isPositiveIntegerLimit(permit.maxOutputBytes) || !isPositiveIntegerLimit(permit.timeoutMs)) {
      return { ok: false, failureCategory: "permit-limits-invalid" };
    }

    // THE TRUSTED TARGET. Mission and workspace come from the immutable config
    // the composition root built alongside the real workspace; only provider,
    // task and ant come from the call. The caller cannot nominate its own
    // mission or workspace, so a permit cannot be redirected by claiming to be
    // somewhere it is not.
    const scope = permitScopeMatches(permit, {
      provider: input.providerId,
      missionId: this.config.missionId,
      taskId: input.taskId,
      antId: input.antId,
      workspaceId: this.config.workspaceId,
    });
    // A mismatch must NOT burn the permit: the correctly-scoped call still has
    // to be possible afterwards.
    if (!scope.ok) return { ok: false, failureCategory: scope.reasonCode };

    // EFFECTIVE CEILINGS. The permit is an authorization ceiling and the config
    // is an operational one; the smaller always wins, and neither can widen the
    // other.
    const effectiveMaxInput = Math.min(this.config.maxStdinBytes, permit.maxInputBytes);
    const effectiveMaxOutput = Math.min(this.config.maxStdoutBytes, permit.maxOutputBytes);

    // Consume the permit IMMEDIATELY before spawn — single use, no replay. Every
    // authorization decision above is already made, so nothing that follows can
    // widen what was authorized.
    if (!consumePermit(permit)) return { ok: false, failureCategory: "permit-consumed" };

    const executableId: ProviderExecutableId = input.providerId;
    const isCodex = executableId === "codex";
    // A safe, bounded contextBrief (file plan / artifact manifest) is appended so
    // build receives the plan and review receives the artifacts — never AntMind.
    const rawPrompt = this.config.promptForRole(input.role, input.antId, input.contextBrief);
    // Role-aware bounded timeout: the per-call value, clamped to the permit ceiling.
    const timeoutMs = Math.max(1, Math.min(permit.timeoutMs, this.config.timeoutMs, Math.floor(input.timeoutMs ?? this.config.timeoutMs)));

    // OUTBOUND BOUNDARY (§26): argv, stdin, and the child environment are built
    // HERE, by the request kernel, never by this caller. It fails closed on
    // authentication material, so a prompt carrying a live credential is never
    // spawned. Note the permit has already been consumed — a blocked request
    // costs the caller its permit, which is the correct incentive.
    const built = buildSafeProviderRequest({
      requestId: `${input.antId}:${input.role}`,
      providerId: executableId,
      role: input.role,
      objective: "",
      promptBody: rawPrompt,
      workingDirectoryAbsolute: this.config.workspaceAbsolutePath,
      timeoutMs,
      // Both ceilings are the PERMIT-BOUNDED values, so the request kernel's
      // existing UTF-8-safe bounding enforces the authorization rather than the
      // looser driver configuration. Claude's stdin and Codex's positional argv
      // prompt both flow through this one boundary.
      maxStdoutBytes: effectiveMaxOutput,
      maxStderrBytes: this.config.maxStderrBytes,
      maxPromptBytes: effectiveMaxInput,
    });
    this.lastRequestReceipt = built.receipt;
    if (!built.ok) {
      // The driver is NEVER invoked for a blocked request.
      return { ok: false, failureCategory: built.receipt.safeReasonCode, requestBytes: 0, responseBytes: 0, durationMs: 0, exitCode: null, timeoutMs };
    }
    const spec: ProviderProcessSpec = built.spec;
    const requestBytes = built.receipt.acceptedBytes;

    const startedAt = Date.now();
    const result = this.config.processDriver.run(spec);
    const durationMs = Date.now() - startedAt;
    // Count a REAL execution only when the injected driver is the real one.
    if (this.config.processDriver.isReal && result.ran) {
      this.realExecs += 1;
      if (executableId === "claude") this.claudeCalls += 1;
      else this.codexCalls += 1;
    }
    const warningCount = countStderrWarnings(result.stderr);
    // REAL UTF-8 BYTES. This field claims bytes, so it must count bytes:
    // `.length` is a UTF-16 code-unit count and under-reports every multibyte
    // character, which would make the accounting below quietly wrong.
    const responseBytes = utf8Bytes(result.stdout);
    const diag = { warningCount, requestBytes, responseBytes, durationMs, exitCode: result.exitCode, timeoutMs };

    // Exit semantics (stderr warnings NEVER fail an exit-0 result).
    if (!result.ran) return { ok: false, failureCategory: result.failureCategory === "none" ? "spawn-failed" : result.failureCategory, ...diag };
    if (result.failureCategory === "timed-out") return { ok: false, failureCategory: "timed-out", ...diag };
    if (result.failureCategory === "non-zero-exit") return { ok: false, failureCategory: "non-zero-exit", ...diag };
    if (result.stdoutTruncated || result.failureCategory === "output-truncated") return { ok: false, failureCategory: "provider-output-too-large", ...diag, outputTruncated: true };

    // DEFENSE IN DEPTH AGAINST A DISOBEDIENT DRIVER. `ProviderProcessSpec` is a
    // request, not a guarantee — the driver is injected, and a broken or hostile
    // one can return more than it was allowed to. Measured in real UTF-8 bytes
    // against the SAME effective ceiling the spec carried, so a driver that
    // ignores the spec cannot smuggle an oversized payload past the permit. The
    // output itself is never placed in the receipt.
    if (responseBytes > effectiveMaxOutput) return { ok: false, failureCategory: "provider-output-too-large", ...diag, outputTruncated: true };

    // Exit code 0, not truncated: parse per provider format — bounded by the
    // same effective ceiling, never the looser config cap.
    if (isCodex) {
      const codex = parseCodexJsonl(result.stdout, effectiveMaxOutput, 16);
      if (codex.status === "malformed") return { ok: false, failureCategory: "malformed-provider-output", ...diag };
      if (codex.status === "missing" || !codex.payload) return { ok: false, failureCategory: "missing-provider-result", ...diag };
      return { ok: true, payload: codex.payload, ...diag, outputTruncated: false };
    }
    const payload = parseClaudeJson(result.stdout, effectiveMaxOutput, 16);
    if (payload.malformed) return { ok: false, failureCategory: "malformed-output", ...diag };
    return { ok: true, payload, ...diag, outputTruncated: false };
  }
}

/**
 * Parse real Claude `--print --output-format json` output. The Claude Code CLI
 * wraps the model answer in an envelope `{type:"result", result:"<text>", ...}`;
 * that inner text may itself be fenced JSON. Fall back to treating stdout as the
 * envelope directly (older/plain formats) via the shared JSON extractor.
 */
export function parseClaudeJson(stdout: string, maxBytes: number, maxFiles: number): RawProviderPayload {
  const capped = truncateUtf8(stdout, maxBytes).text;
  try {
    const outer = JSON.parse(capped) as Record<string, unknown>;
    if (outer && typeof outer.result === "string") {
      return agentMessageToPayload(outer.result, maxFiles);
    }
  } catch {
    /* not a bare envelope — fall through to extraction */
  }
  const obj = extractJsonObject(capped);
  if (obj) {
    // utf8Bytes, NOT .length — see parseCodexJsonl above.
    const p = parseLiveProviderJson(obj, utf8Bytes(obj), maxFiles);
    if (!p.malformed) return p;
  }
  return parseLiveProviderJson(capped, maxBytes, maxFiles);
}
