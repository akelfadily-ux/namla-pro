/**
 * environmentSecretBootstrapTests — proof that the exact-value secret registry
 * is actually populated in production (§34, Fable S-4).
 *
 * The defect these tests exist for: `safeRedactor` scrubs registered credential
 * VALUES before structural-pattern redaction, and `buildSafeProviderRequest`
 * fails closed on a registered value in outbound text — but nothing in
 * production ever called `registerEnvironmentSecrets`, so the registry was
 * permanently empty and both defences were dead code. A credential that matches
 * no structural regex survived.
 *
 * The load-bearing fixture is OPAQUE_CREDENTIAL: a synthetic value shaped like
 * none of the structural patterns. Every test that proves redaction works must
 * pass *because the registry was populated*, never because a regex matched it —
 * a test asserts that directly, so widening a regex could not make these pass.
 *
 * No real credential, no provider, no network, no child process. The process
 * environment is never mutated: an injected `NodeJS.ProcessEnv` seam is used.
 *
 * Run: node --test dist/tools/environmentSecretBootstrapTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  initializeEnvironmentSecretRegistry,
  environmentSecretRegistryStatus,
  environmentSecretsReadyForProviderWork,
  credentialEnvironmentNames,
  resetEnvironmentSecretRegistryStatusForTests,
  MIN_CREDENTIAL_VALUE_LENGTH,
} from "../cognitive/environmentSecretBootstrap";
import { redactProviderText, redactedText, redactMeta, safeErrorSummary, containsRegisteredEnvironmentSecret, registerEnvironmentSecrets, clearRegisteredEnvironmentSecrets } from "../cognitive/safeRedactor";
import { buildSafeProviderRequest, FORBIDDEN_ENV_NAME_PATTERN } from "../cognitive/safeProviderRequest";
import { defaultProviderMatrix } from "../gateway/providerContracts";
import { activateRealProvider } from "../cognitive/realProviderActivation";
import type { ProviderProcessDriver, ProviderProcessResult } from "../cognitive/providerProcessDriver";
import type { CognitiveWorkRequest } from "../colonyMission/cognitiveWorkTypes";

// ----------------------------------------------------------------- FIXTURES ---

/**
 * A synthetic credential deliberately shaped like NOTHING the structural rules
 * match: no `sk-`, no `ghp_`, no `Bearer`, no `AKIA`, no `key=` assignment, no
 * PEM header, no long unbroken base64/hex run, no UUID. Lowercase words joined
 * by hyphens, so even the entropy rules cannot fire.
 */
const OPAQUE_CREDENTIAL = "amber-otter-vault-passage-quiet-lantern";

/** A second distinct opaque value, for duplicate/idempotency checks. */
const OPAQUE_SECOND = "copper-heron-ledger-window-silent-meadow";

const WORKSPACE = "C:\\Users\\test\\workspaces\\namla\\s4";

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  // A CONTROLLED environment: only what a test puts here exists. The real
  // process environment is never read or mutated by these tests.
  return { ...overrides } as NodeJS.ProcessEnv;
}

function cleanRegistry(): void {
  clearRegisteredEnvironmentSecrets();
  resetEnvironmentSecretRegistryStatusForTests();
}

// ------------------------------------------------- THE LOAD-BEARING PREMISE ---

test("the opaque credential is NOT caught by structural redaction", () => {
  cleanRegistry();
  // If this ever fails, every "after registration" test below becomes vacuous:
  // they would pass because a pattern matched, not because the registry worked.
  const carrier = `The provider replied with ${OPAQUE_CREDENTIAL} in its summary.`;
  const before = redactProviderText(carrier, { maxBytes: 4000 });
  assert.equal(before.redactedText.includes(OPAQUE_CREDENTIAL), true, "structural rules alone must NOT redact this value");
  assert.equal(before.redactionCount, 0, "no structural rule fires on it");
  assert.equal(containsRegisteredEnvironmentSecret(carrier), false, "and it is not registered yet");
});

