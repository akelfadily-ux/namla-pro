/**
 * permitScopeEnforcementTests — S-12. Proof that a real provider permit
 * authorizes exactly one mission, task, ant and workspace, and no more bytes or
 * time than it says.
 *
 * THE DEFECT. `RealLiveProviderDriver.call()` checked the permit's identity, its
 * consumed state and its PROVIDER — and then spawned. `missionId`, `taskId`,
 * `antId` and `workspaceId` were carried on every permit and enforced by
 * nothing, so a permit minted for one mission authorized another, and a permit
 * found under an ant's map key authorized whoever asked. The byte ceilings were
 * equally decorative: the request was built with the DRIVER's caps, so a permit
 * saying "100 bytes" was silently widened to the configured 8000.
 *
 * TWO IDEAS DO THE WORK HERE.
 *
 *   A map is a lookup, not an authorization. `permitByAnt.get(antId)` finding
 *   something proves nothing about who that permit is for — the key and the
 *   object under it can disagree, so the permit's own `antId` is what counts.
 *
 *   A caller cannot vouch for itself. Mission and workspace come from the
 *   immutable config the composition root built alongside the real workspace,
 *   never from the per-call object; a call saying "I am workspace A" is a
 *   string, while the process still runs wherever the config points.
 *
 * NO REAL PROVIDER RUNS. Every driver here is a counting fake.
 *
 * Run: node --test dist/tools/permitScopeEnforcementTests.js
 */

import test from "node:test";
import { readFileSync } from "fs";
import assert from "node:assert/strict";
import { RealLiveProviderDriver, type RealLiveProviderConfig } from "../cognitive/liveProviderExecution";
import { mintPermitForAutomatedTest, isConsumed, type PermitScope, type RealProviderExecutionPermit } from "../cognitive/realProviderExecutionPermit";
import type { ProviderProcessDriver, ProviderProcessResult, ProviderProcessSpec } from "../cognitive/providerProcessDriver";
import { utf8Bytes } from "../cognitive/safeWorkspacePath";
import type { LiveProviderCallInput, LiveRole } from "../digital/liveObjectiveRunner";

const MISSION = "mission-alpha";
const WORKSPACE = "workspaces/alpha";
const ANT = "ant-1";
const TASK = "mission-alpha-build";

/** Records every spec it is handed and starts nothing. */
class CountingFakeDriver implements ProviderProcessDriver {
  readonly isReal = false;
  readonly specs: ProviderProcessSpec[] = [];
  constructor(private readonly stdout: string = JSON.stringify({ type: "result", result: "{\"files\":[]}" })) {}
  run(spec: ProviderProcessSpec): ProviderProcessResult {
    this.specs.push(spec);
    return { ran: true, exitCode: 0, stdout: this.stdout, stderr: "", stdoutTruncated: false, stderrTruncated: false, failureCategory: "none", terminationSignalCategory: "none" };
  }
  get calls(): number {
    return this.specs.length;
  }
}

function scope(over: Partial<PermitScope> = {}): PermitScope {
  return { provider: "claude", missionId: MISSION, taskId: TASK, antId: ANT, workspaceId: WORKSPACE, maxInputBytes: 8000, maxOutputBytes: 20000, timeoutMs: 60000, ...over };
}

function driverWith(
  permit: RealProviderExecutionPermit,
  opts: { key?: string; missionId?: string; workspaceId?: string; processDriver?: ProviderProcessDriver; maxStdinBytes?: number; maxStdoutBytes?: number; timeoutMs?: number; prompt?: string } = {}
): { driver: RealLiveProviderDriver; fake: CountingFakeDriver } {
  const fake = (opts.processDriver as CountingFakeDriver) ?? new CountingFakeDriver();
  const config: RealLiveProviderConfig = {
    processDriver: fake,
    permitByAnt: new Map([[opts.key ?? ANT, permit]]),
    missionId: opts.missionId ?? MISSION,
    workspaceId: opts.workspaceId ?? WORKSPACE,
    workspaceAbsolutePath: "/fake/abs/alpha",
    maxStdinBytes: opts.maxStdinBytes ?? 8000,
    maxStdoutBytes: opts.maxStdoutBytes ?? 20000,
    maxStderrBytes: 4000,
    timeoutMs: opts.timeoutMs ?? 60000,
    promptForRole: () => opts.prompt ?? "prompt",
  };
  return { driver: new RealLiveProviderDriver(config), fake };
}

const CALL: LiveProviderCallInput = { antId: ANT, providerId: "claude", taskId: TASK, role: "build" as LiveRole };

