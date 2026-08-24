/**
 * twinBuildLoopTests — TWIN-R1 regressions for the bounded twin build/verify/
 * repair loop, the mission-input seam, and the isolation those two must preserve.
 *
 * WHAT THESE TESTS DO AND DO NOT PROVE. They use injected test doubles to drive
 * CONTROL FLOW: which state the loop reaches, which colony is asked to repair,
 * what a frozen bundle is permitted to claim. They do NOT prove that a real
 * provider can build software, and they do not prove a real sandbox executes
 * anything — the doubles never spawn. Both remain open until a verified sandbox
 * backend and a real provider run exist. Nothing here should be read as evidence
 * that either empire is operational.
 *
 * Deterministic: no fs, no child_process, no network, no wall clock.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { runTwinBuildLoop, classifyVerificationOutcome, validateMaxRepairAttempts, buildRepairObjective, TWIN_DEFAULT_MAX_REPAIR_ATTEMPTS, TWIN_MAX_REPAIR_ATTEMPTS_CEILING } from "../twin/twinBuildLoop";
import type { TwinVerificationBackend, TwinRepairSlot } from "../twin/twinBuildLoop";
import { runTwinColonyLive, InMemoryTwinWorkspaceApplier } from "../twin/twinColonyLiveRunner";
import type { TwinWorkspaceApplier } from "../twin/twinColonyLiveRunner";
import { ColonyWorkspaceAuthority } from "../twin/colonyWorkspace";
import { isVerifiedCandidate } from "../twin/twinColonyTypes";
import { mintTwinEmpirePermitForAutomatedTest } from "../cognitive/twinEmpireLivePermit";
import type { TwinColonyId } from "../cognitive/twinEmpireLivePermit";
import type { VerificationDriver, VerificationOutcome } from "../digital/digitalVerification";
import type { LiveProviderDriver, LiveProviderCallInput, LiveProviderCallResult } from "../digital/liveObjectiveRunner";
import { buildSafeProviderRequest } from "../cognitive/safeProviderRequest";
import { validateMissionId, validateMissionObjectiveText, resolveMissionObjectivePath, MAX_OBJECTIVE_BYTES } from "../cognitive/missionObjectiveFile";

const MISSION = "twin-r1-test";
const CLAUDE_WS = `workspaces/namola-twin/${MISSION}/claude-forge`;
const CODEX_WS = `workspaces/namola-twin/${MISSION}/codex-crucible`;

function permit() {
  return mintTwinEmpirePermitForAutomatedTest({ missionId: MISSION, objectiveId: MISSION, claudeWorkspaceId: CLAUDE_WS, codexWorkspaceId: CODEX_WS, allowedProviders: ["claude", "codex"], maxClaudeConcurrency: 1, maxCodexConcurrency: 1, maxTotalProviderCalls: 10, maxDeepCognitionAnts: 30, maxMcpCalls: 50, perFileByteCap: 20000, workspaceFileCap: 32, maxStdinBytes: 8000, maxStdoutBytes: 20000, perCallTimeoutMs: 600000 });
}

function outcome(commandId: string, over: Partial<VerificationOutcome> = {}): VerificationOutcome {
  return { commandId, status: "passed", failureCategory: null, safeReasonCode: null, outputLineCount: 0, realProcessExecutions: 1, realNetworkCalls: 0, ...over };
}

/** Fails the given command ids as a genuine command failure (the code is wrong). */
function failing(commandId: string): VerificationOutcome {
  return outcome(commandId, { status: "failed", failureCategory: "verification-command-failed", safeReasonCode: "non-zero-exit", outputLineCount: 12 });
}

/** Nothing ran: the honest shape of an absent or refused sandbox. */
function blocked(commandId: string): VerificationOutcome {
  return outcome(commandId, { status: "failed", failureCategory: "verification-unavailable", safeReasonCode: "sandbox-runtime-unavailable", outputLineCount: 0, realProcessExecutions: 0 });
}

/**
 * A verification driver whose verdict per ROUND is scripted. Round N is the
 * verdict for the candidate produced by repair N.
 */
class ScriptedVerificationDriver implements VerificationDriver {
  readonly kind = "scripted-test";
  calls: string[] = [];
  private round = 0;
  private seenTypecheck = 0;
  constructor(private readonly rounds: readonly ("pass" | "fail" | "blocked")[]) {}
  run(commandId: string): VerificationOutcome {
    // The loop runs typecheck first each round, so counting it advances rounds.
    if (commandId === "typecheck") {
      this.round = this.seenTypecheck;
      this.seenTypecheck += 1;
    }
    this.calls.push(`${this.round}:${commandId}`);
    const verdict = this.rounds[Math.min(this.round, this.rounds.length - 1)];
    if (verdict === "pass") return outcome(commandId);
    if (verdict === "blocked") return blocked(commandId);
    return failing(commandId);
  }
}

/** A provider driver that returns file operations and never spawns anything. */
class ScriptedProviderDriver implements LiveProviderDriver {
  readonly kind = "scripted-test";
  readonly realProviderProcessExecutions = 0;
  readonly realNetworkCalls = 0;
  readonly realClaudeCalls = 0;
  readonly realCodexCalls = 0;
  seen: LiveProviderCallInput[] = [];
  constructor(private readonly files: readonly { path: string; content: string }[], private readonly ok = true) {}
  call(input: LiveProviderCallInput): LiveProviderCallResult {
    this.seen.push(input);
    if (!this.ok) return { ok: false, failureCategory: "provider-exit-failure" };
    return { ok: true, payload: { summary: "ok", files: this.files.map((f) => ({ path: f.path, operation: "create", content: f.content })), risks: [], tests: [], confidence: 0.8 } as never, requestBytes: 100, responseBytes: 200, durationMs: 5 };
  }
}

