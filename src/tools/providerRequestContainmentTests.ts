/**
 * providerRequestContainmentTests — proof that no secret leaves the process.
 *
 * Every test uses a COUNTING FAKE driver. No real provider, no network, no
 * child process. The counter is the load-bearing assertion for "fail closed":
 * a blocked request must leave `runs === 0`, because a request that was
 * inspected and refused *after* spawning would have already leaked.
 *
 * Run: node --test dist/tools/providerRequestContainmentTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import {
  buildSafeProviderRequest,
  buildRequestManifest,
  buildSafeChildEnv,
  rejectedEnvNames,
  ALLOWED_ENV_NAMES,
  FORBIDDEN_ENV_NAME_PATTERN,
  MAX_PROMPT_BYTES,
  type ProviderRequestReceipt,
} from "../cognitive/safeProviderRequest";
import { registerEnvironmentSecrets, clearRegisteredEnvironmentSecrets } from "../cognitive/safeRedactor";
import { utf8Bytes } from "../cognitive/safeWorkspacePath";
import type { ProviderProcessDriver, ProviderProcessResult, ProviderProcessSpec } from "../cognitive/providerProcessDriver";

// ------------------------------------------------------------- FIXTURES ---

const OPENAI = "sk-proj-AbCdEf0123456789AbCdEf0123456789";
const GITHUB = "ghp_AbCdEf0123456789AbCdEf0123456789Ab";
const GH_PAT = "github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz012345";
const AWS_ID = "AKIAIOSFODNN7EXAMPLE";
const BEARER = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig";
const REFRESH = "refresh_token=1//0eXaMpLeReFrEsHtOkEnVaLuE12345";
const COOKIE = "Cookie: session_id=s3cr3tCookieValue9999";
const PASSWORD = "password=hunter2-not-a-real-password";
const PEM = ["-----BEGIN RSA PRIVATE KEY-----", "MIIEowIBAAKCAQEAxyz0123456789abcdef", "-----END RSA PRIVATE KEY-----"].join("\n");
const OPENSSH = ["-----BEGIN OPENSSH PRIVATE KEY-----", "b3BlbnNzaC1rZXktdjEAAAAABG5vbmU", "-----END OPENSSH PRIVATE KEY-----"].join("\n");
const ENV_SECRET = "hunter2-super-secret-env-value";

const ALL_RAW = [OPENAI, GITHUB, GH_PAT, AWS_ID, "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig", "1//0eXaMpLeReFrEsHtOkEnVaLuE12345", "s3cr3tCookieValue9999", "hunter2-not-a-real-password", "MIIEowIBAAKCAQEAxyz0123456789abcdef", ENV_SECRET];

const WS = "C:\\Users\\test\\workspaces\\namola-twin\\m1\\codex-crucible";

function baseInput(overrides: Partial<Parameters<typeof buildSafeProviderRequest>[0]> = {}) {
  return {
    requestId: "req-1",
    providerId: "codex" as const,
    role: "implementation",
    objective: "Build a task manager.",
    promptBody: "Return JSON with an artifacts array.",
    workingDirectoryAbsolute: WS,
    timeoutMs: 600000,
    maxStdoutBytes: 200000,
    maxStderrBytes: 20000,
    ...overrides,
  };
}

/** Asserts no raw secret appears anywhere in `haystack`. */
function assertNoRawSecret(haystack: string, label: string): void {
  for (const raw of ALL_RAW) {
    assert.equal(haystack.includes(raw), false, `${label} must not contain the raw secret ${raw.slice(0, 10)}…`);
  }
}

/** A fake driver that COUNTS invocations and records what it was handed. */
class CountingFakeDriver implements ProviderProcessDriver {
  readonly isReal = false;
  runs = 0;
  lastSpec: ProviderProcessSpec | null = null;

  run(spec: ProviderProcessSpec): ProviderProcessResult {
    this.runs += 1;
    this.lastSpec = spec;
    return { ran: true, exitCode: 0, terminationSignalCategory: "none", stdout: "{}", stderr: "", stdoutTruncated: false, stderrTruncated: false, failureCategory: "none" };
  }
}

/** Drive the fake exactly as production would: build, then run only if allowed. */
function attempt(input: ReturnType<typeof baseInput>, driver: CountingFakeDriver) {
  const built = buildSafeProviderRequest(input);
  if (built.ok) driver.run(built.spec);
  return built;
}

// -------------------------------------------------- BLOCKED (FAIL CLOSED) ---