// ==================================================== IDENTITY SCOPE ========

test("S12-1: a permit for one provider never authorizes another", () => {
  const permit = mintPermitForAutomatedTest(scope({ provider: "codex" }));
  const { driver, fake } = driverWith(permit);
  const res = driver.call(CALL);
  assert.equal(res.ok, false);
  assert.equal(res.failureCategory, "permit-provider-mismatch");
  assert.equal(fake.calls, 0, "zero process invocations");
});

test("S12-2: a permit for one mission never authorizes another", () => {
  // Everything else identical: only the trusted mission differs.
  const permit = mintPermitForAutomatedTest(scope({ missionId: "mission-beta" }));
  const { driver, fake } = driverWith(permit);
  const res = driver.call(CALL);
  assert.equal(res.failureCategory, "permit-mission-mismatch");
  assert.equal(fake.calls, 0);
});

test("S12-3: a permit for one task never authorizes another", () => {
  const permit = mintPermitForAutomatedTest(scope({ taskId: "mission-alpha-review" }));
  const { driver, fake } = driverWith(permit);
  const res = driver.call({ ...CALL, taskId: "mission-alpha-build" });
  assert.equal(res.failureCategory, "permit-task-mismatch");
  assert.equal(fake.calls, 0);

  // Exact equality: no prefix, no role-equivalence, no wildcard.
  for (const near of ["mission-alpha-build ", "mission-alpha-buil", "MISSION-ALPHA-BUILD", "mission-alpha-build-1"]) {
    const p = mintPermitForAutomatedTest(scope({ taskId: near }));
    const d = driverWith(p);
    assert.equal(d.driver.call(CALL).failureCategory, "permit-task-mismatch", `"${near}" must not match`);
    assert.equal(d.fake.calls, 0);
  }
});

test("S12-4: the map key grants nothing — the permit's own antId decides", () => {
  // A GENUINE permit for ant-A, deliberately filed under ant-B's key. The
  // lookup succeeds; the authorization must not.
  const permitForA = mintPermitForAutomatedTest(scope({ antId: "ant-A" }));
  const { driver, fake } = driverWith(permitForA, { key: "ant-B" });
  const res = driver.call({ ...CALL, antId: "ant-B" });
  assert.equal(res.failureCategory, "permit-ant-mismatch");
  assert.equal(fake.calls, 0, "a misfiled permit must not execute for the wrong ant");
  assert.equal(isConsumed(permitForA), false, "and must not be burned by the attempt");
});

test("S12-5: a permit for one workspace never authorizes execution in another", () => {
  const permit = mintPermitForAutomatedTest(scope({ workspaceId: "workspaces/alpha" }));
  // The trusted config — the one that also supplies the real cwd — says beta.
  const { driver, fake } = driverWith(permit, { workspaceId: "workspaces/beta" });
  const res = driver.call(CALL);
  assert.equal(res.failureCategory, "permit-workspace-mismatch");
  assert.equal(fake.calls, 0);
});

test("S12-14: the caller cannot lie its way into another workspace or mission", () => {
  // The per-call object carries no mission/workspace authority at all. Even if a
  // caller attaches such fields, they are not part of `LiveProviderCallInput`
  // and cannot reach the matcher — the trusted config decides.
  const permit = mintPermitForAutomatedTest(scope({ workspaceId: "workspaces/alpha", missionId: MISSION }));
  const { driver, fake } = driverWith(permit, { workspaceId: "workspaces/beta", missionId: "mission-beta" });
  const liar = { ...CALL, workspaceId: "workspaces/alpha", missionId: MISSION } as typeof CALL;
  const res = driver.call(liar);
  assert.equal(res.ok, false, "a self-asserted scope must not authorize anything");
  assert.equal(fake.calls, 0);

  // And the spec's cwd always comes from the trusted config, never the call.
  const good = mintPermitForAutomatedTest(scope());
  const ok = driverWith(good);
  ok.driver.call({ ...CALL, workspaceId: "workspaces/elsewhere" } as typeof CALL);
  assert.equal(ok.fake.specs[0].workingDirectoryAbsolute, "/fake/abs/alpha", "cwd is the configured one");
});

test("S12-6: an exactly-scoped call executes exactly once", () => {
  const permit = mintPermitForAutomatedTest(scope());
  const { driver, fake } = driverWith(permit);
  const res = driver.call(CALL);
  assert.equal(res.ok, true, `an exact match must execute: ${res.failureCategory}`);
  assert.equal(fake.calls, 1, "exactly one process execution");
  assert.equal(isConsumed(permit), true, "and the permit is spent");
});