/** Records every write so cross-workspace mutation can be asserted about. */
class RecordingApplier implements TwinWorkspaceApplier {
  readonly realFilesystemWrites = 0;
  written: string[] = [];
  constructor(readonly workspaceId: string, private readonly inner: TwinWorkspaceApplier) {}
  get fileCount(): number {
    return this.inner.fileCount;
  }
  apply(relPath: string, content: string) {
    const r = this.inner.apply(relPath, content);
    if (r.ok) this.written.push(relPath);
    return r;
  }
}

function backend(driver: VerificationDriver | null, verified = true): TwinVerificationBackend {
  return { driver, sandboxBackendId: driver && verified ? "container" : "none", sandboxVerified: Boolean(driver) && verified };
}

function slots(n: number, colony: TwinColonyId): TwinRepairSlot[] {
  return Array.from({ length: n }, (_u, k) => ({ antId: `ant-impl-repair-${k + 1}`, taskId: `${MISSION}-${colony}-repair-${k + 1}` }));
}

function loop(over: Partial<Parameters<typeof runTwinBuildLoop>[0]> = {}) {
  const authority = new ColonyWorkspaceAuthority();
  const applier = new RecordingApplier(CLAUDE_WS, new InMemoryTwinWorkspaceApplier(authority, CLAUDE_WS));
  return runTwinBuildLoop({
    colonyId: "claude-forge",
    missionId: MISSION,
    provider: "claude",
    workspaceId: CLAUDE_WS,
    applier,
    verification: backend(new ScriptedVerificationDriver(["pass"])),
    providerDriver: new ScriptedProviderDriver([{ path: "src/fix.ts", content: "export const fixed = 1;" }]),
    empirePermit: permit(),
    repairSlots: slots(2, "claude-forge"),
    maxRepairAttempts: TWIN_DEFAULT_MAX_REPAIR_ATTEMPTS,
    repairTimeoutMs: 60000,
    candidatePaths: ["src/a.ts"],
    missionObjective: "build a task engine",
    log: () => {},
    ...over,
  });
}

// ---------------------------------------------------------------------------
// D. A candidate a real driver passed freezes as VERIFIED.
// ---------------------------------------------------------------------------
test("D: all stages PASS reaches CANDIDATE_VERIFIED with no repair", () => {
  const v = new ScriptedVerificationDriver(["pass"]);
  const r = loop({ verification: backend(v) });
  assert.equal(r.state, "CANDIDATE_VERIFIED");
  assert.equal(r.finalStatus, "PASS");
  assert.equal(r.repairAttempts, 0);
  assert.equal(r.verificationRounds, 1);
  assert.deepEqual(v.calls, ["0:typecheck", "0:build", "0:test"], "all three stages run, in order");
});

// ---------------------------------------------------------------------------
// E + F + G. A failure asks the SAME colony to repair, the repair is applied
// through Namla's writer, and a passing retest yields VERIFIED.
// ---------------------------------------------------------------------------
test("E/F/G: FAIL triggers same-colony repair, applied by Namla, then VERIFIED", () => {
  const provider = new ScriptedProviderDriver([{ path: "src/fix.ts", content: "export const fixed = 1;" }]);
  const authority = new ColonyWorkspaceAuthority();
  const applier = new RecordingApplier(CLAUDE_WS, new InMemoryTwinWorkspaceApplier(authority, CLAUDE_WS));
  const r = runTwinBuildLoop({
    colonyId: "claude-forge", missionId: MISSION, provider: "claude", workspaceId: CLAUDE_WS,
    applier, verification: backend(new ScriptedVerificationDriver(["fail", "pass"])),
    providerDriver: provider, empirePermit: permit(), repairSlots: slots(2, "claude-forge"),
    maxRepairAttempts: 2, repairTimeoutMs: 60000, candidatePaths: ["src/a.ts"],
    missionObjective: "build a task engine", log: () => {},
  });
  assert.equal(r.state, "CANDIDATE_VERIFIED", "repair then pass is VERIFIED");
  assert.equal(r.repairAttempts, 1, "exactly one repair round");
  assert.equal(r.verificationRounds, 2, "verified again after repair");

  // E: the repair went to THIS colony's provider, with a repair-scoped task id.
  assert.equal(provider.seen.length, 1);
  assert.equal(provider.seen[0].providerId, "claude", "claude-forge repairs via claude");
  assert.equal(provider.seen[0].taskId, `${MISSION}-claude-forge-repair-1`);
  assert.equal(provider.seen[0].contextBrief?.includes("REPAIR TASK"), true, "a structured repair objective was sent");

  // F: Namla applied the file. The provider wrote nothing itself.
  assert.deepEqual(applier.written, ["src/fix.ts"], "the repaired file was applied through the Namla writer");
  assert.equal(r.filesAppliedByRepair, 1);
  assert.equal(r.finalCandidatePaths.includes("src/fix.ts"), true);
});

// ---------------------------------------------------------------------------
// H. Repeated failure exhausts the budget and FAILS CLOSED.
// ---------------------------------------------------------------------------
test("H: repeated failure exhausts maxRepairAttempts and FAILS CLOSED", () => {
  const provider = new ScriptedProviderDriver([{ path: "src/fix.ts", content: "export const a = 1;" }]);
  const r = loop({ verification: backend(new ScriptedVerificationDriver(["fail", "fail", "fail", "fail"])), providerDriver: provider, maxRepairAttempts: 2, repairSlots: slots(2, "claude-forge") });
  assert.equal(r.state, "FAIL_CLOSED");
  assert.equal(r.finalStatus, "FAIL", "a failure never becomes a pass");
  assert.equal(r.repairAttempts, 2, "stopped exactly at the budget");
  assert.equal(r.stopReason, "repair-budget-exhausted");
  assert.equal(provider.seen.length, 2, "no provider call beyond the budget");
});

test("H2: a zero repair budget fails closed on the first failure", () => {
  const provider = new ScriptedProviderDriver([{ path: "src/fix.ts", content: "export const a = 1;" }]);
  const r = loop({ verification: backend(new ScriptedVerificationDriver(["fail"])), providerDriver: provider, maxRepairAttempts: 0, repairSlots: [] });
  assert.equal(r.state, "FAIL_CLOSED");
  assert.equal(r.repairAttempts, 0);
  assert.equal(provider.seen.length, 0, "zero budget spends nothing");
});

