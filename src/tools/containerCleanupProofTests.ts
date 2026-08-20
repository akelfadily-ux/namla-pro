/**
 * containerCleanupProofTests — S-16. Proof that "the container is gone" is only
 * ever claimed from a query that ACTUALLY SUCCEEDED and affirmatively showed the
 * exact target absent.
 *
 * THE ORIGINAL DEFECT. Both cleanup paths decided removal with:
 *
 *     return check.status !== 0;
 *
 * `spawnSync`'s `status` is tri-state, and `null` — no exit code at all — means
 * the process never completed: the binary was missing (ENOENT), the call timed
 * out (ETIMEDOUT), the output overran `maxBuffer` (ENOBUFS), or a signal killed
 * it. `null !== 0` is `true`, so every "we could not look" outcome was read as
 * "we looked and it was gone".
 *
 * WHY EXCLUDING THOSE WAS STILL NOT ENOUGH. That left the rule "a COMPLETED,
 * error-free, non-zero exit proves absence", which is also false. Docker's CLI
 * collects any error from the object lookup and returns
 * `StatusError{StatusCode: 1}`, so
 *
 *     inspect <no such container>       -> exit 1
 *     inspect <daemon unreachable>      -> exit 1
 *     inspect <API / permission error>  -> exit 1
 *
 * are indistinguishable by exit code. A non-zero status proves "the query
 * failed", never "the container does not exist". The predicate read exactly the
 * pair `(error, status)`, so two different realities produced the identical
 * input and the identical verdict — a structural collision, not a matter of
 * enumerating more exit codes.
 *
 * WHY THERE IS NO NAME FILTER. An earlier draft bounded the listing with
 * `--filter name=<target>`. That put Docker's matching language inside the
 * proof: the filter is documented as matching all or PART of a name, and Moby
 * evaluates the value as a REGULAR EXPRESSION after an exact-match fast path.
 * The proof would then depend on those semantics before our own comparison ran.
 * It is gone. The listing is unfiltered and identity is decided by exact string
 * comparison alone.
 *
 * THE RULE. Absence is proven only by an AFFIRMATIVE, SUCCESSFUL enumeration:
 * the query ran, exited 0, returned structurally valid machine-parseable
 * output, and that output contains no exact match for the target. Anything else
 * — spawn failure, timeout, signal, buffer overrun, non-zero status, malformed
 * or partial output — is UNKNOWN, and UNKNOWN IS NOT REMOVED. On a host with
 * enough containers to overrun the finite `maxBuffer`, availability fails
 * closed; security never fails open.
 *
 * Error text is deliberately never consulted. "No such object" is a
 * human-readable message, not a security protocol: localizable, version
 * dependent, and influencable through a container name.
 *
 * THESE TESTS EXECUTE THE DECISION. Every case drives the real predicate, and
 * several drive it from REAL child processes so the fixtures cannot drift from
 * what Node actually returns. No container runtime is required and none is
 * started; this host has neither docker nor podman.
 *
 * Run: node --test dist/tools/containerCleanupProofTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { containerAbsenceProven, containerEnumerationArgs, PROBE_KILL_SIGNAL, type ContainerEnumerationOutcome } from "../cognitive/containerSandboxBackend";

const BACKEND_SRC = readFileSync("src/cognitive/containerSandboxBackend.ts", "utf8");
const BISECTION_SRC = readFileSync("src/cognitive/dockerStageBisection.ts", "utf8");

const TARGET = "namla-run-4242-0";

/** A `spawnSync`-shaped enumeration result. Defaults to the "never ran" shape. */
function enumeration(over: Partial<ContainerEnumerationOutcome> = {}): ContainerEnumerationOutcome {
  return { status: null, error: undefined, signal: null, stdout: "", ...over };
}

/** A SUCCESSFUL enumeration that listed exactly these container names. */
function listed(names: readonly string[]): ContainerEnumerationOutcome {
  return { status: 0, error: undefined, signal: null, stdout: names.map((n) => JSON.stringify(n)).join("\n") };
}