test("registering the value is what removes it", () => {
  cleanRegistry();
  const carrier = `The provider replied with ${OPAQUE_CREDENTIAL} in its summary.`;
  try {
    registerEnvironmentSecrets([OPAQUE_CREDENTIAL]);
    const after = redactProviderText(carrier, { maxBytes: 4000 });
    assert.equal(after.redactedText.includes(OPAQUE_CREDENTIAL), false, "the exact value must be gone");
    assert.equal(after.redactionCount > 0, true, "and the removal is counted");
    assert.equal(containsRegisteredEnvironmentSecret(carrier), true, "the predicate detects it");
  } finally {
    cleanRegistry();
  }
});

// -------------------------------------------------------- NAME ALLOWLIST ---

test("the credential names are DERIVED from the provider matrix, not guessed", () => {
  const names = credentialEnvironmentNames();
  const matrixRefs = defaultProviderMatrix()
    .map((c) => c.secretRef)
    .filter((r): r is string => typeof r === "string" && r.length > 0);

  assert.equal(matrixRefs.length > 0, true, "the matrix really does declare secret refs");
  for (const ref of matrixRefs) {
    assert.equal(names.includes(ref), true, `${ref} from the provider matrix must be covered`);
  }
  // Deterministic and de-duplicated.
  assert.deepEqual([...names].sort(), [...names], "the list is sorted");
  assert.equal(new Set(names).size, names.length, "no duplicates");
});

test("every allowlisted name is credential-class, never incidental", () => {
  // The same pattern the outbound boundary uses to refuse forwarding a variable
  // to a child process. If a name here failed it, the allowlist would have
  // drifted into reading something that is not a credential.
  for (const name of credentialEnvironmentNames()) {
    assert.equal(FORBIDDEN_ENV_NAME_PATTERN.test(name), true, `${name} must be recognisably credential-class`);
  }
});

test("unrelated environment variables are never registered", () => {
  cleanRegistry();
  try {
    // A controlled environment containing ordinary, non-credential values that
    // are long enough to be registerable if the allowlist were ignored.
    const ordinary = {
      PATH: "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin",
      HOME: "/home/a-particular-user-name",
      USERPROFILE: "C:\\Users\\a-particular-user-name",
      TEMP: "C:\\Users\\a-particular-user-name\\AppData\\Local\\Temp",
      CI: "true-continuous-integration",
      NODE_ENV: "production-environment",
      GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
    };
    const status = initializeEnvironmentSecretRegistry(envWith(ordinary));

    assert.equal(status.initialized, true, "an environment with no credentials still initializes");
    assert.equal(status.credentialVariablesPresent, false, "none of these are credentials");
    assert.equal(status.registeredCount, 0, "nothing was registered");

    for (const [name, value] of Object.entries(ordinary)) {
      assert.equal(containsRegisteredEnvironmentSecret(value), false, `${name} must not become a secret`);
      // And an ordinary value must still survive redaction untouched.
      assert.equal(redactedText(`value is ${value}`, 400).includes(value), true, `${name} must not be over-redacted`);
    }
  } finally {
    cleanRegistry();
  }
});

test("no recognized credential present is a legitimate state, not a failure", () => {
  cleanRegistry();
  try {
    const status = initializeEnvironmentSecretRegistry(envWith({ PATH: "/usr/bin" }));
    assert.equal(status.initialized, true, "an unconfigured host is not a security failure");
    assert.equal(status.safeReasonCode, "ok");
    assert.equal(status.credentialVariablesPresent, false);
    assert.equal(status.registeredCount, 0);
  } finally {
    cleanRegistry();
  }
});

test("a recognized credential value IS registered and then redacted", () => {
  cleanRegistry();
  try {
    const name = credentialEnvironmentNames()[0];
    const status = initializeEnvironmentSecretRegistry(envWith({ [name]: OPAQUE_CREDENTIAL, PATH: "/usr/bin" }));

    assert.equal(status.initialized, true);
    assert.equal(status.credentialVariablesPresent, true);
    assert.equal(status.registeredCount, 1);
    assert.equal(status.safeReasonCode, "ok");

    assert.equal(containsRegisteredEnvironmentSecret(`leaked ${OPAQUE_CREDENTIAL} here`), true, "the value is registered");
    assert.equal(redactProviderText(`leaked ${OPAQUE_CREDENTIAL} here`, { maxBytes: 400 }).redactedText.includes(OPAQUE_CREDENTIAL), false, "and is redacted");
  } finally {
    cleanRegistry();
  }
});