test("high-risk authentication material blocks the request and never spawns", () => {
  const carriers: Array<[string, string]> = [
    ["openai key in English prose", `Please deploy the service. The key is ${OPENAI}. Thanks.`],
    ["github token", `Use ${GITHUB} to clone the repository.`],
    ["github pat", `token ${GH_PAT}`],
    ["aws access key", `Configure AWS with ${AWS_ID}.`],
    ["bearer header", `Send header Authorization: ${BEARER}`],
    ["oauth refresh token", `Persist ${REFRESH} for later.`],
    ["session cookie", `Replay with ${COOKIE}`],
    ["password assignment", `Login with ${PASSWORD}`],
    ["PEM private key", `Here is the deploy key:\n${PEM}`],
    ["OpenSSH private key", `Here is the ssh key:\n${OPENSSH}`],
    ["JSON body", JSON.stringify({ task: "build", credentials: { api_key: OPENAI } })],
    ["TypeScript comment", `// FIXME: rotate ${GITHUB}\nexport const x = 1;`],
    ["Arabic prose", `يرجى استخدام المفتاح ${OPENAI} للنشر الآن.`],
    ["Hebrew prose", `אנא השתמש במפתח ${GITHUB} כדי לפרוס.`],
  ];

  for (const [label, promptBody] of carriers) {
    const driver = new CountingFakeDriver();
    const built = attempt(baseInput({ promptBody }), driver);

    assert.equal(built.ok, false, `${label} must be blocked`);
    assert.equal(built.spec, null, `${label} must expose no spec`);
    assert.equal(built.env, null, `${label} must expose no env`);
    assert.equal(built.receipt.blocked, true, `${label} receipt must be blocked`);
    assert.equal(built.receipt.safeReasonCode, "provider-request-secret-blocked", `${label} reason code`);
    // THE decisive assertion: the driver was never reached.
    assert.equal(driver.runs, 0, `${label} must never invoke the provider driver`);
    assert.equal(driver.lastSpec, null, `${label} must never hand a spec to a driver`);
    // The receipt names categories, never values.
    assertNoRawSecret(JSON.stringify(built.receipt), `${label} receipt`);
    assert.equal(built.receipt.redactionCategories.length > 0, true, `${label} must report a category`);
  }
});

test("blocked requests report the correct category and no value-derived digest", () => {
  const built = buildSafeProviderRequest(baseInput({ promptBody: `key ${OPENAI}` }));
  assert.equal(built.ok, false);
  assert.deepEqual(built.receipt.redactionCategories, ["OPENAI_KEY"]);
  // A digest of a blocked secret would be a side channel — there must not be one.
  assert.equal(built.receipt.safeFingerprint, "spr-blocked");
  assertNoRawSecret(built.receipt.safeFingerprint, "blocked fingerprint");

  const ssh = buildSafeProviderRequest(baseInput({ promptBody: OPENSSH }));
  assert.equal(ssh.ok, false);
  assert.equal(ssh.receipt.redactionCategories.includes("SSH_PRIVATE_MATERIAL"), true);
});

test("a registered environment-secret value blocks the request", () => {
  registerEnvironmentSecrets([ENV_SECRET]);
  try {
    const driver = new CountingFakeDriver();
    const built = attempt(baseInput({ promptBody: `the deploy used ${ENV_SECRET} last time` }), driver);
    assert.equal(built.ok, false, "a registered env secret must block");
    assert.equal(built.receipt.safeReasonCode, "provider-request-secret-blocked");
    assert.equal(driver.runs, 0);
  } finally {
    clearRegisteredEnvironmentSecrets();
  }
});

test("secrets hidden in context, evidence, file summaries and objective all block", () => {
  const fields = ["objective", "contextExcerpts", "fileSummaries", "evidenceExcerpts"] as const;
  for (const field of fields) {
    const driver = new CountingFakeDriver();
    const overrides = field === "objective" ? { objective: `deploy with ${OPENAI}` } : { [field]: [`leaked ${OPENAI}`] };
    const built = attempt(baseInput(overrides as never), driver);
    assert.equal(built.ok, false, `${field} must be inspected`);
    assert.equal(driver.runs, 0, `${field} must not spawn`);
  }
});

// ------------------------------------------------- ALLOWED (REDACT + SEND) ---

test("clean prompts pass through unchanged and reach the driver", () => {
  const driver = new CountingFakeDriver();
  const promptBody = ["export function add(a: number, b: number): number {", "  return a + b; // ordinary code, no secret", "}", "مرحبا بالعالم", "שלום עולם", "🚀 done"].join("\n");
  const built = attempt(baseInput({ promptBody }), driver);

  assert.equal(built.ok, true, "clean source code must not be blocked");
  assert.equal(driver.runs, 1);
  assert.equal(built.receipt.blocked, false);
  assert.equal(built.receipt.safeReasonCode, "ok");
  assert.equal(built.receipt.redactionCount, 0, "clean text must not be redacted");
  // Every line of the clean prompt survives verbatim.
  for (const line of promptBody.split("\n")) {
    assert.equal(driver.lastSpec?.argumentList.join(" ").includes(line), true, `clean line must survive: ${line}`);
  }
});

test("lower-risk secret-shaped text is redacted and still sent", () => {
  const driver = new CountingFakeDriver();
  const blob = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODk";
  const uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  const built = attempt(baseInput({ promptBody: `The digest is ${blob} and the trace id is ${uuid}.` }), driver);

  assert.equal(built.ok, true, "shaped-but-not-credential text must not block");
  assert.equal(driver.runs, 1, "a lower-risk request is still sent");
  assert.equal(built.receipt.redactionCount >= 2, true, "both shaped values must be redacted");
  const argv = driver.lastSpec?.argumentList.join(" ") ?? "";
  assert.equal(argv.includes(blob), false, "the entropy blob must not reach argv");
  assert.equal(argv.includes(uuid), false, "the uuid must not reach argv");
  assert.equal(argv.includes("[REDACTED:ENTROPY]"), true);
  assert.equal(argv.includes("[REDACTED:UUID]"), true);
});

// ------------------------------------------------------ ARGV + STDIN + ENV ---