function errno(code: string): NodeJS.ErrnoException {
  const e = new Error(code) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

/** Bounded helper child. Never a shell, always reaped by spawnSync. */
function runNode(script: string, opts: { timeout?: number; maxBuffer?: number } = {}) {
  return spawnSync(process.execPath, ["-e", script], { shell: false, encoding: "utf8", timeout: opts.timeout ?? 30000, killSignal: "SIGKILL", maxBuffer: opts.maxBuffer ?? 65536, windowsHide: true });
}

/** The source text of one method or function body, for wiring assertions. */
function bodyOf(src: string, signature: string, indent: string): string {
  const start = src.indexOf(signature);
  assert.notEqual(start, -1, `not found: ${signature}`);
  const rest = src.slice(start);
  const end = rest.indexOf(`\n${indent}}`);
  assert.notEqual(end, -1, `end not found: ${signature}`);
  return rest.slice(0, end);
}

// ============ THE PROOF: SUCCESSFUL ENUMERATION + EXACT IDENTITY ONLY =======

test("S16-C1: a successful enumeration containing the exact target => NOT removed", () => {
  assert.equal(containerAbsenceProven(TARGET, listed([TARGET])), false, "the target was enumerated: it exists");
  const real = runNode(`process.stdout.write(JSON.stringify(${JSON.stringify(TARGET)}));process.exit(0)`);
  assert.equal(real.status, 0);
  assert.equal(containerAbsenceProven(TARGET, real), false, "and the same holds for a REAL successful listing");
});

test("S16-C2: a successful EMPTY enumeration => removed", () => {
  assert.equal(containerAbsenceProven(TARGET, listed([])), true);
  assert.equal(containerAbsenceProven(TARGET, enumeration({ status: 0, stdout: "   \n  \n" })), true, "blank lines are still an empty listing");
  const real = runNode("process.exit(0)");
  assert.equal(real.status, 0);
  assert.equal(containerAbsenceProven(TARGET, real), true, "a REAL successful empty listing proves absence");
});

test("S16-C3: a successful enumeration of only NEAR-MISS names => removed", () => {
  // Comparison is EXACT, which is what makes dropping `--filter name=` safe:
  // that filter matched PART of a name and was evaluated as a regex, so
  // near-misses arrived through it anyway. Identity is the only thing consulted.
  assert.equal(containerAbsenceProven(TARGET, listed([`${TARGET}-extra`])), true, "a longer name is a different container");
  assert.equal(containerAbsenceProven(TARGET, listed([TARGET.slice(0, -1)])), true, "a prefix is a different container");
  assert.equal(containerAbsenceProven(TARGET, listed([`x${TARGET}`])), true, "a suffix match is a different container");
  assert.equal(containerAbsenceProven(TARGET, listed(["unrelated", "namla-run-4242-1", "namla-verify-4242-0"])), true, "sibling NAMLA containers are not the target");
});

test("S16-C4: a successful enumeration containing the target AMONG MANY => NOT removed", () => {
  assert.equal(containerAbsenceProven(TARGET, listed(["a", "b", TARGET, "c"])), false);
  assert.equal(containerAbsenceProven(TARGET, listed([`${TARGET}-extra`, TARGET])), false, "a near-miss before it does not hide it");
  // Docker reports several names for one container as a comma-joined field, so
  // each alias is compared, never the joined string as a whole.
  assert.equal(containerAbsenceProven(TARGET, listed([`alias,${TARGET}`])), false, "a comma-joined alias list is split");
  assert.equal(containerAbsenceProven(TARGET, listed([`${TARGET} , other`])), false, "surrounding whitespace is trimmed");
});

test("S16-C5: a completed NON-ZERO status => NOT removed", () => {
  // THE CASE BOTH EARLIER REPAIRS MISSED. Docker returns a non-zero status for
  // "no such object" AND for an unreachable daemon or an API error, so the code
  // carries no information about existence at all.
  for (const status of [1, 2, 125, 126, 127]) {
    assert.equal(containerAbsenceProven(TARGET, enumeration({ status, stdout: "" })), false, `a completed exit ${status} proves nothing`);
  }
  // Driven by REAL processes that exit 1 exactly as the CLI would — one meaning
  // absence, one meaning a dead daemon. They are indistinguishable, which is
  // precisely why neither may prove removal.
  const noSuchObject = runNode("process.stderr.write('Error: No such object: x');process.exit(1)");
  const daemonDown = runNode("process.stderr.write('Cannot connect to the Docker daemon');process.exit(1)");
  assert.equal(noSuchObject.status, 1);
  assert.equal(daemonDown.status, 1);
  assert.equal(containerAbsenceProven(TARGET, noSuchObject), false);
  assert.equal(containerAbsenceProven(TARGET, daemonDown), false);
  assert.equal(containerAbsenceProven(TARGET, noSuchObject), containerAbsenceProven(TARGET, daemonDown), "identical inputs must give identical verdicts — so neither may be trusted");
  // And the repair must not be error-text parsing: a message is not a protocol.
  const predicate = bodyOf(BACKEND_SRC, "export function containerAbsenceProven(", "");
  for (const phrase of ["No such object", "No such container", "Cannot connect", "stderr"]) {
    assert.equal(predicate.includes(phrase), false, `the predicate must not read ${phrase}`);
  }
});

test("S16-C6: an enumeration that could not SPAWN (ENOENT) => NOT removed", () => {
  assert.equal(containerAbsenceProven(TARGET, enumeration({ status: null, error: errno("ENOENT") })), false);
  const missing = spawnSync("namla-s16-no-such-binary", ["container", "ls"], { shell: false, encoding: "utf8", timeout: 30000, killSignal: "SIGKILL", maxBuffer: 65536, windowsHide: true });
  assert.equal((missing.error as NodeJS.ErrnoException | undefined)?.code, "ENOENT");
  assert.equal(containerAbsenceProven(TARGET, missing), false);
});

test("S16-C7: an enumeration that TIMED OUT (ETIMEDOUT) => NOT removed", () => {
  assert.equal(containerAbsenceProven(TARGET, enumeration({ status: null, error: errno("ETIMEDOUT"), signal: "SIGKILL" })), false);
  const timedOut = runNode("setTimeout(()=>{},5000)", { timeout: 300 });
  assert.equal((timedOut.error as NodeJS.ErrnoException | undefined)?.code, "ETIMEDOUT");
  assert.equal(containerAbsenceProven(TARGET, timedOut), false);
});

test("S16-C8: an enumeration that overran maxBuffer (ENOBUFS) => NOT removed", () => {
  // The shape that matters now nothing is filtered: a host with very many
  // containers truncates the listing, and the target's line may be the one cut
  // off. Availability may fail closed here; security must not fail open.
  assert.equal(containerAbsenceProven(TARGET, enumeration({ status: null, error: errno("ENOBUFS"), signal: "SIGKILL" })), false);
  const overran = runNode("process.stdout.write('x'.repeat(200000))", { maxBuffer: 64 });
  assert.equal(containerAbsenceProven(TARGET, overran), false, "a truncated listing is never a complete one");
});

test("S16-C9: an enumeration killed by a SIGNAL => NOT removed", () => {
  for (const signal of ["SIGKILL", "SIGTERM", "SIGINT"] as const) {
    assert.equal(containerAbsenceProven(TARGET, enumeration({ status: null, error: undefined, signal })), false, `${signal} termination observes nothing`);
  }
});

test("S16-C10: status 0 with MALFORMED output => NOT removed", () => {
  for (const stdout of ["not json", "{", "[", '{"Names":"x"}', "namla-run-4242-0", '"unterminated', "null", "123", "true", "[]", "{}"]) {
    assert.equal(containerAbsenceProven(TARGET, enumeration({ status: 0, stdout })), false, `malformed ${JSON.stringify(stdout).slice(0, 24)} must not prove absence`);
  }
  assert.equal(containerAbsenceProven(TARGET, { status: 0, error: undefined, signal: null }), false, "absent stdout is not a proven-empty listing");
});

test("S16-C11: PARTIALLY valid, partially malformed output => NOT removed", () => {
  // A parser that skipped the bad line could skip the very line naming the
  // target, so one unparseable line makes the whole listing unknown.
  assert.equal(containerAbsenceProven(TARGET, enumeration({ status: 0, stdout: '"other"\nnot-json' })), false, "good line then bad line");
  assert.equal(containerAbsenceProven(TARGET, enumeration({ status: 0, stdout: 'not-json\n"other"' })), false, "bad line then good line");
  assert.equal(containerAbsenceProven(TARGET, enumeration({ status: 0, stdout: '"a"\n{"Names":"b"}\n"c"' })), false, "a non-string element in the middle");
  assert.equal(containerAbsenceProven(TARGET, enumeration({ status: 0, stdout: '"a"\n"b' })), false, "a truncated final line");
});

test("S16-C12: both production cleanup sites use the shared implementation", () => {
  const sites = [
    ["containerSandboxBackend.forceRemove", bodyOf(BACKEND_SRC, "  private forceRemove(runtime: string, name: string): boolean {", "  ")],
    ["dockerStageBisection.remove", bodyOf(BISECTION_SRC, "  remove(containerName: string): boolean {", "  ")],
  ] as const;
  for (const [name, body] of sites) {
    assert.equal(/status\s*!==\s*0/.test(body), false, `${name} must not decide cleanup from a status check`);
    assert.equal(/\["inspect",/.test(body), false, `${name} must have no inspect-based fallback`);
    assert.match(body, /containerEnumerationArgs\(\)/, `${name} must enumerate`);
    assert.match(body, /return containerAbsenceProven\(/, `${name} must decide through the shared predicate`);
    // The S-16 enumeration query itself is bounded and uncatchably killed.
    for (const opt of ["shell: false", 'encoding: "utf8"', "timeout:", "killSignal:", "maxBuffer:", "windowsHide: true"]) {
      assert.equal(body.includes(opt), true, `${name} enumeration must set ${opt}`);
    }
    // The kill is uncatchable, written either literally or as the named
    // constant — which is itself SIGKILL.
    assert.equal(/killSignal: (?:"SIGKILL"|PROBE_KILL_SIGNAL)/.test(body), true, `${name} enumeration must kill uncatchably`);
    assert.equal(PROBE_KILL_SIGNAL, "SIGKILL", "the named constant is SIGKILL");
    assert.equal(/maxBuffer:\s*Infinity/.test(body), false, `${name} must keep a finite bound`);
  }
  assert.equal((BACKEND_SRC.match(/export function containerAbsenceProven\(/g) ?? []).length, 1, "exactly one definition");
  assert.equal((BISECTION_SRC.match(/function containerAbsenceProven\(/g) ?? []).length, 0, "no duplicated parser");
  assert.equal(/JSON\.parse/.test(BISECTION_SRC), false, "no duplicated output parsing");
  assert.match(BISECTION_SRC, /import \{[^}]*containerAbsenceProven[^}]*\} from "\.\/containerSandboxBackend"/, "it imports the one definition");

  const predicate = bodyOf(BACKEND_SRC, "export function containerAbsenceProven(", "");
  assert.match(predicate, /if \(query\.error\) return false;/, "a failed call proves nothing");
  assert.match(predicate, /if \(typeof query\.status !== "number"\) return false;/, "a missing exit code proves nothing");
  assert.match(predicate, /if \(query\.status !== 0\) return false;/, "a FAILED query proves nothing");
});

test("S16-C13: an unproven cleanup blocks available-and-verified", () => {
  assert.match(BACKEND_SRC, /if \(!removed\) return unverified\("sandbox-cleanup-incomplete", `container not removed after failed probe/, "the failed-probe path refuses");
  assert.match(BACKEND_SRC, /if \(!removed\) return unverified\("sandbox-cleanup-incomplete", "container not removed after exit"\)/, "the success path refuses");
  const body = bodyOf(BACKEND_SRC, "  verifyIsolation(): SandboxCapabilityReport {", "  ");
  const refusal = body.indexOf('if (!removed) return unverified("sandbox-cleanup-incomplete", "container not removed after exit")');
  const verified = body.indexOf('capabilityState: "available-and-verified"');
  assert.ok(refusal > 0 && verified > refusal, "cleanup must be proven BEFORE the verified state is built");
});

test("S16-C14: an unproven cleanup cannot produce cleanupComplete true", () => {
  assert.match(BACKEND_SRC, /const cleanupComplete = this\.forceRemove\(/, "the receipt field comes from the proof");
  assert.match(BACKEND_SRC, /safeReasonCode: cleanupComplete \? "ok" : "sandbox-cleanup-incomplete"/, "and the reason follows it");
  assert.match(BISECTION_SRC, /if \(!removed\) cleanupComplete = false;/, "the bisection records an unremovable container");
});

test("S16-C15: the enumeration argv is unfiltered, --all and machine-parseable", () => {
  const args = containerEnumerationArgs();
  assert.deepEqual(args, ["container", "ls", "--all", "--format", "{{json .Names}}"]);
  for (const required of ["container", "ls", "--all", "--format", "{{json .Names}}"]) {
    assert.equal(args.includes(required), true, `argv must contain ${required}`);
  }
  // The whole point of this correction: Docker's name-matching language is not
  // part of the proof. The filter matches PART of a name and is evaluated as a
  // regex by Moby, so it is excluded entirely.
  assert.equal(args.includes("--filter"), false, "no --filter may appear");
  assert.equal(args.some((a) => a.startsWith("name=")), false, "no name= value may appear");
  assert.equal(args.join(" ").includes("filter"), false, "the argv mentions no filter at all");
  assert.equal(BACKEND_SRC.includes('"--filter"'), false, "and none is constructed anywhere in the backend");
  for (const a of args) assert.equal(/[;&|`$<>]/.test(a), false, `no shell metacharacter in ${a}`);
});

// ============================== TARGET IDENTITY AND RESIDUAL PROPERTIES =====

test("S16-C16: the evidence parser compares identity exactly and imposes no naming policy", () => {
  // The parser answers ONE question — "did a complete successful enumeration
  // omit this exact target?" — and must not additionally answer "is this one of
  // today's default NAMLA name shapes". An earlier draft hard-coded that
  // grammar and would have rejected a name the exported
  // `runStageBisection(runner, inputs, namePrefix)` API can legitimately
  // generate, which is a behaviour change S-16 has no business making.
  for (const name of ["namla-run-4242-0", "namla-verify-99999-12", "namla-bisect-8", "custom-prefix-1", "my.prefix-3", "UPPER-2"]) {
    assert.equal(containerAbsenceProven(name, listed([name])), false, `${name} present must read as present`);
    assert.equal(containerAbsenceProven(name, listed(["something-else"])), true, `${name} absent must read as absent`);
  }

  // The specific regression the review named: a non-default bisection prefix.
  assert.equal(containerAbsenceProven("custom-prefix-1", listed(["custom-prefix-1"])), false);
  assert.equal(containerAbsenceProven("custom-prefix-1", listed([])), true);

  // Regex metacharacters are ORDINARY CHARACTERS here: nothing is filtered, so
  // they reach no Docker regex and cannot broaden or narrow anything. They are
  // compared literally and match only themselves.
  assert.equal(containerAbsenceProven("na.me", listed(["name"])), true, "a dot must not match any character");
  assert.equal(containerAbsenceProven("na.me", listed(["na.me"])), false, "it matches itself exactly");
  assert.equal(containerAbsenceProven("a*", listed(["aaa"])), true, "a star is not a quantifier");
  assert.equal(containerAbsenceProven("^x$", listed(["x"])), true, "anchors are not anchors");
  assert.equal(containerAbsenceProven("a|b", listed(["a"])), true, "an alternation is not an alternation");

  // The only requirement on the target is that there IS one.
  assert.equal(containerAbsenceProven("", listed([])), false, "an empty target proves nothing");
  assert.equal(containerAbsenceProven(undefined as unknown as string, listed([])), false, "a missing target proves nothing");

  // And the invented naming policy is gone from the parser entirely.
  assert.equal(BACKEND_SRC.includes("INTERNAL_CONTAINER_NAME"), false, "no hard-coded name grammar remains");
});

test("S16-C17: UNKNOWN is never REMOVED — exhaustively over every non-affirmative shape", () => {
  const codes = [undefined, errno("ENOENT"), errno("ETIMEDOUT"), errno("ENOBUFS"), errno("EACCES"), errno("EAGAIN")];
  const signals: (NodeJS.Signals | null)[] = [null, "SIGKILL", "SIGTERM"];
  for (const error of codes) {
    for (const signal of signals) {
      assert.equal(containerAbsenceProven(TARGET, enumeration({ status: null, error, signal })), false, `status null (error=${error?.code ?? "none"}, signal=${signal})`);
      assert.equal(containerAbsenceProven(TARGET, enumeration({ status: 1, error, signal })), false, `non-zero status (error=${error?.code ?? "none"})`);
      if (error) assert.equal(containerAbsenceProven(TARGET, enumeration({ status: 0, error, signal, stdout: "" })), false, `a spawn error voids even status 0 (${error.code})`);
    }
  }
});

test("S16-C18: the predicate reads ONLY the fields that carry evidence", () => {
  const noisy = { status: 1, error: undefined, signal: null, stdout: '"other"', stderr: "Error: No such object", pid: 1234 };
  assert.equal(containerAbsenceProven(TARGET, noisy as ContainerEnumerationOutcome), false, "stderr is not evidence and a failed query proves nothing");
  const provable = { status: 0, error: undefined, signal: null, stdout: '"other"', stderr: "irrelevant noise" };
  assert.equal(containerAbsenceProven(TARGET, provable as ContainerEnumerationOutcome), true);
});

test("no repository file preserves either superseded absence claim", () => {
  const files = [
    "src/cognitive/containerSandboxBackend.ts",
    "src/cognitive/dockerStageBisection.ts",
    "src/tools/containerCleanupProofTests.ts",
    "src/tools/probeTimeoutTruthTests.ts",
    "src/tools/verifyContainerCleanupProof.ts",
    ".github/workflows/p0-security.yml",
  ];
  // Needles are ASSEMBLED so this assertion's own text cannot satisfy it, and
  // prose is excluded: a header may legitimately DESCRIBE the corrected defect,
  // and this very test names the phrases it is hunting for.
  const marker = ["TEMPORARY", "NON-VACUITY", "INJECTION"].join(" ");
  const claims = [["exit 1", "proves absence"].join(" "), ["non-zero", "proves absence"].join(" "), ["non-zero", "proves removal"].join(" ")];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const code = src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("#") && !t.includes("assert.") && !t.includes("const marker") && !t.includes("const claims");
      })
      .join("\n");
    assert.equal(code.includes(marker), false, `${f} must carry no injection marker`);
    for (const claim of claims) {
      assert.equal(code.toLowerCase().includes(claim.toLowerCase()), false, `${f} must not assert that ${claim}`);
    }
    // Scoped to argv CONSTRUCTION — prose may explain why the filter is gone.
    assert.equal(/"--filter"\s*,\s*[`"]name=/.test(code), false, `${f} must not build a docker name filter`);
  }
});

test("this suite started no container and required no runtime", () => {
  const src = readFileSync("src/tools/containerCleanupProofTests.ts", "utf8");
  for (const runtime of ["docker", "podman"]) {
    for (const verb of ["run", "build", "pull", "create"]) {
      const needle = [runtime, verb].join(" ");
      const mentions = src
        .split("\n")
        .filter((l) => l.includes(needle))
        .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.includes("[runtime, verb]"));
      assert.equal(mentions.length, 0, `must not invoke ${needle}: ${mentions.join(" | ").slice(0, 120)}`);
    }
  }
});