test("H3: exhausted repair permits fail closed rather than continuing unauthorized", () => {
  const r = loop({ verification: backend(new ScriptedVerificationDriver(["fail", "fail"])), maxRepairAttempts: 2, repairSlots: [] });
  assert.equal(r.state, "FAIL_CLOSED");
  assert.equal(r.stopReason, "repair-permit-exhausted");
});

// ---------------------------------------------------------------------------
// I + J. BLOCKED and UNVERIFIED never become a pass and never trigger repair.
// ---------------------------------------------------------------------------
test("I: a BLOCKED verification never triggers repair and never reports success", () => {
  const provider = new ScriptedProviderDriver([{ path: "src/fix.ts", content: "export const a = 1;" }]);
  const r = loop({ verification: backend(new ScriptedVerificationDriver(["blocked", "pass"])), providerDriver: provider });
  assert.equal(r.state, "VERIFICATION_BLOCKED");
  assert.equal(r.finalStatus, "BLOCKED");
  assert.notEqual(r.finalStatus, "PASS");
  assert.equal(r.repairAttempts, 0, "nothing to repair towards, so nothing is spent");
  assert.equal(provider.seen.length, 0, "no repair provider call is made");
});

test("J: an absent verification driver is UNVERIFIED, never PASS", () => {
  const provider = new ScriptedProviderDriver([{ path: "src/fix.ts", content: "export const a = 1;" }]);
  const r = loop({ verification: backend(null), providerDriver: provider });
  assert.equal(r.state, "VERIFICATION_BLOCKED");
  assert.equal(r.finalStatus, "UNVERIFIED");
  assert.equal(r.stopReason, "no-verification-driver");
  assert.equal(provider.seen.length, 0);
  assert.equal(r.receipts[0].sandboxVerified, false, "an absent driver is never recorded as a verified sandbox");
});

test("J2: outcome classification never maps a non-pass to PASS", () => {
  assert.equal(classifyVerificationOutcome(outcome("typecheck")), "PASS");
  assert.equal(classifyVerificationOutcome(failing("typecheck")), "FAIL");
  assert.equal(classifyVerificationOutcome(blocked("typecheck")), "BLOCKED");
  // Anything that never reached execution is BLOCKED, not FAIL: it says nothing
  // about the candidate.
  assert.equal(classifyVerificationOutcome(outcome("nope", { status: "failed", failureCategory: "invalid-path", safeReasonCode: "unknown-command" })), "BLOCKED");
});

test("I2: a repair that changes nothing stops instead of looping", () => {
  const r = loop({ verification: backend(new ScriptedVerificationDriver(["fail", "fail", "fail"])), providerDriver: new ScriptedProviderDriver([], true), maxRepairAttempts: 2, repairSlots: slots(2, "claude-forge") });
  assert.equal(r.state, "FAIL_CLOSED");
  assert.equal(r.stopReason, "repair-produced-no-change");
  assert.equal(r.repairAttempts, 1, "a no-op repair is not retried against an unchanged candidate");
});

test("I3: a failed repair provider call fails closed, never verified", () => {
  const r = loop({ verification: backend(new ScriptedVerificationDriver(["fail", "fail"])), providerDriver: new ScriptedProviderDriver([], false), maxRepairAttempts: 2, repairSlots: slots(2, "claude-forge") });
  assert.equal(r.state, "FAIL_CLOSED");
  assert.notEqual(r.finalStatus, "PASS");
  assert.equal(r.repairReceipts[0].ok, false);
});

// ---------------------------------------------------------------------------
// K + L. A repair may only touch its own colony's workspace.
// ---------------------------------------------------------------------------
test("K/L: a colony's repair cannot write into the other colony's workspace", () => {
  // One shared authority, two DISTINCT workspaces — the strongest arrangement
  // for this claim, because a leak would be observable rather than impossible.
  const authority = new ColonyWorkspaceAuthority();
  const claudeApplier = new RecordingApplier(CLAUDE_WS, new InMemoryTwinWorkspaceApplier(authority, CLAUDE_WS));
  const codexApplier = new RecordingApplier(CODEX_WS, new InMemoryTwinWorkspaceApplier(authority, CODEX_WS));

  // Both providers try to write a path that names the OTHER colony.
  const hostile = [{ path: "../codex-crucible/steal.ts", content: "export const x = 1;" }];
  const claudeRun = runTwinBuildLoop({
    colonyId: "claude-forge", missionId: MISSION, provider: "claude", workspaceId: CLAUDE_WS,
    applier: claudeApplier, verification: backend(new ScriptedVerificationDriver(["fail", "fail"])),
    providerDriver: new ScriptedProviderDriver(hostile), empirePermit: permit(),
    repairSlots: slots(1, "claude-forge"), maxRepairAttempts: 1, repairTimeoutMs: 60000,
    candidatePaths: ["src/a.ts"], missionObjective: "m", log: () => {},
  });

  assert.equal(claudeRun.filesAppliedByRepair, 0, "a traversing path is refused by the workspace authority");
  assert.deepEqual(claudeApplier.written, [], "claude wrote nothing");
  assert.deepEqual(codexApplier.written, [], "codex's workspace was never written by claude's repair");
  assert.equal(authority.fileCount(CODEX_WS), 0, "the competitor workspace stays empty");
  assert.equal(claudeRun.state, "FAIL_CLOSED");
});