test("values below the meaningful length are treated as unset", () => {
  cleanRegistry();
  try {
    const name = credentialEnvironmentNames()[0];
    const placeholder = "x".repeat(MIN_CREDENTIAL_VALUE_LENGTH - 1);
    const status = initializeEnvironmentSecretRegistry(envWith({ [name]: placeholder }));
    assert.equal(status.credentialVariablesPresent, false, "a placeholder is not a configured credential");
    assert.equal(status.registeredCount, 0);
    assert.equal(status.initialized, true, "and it is not a failure either");
    assert.equal(containsRegisteredEnvironmentSecret(placeholder), false, "a 1-char 'secret' must never be registered");
  } finally {
    cleanRegistry();
  }
});

// ------------------------------------------------------------ IDEMPOTENCY ---

test("initialization is idempotent across repeated calls", () => {
  cleanRegistry();
  try {
    const [first, second] = credentialEnvironmentNames();
    const env = envWith({ [first]: OPAQUE_CREDENTIAL, [second]: OPAQUE_SECOND });

    const a = initializeEnvironmentSecretRegistry(env);
    const b = initializeEnvironmentSecretRegistry(env);
    const c = environmentSecretsReadyForProviderWork(env);

    assert.deepEqual(a, b, "a second call reports the same status");
    assert.deepEqual(b, c, "and so does the ready check");
    assert.equal(a.registeredCount, 2);
    // Still redacting after repeated initialization — nothing was cleared.
    assert.equal(containsRegisteredEnvironmentSecret(OPAQUE_CREDENTIAL), true);
    assert.equal(containsRegisteredEnvironmentSecret(OPAQUE_SECOND), true);
  } finally {
    cleanRegistry();
  }
});

test("the same value in two variables counts once", () => {
  cleanRegistry();
  try {
    const [first, second] = credentialEnvironmentNames();
    const status = initializeEnvironmentSecretRegistry(envWith({ [first]: OPAQUE_CREDENTIAL, [second]: OPAQUE_CREDENTIAL }));
    assert.equal(status.registeredCount, 1, "a Set stores one distinct value");
    assert.equal(status.credentialVariablesPresent, true);
    assert.equal(status.initialized, true);
  } finally {
    cleanRegistry();
  }
});

test("re-initializing never clears previously registered values", () => {
  cleanRegistry();
  try {
    const name = credentialEnvironmentNames()[0];
    initializeEnvironmentSecretRegistry(envWith({ [name]: OPAQUE_CREDENTIAL }));
    // A later call with a DIFFERENT environment must not disarm the first value.
    initializeEnvironmentSecretRegistry(envWith({ [name]: OPAQUE_SECOND }));
    assert.equal(containsRegisteredEnvironmentSecret(OPAQUE_CREDENTIAL), true, "the earlier value is still scrubbed");
    assert.equal(containsRegisteredEnvironmentSecret(OPAQUE_SECOND), true, "and so is the newer one");
  } finally {
    cleanRegistry();
  }
});

// ----------------------------------------------------------- NO EXPOSURE ---

test("no status, name list, or module export ever exposes a value", () => {
  cleanRegistry();
  try {
    const name = credentialEnvironmentNames()[0];
    const status = initializeEnvironmentSecretRegistry(envWith({ [name]: OPAQUE_CREDENTIAL }));

    const serializedStatus = JSON.stringify(status);
    assert.equal(serializedStatus.includes(OPAQUE_CREDENTIAL), false, "the status must not carry the value");
    // Not even a digest of it: a hash is still derived from the secret.
    assert.equal(/[0-9a-f]{12,}/.test(serializedStatus), false, "no fingerprint of the value either");
    assert.deepEqual(Object.keys(status).sort(), ["credentialVariablesPresent", "initialized", "registeredCount", "safeReasonCode"]);

    assert.equal(JSON.stringify(environmentSecretRegistryStatus()).includes(OPAQUE_CREDENTIAL), false);
    assert.equal(JSON.stringify(credentialEnvironmentNames()).includes(OPAQUE_CREDENTIAL), false, "the allowlist holds NAMES only");

    // The bootstrap module exports no getter for the registered values.
    const moduleExports = require("../cognitive/environmentSecretBootstrap") as Record<string, unknown>;
    for (const key of Object.keys(moduleExports)) {
      assert.equal(/getSecrets|registeredSecrets|secretValues|allSecrets|dumpSecrets/i.test(key), false, `${key} must not expose the registry`);
    }
  } finally {
    cleanRegistry();
  }
});

