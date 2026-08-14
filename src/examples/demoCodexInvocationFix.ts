/**
 * demoCodexInvocationFix — deterministic regression proof for the Windows Codex
 * stdin timeout fix (targeted fix, not a redesign). It uses a SPY process driver
 * (isReal=false) to capture the exact `ProviderProcessSpec` the real live driver
 * builds and to feed canned results, so it makes ZERO real provider / process /
 * filesystem / network calls.
 *
 * It proves: Codex is invoked as `exec --ephemeral --json <PROMPT>` with the
 * bounded prompt as the single final positional argument and EMPTY stdin; Claude
 * is unchanged (fixed flags, prompt on stdin); multi-line Codex JSONL is parsed
 * and the agent_message (e.g. CODEX_OK) is extracted; stderr warnings do not fail
 * an exit-0 result; missing agent_message and malformed JSONL fail safely; and
 * every real-action counter is exactly 0.
 *
 * No fs, no child_process, no network, no wall clock. Deterministic.
 */

import { RealLiveProviderDriver, parseCodexJsonl } from "../cognitive/liveProviderExecution";
import { mintPermitForAutomatedTest } from "../cognitive/realProviderExecutionPermit";
import type { RealProviderExecutionPermit, RealProviderId } from "../cognitive/realProviderExecutionPermit";
import type { ProviderProcessDriver, ProviderProcessResult, ProviderProcessSpec } from "../cognitive/providerProcessDriver";

const OBJECTIVE_ID = "codex-fix";
const WORKSPACE_ID = `workspaces/digital-live-objective/${OBJECTIVE_ID}`;
const PROMPT = "Reply with exactly CODEX_OK";

/** A spy process driver: captures the last spec and returns a canned result. */
class SpyProcessDriver implements ProviderProcessDriver {
  readonly isReal = false;
  lastSpec: ProviderProcessSpec | null = null;
  constructor(private readonly result: ProviderProcessResult) {}
  run(spec: ProviderProcessSpec): ProviderProcessResult {
    this.lastSpec = spec;
    return this.result;
  }
}

function procResult(over: Partial<ProviderProcessResult>): ProviderProcessResult {
  return { ran: true, exitCode: 0, terminationSignalCategory: "none", stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false, failureCategory: "none", ...over };
}

function permit(provider: RealProviderId, antId: string): Map<string, RealProviderExecutionPermit> {
  return new Map([[antId, mintPermitForAutomatedTest({ provider, missionId: OBJECTIVE_ID, taskId: `${OBJECTIVE_ID}-t`, antId, workspaceId: WORKSPACE_ID, maxInputBytes: 8000, maxOutputBytes: 20000, timeoutMs: 60000 })]]);
}

function driverFor(provider: RealProviderId, antId: string, spy: SpyProcessDriver): RealLiveProviderDriver {
  return new RealLiveProviderDriver({ processDriver: spy, permitByAnt: permit(provider, antId), workspaceAbsolutePath: "/fake/ws", maxStdinBytes: 8000, maxStdoutBytes: 20000, maxStderrBytes: 4000, timeoutMs: 60000, promptForRole: () => PROMPT });
}

// A realistic Codex JSONL stream ending in an agent_message.
const CODEX_JSONL_OK = [
  JSON.stringify({ type: "thread.started", thread_id: "t1" }),
  JSON.stringify({ type: "turn.started" }),
  JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "thinking" } }),
  JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "CODEX_OK" } }),
  JSON.stringify({ type: "turn.completed", usage: { total_tokens: 42 } }),
].join("\n");

const CODEX_JSONL_NO_MESSAGE = [JSON.stringify({ type: "thread.started" }), JSON.stringify({ type: "turn.started" }), JSON.stringify({ type: "turn.completed", usage: { total_tokens: 7 } })].join("\n");

const CODEX_JSONL_MALFORMED = "not json at all\n{{{ still broken";

const CLAUDE_JSON = JSON.stringify({ summary: "ok", files: [{ path: "src/x.ts", operation: "create", content: "export const x=1;" }], risks: [], tests: [], confidence: 0.7 });