test("Codex carries the prompt in argv only; Claude on stdin only — never both", () => {
  const codex = buildSafeProviderRequest(baseInput({ providerId: "codex", promptBody: "build it" }));
  assert.equal(codex.ok, true);
  const codexArgv = codex.ok ? codex.spec.argumentList : [];
  assert.deepEqual(codexArgv.slice(0, -1), ["exec", "--ephemeral", "--json", "--ignore-user-config", "--sandbox", "read-only"]);
  assert.equal(codexArgv[codexArgv.length - 1]?.includes("build it"), true);
  assert.equal(codex.ok && codex.spec.stdinData, "", "codex stdin must be empty and closed");

  const claude = buildSafeProviderRequest(baseInput({ providerId: "claude", promptBody: "review it" }));
  assert.equal(claude.ok, true);
  assert.deepEqual(claude.ok && claude.spec.argumentList, ["--print", "--output-format", "json", "--disallowedTools", "Read,Glob,Grep,Bash,PowerShell,Write,Edit,MultiEdit,NotebookEdit"]);
  assert.equal(claude.ok && claude.spec.stdinData.includes("review it"), true);
  // A fixed template means argv length cannot grow with mission text.
  assert.equal(claude.ok && claude.spec.argumentList.length, 5);
});

test("argv is a fixed template — mission text can never add a flag or an executable", () => {
  const hostile = "--dangerously-skip-permissions --allow-all; rm -rf /";
  const built = buildSafeProviderRequest(baseInput({ providerId: "codex", promptBody: hostile }));
  assert.equal(built.ok, true, "hostile-looking text is data, not a credential");
  const argv = built.ok ? built.spec.argumentList : [];
  // The flags are exactly the template; the hostile text is ONE trailing
  // positional entry, which shell:false can never reinterpret as a flag.
  assert.deepEqual(argv.slice(0, -1), ["exec", "--ephemeral", "--json", "--ignore-user-config", "--sandbox", "read-only"]);
  assert.equal(argv.length, 7, "argv length is fixed at flags + one positional");
  assert.equal(argv[argv.length - 1]?.endsWith(hostile), true, "hostile text stays inside the single positional entry");
  assert.equal(built.ok && built.spec.executableId, "codex");
});

test("the child environment is an allowlist and never inherits process.env", () => {
  const hostile: NodeJS.ProcessEnv = {
    PATH: "/usr/bin",
    HOME: "/home/test",
    OPENAI_API_KEY: OPENAI,
    GITHUB_TOKEN: GITHUB,
    AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    MY_PASSWORD: "hunter2-not-a-real-password",
    SESSION_ID: "s3cr3tCookieValue9999",
    HTTP_COOKIE: "a=b",
    SSH_PRIVATE_KEY: PEM,
    NPM_AUTH_TOKEN: "abc",
    SOME_CREDENTIAL: "x",
  };
  const env = buildSafeChildEnv(hostile);

  assert.deepEqual(Object.keys(env).sort(), ["HOME", "PATH"], "only allowlisted names may pass");
  assertNoRawSecret(JSON.stringify(env), "child environment");
  // Nothing outside the allowlist can appear, by construction.
  for (const name of Object.keys(env)) assert.equal(ALLOWED_ENV_NAMES.includes(name), true);

  // Every required forbidden substring is actually rejected.
  for (const name of ["MY_TOKEN", "A_SECRET", "X_PASSWORD", "HTTP_COOKIE", "SESSION_ID", "SSH_PRIVATE_KEY", "OPENAI_API_KEY", "SOME_CREDENTIAL", "NPM_AUTH_TOKEN"]) {
    assert.equal(FORBIDDEN_ENV_NAME_PATTERN.test(name), true, `${name} must be forbidden`);
  }
  // The real process.env is filtered the same way.
  assertNoRawSecret(JSON.stringify(buildSafeChildEnv()), "real process.env passthrough");
});

test("asking to forward a credential-shaped env name is refused, not silently dropped", () => {
  const driver = new CountingFakeDriver();
  const built = attempt(baseInput({ requestedEnvNames: ["PATH", "OPENAI_API_KEY"] }), driver);
  assert.equal(built.ok, false);
  assert.equal(built.receipt.safeReasonCode, "forbidden-environment-name");
  assert.equal(driver.runs, 0);
  assert.deepEqual(rejectedEnvNames(["PATH", "GITHUB_TOKEN", "HOME"]), ["GITHUB_TOKEN"]);
});

// -------------------------------------------------------------- UTF-8 ---

test("byte limits are real UTF-8 bytes and never split a character", () => {
  const arabic = "مرحبا بالعالم ";
  const emoji = "🚀🎉";
  const promptBody = (arabic + emoji).repeat(400);
  const cap = 1000;
  const built = buildSafeProviderRequest(baseInput({ promptBody, maxPromptBytes: cap }));
  assert.equal(built.ok, true);
  const argvList = built.ok ? built.spec.argumentList : [];
  const argv = argvList[argvList.length - 1] ?? "";

  assert.equal(utf8Bytes(argv) <= cap, true, "argv must respect the real byte cap");
  assert.equal(built.receipt.acceptedBytes <= cap, true);
  assert.equal(built.receipt.acceptedBytes, utf8Bytes(argv), "acceptedBytes must be exact");
  assert.equal(built.receipt.rejectedBytes, utf8Bytes(built.ok ? [baseInput().objective, promptBody].join("\n\n") : "") - built.receipt.acceptedBytes, "rejectedBytes must be exact");
  // Valid UTF-8: no replacement character, and a byte round-trip is lossless.
  assert.equal(argv.includes("\uFFFD"), false, "no replacement characters");
  assert.equal(Buffer.from(argv, "utf8").toString("utf8"), argv, "round-trip must be lossless");
  // An emoji is 2 UTF-16 units — the cut must not leave a lone surrogate.
  assert.equal(/[\uD800-\uDBFF]$/.test(argv), false, "must not end on a high surrogate");
});