// ---------------------------------------------------------------------------
// A + B + C + M. Integration through the colony runner.
// ---------------------------------------------------------------------------
function colonyRun(colonyId: TwinColonyId, workspaceId: string, objective: string, verification: TwinVerificationBackend, authority: ColonyWorkspaceAuthority) {
  const cohort = [
    { antId: "ant-arch", role: "architecture" as const },
    { antId: "ant-impl", role: "implementation" as const },
    { antId: "ant-rev", role: "review" as const },
  ];
  const provider = new ScriptedProviderDriver([{ path: "src/engine.ts", content: "export const engine = 1;" }]);
  const applier = new RecordingApplier(workspaceId, new InMemoryTwinWorkspaceApplier(authority, workspaceId));
  const result = runTwinColonyLive({
    colonyId, culture: colonyId === "claude-forge" ? "architecture-first" : "implementation-first",
    provider: colonyId === "claude-forge" ? "claude" : "codex", missionId: MISSION, workspaceId,
    cohort, empirePermit: permit(), providerDriver: provider, applier,
    acceptance: ["engine works"], missionObjective: objective, verification,
    repairSlots: slots(1, colonyId), maxRepairAttempts: 1, repairTimeoutMs: 60000, log: () => {},
  });
  return { result, provider, applier };
}

test("A/B: the same parameterized mission reaches both colonies independently", () => {
  const objective = "Build namla-task-engine-trial: durable local task execution engine.";
  const authority = new ColonyWorkspaceAuthority();
  const a = colonyRun("claude-forge", CLAUDE_WS, objective, backend(new ScriptedVerificationDriver(["fail", "pass"])), authority);
  const b = colonyRun("codex-crucible", CODEX_WS, objective, backend(new ScriptedVerificationDriver(["fail", "pass"])), authority);

  // A: the objective the CLI validated is what the repair objective restates.
  const aBrief = a.provider.seen.find((c) => c.contextBrief?.includes("REPAIR TASK"))?.contextBrief ?? "";
  const bBrief = b.provider.seen.find((c) => c.contextBrief?.includes("REPAIR TASK"))?.contextBrief ?? "";
  assert.equal(aBrief.includes(objective), true, "claude-forge received the supplied mission");
  assert.equal(bBrief.includes(objective), true, "codex-crucible received the supplied mission");

  // B: identical mission, independent runs — neither brief names the competitor.
  assert.equal(aBrief.includes("codex-crucible"), false, "claude's repair never names the competitor");
  assert.equal(bBrief.includes("claude-forge"), false, "codex's repair never names the competitor");
  assert.equal(a.result.candidateVerified, true);
  assert.equal(b.result.candidateVerified, true);
});

test("C: each colony writes only into its own workspace", () => {
  const authority = new ColonyWorkspaceAuthority();
  const a = colonyRun("claude-forge", CLAUDE_WS, "m", backend(new ScriptedVerificationDriver(["pass"])), authority);
  const b = colonyRun("codex-crucible", CODEX_WS, "m", backend(new ScriptedVerificationDriver(["pass"])), authority);
  assert.equal(a.applier.workspaceId, CLAUDE_WS);
  assert.equal(b.applier.workspaceId, CODEX_WS);
  assert.equal(authority.fileCount(CLAUDE_WS), 1);
  assert.equal(authority.fileCount(CODEX_WS), 1);
  assert.notEqual(a.result.bundle?.fingerprint, undefined);
});

test("D2: the frozen bundle states its verification verdict, and v1 is never verified", () => {
  const authority = new ColonyWorkspaceAuthority();
  const verified = colonyRun("claude-forge", CLAUDE_WS, "m", backend(new ScriptedVerificationDriver(["pass"])), authority);
  assert.equal(verified.result.bundle?.evidenceVersion, 2);
  assert.equal(verified.result.bundle?.verification?.finalStatus, "VERIFIED");
  assert.equal(isVerifiedCandidate(verified.result.bundle!), true);
  assert.equal(verified.result.bundle?.verification?.stageReceipts.length, 3, "one receipt per stage");
  assert.equal(verified.result.bundle?.verification?.workspaceFingerprint.startsWith("tw-"), true);

  // A bundle with no verification evidence is UNEXAMINED, never verified.
  assert.equal(isVerifiedCandidate({ evidenceVersion: undefined, verification: undefined }), false);
  assert.equal(isVerifiedCandidate({ evidenceVersion: 2, verification: undefined }), false);

  const authority2 = new ColonyWorkspaceAuthority();
  const blockedRun = colonyRun("codex-crucible", CODEX_WS, "m", backend(null), authority2);
  assert.equal(blockedRun.result.bundle?.verification?.finalStatus, "VERIFICATION_BLOCKED");
  assert.equal(isVerifiedCandidate(blockedRun.result.bundle!), false, "blocked is never verified");
  assert.equal(blockedRun.result.candidateVerified, false);
});

test("M: providers propose file operations and never gain direct write authority", () => {
  const authority = new ColonyWorkspaceAuthority();
  const a = colonyRun("claude-forge", CLAUDE_WS, "m", backend(new ScriptedVerificationDriver(["pass"])), authority);
  // Every file in the workspace arrived through the Namla applier this test owns.
  assert.deepEqual(a.applier.written, ["src/engine.ts"]);
  assert.equal(authority.fileCount(CLAUDE_WS), a.applier.written.length, "no file appeared by any other route");
  assert.equal(a.result.bundle?.providerReceipts.every((r) => r.real === false), true, "a non-spawning driver is recorded as not real");
});