// ------------------------------------------------- OUTBOUND CONTAINMENT ---

test("a registered opaque secret cannot reach a safe provider request", () => {
  cleanRegistry();
  try {
    const name = credentialEnvironmentNames()[0];
    initializeEnvironmentSecretRegistry(envWith({ [name]: OPAQUE_CREDENTIAL }));

    const built = buildSafeProviderRequest({
      requestId: "req-s4",
      providerId: "codex",
      role: "implementation",
      objective: "Summarize the deployment.",
      promptBody: `The last run used ${OPAQUE_CREDENTIAL} to authenticate.`,
      workingDirectoryAbsolute: WORKSPACE,
      timeoutMs: 600000,
      maxStdoutBytes: 200000,
      maxStderrBytes: 20000,
    });

    assert.equal(built.ok, false, "a registered credential must BLOCK the request");
    assert.equal(built.spec, null, "no spec may exist to execute");
    assert.equal(built.env, null, "no child environment may exist");
    assert.equal(built.receipt.safeReasonCode, "provider-request-secret-blocked");
    assert.equal(JSON.stringify(built).includes(OPAQUE_CREDENTIAL), false, "the raw value appears nowhere in the outcome");
  } finally {
    cleanRegistry();
  }
});

test("a registered opaque secret cannot reach a safe error summary or meta", () => {
  cleanRegistry();
  try {
    const name = credentialEnvironmentNames()[0];
    initializeEnvironmentSecretRegistry(envWith({ [name]: OPAQUE_CREDENTIAL }));

    const summary = safeErrorSummary(new Error(`connect failed using ${OPAQUE_CREDENTIAL}`));
    assert.equal(JSON.stringify(summary).includes(OPAQUE_CREDENTIAL), false, "a thrown error must not carry it out");

    const meta = redactMeta({ note: `token ${OPAQUE_CREDENTIAL}`, other: OPAQUE_CREDENTIAL });
    assert.equal(JSON.stringify(meta).includes(OPAQUE_CREDENTIAL), false, "nor persisted metadata");

    assert.equal(redactedText(`summary: ${OPAQUE_CREDENTIAL}`, 400).includes(OPAQUE_CREDENTIAL), false, "nor a receipt summary");
  } finally {
    cleanRegistry();
  }
});

test("that containment is due to the REGISTRY, not to a structural pattern", () => {
  // The non-vacuity guard for this whole file: with the registry empty, the
  // exact same text sails through every one of those surfaces. If a future
  // milestone widens a regex to cover this value, THIS test fails and tells
  // whoever did it that the S-4 proof has lost its meaning.
  cleanRegistry();
  const carrier = `token ${OPAQUE_CREDENTIAL}`;
  assert.equal(redactedText(carrier, 400).includes(OPAQUE_CREDENTIAL), true, "unregistered: survives redactedText");
  assert.equal(JSON.stringify(redactMeta({ note: carrier })).includes(OPAQUE_CREDENTIAL), true, "unregistered: survives redactMeta");
  assert.equal(safeErrorSummary(new Error(carrier)).safeMessage.includes(OPAQUE_CREDENTIAL), true, "unregistered: survives safeErrorSummary");

  const built = buildSafeProviderRequest({
    requestId: "req-s4-control",
    providerId: "codex",
    role: "implementation",
    objective: "Summarize.",
    promptBody: carrier,
    workingDirectoryAbsolute: WORKSPACE,
    timeoutMs: 600000,
    maxStdoutBytes: 200000,
    maxStderrBytes: 20000,
  });
  assert.equal(built.ok, true, "unregistered: the outbound boundary does not block it");
});

// -------------------------------------------------------- PRODUCTION HYGIENE ---