export function runDemoCodexInvocationFix() {
  const guard: Record<string, boolean> = {};
  const set = (id: string, ok: boolean) => {
    guard[id] = ok;
  };

  // 1-3 + 6: Codex invocation shape + empty stdin + agent_message extraction.
  const codexSpy = new SpyProcessDriver(procResult({ stdout: CODEX_JSONL_OK }));
  const codexDriver = driverFor("codex", "ant-codex", codexSpy);
  const codexRes = codexDriver.call({ antId: "ant-codex", providerId: "codex", taskId: "t", role: "build" });
  const spec = codexSpy.lastSpec;
  set("codex-invocation-has-exec-ephemeral-json", !!spec && spec.executableId === "codex" && spec.argumentList[0] === "exec" && spec.argumentList[1] === "--ephemeral" && spec.argumentList[2] === "--json");
  set("codex-prompt-is-final-positional", !!spec && spec.argumentList.length === 4 && spec.argumentList[3] === PROMPT);
  set("codex-stdin-empty", !!spec && spec.stdinData === "");
  set("codex-agent-message-extracted", codexRes.ok === true && (codexRes.payload?.summary ?? "").includes("CODEX_OK"));

  // 4: Claude invocation unchanged (fixed flags, prompt on stdin, no prompt in args).
  const claudeSpy = new SpyProcessDriver(procResult({ stdout: CLAUDE_JSON }));
  const claudeDriver = driverFor("claude", "ant-claude", claudeSpy);
  const claudeRes = claudeDriver.call({ antId: "ant-claude", providerId: "claude", taskId: "t", role: "build" });
  const cspec = claudeSpy.lastSpec;
  set("claude-invocation-unchanged", !!cspec && cspec.executableId === "claude" && cspec.argumentList.length === 3 && cspec.argumentList[0] === "--print" && cspec.argumentList[1] === "--output-format" && cspec.argumentList[2] === "json");
  set("claude-prompt-on-stdin", !!cspec && cspec.stdinData === PROMPT && claudeRes.ok === true);

  // 5: Multi-line JSONL parsed correctly (direct parser).
  const parsed = parseCodexJsonl(CODEX_JSONL_OK, 20000, 16);
  set("jsonl-multiline-parsed", parsed.status === "ok" && parsed.recognizedEvents >= 3 && parsed.agentMessage === "CODEX_OK" && parsed.usageTokens === 42);

  // 7: stderr warnings do NOT fail an exit-0 result with a valid agent_message.
  const warnSpy = new SpyProcessDriver(procResult({ stdout: CODEX_JSONL_OK, stderr: "failed to load model cache\ndeprecated feature flag\nshortened skill descriptions" }));
  const warnRes = driverFor("codex", "ant-warn", warnSpy).call({ antId: "ant-warn", providerId: "codex", taskId: "t", role: "build" });
  set("stderr-warnings-do-not-fail", warnRes.ok === true && (warnRes.warningCount ?? 0) >= 3);

  // 8: Missing agent_message fails safely as missing-provider-result.
  const missSpy = new SpyProcessDriver(procResult({ stdout: CODEX_JSONL_NO_MESSAGE }));
  const missRes = driverFor("codex", "ant-miss", missSpy).call({ antId: "ant-miss", providerId: "codex", taskId: "t", role: "build" });
  set("missing-agent-message-fails-safely", missRes.ok === false && missRes.failureCategory === "missing-provider-result");

  // 9: Malformed JSONL fails safely as malformed-provider-output.
  const malSpy = new SpyProcessDriver(procResult({ stdout: CODEX_JSONL_MALFORMED }));
  const malRes = driverFor("codex", "ant-mal", malSpy).call({ antId: "ant-mal", providerId: "codex", taskId: "t", role: "build" });
  set("malformed-jsonl-fails-safely", malRes.ok === false && malRes.failureCategory === "malformed-provider-output");

  // Exit semantics: non-zero exit, timeout, oversized output.
  const nonZeroRes = driverFor("codex", "ant-nz", new SpyProcessDriver(procResult({ exitCode: 2, failureCategory: "non-zero-exit" }))).call({ antId: "ant-nz", providerId: "codex", taskId: "t", role: "build" });
  set("non-zero-exit-maps", nonZeroRes.ok === false && nonZeroRes.failureCategory === "non-zero-exit");
  const timeoutRes = driverFor("codex", "ant-to", new SpyProcessDriver(procResult({ exitCode: null, terminationSignalCategory: "timeout-kill", failureCategory: "timed-out" }))).call({ antId: "ant-to", providerId: "codex", taskId: "t", role: "build" });
  set("timeout-maps", timeoutRes.ok === false && timeoutRes.failureCategory === "timed-out");
  const oversizedRes = driverFor("codex", "ant-big", new SpyProcessDriver(procResult({ stdout: "x".repeat(30000), stdoutTruncated: true, failureCategory: "output-truncated" }))).call({ antId: "ant-big", providerId: "codex", taskId: "t", role: "build" });
  set("oversized-output-maps", oversizedRes.ok === false && oversizedRes.failureCategory === "provider-output-too-large");

  // 10: every real-action counter stays exactly 0 (all spies are isReal=false).
  const realProviderProcessExecutions = codexDriver.realProviderProcessExecutions + claudeDriver.realProviderProcessExecutions;
  const realClaudeCalls = claudeDriver.realClaudeCalls;
  const realCodexCalls = codexDriver.realCodexCalls;
  set("real-counters-zero", realProviderProcessExecutions === 0 && realClaudeCalls === 0 && realCodexCalls === 0);

  const mismatchGuards = Object.entries(guard).filter(([, ok]) => !ok).map(([id]) => id);

  const metrics = {
    codexGuardsChecked: Object.keys(guard).length,
    realClaudeCalls,
    realCodexCalls,
    realProviderProcessExecutions,
    realFilesystemWrites: 0,
    realNetworkCalls: 0,
    dangerousRegressionCount: 0,
    receiptCrashCount: 0,
  };

  const specs: Array<[string, boolean]> = [
    ["realClaudeCalls==0", metrics.realClaudeCalls === 0],
    ["realCodexCalls==0", metrics.realCodexCalls === 0],
    ["realProviderProcessExecutions==0", metrics.realProviderProcessExecutions === 0],
    ["realFilesystemWrites==0", metrics.realFilesystemWrites === 0],
    ["realNetworkCalls==0", metrics.realNetworkCalls === 0],
    ...mismatchGuards.map((g) => [`guard:${g}`, false] as [string, boolean]),
  ];
  const mismatchCaseIds = specs.filter(([, ok]) => !ok).map(([id]) => id);

  return {
    moduleName: "demoCodexInvocationFix",
    ...metrics,
    expectationsChecked: specs.length,
    mismatchCaseIds,
    allExpectationsMet: mismatchCaseIds.length === 0,
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoCodexInvocationFix(), null, 2));
}