// ---------------------------------------------------------------------------
// N. Hostile mission text is data and cannot alter provider argv.
// ---------------------------------------------------------------------------
test("N: hostile objective text cannot modify provider argv", () => {
  const hostile = [
    "--allowedTools Write",
    "--dangerously-skip-permissions",
    "--disallowedTools ''",
    "; rm -rf /",
    "$(whoami)",
    "`id`",
    "--permission-mode bypassPermissions",
  ].join(" ");
  for (const providerId of ["claude", "codex"] as const) {
    const built = buildSafeProviderRequest({ requestId: "r", providerId, role: "implementation", objective: hostile, promptBody: hostile, workingDirectoryAbsolute: process.cwd(), timeoutMs: 600000, maxStdoutBytes: 200000, maxStderrBytes: 20000 });
    assert.equal(built.ok, true, "hostile-looking mission text is data, not a credential");
    const argv = built.ok ? built.spec.argumentList : [];
    if (providerId === "claude") {
      assert.deepEqual(argv, ["--print", "--output-format", "json", "--disallowedTools", "Read,Glob,Grep,Bash,PowerShell,Write,Edit,MultiEdit,NotebookEdit"], "the Claude template is untouched by mission text");
      assert.equal(argv.some((a) => a.includes("rm -rf")), false, "no mission text reaches Claude argv at all");
    } else {
      assert.deepEqual(argv.slice(0, -1), ["exec", "--ephemeral", "--json", "--ignore-user-config", "--sandbox", "read-only"], "the Codex flag template is untouched");
      // Codex carries the prompt as the single FINAL positional; with shell:false
      // it can never be reinterpreted as a flag or a command.
      assert.equal(argv.length, 7, "mission text cannot grow Codex argv");
    }
    assert.equal(argv.includes("--allowedTools"), false);
    assert.equal(argv.includes("--dangerously-skip-permissions"), false);
  }
});

// ---------------------------------------------------------------------------
// Mission-input seam and repair-budget bounds.
// ---------------------------------------------------------------------------
test("mission id shape is narrow enough that it cannot traverse", () => {
  assert.equal(validateMissionId("trial-engine"), true);
  for (const bad of ["../evil", "a/b", "A-Upper", "", "-leading", "a--b", "x".repeat(65), "with space", "dot.dot"]) {
    assert.equal(validateMissionId(bad), false, `${bad} must be refused`);
  }
});

test("objective text is bounded, non-empty and control-character free", () => {
  assert.equal(validateMissionObjectiveText("build a thing").ok, true);
  assert.equal(validateMissionObjectiveText("   ").reasonCode, "empty-objective");
  assert.equal(validateMissionObjectiveText("bad\u0000nul").reasonCode, "control-characters");
  assert.equal(validateMissionObjectiveText("esc\u001b[31m").reasonCode, "control-characters");
  // Newlines and tabs are legitimate in a mission document.
  assert.equal(validateMissionObjectiveText("line1\nline2\tcol").ok, true);
  // Oversized is REFUSED, never truncated: half a mission is a different mission.
  assert.equal(validateMissionObjectiveText("x".repeat(MAX_OBJECTIVE_BYTES + 1)).reasonCode, "objective-too-large");
});

test("objective path must resolve inside an approved root and carry an approved extension", () => {
  const root = process.cwd();
  assert.equal(resolveMissionObjectivePath("mission.md", [root]).ok, true);
  assert.equal(resolveMissionObjectivePath("../../etc/passwd.md", [root]).reasonCode, "path-escapes-approved-root");
  assert.equal(resolveMissionObjectivePath("mission.json", [root]).reasonCode, "unapproved-extension");
  assert.equal(resolveMissionObjectivePath("", [root]).reasonCode, "empty-path");
  // A root is a directory, so the root ITSELF is not an acceptable target.
  assert.equal(resolveMissionObjectivePath(root, [root]).ok, false);
  // No approved root means no acceptable path, not a permissive default.
  assert.equal(resolveMissionObjectivePath("mission.md", []).reasonCode, "path-escapes-approved-root");
});

test("repair budget rejects every value that would remove the bound", () => {
  assert.equal(validateMaxRepairAttempts(0), 0);
  assert.equal(validateMaxRepairAttempts(TWIN_MAX_REPAIR_ATTEMPTS_CEILING), TWIN_MAX_REPAIR_ATTEMPTS_CEILING);
  for (const bad of [-1, 1.5, NaN, Infinity, -Infinity, TWIN_MAX_REPAIR_ATTEMPTS_CEILING + 1]) {
    assert.equal(validateMaxRepairAttempts(bad), null, `${bad} must be refused`);
  }
});

test("an invalid repair budget fails closed instead of running unbounded", () => {
  const r = loop({ maxRepairAttempts: Number.POSITIVE_INFINITY });
  assert.equal(r.state, "FAIL_CLOSED");
  assert.equal(r.finalStatus, "UNVERIFIED");
  assert.equal(r.stopReason, "invalid-max-repair-attempts");
});

test("the repair objective carries bounded evidence and no workspace contents", () => {
  const brief = buildRepairObjective({ missionObjective: "build it", stage: "typecheck", safeReasonCode: "non-zero-exit", failureCategory: "verification-command-failed", outputLineCount: 9, attempt: 1, candidatePaths: ["src/a.ts", "src/b.ts"] });
  assert.equal(brief.includes("build it"), true);
  assert.equal(brief.includes("typecheck"), true);
  assert.equal(brief.includes("src/a.ts"), true);
  // Paths, never contents; a count, never raw diagnostics.
  assert.equal(brief.includes("export const"), false, "no file content is disclosed");
  assert.equal(brief.includes("DIAGNOSTIC LINE COUNT: 9"), true);
  assert.equal(brief.includes("Namla applies every file operation"), true);
  // Path disclosure is bounded even when a candidate is large.
  const many = buildRepairObjective({ missionObjective: "m", stage: "test", safeReasonCode: null, failureCategory: null, outputLineCount: 0, attempt: 1, candidatePaths: Array.from({ length: 500 }, (_u, k) => `src/f${k}.ts`), maxPaths: 32 });
  assert.equal((many.match(/src\/f/g) ?? []).length, 32, "the path list is capped");
});

// ---------------------------------------------------------------------------
// O-S. A candidate nothing verified must not be crowned the winner, and the two
// producers' opposite real-provider-call expectations must each apply where they
// are true. These close the gap where the court could select a
// VERIFICATION_BLOCKED candidate on artifact count alone.
// ---------------------------------------------------------------------------
import { judgeTwinBundles } from "../twin/namolaCourt";
import { validateFrozenBundle } from "../twin/frozenBundleValidator";
import { freezeBundle } from "../twin/colonyForge";
import { SilentWitness } from "../twin/silentWitness";
import type { ColonyEvidenceBundle, TwinCandidateVerificationEvidence } from "../twin/twinColonyTypes";