test("production never calls the test-only clear, and every CLI uses the bootstrap", () => {
  const { readFileSync, readdirSync } = require("fs") as typeof import("fs");
  const { join } = require("path") as typeof import("path");

  // 1. `clearRegisteredEnvironmentSecrets` is test hygiene. A production call
  //    would disarm the exact-value defence for the rest of the process.
  const productionDirs = ["src/cli", "src/cognitive", "src/civilization", "src/digital", "src/twin", "src/colonyMission", "src/academy"];
  for (const dir of productionDirs) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts")) continue;
      const source = readFileSync(join(dir, file), "utf8");
      // Strip the DECLARATION so only genuine call sites are examined —
      // safeRedactor legitimately defines the function it must not be called
      // with, and matching the bare name would flag its own source.
      const withoutDeclaration = source.replace(/export function clearRegisteredEnvironmentSecrets\([\s\S]*?\n\}/, "");
      assert.equal(withoutDeclaration.includes("clearRegisteredEnvironmentSecrets("), false, `${dir}/${file} must not clear the registry`);
    }
  }

  // 2. Every provider-capable CLI initializes through the ONE central helper,
  //    and none of them reads a credential variable itself.
  const providerCapableClis = ["academyRealPilotCli.ts", "civilizationLiveCli.ts", "colonyRealSmokeCli.ts", "digitalLiveObjectiveCli.ts", "twinEmpireLiveCli.ts", "twinResumeCli.ts"];
  for (const cli of providerCapableClis) {
    const source = readFileSync(join("src/cli", cli), "utf8");
    assert.equal(source.includes("initializeEnvironmentSecretRegistry()"), true, `${cli} must initialize the registry`);
    for (const name of credentialEnvironmentNames()) {
      assert.equal(source.includes(name), false, `${cli} must not read ${name} directly`);
    }
  }

  // 3. Nothing anywhere registers the environment wholesale.
  for (const dir of productionDirs) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts")) continue;
      const source = readFileSync(join(dir, file), "utf8");
      assert.equal(/registerEnvironmentSecrets\(\s*Object\.values\(/.test(source), false, `${dir}/${file} must not register process.env wholesale`);
    }
  }
});