test("stdin is bounded in bytes for the stdin-based provider", () => {
  const cap = 800;
  const built = buildSafeProviderRequest(baseInput({ providerId: "claude", promptBody: "שלום עולם ".repeat(500), maxPromptBytes: cap }));
  assert.equal(built.ok, true);
  const stdin = built.ok ? built.spec.stdinData : "";
  assert.equal(utf8Bytes(stdin) <= cap, true);
  assert.equal(stdin.includes("\uFFFD"), false);
  assert.equal(Buffer.from(stdin, "utf8").toString("utf8"), stdin);
});

test("the default prompt cap is enforced without an explicit override", () => {
  const built = buildSafeProviderRequest(baseInput({ promptBody: "a".repeat(MAX_PROMPT_BYTES + 5000) }));
  assert.equal(built.ok, true);
  assert.equal(built.receipt.acceptedBytes <= MAX_PROMPT_BYTES, true);
  assert.equal(built.receipt.rejectedBytes > 0, true);
});

// ------------------------------------------- MANIFEST, RECEIPTS, TERMINAL ---

test("request manifests and receipts persist safe fields only", () => {
  const receipts: ProviderRequestReceipt[] = [buildSafeProviderRequest(baseInput({ requestId: "r-blocked", promptBody: `key ${OPENAI} and ${COOKIE}` })).receipt, buildSafeProviderRequest(baseInput({ requestId: "r-ok", promptBody: "clean prompt" })).receipt];

  const manifest = buildRequestManifest(receipts);
  assertNoRawSecret(manifest, "request manifest");

  // Write to a REAL temp directory and read it back off disk.
  const dir = mkdtempSync(resolve(tmpdir(), "namla-req-"));
  try {
    const p = resolve(dir, "request-manifest.json");
    writeFileSync(p, manifest, "utf8");
    const onDisk = readFileSync(p, "utf8");
    assertNoRawSecret(onDisk, "request-manifest.json on disk");

    const parsed = JSON.parse(onDisk) as { requests: Record<string, unknown>[] };
    const allowed = ["requestId", "providerId", "role", "acceptedBytes", "rejectedBytes", "redactionCount", "redactionCategories", "blocked", "safeReasonCode", "safeFingerprint"];
    for (const r of parsed.requests) {
      assert.deepEqual(Object.keys(r).sort(), [...allowed].sort(), "a manifest entry must carry exactly the safe fields");
    }
    assert.equal(parsed.requests[0].blocked, true);
    assert.equal(parsed.requests[1].blocked, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a terminal diagnostic of a request carries no secret", () => {
  const built = buildSafeProviderRequest(baseInput({ promptBody: `deploying with ${OPENAI}` }));
  // Exactly what a stage log would print.
  const line = JSON.stringify({ stage: "provider-request", ...built.receipt });
  assertNoRawSecret(line, "terminal diagnostic");
  assert.equal(line.includes("provider-request-secret-blocked"), true);
});

test("identical safe prompts fingerprint identically; different ones differ", () => {
  const a = buildSafeProviderRequest(baseInput({ promptBody: "identical prompt" })).receipt.safeFingerprint;
  const b = buildSafeProviderRequest(baseInput({ promptBody: "identical prompt" })).receipt.safeFingerprint;
  const c = buildSafeProviderRequest(baseInput({ promptBody: "a different prompt" })).receipt.safeFingerprint;
  assert.equal(a, b, "same safe input must fingerprint identically");
  assert.notEqual(a, c, "different safe input must fingerprint differently");
  assertNoRawSecret(a + b + c, "fingerprints");
});

test("a fake API JSON body built from a request carries no secret", () => {
  // A fake HTTP-style provider: the body is assembled from the SAME boundary,
  // so an API-shaped provider inherits the identical guarantee as a CLI one.
  let sentBodies: string[] = [];
  const fakeApiSend = (input: ReturnType<typeof baseInput>): string => {
    const built = buildSafeProviderRequest(input);
    if (!built.ok) return built.receipt.safeReasonCode;
    const body = JSON.stringify({ model: built.spec.executableId, prompt: built.spec.stdinData || built.spec.argumentList[3], metadata: built.receipt });
    sentBodies.push(body);
    return "sent";
  };

  assert.equal(fakeApiSend(baseInput({ providerId: "claude", promptBody: `use ${OPENAI} please` })), "provider-request-secret-blocked");
  assert.equal(sentBodies.length, 0, "a blocked request must produce NO request body at all");

  assert.equal(fakeApiSend(baseInput({ providerId: "claude", promptBody: "summarize the plan" })), "sent");
  assert.equal(sentBodies.length, 1);
  assertNoRawSecret(sentBodies[0], "fake API JSON body");
  assert.equal(JSON.parse(sentBodies[0]).prompt.includes("summarize the plan"), true);
});

test("no real action is taken anywhere in this suite", () => {
  const driver = new CountingFakeDriver();
  assert.equal(driver.isReal, false);
  const blocked = attempt(baseInput({ promptBody: `${OPENAI}` }), driver);
  const clean = attempt(baseInput({ promptBody: "fine" }), driver);
  assert.equal(blocked.ok, false);
  assert.equal(clean.ok, true);
  assert.equal(driver.runs, 1, "only the clean request ran, and only against a fake");
});

// ------------------------------- CODEX PROVIDER BOUNDARY IS ASSERTED (D-6) ---
// The Codex provider process runs directly on the HOST - it is NOT inside the
// verification container. Whatever authority it has therefore comes from the
// CLI's own defaults plus whatever ambient user configuration it happens to
// load. D-6B established that `$CODEX_HOME/config.toml` on a developer machine
// can declare MCP servers, and that Codex initializes those during exec startup
// - host processes that no `--sandbox` value constrains, because the sandbox
// governs model-generated shell commands only.
//
// Namla therefore states the boundary itself instead of inheriting it:
// `--ignore-user-config` keeps ambient execution configuration out of the
// session (auth still resolves via CODEX_HOME), and `--sandbox read-only`
// asserts a non-mutating filesystem policy rather than accepting whatever the
// default resolves to for the current project-trust state.

/** The exact flags every Codex provider invocation must carry, in order. */
const REQUIRED_CODEX_FLAGS: readonly string[] = ["exec", "--ephemeral", "--json", "--ignore-user-config", "--sandbox", "read-only"];

test("D-6: Codex argv asserts the sandbox and excludes ambient user config", () => {
  const built = buildSafeProviderRequest(baseInput({ providerId: "codex", promptBody: "build it" }));
  assert.equal(built.ok, true);
  const argv = built.ok ? built.spec.argumentList : [];

  assert.deepEqual(argv.slice(0, REQUIRED_CODEX_FLAGS.length), REQUIRED_CODEX_FLAGS, "the fixed flag template must be exact and ordered");
  assert.equal(argv.length, REQUIRED_CODEX_FLAGS.length + 1, "flags plus exactly one positional prompt");
  assert.equal(argv[argv.length - 1]?.includes("build it"), true, "the prompt is the FINAL positional argument");
  assert.equal(built.ok && built.spec.executableId, "codex", "the executable id must stay codex");

  // `--sandbox` must be followed by the read-only value and by nothing else.
  const sandboxAt = argv.indexOf("--sandbox");
  assert.equal(sandboxAt >= 0, true, "the sandbox policy must be stated explicitly");
  assert.equal(argv[sandboxAt + 1], "read-only", "the sandbox value must be read-only");
  assert.equal(argv.filter((a) => a === "--sandbox").length, 1, "exactly one sandbox option");
  assert.equal(argv.includes("--ignore-user-config"), true, "ambient user execution config must be excluded");
});

test("D-6: no prompt text can inject, remove or retarget a Codex flag", () => {
  // Every one of these is ordinary DATA. `shell:false` plus a fixed template
  // means none of it can become an argument in its own right.
  const hostile = [
    "--sandbox danger-full-access",
    "--dangerously-bypass-approvals-and-sandbox",
    "--full-auto --skip-git-repo-check",
    "--config sandbox_mode=danger-full-access",
    "read-only --sandbox workspace-write",
  ].join(" ");
  const built = buildSafeProviderRequest(baseInput({ providerId: "codex", promptBody: hostile }));
  assert.equal(built.ok, true, "hostile-looking text is data, not a credential");
  const argv = built.ok ? built.spec.argumentList : [];

  assert.deepEqual(argv.slice(0, REQUIRED_CODEX_FLAGS.length), REQUIRED_CODEX_FLAGS, "the template is unchanged by mission text");
  assert.equal(argv.length, REQUIRED_CODEX_FLAGS.length + 1, "mission text can never grow argv");
  assert.equal(argv[argv.length - 1]?.endsWith(hostile), true, "hostile text stays inside the single positional entry");
  // The sandbox value is still the one Namla chose, not one the text named.
  assert.equal(argv[argv.indexOf("--sandbox") + 1], "read-only", "no prompt text may retarget the sandbox value");
});

test("D-6: no authority-widening Codex flag is ever emitted", () => {
  const forbidden = ["--dangerously-bypass-approvals-and-sandbox", "--full-auto", "--skip-git-repo-check", "--ask-for-approval", "--ignore-rules", "--profile", "--config", "-c"];
  for (const providerId of ["codex", "claude"] as const) {
    const built = buildSafeProviderRequest(baseInput({ providerId, promptBody: "ordinary work" }));
    assert.equal(built.ok, true);
    const flags = (built.ok ? built.spec.argumentList : []).slice(0, -1); // exclude the positional
    for (const bad of forbidden) {
      assert.equal(flags.includes(bad), false, `${providerId} argv must never carry ${bad}`);
    }
    assert.equal(flags.includes("danger-full-access"), false, `${providerId} argv must never name danger-full-access`);
    assert.equal(flags.includes("workspace-write"), false, `${providerId} argv must never name workspace-write`);
  }
});

// --------------------------- CLAUDE FILESYSTEM-READ TOOLS ARE DENIED (D-7) ---
// D-7B proved, with a 256-bit CSPRNG sentinel in a neutral-named file, that the
// Claude provider process could return the exact bytes of a workspace file that
// appeared NOWHERE in the curated outbound prompt. The bytes were acquired
// during the provider interaction through Claude's own native workspace access,
// and Namla observed nothing: `liveProviderExecution` parses only summary /
// assumptions / files / risks / tests / confidence / requestedCommands, so a
// direct read leaves no trace in any receipt, counter or policy field.
//
// `safeProviderRequest` is "the ONE outbound boundary" - high-confidence
// credentials FAIL CLOSED rather than being sent. A provider that reads its own
// context off disk routes around that boundary entirely. Namla therefore denies
// the filesystem-read tool names at the fixed argv layer, where mission text can
// never reach them, instead of trusting ambient Claude settings.
//
// Scope note kept deliberately narrow: this denies the READ tool NAMES proven in
// D-7B. It is not a claim that no file can be reached by any other mechanism.

/**
 * Tool names Claude must never be able to use for provider generation. D-7 added
 * the filesystem-read names; D-9B added the shell names; D-14 added the mutation
 * names. The list is the COMPLETE
 * deny set because the assertions below compare it by exact equality.
 */
const DENIED_CLAUDE_TOOLS: readonly string[] = ["Read", "Glob", "Grep", "Bash", "PowerShell", "Write", "Edit", "MultiEdit", "NotebookEdit"];

/** Installed 2.1.237: `--disallowedTools <tools...>`, comma or space separated. */
const CLAUDE_DENY_VALUE = "Read,Glob,Grep,Bash,PowerShell,Write,Edit,MultiEdit,NotebookEdit";

test("D-7: Claude argv denies the native filesystem-read tools", () => {
  const built = buildSafeProviderRequest(baseInput({ providerId: "claude", promptBody: "do the work" }));
  assert.equal(built.ok, true);
  const argv = built.ok ? built.spec.argumentList : [];

  assert.deepEqual(argv, ["--print", "--output-format", "json", "--disallowedTools", CLAUDE_DENY_VALUE], "the Claude flag template must be exact and ordered");

  const at = argv.indexOf("--disallowedTools");
  assert.equal(at >= 0, true, "the deny policy must be stated explicitly");
  assert.equal(argv.filter((a) => a === "--disallowedTools").length, 1, "exactly one deny option");
  const denied = (argv[at + 1] ?? "").split(/[,\s]+/).filter(Boolean);
  for (const tool of DENIED_CLAUDE_TOOLS) {
    assert.equal(denied.includes(tool), true, `${tool} must be denied by name`);
  }
  // The prompt stays on stdin: argv carries no mission text at all.
  assert.equal(built.ok && built.spec.stdinData.includes("do the work"), true, "the prompt travels on stdin");
  assert.equal(argv.some((a) => a.includes("do the work")), false, "no mission text may appear in Claude argv");
});

test("D-7: no prompt text can remove, widen or retarget the Claude deny list", () => {
  // Every one of these is ordinary DATA. A fixed template plus shell:false means
  // none of it can become an argument in its own right.
  const hostile = [
    "--allowedTools Read",
    '--disallowedTools ""',
    "--disallowedTools=",
    "Read Glob Grep",
    "--dangerously-skip-permissions",
    "--permission-mode bypassPermissions",
  ].join(" ");
  const built = buildSafeProviderRequest(baseInput({ providerId: "claude", promptBody: hostile }));
  assert.equal(built.ok, true, "hostile-looking text is data, not a credential");
  const argv = built.ok ? built.spec.argumentList : [];

  assert.deepEqual(argv, ["--print", "--output-format", "json", "--disallowedTools", CLAUDE_DENY_VALUE], "the template is unchanged by mission text");
  assert.equal(argv.length, 5, "mission text can never grow Claude argv");
  assert.equal(argv.includes("--allowedTools"), false, "no allow-list may be introduced by prompt text");
  // The deny value is still the one Namla chose, not one the text named.
  const denied = (argv[argv.indexOf("--disallowedTools") + 1] ?? "").split(/[,\s]+/).filter(Boolean);
  assert.deepEqual(denied, [...DENIED_CLAUDE_TOOLS], "no prompt text may retarget the deny list");
});

test("D-7: Claude argv introduces no authority-widening option", () => {
  const forbidden = ["--allowedTools", "--allowed-tools", "--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "--permission-mode", "--permission-prompt-tool", "--settings", "--add-dir", "--plugin-dir"];
  const built = buildSafeProviderRequest(baseInput({ providerId: "claude", promptBody: "ordinary work" }));
  assert.equal(built.ok, true);
  const argv = built.ok ? built.spec.argumentList : [];
  for (const bad of forbidden) {
    assert.equal(argv.includes(bad), false, `Claude argv must never carry ${bad}`);
  }
  assert.equal(argv.includes("bypassPermissions"), false, "Claude argv must never name bypassPermissions");
});

test("D-7: the D-6 Codex boundary is unchanged by the Claude hardening", () => {
  const built = buildSafeProviderRequest(baseInput({ providerId: "codex", promptBody: "build it" }));
  assert.equal(built.ok, true);
  const argv = built.ok ? built.spec.argumentList : [];
  assert.deepEqual(argv.slice(0, -1), ["exec", "--ephemeral", "--json", "--ignore-user-config", "--sandbox", "read-only"], "Codex flags must be byte-for-byte unchanged");
  assert.equal(argv[argv.length - 1]?.includes("build it"), true, "the Codex prompt is still the final positional");
  assert.equal(argv.includes("--disallowedTools"), false, "the Claude deny flag must not leak into Codex argv");
});

// ------------------------- CLAUDE SHELL TOOLS ARE DENIED BY NAMLA (D-9B) ---
// D-8 measured the exact production Claude invocation attempting BOTH shell
// tools: `permission_denials` came back as ["PowerShell","Bash"], no command
// ran, and no marker appeared. That denial came from Claude's own mode:"default"
// layer with an empty user-scope rule set - NOT from anything Namla asserts.
//
// D-9 then showed why that is fragile: Namla forwards HOME/USERPROFILE/APPDATA
// (the CLI needs them to find its own credentials), so the real user settings
// file is read on every production call. An ordinary `permissions.allow: ["Bash"]`
// added there would change the outcome with no Namla code change, no argv change,
// and no signal in any receipt. Namla strips CLAUDE_CONFIG_DIR and XDG_CONFIG_HOME,
// so selector-based redirection is already blocked - but the settings file itself
// is not something Namla controls.
//
// Build Law is unqualified: "a provider never writes files, runs commands ..."
// and "No provider receives a generic run-tool capability". Namla therefore names
// the shell tools in its own fixed argv, where mission text cannot reach them, so
// Namla states this boundary independently of ambient settings.
//
// Scope: this removes these tool NAMES from the provider-generation session. It is
// not a claim that no command can execute by any other mechanism, and not OS-level
// process isolation.

/** Every native tool name Namla denies for provider generation. */
const D9B_DENIED_TOOLS: readonly string[] = ["Read", "Glob", "Grep", "Bash", "PowerShell", "Write", "Edit", "MultiEdit", "NotebookEdit"];

/** Installed 2.1.237 canonical identifiers, comma-separated single argument. */
const D9B_DENY_VALUE = "Read,Glob,Grep,Bash,PowerShell,Write,Edit,MultiEdit,NotebookEdit";

test("D-9B: Claude argv denies the native shell tools as well as the read tools", () => {
  const built = buildSafeProviderRequest(baseInput({ providerId: "claude", promptBody: "do the work" }));
  assert.equal(built.ok, true);
  const argv = built.ok ? built.spec.argumentList : [];

  assert.deepEqual(argv, ["--print", "--output-format", "json", "--disallowedTools", D9B_DENY_VALUE], "the Claude flag template must be exact and ordered");
  assert.equal(built.ok && built.spec.executableId, "claude", "the executable id must stay claude");

  const at = argv.indexOf("--disallowedTools");
  const denied = (argv[at + 1] ?? "").split(/[,\s]+/).filter(Boolean);
  for (const tool of D9B_DENIED_TOOLS) {
    assert.equal(denied.includes(tool), true, `${tool} must be denied by name`);
    assert.equal(denied.filter((d) => d === tool).length, 1, `${tool} must appear exactly once`);
  }
  assert.equal(denied.length, D9B_DENIED_TOOLS.length, "the deny list carries exactly these tools");

  // The prompt stays on stdin: argv carries no mission text at all.
  assert.equal(built.ok && built.spec.stdinData.includes("do the work"), true, "the prompt travels on stdin");
  assert.equal(argv.some((a) => a.includes("do the work")), false, "no mission text may appear in Claude argv");
});

test("D-9B: hostile prompt text cannot re-enable a shell tool", () => {
  // Ordinary DATA. A fixed template plus shell:false means none of it can become
  // an argument, and none of it can shorten or retarget the deny list.
  const hostile = [
    "--allowedTools Bash",
    "--disallowedTools Read",
    "--disallowedTools=Read,Glob,Grep",
    "Bash",
    "PowerShell",
    "--dangerously-skip-permissions",
    "--permission-mode bypassPermissions",
  ].join(" ");
  const built = buildSafeProviderRequest(baseInput({ providerId: "claude", promptBody: hostile }));
  assert.equal(built.ok, true, "hostile-looking text is data, not a credential");
  const argv = built.ok ? built.spec.argumentList : [];

  assert.deepEqual(argv, ["--print", "--output-format", "json", "--disallowedTools", D9B_DENY_VALUE], "the template is unchanged by mission text");
  assert.equal(argv.length, 5, "mission text can never grow Claude argv");
  assert.equal(argv.filter((a) => a === "--disallowedTools").length, 1, "exactly one deny option");
  assert.equal(argv.includes("--allowedTools"), false, "no allow-list may be introduced by prompt text");

  const denied = (argv[argv.indexOf("--disallowedTools") + 1] ?? "").split(/[,\s]+/).filter(Boolean);
  assert.deepEqual(denied, [...D9B_DENIED_TOOLS], "no prompt text may shorten or retarget the deny list");
  assert.equal(built.ok && built.spec.stdinData.includes("--allowedTools Bash"), true, "the hostile text stays inert on stdin");
});

test("D-9B: no authority-widening Claude option accompanies the shell denial", () => {
  const forbidden = ["--allowedTools", "--allowed-tools", "--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "--permission-mode", "--permission-prompt-tool", "--settings", "--add-dir", "--plugin-dir"];
  const built = buildSafeProviderRequest(baseInput({ providerId: "claude", promptBody: "ordinary work" }));
  assert.equal(built.ok, true);
  const argv = built.ok ? built.spec.argumentList : [];
  for (const bad of forbidden) {
    assert.equal(argv.includes(bad), false, `Claude argv must never carry ${bad}`);
  }
  assert.equal(argv.includes("bypassPermissions"), false, "Claude argv must never name bypassPermissions");
});

test("D-9B: the D-6 Codex boundary is unchanged by the Claude shell denial", () => {
  const built = buildSafeProviderRequest(baseInput({ providerId: "codex", promptBody: "build it" }));
  assert.equal(built.ok, true);
  const argv = built.ok ? built.spec.argumentList : [];
  assert.deepEqual(argv.slice(0, -1), ["exec", "--ephemeral", "--json", "--ignore-user-config", "--sandbox", "read-only"], "Codex flags must be byte-for-byte unchanged");
  assert.equal(argv[argv.length - 1]?.includes("build it"), true, "the Codex prompt is still the final positional");
  assert.equal(argv.includes("--disallowedTools"), false, "the Claude deny flag must not leak into Codex argv");
});

// ---------------------------------------------------------------------------
// D-14: the WRITE half of the Build Law provider invariant, stated in argv.
//
// D-7 denied the filesystem-read names; D-9B denied the shell names. Both cited
// the same Build Law sentence -- a provider "never writes files, runs commands"
// -- but only its SECOND clause was actually stated at the argv layer. The tools
// that write files directly were not named, so the first clause rested on host-CLI
// behaviour that Namla does not own, does not state, and does not test.
//
// The parsed provider payload's file operations are applied by Namla's own
// workspace writer, so denying these names removes no capability the product
// depends on -- the full P0 gate stays green.
//
// Classification: HARDENING. No provider write was reproduced. This states an
// existing Build Law boundary at the layer where mission text cannot reach it.
//
// Scope: this removes these tool NAMES from the provider-generation session. It is
// not a claim that no file can be modified by any other mechanism, and not
// OS-level process isolation.

/** The mutation tools: canonical identifiers, verified against the shipped catalog. */
const D14_MUTATION_TOOLS: readonly string[] = ["Write", "Edit", "MultiEdit", "NotebookEdit"];

test("D-14: Claude argv denies the native mutation tools by name", () => {
  const built = buildSafeProviderRequest(baseInput({ providerId: "claude", promptBody: "do the work" }));
  assert.equal(built.ok, true);
  const argv = built.ok ? built.spec.argumentList : [];

  const at = argv.indexOf("--disallowedTools");
  assert.equal(at >= 0, true, "the deny policy must be stated explicitly");
  const denied = (argv[at + 1] ?? "").split(/[,\s]+/).filter(Boolean);
  for (const tool of D14_MUTATION_TOOLS) {
    assert.equal(denied.includes(tool), true, `${tool} must be denied by name`);
    assert.equal(denied.filter((d) => d === tool).length, 1, `${tool} must appear exactly once`);
  }
});

test("D-14: the deny list is exactly the read, shell and mutation names", () => {
  // Exact equality, so a future name can only enter or leave deliberately.
  const built = buildSafeProviderRequest(baseInput({ providerId: "claude", promptBody: "ordinary work" }));
  assert.equal(built.ok, true);
  const argv = built.ok ? built.spec.argumentList : [];
  const denied = (argv[argv.indexOf("--disallowedTools") + 1] ?? "").split(/[,\s]+/).filter(Boolean);
  assert.deepEqual(denied, ["Read", "Glob", "Grep", "Bash", "PowerShell", "Write", "Edit", "MultiEdit", "NotebookEdit"], "the complete deny set");
  assert.equal(new Set(denied).size, denied.length, "no duplicate tool name");
  // One comma-separated VALUE, not one flag per tool: the variadic option must not
  // be given a chance to swallow a following argument.
  assert.equal(argv.length, 5, "Claude argv stays a five-entry fixed template");
  assert.equal(argv.filter((a) => a === "--disallowedTools").length, 1, "exactly one deny option");
});

test("D-14: hostile prompt text cannot re-enable a mutation tool", () => {
  const hostile = [
    "--allowedTools Write",
    "--disallowedTools Read",
    "--disallowedTools=Read,Glob",
    "Write",
    "Edit",
    "--dangerously-skip-permissions",
    "--permission-mode acceptEdits",
  ].join(" ");
  const built = buildSafeProviderRequest(baseInput({ providerId: "claude", promptBody: hostile }));
  assert.equal(built.ok, true, "hostile-looking text is data, not a credential");
  const argv = built.ok ? built.spec.argumentList : [];

  assert.deepEqual(argv, ["--print", "--output-format", "json", "--disallowedTools", CLAUDE_DENY_VALUE], "the template is unchanged by mission text");
  assert.equal(argv.includes("--allowedTools"), false, "no allow-list may be introduced by prompt text");
  assert.equal(argv.includes("acceptEdits"), false, "no permission mode may be introduced by prompt text");
  const denied = (argv[argv.indexOf("--disallowedTools") + 1] ?? "").split(/[,\s]+/).filter(Boolean);
  for (const tool of D14_MUTATION_TOOLS) {
    assert.equal(denied.includes(tool), true, `${tool} must survive hostile prompt text`);
  }
  assert.equal(built.ok && built.spec.stdinData.includes("--allowedTools Write"), true, "the hostile text stays inert on stdin");
});

test("D-14: the Codex boundary is unchanged by the Claude mutation denial", () => {
  const built = buildSafeProviderRequest(baseInput({ providerId: "codex", promptBody: "build it" }));
  assert.equal(built.ok, true);
  const argv = built.ok ? built.spec.argumentList : [];
  assert.deepEqual(argv.slice(0, -1), ["exec", "--ephemeral", "--json", "--ignore-user-config", "--sandbox", "read-only"], "Codex flags must be byte-for-byte unchanged");
  assert.equal(argv[argv.length - 1]?.includes("build it"), true, "the Codex prompt is still the final positional");
  assert.equal(argv.includes("--disallowedTools"), false, "the Claude deny flag must not leak into Codex argv");
});