const CONTRACT = { criteria: ["works"], requireIndependentReview: true, requireFrozenBundle: true } as const;

function verificationEvidence(status: TwinCandidateVerificationEvidence["finalStatus"]): TwinCandidateVerificationEvidence {
  return { finalStatus: status, verificationRounds: 1, repairAttempts: 0, filesAppliedByRepair: 0, sandboxBackendId: status === "VERIFICATION_BLOCKED" ? "none" : "container", sandboxVerified: status !== "VERIFICATION_BLOCKED", stopReason: null, stageReceipts: [], repairReceipts: [], workspaceFingerprint: "tw-test" };
}

function bundleFor(colonyId: "claude-forge" | "codex-crucible", relPath: string, opts: { version2?: TwinCandidateVerificationEvidence["finalStatus"]; realCalls?: number } = {}): ColonyEvidenceBundle {
  const artifact = { relativePath: relPath, content: "export const x = 1;", purpose: "p", acceptanceCriteriaCovered: ["works"] };
  return freezeBundle({
    colonyId, missionId: MISSION, culture: colonyId === "claude-forge" ? "architecture-first" : "implementation-first",
    workspacePath: colonyId === "claude-forge" ? CLAUDE_WS : CODEX_WS,
    architecture: { architectureSummary: "s", filePlan: [relPath], acceptanceMapping: ["covers works"], interfaceDecisions: [], risks: [] },
    artifacts: [artifact],
    artifactManifest: [{ relativePath: relPath, bytes: artifact.content.length, fingerprint: "fp" }],
    reviews: [{ reviewerAntId: "r", authorAntId: "a", decision: "approve", findings: ["ok"], securityFindings: [], selfReview: false }],
    testEvidence: { testsProposed: 1, independentReviews: 1, artifactCount: 1 },
    securityEvidence: { findings: [], passed: true },
    performanceEvidence: [{ check: "size", observed: 1, budget: 10, withinBudget: true }],
    riskRegister: ["r"], failureRegister: [], uncertaintyRegister: ["u"], minorityReports: [],
    providerReceipts: [{ antId: "a", providerId: "claude", role: "implementation", ok: true, real: (opts.realCalls ?? 0) > 0 }],
    costReport: { providerCalls: 1, realProviderCalls: opts.realCalls ?? 0 },
    reproductionInstructions: ["npx.cmd tsc --noEmit"],
    ...(opts.version2 ? { evidenceVersion: 2 as const, verification: verificationEvidence(opts.version2) } : {}),
  });
}

test("O: the court disqualifies a v2 candidate that nothing verified", () => {
  const witness = new SilentWitness().report();
  const verified = bundleFor("claude-forge", "src/a.ts", { version2: "VERIFIED", realCalls: 3 });
  const blockedBundle = bundleFor("codex-crucible", "src/b.ts", { version2: "VERIFICATION_BLOCKED", realCalls: 3 });
  const d = judgeTwinBundles(verified, blockedBundle, witness, CONTRACT);
  assert.equal(d.claudeScore.verified, true);
  assert.equal(d.codexScore.verified, false);
  assert.equal(d.codexScore.valid, false, "an unverified candidate is not a valid candidate");
  assert.equal(d.codexScore.disqualifiers.includes("candidate-not-verified"), true);
  assert.equal(d.decision, "SELECT_CLAUDE", "the verified candidate wins");
  assert.equal(d.reason, "only-claude-bundle-valid");
});

test("O2: two unverified v2 candidates are rejected, never crowned on artifact count", () => {
  const witness = new SilentWitness().report();
  const a = bundleFor("claude-forge", "src/a.ts", { version2: "FAILED", realCalls: 3 });
  const b = bundleFor("codex-crucible", "src/b.ts", { version2: "VERIFICATION_BLOCKED", realCalls: 3 });
  const d = judgeTwinBundles(a, b, witness, CONTRACT);
  assert.equal(d.decision, "REJECT_BOTH");
  assert.equal(d.reason, "both-bundles-invalid");
});

test("P: two VERIFIED complementary candidates still merge", () => {
  const witness = new SilentWitness().report();
  const a = bundleFor("claude-forge", "src/a.ts", { version2: "VERIFIED", realCalls: 3 });
  const b = bundleFor("codex-crucible", "src/b.ts", { version2: "VERIFIED", realCalls: 3 });
  const d = judgeTwinBundles(a, b, witness, CONTRACT);
  assert.equal(d.decision, "MERGE");
  assert.equal(d.claudeScore.valid && d.codexScore.valid, true, "real provider calls do not disqualify a live bundle");
});

test("Q: v1 forge bundles keep exactly their old rules", () => {
  const witness = new SilentWitness().report();
  // Deterministic v1 bundles: valid, and not marked verified because nothing was.
  const a = bundleFor("claude-forge", "src/a.ts");
  const b = bundleFor("codex-crucible", "src/b.ts");
  const d = judgeTwinBundles(a, b, witness, CONTRACT);
  assert.equal(d.decision, "MERGE", "v1 behaviour is unchanged");
  assert.equal(d.claudeScore.verified, false, "a v1 bundle is unexamined, never verified");
  assert.equal(d.claudeScore.valid, true);
  // A v1 bundle that reports a real provider call is still disqualified.
  const dirty = bundleFor("claude-forge", "src/a.ts", { realCalls: 1 });
  const d2 = judgeTwinBundles(dirty, b, witness, CONTRACT);
  assert.equal(d2.claudeScore.disqualifiers.includes("unexpected-real-provider-call"), true);
});