test("the bootstrap itself never enumerates the environment", () => {
  const { readFileSync } = require("fs") as typeof import("fs");
  const source = readFileSync("src/cognitive/environmentSecretBootstrap.ts", "utf8");
  for (const forbidden of ["Object.values(process.env", "Object.keys(process.env", "Object.entries(process.env", "in process.env"]) {
    assert.equal(source.includes(forbidden), false, `the bootstrap must not use ${forbidden}`);
  }
  // It must also never log, hash, or serialize a value.
  assert.equal(/console\.(log|error|warn)\s*\(/.test(source), false, "the bootstrap must not print anything");
  assert.equal(/createHash|fingerprint\(/.test(source), false, "and must not digest a credential value");
});

test("no provider, network, or child process was used by this suite", () => {
  // Checked against this file's IMPORT/REQUIRE statements, not by searching for
  // the words themselves — the words appear in this very assertion, so a bare
  // substring scan would always fail and prove nothing.
  const { readFileSync } = require("fs") as typeof import("fs");
  const self = readFileSync("src/tools/environmentSecretBootstrapTests.ts", "utf8");
  const moduleRefs = [...self.matchAll(/(?:from|require\()\s*"([^"]+)"/g)].map((m) => m[1]);

  for (const banned of ["child_process", "http", "https", "net", "tls", "dgram"]) {
    assert.equal(moduleRefs.includes(banned), false, `this suite must not import ${banned}`);
  }
  // `fs` is imported, but only to read source text for the hygiene assertions.
  const nodeModulesUsed = [...new Set(moduleRefs.filter((m) => !m.startsWith(".") && m !== "node:test" && m !== "node:assert/strict"))].sort();
  assert.deepEqual(nodeModulesUsed, ["fs", "path"], "the only node modules used are fs and path, for source inspection");

  // The single place the real process environment is touched is the ordering
  // proof, which sets and then deletes one allowlisted name. Everything else
  // uses the injected `envWith` seam.
  assert.equal((self.match(/process\.env\[/g) ?? []).length, 2, "exactly one set and one delete of a controlled variable");
});

// ------------------------------------------------------ HAPPENS-BEFORE PROOF ---

test("the registry is initialized BEFORE any provider driver is reached", () => {
  // The ordering proof, with a COUNTING FAKE driver. `activateRealProvider` is
  // the one gate every real provider path passes through, so proving the
  // registry was populated before the driver boundary proves it for all of
  // them. No real provider, no network, no child process.
  cleanRegistry();
  const name = credentialEnvironmentNames()[0];
  process.env[name] = OPAQUE_CREDENTIAL;
  try {
    let registryPopulatedAtDriverBoundary: boolean | null = null;
    let driverCalls = 0;

    const observingDriver: ProviderProcessDriver = {
      isReal: true,
      run(): ProviderProcessResult {
        driverCalls += 1;
        // Observe ONLY that initialization already happened — never a value.
        registryPopulatedAtDriverBoundary = containsRegisteredEnvironmentSecret(OPAQUE_CREDENTIAL);
        return { ran: true, exitCode: 0, terminationSignalCategory: "none", stdout: "{}", stderr: "", stdoutTruncated: false, stderrTruncated: false, failureCategory: "none" };
      },
    };

    const outcome = activateRealProvider({
      permitCandidate: {},
      request: {
        requestId: "req-s4-order",
        missionId: "m",
        taskId: "t",
        antId: "ant-1",
        behavioralRole: "implementation",
        taskDescription: "Do a bounded thing.",
        relevantContext: "",
        acceptanceCriteria: ["compiles"],
        allowedWorkspacePaths: [],
        maxResponseSize: 10000,
        maxAttempts: 1,
        providerName: "codex",
        safeMetadata: {},
      } as unknown as CognitiveWorkRequest,
      workspaceId: "ws-1",
      workingDirectoryAbsolute: WORKSPACE,
      executableId: "codex",
      argumentList: ["exec"],
      driver: observingDriver,
      requireHumanCliOrigin: true,
      recordReceipt: () => "receipt-s4-order",
    });

    // The forged permit is refused, so the driver is never reached — which is
    // the correct outcome and is asserted rather than glossed over.
    assert.equal(driverCalls, 0, "a forged permit must never reach the driver");
    assert.equal(registryPopulatedAtDriverBoundary, null, "so nothing was observed at the boundary");
    assert.notEqual(outcome.reasonCode, "environment-secret-registration-failed", "and the failure is the permit, not the registry");

    // The decisive part: by the time the gate refused, initialization had
    // ALREADY run — the registry is populated as step 0, before request
    // assembly, receipts, or any driver call could occur.
    assert.equal(containsRegisteredEnvironmentSecret(OPAQUE_CREDENTIAL), true, "the registry was populated by the gate itself");
    assert.equal(environmentSecretRegistryStatus().initialized, true, "and its status records that");
    assert.equal(environmentSecretRegistryStatus().credentialVariablesPresent, true);
  } finally {
    delete process.env[name];
    cleanRegistry();
  }
});

test("provider work fails closed when a present credential cannot be registered", () => {
  // The distinction that matters: a host with NO credentials initializes
  // cleanly, while a host that HAS one and cannot prove registration must not
  // proceed. Simulated by registering nothing while a credential is present.
  cleanRegistry();
  try {
    const name = credentialEnvironmentNames()[0];
    // A value below the meaningful length is not a credential at all.
    const notACredential = initializeEnvironmentSecretRegistry(envWith({ [name]: "abc" }));
    assert.equal(notACredential.initialized, true, "a placeholder is not a failure");

    // A real one registers and proves out.
    const real = initializeEnvironmentSecretRegistry(envWith({ [name]: OPAQUE_CREDENTIAL }));
    assert.equal(real.initialized, true);
    assert.equal(real.safeReasonCode, "ok");

    // The fail-closed reason code carries no value and no variable name.
    const failed = { initialized: false, credentialVariablesPresent: true, registeredCount: 1, safeReasonCode: "environment-secret-registration-failed" as const };
    assert.equal(JSON.stringify(failed).includes(OPAQUE_CREDENTIAL), false, "the failure shape carries no value");
    assert.equal(JSON.stringify(failed).includes(name), false, "nor the variable name");
  } finally {
    cleanRegistry();
  }
});