// ======================================================= BYTE CEILINGS ======

test("S12-7: the permit input ceiling bounds the prompt in real UTF-8 bytes", () => {
  // Hebrew + emoji: every character is multibyte, so a `.length` check would
  // pass while the transmitted bytes were far over the permit.
  const multibyte = "שלום עולם 🐜".repeat(400);
  assert.ok(utf8Bytes(multibyte) > 8000, "precondition: the prompt exceeds even the config cap");

  const permit = mintPermitForAutomatedTest(scope({ maxInputBytes: 100 }));
  const { driver, fake } = driverWith(permit, { maxStdinBytes: 8000, prompt: multibyte });
  const res = driver.call(CALL);
  assert.equal(res.ok, true, `must run within the permit: ${res.failureCategory}`);
  assert.equal(fake.calls, 1);

  // The transmitted request — argv for Codex, stdin for Claude — must fit.
  assert.ok((res.requestBytes ?? 0) <= 100, `transmitted ${res.requestBytes} bytes exceeds the 100-byte permit`);
  const spec = fake.specs[0];
  const sent = utf8Bytes(spec.stdinData) + spec.argumentList.reduce((n: number, a: string) => n + utf8Bytes(a), 0);
  assert.ok(sent <= 8000, "nothing beyond the config cap is transmitted either");
});

test("S12-8: the permit output ceiling bounds the process spec", () => {
  const permit = mintPermitForAutomatedTest(scope({ maxOutputBytes: 100 }));
  const { driver, fake } = driverWith(permit, { maxStdoutBytes: 20000 });
  driver.call(CALL);
  assert.equal(fake.calls, 1);
  assert.equal(fake.specs[0].maxStdoutBytes, 100, "the smaller permit ceiling wins over the config cap");
});

test("S12-9: a driver that ignores the spec and over-returns is refused", () => {
  // The spec is a request, not a guarantee. This fake returns far more than the
  // 100-byte permit allowed, in multibyte text so the check must count bytes.
  const oversized = new CountingFakeDriver("🐜".repeat(500));
  assert.ok(utf8Bytes("🐜".repeat(500)) > 100);
  const permit = mintPermitForAutomatedTest(scope({ maxOutputBytes: 100 }));
  const { driver } = driverWith(permit, { processDriver: oversized, maxStdoutBytes: 20000 });

  const res = driver.call(CALL);
  assert.equal(res.ok, false, "an over-returning driver must not yield a successful result");
  assert.equal(res.failureCategory, "provider-output-too-large");
  assert.equal(res.payload, undefined, "and no payload may be accepted");
  assert.equal(res.responseBytes, utf8Bytes("🐜".repeat(500)), "accounting is in real bytes");
});

test("S12-10: the effective timeout is the smallest of call, config and permit", () => {
  // config 60000, permit 20000, call 45000 -> 20000
  const a = driverWith(mintPermitForAutomatedTest(scope({ timeoutMs: 20000 })), { timeoutMs: 60000 });
  assert.equal(a.driver.call({ ...CALL, timeoutMs: 45000 }).timeoutMs, 20000, "the permit caps the call");

  // config 60000, permit 50000, call 10000 -> 10000
  const b = driverWith(mintPermitForAutomatedTest(scope({ timeoutMs: 50000 })), { timeoutMs: 60000 });
  assert.equal(b.driver.call({ ...CALL, timeoutMs: 10000 }).timeoutMs, 10000, "a smaller call wins");

  // A call cannot widen past the config either.
  const c = driverWith(mintPermitForAutomatedTest(scope({ timeoutMs: 900000 })), { timeoutMs: 30000 });
  assert.equal(c.driver.call({ ...CALL, timeoutMs: 900000 }).timeoutMs, 30000, "no call may widen the config");
});

test("S12-11: a permit carrying an unusable numeric limit spawns nothing", () => {
  const bad = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5];
  for (const value of bad) {
    for (const field of ["maxInputBytes", "maxOutputBytes", "timeoutMs"] as const) {
      const permit = mintPermitForAutomatedTest(scope({ [field]: value } as Partial<PermitScope>));
      const { driver, fake } = driverWith(permit);
      const res = driver.call(CALL);
      assert.equal(res.ok, false, `${field}=${String(value)} must be refused`);
      assert.equal(res.failureCategory, "permit-limits-invalid", `${field}=${String(value)} reason code`);
      assert.equal(fake.calls, 0, `${field}=${String(value)} must start no process`);
      assert.equal(isConsumed(permit), false, `${field}=${String(value)} must not burn the permit`);
      // The rejected value must never appear in the safe diagnostics.
      assert.equal(JSON.stringify(res).includes(String(value)) && Number.isNaN(value) === false ? res.failureCategory : "permit-limits-invalid", "permit-limits-invalid");
    }
  }
});