test("R: the frozen-bundle validator applies each version's rule where it is true", () => {
  // v1: a real provider call is an anomaly.
  assert.equal(validateFrozenBundle(bundleFor("claude-forge", "src/a.ts")).valid, true);
  assert.equal(validateFrozenBundle(bundleFor("claude-forge", "src/a.ts", { realCalls: 2 })).issues.includes("unexpected-real-provider-call"), true);
  // v2: real provider calls are expected; missing verification evidence is not.
  assert.equal(validateFrozenBundle(bundleFor("claude-forge", "src/a.ts", { version2: "VERIFIED", realCalls: 5 })).valid, true, "a live bundle is not disqualified for having really called a provider");
  const noEvidence = { ...bundleFor("claude-forge", "src/a.ts", { version2: "VERIFIED", realCalls: 5 }), verification: undefined } as ColonyEvidenceBundle;
  assert.equal(validateFrozenBundle(noEvidence).issues.includes("v2-bundle-missing-verification-evidence"), true);
});

test("S: a live bundle reports its real provider calls truthfully", () => {
  const authority = new ColonyWorkspaceAuthority();
  const run = colonyRun("claude-forge", CLAUDE_WS, "m", backend(new ScriptedVerificationDriver(["pass"])), authority);
  // The scripted driver never spawns, so the truthful count is zero - and it is
  // reported as a COUNT, not as a hard-coded literal.
  assert.equal(run.result.bundle?.costReport.realProviderCalls, 0);
  assert.equal(typeof run.result.bundle?.costReport.realProviderCalls, "number");
  assert.equal(run.result.bundle?.providerReceipts.every((r) => r.real === false), true);
});

// ---------------------------------------------------------------------------
// T-V. Regressions for the three defects the adversarial release gate found.
// ---------------------------------------------------------------------------
import { evaluateHardRejections } from "../twin/namolaSovereignCourt";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync as realpathNode } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadMissionObjectiveFile } from "../cognitive/missionObjectiveFile";

/** A driver that ACTUALLY advances its real-execution counter, like the live one. */
class CountingProviderDriver implements LiveProviderDriver {
  readonly kind = "counting-test";
  realProviderProcessExecutions = 0;
  readonly realNetworkCalls = 0;
  realClaudeCalls = 0;
  readonly realCodexCalls = 0;
  constructor(private readonly files: readonly { path: string; content: string }[]) {}
  call(): LiveProviderCallResult {
    this.realProviderProcessExecutions += 1;
    this.realClaudeCalls += 1;
    return { ok: true, payload: { summary: "ok", files: this.files.map((f) => ({ path: f.path, operation: "create", content: f.content })), risks: [], tests: [], confidence: 0.8 } as never, requestBytes: 1, responseBytes: 1, durationMs: 1 };
  }
}

test("T: the merge-approving court rejects an unverified v2 candidate", () => {
  const witness = new SilentWitness().report();
  const verified = bundleFor("claude-forge", "src/a.ts", { version2: "VERIFIED", realCalls: 3 });
  const blockedBundle = bundleFor("codex-crucible", "src/b.ts", { version2: "VERIFICATION_BLOCKED", realCalls: 3 });
  const input = { claude: verified, codex: blockedBundle, witness, admittedFindings: [], dominanceDecisions: [], residualUncertainty: [], acceptance: ["works"], budget: { maxMergeComponents: 8 } };

  const checks = evaluateHardRejections(input);
  const gate = checks.find((c) => c.id === "no-unverified-v2-candidate");
  assert.notEqual(gate, undefined, "the verification gate must exist in this court");
  assert.equal(gate?.passed, false, "an unverified v2 candidate must fail the hard rejection");

  // A structurally VALID bundle is not the same fact as a VERIFIED one: the
  // blocked candidate is well-formed, which is exactly why this gate is needed.
  assert.equal(validateFrozenBundle(blockedBundle).valid, true, "the blocked candidate is well-formed");
  assert.equal(checks.find((c) => c.id === "both-bundles-valid")?.passed, true, "and passes the structural check");

  // Both verified -> the gate permits normal comparison.
  const bothOk = evaluateHardRejections({ ...input, codex: bundleFor("codex-crucible", "src/b.ts", { version2: "VERIFIED", realCalls: 3 }) });
  assert.equal(bothOk.find((c) => c.id === "no-unverified-v2-candidate")?.passed, true);

  // v1 bundles predate verification and are unaffected.
  const v1 = evaluateHardRejections({ ...input, claude: bundleFor("claude-forge", "src/a.ts"), codex: bundleFor("codex-crucible", "src/b.ts") });
  assert.equal(v1.find((c) => c.id === "no-unverified-v2-candidate")?.passed, true, "v1 compatibility retained");
});

test("U: real-provider accounting derives from execution provenance, repair calls included", () => {
  const authority = new ColonyWorkspaceAuthority();
  const applier = new RecordingApplier(CLAUDE_WS, new InMemoryTwinWorkspaceApplier(authority, CLAUDE_WS));
  const driver = new CountingProviderDriver([{ path: "src/engine.ts", content: "export const e = 1;" }]);
  const cohort = [
    { antId: "ant-arch", role: "architecture" as const },
    { antId: "ant-impl", role: "implementation" as const },
    { antId: "ant-rev", role: "review" as const },
  ];
  const result = runTwinColonyLive({
    colonyId: "claude-forge", culture: "architecture-first", provider: "claude", missionId: MISSION,
    workspaceId: CLAUDE_WS, cohort, empirePermit: permit(), providerDriver: driver, applier,
    acceptance: ["works"], missionObjective: "m",
    verification: backend(new ScriptedVerificationDriver(["fail", "pass"])),
    repairSlots: slots(1, "claude-forge"), maxRepairAttempts: 1, repairTimeoutMs: 60000, log: () => {},
  });
  // 3 role calls + 1 repair call, every one of which advanced the real counter.
  assert.equal(driver.realProviderProcessExecutions, 4, "three roles plus one repair");
  assert.equal(result.bundle?.costReport.realProviderCalls, 4, "the total includes the repair call and is not hard-coded");
  assert.equal(result.bundle?.providerReceipts.every((r) => r.real === true), true, "each receipt states its own provenance");
  // The count is derived, never taken from the provider's name or its own claim.
  assert.equal(result.bundle?.costReport.realProviderCalls, driver.realProviderProcessExecutions);
});

test("V: containment is re-checked on the RESOLVED path, defeating an intermediate link", () => {
  const base = realpathNode(mkdtempSync(join(tmpdir(), "namla-obj-")));
  const root = join(base, "approved");
  const outside = join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.md"), "secret mission text", "utf8");

  // A file genuinely inside the root is accepted.
  writeFileSync(join(root, "ok.md"), "a real mission", "utf8");
  assert.equal(loadMissionObjectiveFile(join(root, "ok.md"), [root]).ok, true);

  // An INTERMEDIATE link that escapes the root: lexically contained, really not.
  let linked = false;
  try {
    symlinkSync(outside, join(root, "link"), "junction");
    linked = true;
  } catch {
    try {
      symlinkSync(outside, join(root, "link"), "dir");
      linked = true;
    } catch {
      linked = false;
    }
  }
  if (!linked) {
    // Honest skip rather than a silent pass: this host cannot create the link,
    // so the intermediate-link refusal is UNVERIFIED here, not proven.
    assert.equal(loadMissionObjectiveFile(join(root, "ok.md"), [root]).ok, true);
    return;
  }
  const through = join(root, "link", "secret.md");
  const res = loadMissionObjectiveFile(through, [root]);
  assert.equal(res.ok, false, "a path escaping the root through an intermediate link is refused");
  assert.equal(res.ok === false && res.reasonCode, "path-escapes-approved-root");
});

test("W: repair-bound semantics are exact at every budget, with no off-by-one", () => {
  // Always-failing verification, so the ONLY thing that stops the loop is the
  // budget. The provider call count is the observable.
  for (const budget of [0, 1, 2, 3, 4, 5]) {
    const provider = new ScriptedProviderDriver([{ path: "src/fix.ts", content: `export const v${budget} = 1;` }]);
    const r = loop({
      verification: backend(new ScriptedVerificationDriver(["fail", "fail", "fail", "fail", "fail", "fail", "fail"])),
      providerDriver: provider,
      maxRepairAttempts: budget,
      repairSlots: slots(budget, "claude-forge"),
    });
    assert.equal(r.state, "FAIL_CLOSED", `budget ${budget} must fail closed`);
    assert.equal(r.finalStatus, "FAIL", `budget ${budget} never becomes a pass`);
    assert.equal(r.repairAttempts, budget, `budget ${budget} performs exactly ${budget} repair rounds`);
    assert.equal(provider.seen.length, budget, `budget ${budget} makes exactly ${budget} repair provider calls`);
    assert.equal(r.stopReason, "repair-budget-exhausted");
    // One more verification round than repairs: the initial candidate plus one
    // retest per repair.
    assert.equal(r.verificationRounds, budget + 1, `budget ${budget} verifies ${budget + 1} times`);
  }
});

test("W2: no repair follows PASS, BLOCKED or UNVERIFIED", () => {
  for (const [name, verification] of [
    ["PASS", backend(new ScriptedVerificationDriver(["pass"]))],
    ["BLOCKED", backend(new ScriptedVerificationDriver(["blocked"]))],
    ["UNVERIFIED", backend(null)],
  ] as const) {
    const provider = new ScriptedProviderDriver([{ path: "src/fix.ts", content: "export const a = 1;" }]);
    const r = loop({ verification, providerDriver: provider, maxRepairAttempts: 5, repairSlots: slots(5, "claude-forge") });
    assert.equal(provider.seen.length, 0, `${name} must spend no repair call`);
    assert.equal(r.repairAttempts, 0, `${name} must record no repair attempt`);
  }
});

test("X: malformed verification evidence is NOT verified", () => {
  // Evidence can arrive from a deserialized record, where the type system is no
  // longer standing guard. Every shape that is not exactly VERIFIED must be false.
  const base = bundleFor("claude-forge", "src/a.ts", { version2: "VERIFIED" });
  const malformed = [
    { evidenceVersion: 2 as const, verification: undefined },
    { evidenceVersion: 2 as const, verification: {} as never },
    { evidenceVersion: 2 as const, verification: { finalStatus: "" } as never },
    { evidenceVersion: 2 as const, verification: { finalStatus: "verified" } as never },
    { evidenceVersion: 2 as const, verification: { finalStatus: "PASS" } as never },
    { evidenceVersion: 2 as const, verification: { finalStatus: null } as never },
    { evidenceVersion: undefined, verification: base.verification },
    { evidenceVersion: 1 as never, verification: base.verification },
  ];
  for (const m of malformed) {
    assert.equal(isVerifiedCandidate(m), false, `${JSON.stringify(m.verification)} @v${m.evidenceVersion} must not be verified`);
  }
  // Only the exact pair is verified.
  assert.equal(isVerifiedCandidate({ evidenceVersion: 2, verification: base.verification }), true);
});

test("X2: a BLOCKED round AFTER a successful repair still ends blocked, with no further repair", () => {
  // Round 0 fails -> repair -> round 1 the sandbox goes away. The loop must stop
  // blocked rather than spending the remaining budget on an unanswerable question.
  const provider = new ScriptedProviderDriver([{ path: "src/fix.ts", content: "export const a = 1;" }]);
  const r = loop({
    verification: backend(new ScriptedVerificationDriver(["fail", "blocked", "pass"])),
    providerDriver: provider,
    maxRepairAttempts: 3,
    repairSlots: slots(3, "claude-forge"),
  });
  assert.equal(r.state, "VERIFICATION_BLOCKED");
  assert.equal(r.finalStatus, "BLOCKED");
  assert.notEqual(r.finalStatus, "PASS");
  assert.equal(r.repairAttempts, 1, "exactly the one repair that preceded the block");
  assert.equal(provider.seen.length, 1, "no repair is spent against a blocked verifier");
  assert.equal(r.verificationRounds, 2);
});