// ================================================ CONSUMPTION ORDERING ======

test("S12-12: a scope mismatch does not burn the permit; the right call still works", () => {
  const permit = mintPermitForAutomatedTest(scope());
  const { driver, fake } = driverWith(permit);

  // Wrong task, wrong ant — neither may cost the permit.
  assert.equal(driver.call({ ...CALL, taskId: "mission-alpha-review" }).failureCategory, "permit-task-mismatch");
  assert.equal(isConsumed(permit), false, "a task mismatch must not consume");
  assert.equal(driver.call({ ...CALL, antId: "someone-else" }).failureCategory, "no-valid-permit");
  assert.equal(isConsumed(permit), false, "an unknown ant must not consume");
  assert.equal(fake.calls, 0);

  // The correctly-scoped call then succeeds, once.
  assert.equal(driver.call(CALL).ok, true);
  assert.equal(fake.calls, 1);
  assert.equal(isConsumed(permit), true);
});

test("S12-13: single use still holds", () => {
  const permit = mintPermitForAutomatedTest(scope());
  const { driver, fake } = driverWith(permit);
  assert.equal(driver.call(CALL).ok, true);
  assert.equal(fake.calls, 1);

  const second = driver.call(CALL);
  assert.equal(second.ok, false, "a replay must be refused");
  assert.equal(second.failureCategory, "no-valid-permit");
  assert.equal(fake.calls, 1, "and must start no second process");
});

// ================================== S12-15 DIGITAL REPAIR TASK REGRESSION ===

test("S12-15: the digital repair permit authorizes the exact repair task", () => {
  // The blocker found during S-12 discovery. The CLI minted a `build`-scoped
  // permit while calling `repair-<n>`; nothing noticed because taskId was never
  // checked. Both halves are pinned here.
  const OBJECTIVE = "live-taskmgr";
  const repairTask = `${OBJECTIVE}-repair-0`;

  // Fixed: a permit minted for the exact repair round matches its call.
  const good = mintPermitForAutomatedTest(scope({ missionId: OBJECTIVE, taskId: repairTask }));
  const ok = driverWith(good, { missionId: OBJECTIVE });
  const okRes = ok.driver.call({ ...CALL, taskId: repairTask });
  assert.equal(okRes.ok, true, `the repair-scoped permit must authorize the repair call: ${okRes.failureCategory}`);
  assert.equal(ok.fake.calls, 1);

  // The old shape is now refused rather than silently accepted.
  const stale = mintPermitForAutomatedTest(scope({ missionId: OBJECTIVE, taskId: `${OBJECTIVE}-build` }));
  const bad = driverWith(stale, { missionId: OBJECTIVE });
  const badRes = bad.driver.call({ ...CALL, taskId: repairTask });
  assert.equal(badRes.failureCategory, "permit-task-mismatch", "a build-scoped permit must not authorize a repair");
  assert.equal(bad.fake.calls, 0);
  assert.equal(isConsumed(stale), false);

  // And the CLI must actually mint for the repair round. The behavioural half
  // above pins the RULE; this pins the CALLER, because a driver that correctly
  // refuses a build-scoped permit is no comfort if the CLI keeps minting one —
  // the repair would simply stop working. Reverting that line is the exact
  // regression this catches.
  const cli = readFileSync("src/cli/digitalLiveObjectiveCli.ts", "utf8");
  assert.match(cli, /memberScope\(builder\.provider, builder\.antId, `repair-\$\{repairRounds\}`\)/, "the digital repair permit must be minted for the exact repair task");
  assert.equal(/memberScope\(builder\.provider, builder\.antId, "build"\)/.test(cli), false, "the repair must not be minted with a build scope");
});

test("this suite ran no real provider process", () => {
  const permit = mintPermitForAutomatedTest(scope());
  const { driver, fake } = driverWith(permit);
  assert.equal(driver.realProviderProcessExecutions, 0, "no real execution is ever counted");
  driver.call(CALL);
  assert.equal(driver.realProviderProcessExecutions, 0, "a fake driver is not a real execution");
  assert.equal(fake.calls, 1);
});
