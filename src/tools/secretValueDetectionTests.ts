/**
 * secretValueDetectionTests — proof that a secret VALUE is refused, not just a
 * secret NOUN (§37, Fable S-7).
 *
 * Two connected failures, measured at the previous commit before any fix:
 *
 *   1. `looksLikeSecret` returned FALSE for all nine credential shapes below —
 *      including every family `safeRedactor` already recognised — while
 *      returning TRUE for the sentence "the token expires". It read names, not
 *      values, so every consumer of the policy inherited that blind spot.
 *   2. `ReceiptLog.create` validated `params.summary` and stored `details`
 *      untouched, so a live credential in a diagnostic field entered receipts
 *      and downstream colony state.
 *
 * Every credential is SYNTHETIC and assembled at RUNTIME from harmless
 * fragments. GitHub push protection blocked an earlier milestone for committing
 * contiguous credential literals, so no complete credential-looking string
 * exists in this source. The assembled values carry the exact real shapes.
 *
 * Run: node --test dist/tools/secretValueDetectionTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { looksLikeSecret, assertNotSecret } from "../policies/secretProtectionPolicy";
import { containsSecretValue, detectResidualSecrets, registerEnvironmentSecrets, clearRegisteredEnvironmentSecrets, REDACTION_MARKERS } from "../cognitive/safeRedactor";
import { ReceiptLog } from "../core/receiptLog";
import { ColonyMemory } from "../core/colonyMemory";
import { isPheromonePayloadSafe, assertPheromoneSafe } from "../policies/pheromoneSafetyPolicy";

// ----------------------------------------------------------------- FIXTURES ---

/** Assemble a synthetic credential at runtime; no contiguous literal is committed. */
function joinCredential(...parts: readonly string[]): string {
  return parts.join("");
}

const SK_PROVIDER = joinCredential("sk", "-proj-", "AbCdEf0123456789", "AbCdEf0123456789");
const GITHUB = joinCredential("ghp", "_", "AbCdEf0123456789", "AbCdEf0123456789");
const AWS = joinCredential("AKIA", "IOSFODNN", "7EXAMPLE");
const STRIPE = joinCredential("sk", "_live_", "51H8xQ2KlMnOpQrSt", "UvWxYz0123456789abcd");
const SLACK = joinCredential("xox", "b-", "2401234567890-", "2409876543210-", "AbCdEfGhIjKlMnOpQrStUvWx");
const GOOGLE = joinCredential("AIza", "SyD1234567890", "abcdefghijklmnopqrstuv");
const NPM = joinCredential("npm", "_", "AbCdEfGhIjKlMnOpQrSt", "UvWxYz0123456789ab");
const GITLAB = joinCredential("glpat", "-", "AbCdEfGhIjKlMnOpQr");
const JWT = joinCredential("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkEgQiJ9", ".", "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");

/** An opaque value matching NO structural rule — the S-4 registry's whole point. */
const OPAQUE = joinCredential("amber-otter-", "vault-passage-", "quiet-lantern");

const FAMILIES: ReadonlyArray<readonly [string, string]> = [
  ["sk-* provider credential", SK_PROVIDER],
  ["GitHub token", GITHUB],
  ["AWS access key", AWS],
  ["Stripe key", STRIPE],
  ["Slack token", SLACK],
  ["Google API key", GOOGLE],
  ["npm token", NPM],
  ["GitLab token", GITLAB],
  ["JWT", JWT],
];

// ------------------------------------------------- VALUE DETECTION (S-7 CORE) ---

test("every credential SHAPE is recognised as a secret value", () => {
  for (const [label, credential] of FAMILIES) {
    assert.equal(containsSecretValue(credential), true, `${label}: canonical predicate must detect it`);
    assert.equal(looksLikeSecret(credential), true, `${label}: looksLikeSecret must return true`);
    // Embedded in prose, not just standalone.
    assert.equal(looksLikeSecret(`the deployment used ${credential} yesterday`), true, `${label}: must be found inside prose`);
  }
});

test("JWT is detected through the canonical boundary, not a local regex", () => {
  // The audit named JWTs explicitly and measurement showed the canonical
  // detector returned [] for one, so a structural rule was added to
  // safeRedactor rather than to the policy module.
  assert.deepEqual([...detectResidualSecrets(JWT)], ["JWT"], "the canonical detector classifies it");
  assert.equal(looksLikeSecret(JWT), true);
});

test("ordinary dotted text is not mistaken for a JWT", () => {
  const notJwts = ["a.b.c", "version 1.2.3", "file.name.ext", "some.dotted.identifier.chain", "2026-08-13T10:00:00.000Z", joinCredential("eyJ", ".short.x")];
  for (const text of notJwts) {
    assert.equal(containsSecretValue(text), false, `${text} must not be a secret value`);
    assert.deepEqual([...detectResidualSecrets(text)], [], `${text} must match no rule`);
  }
});

test("the existing lexical noun rules are PRESERVED, not replaced", () => {
  // S-7 ADDS value detection. The noun rules stay exactly as they were; their
  // over-inclusiveness is a separate, later concern.
  for (const nounText of ["the token expires", "store the password", "a secret plan", "read the credentials", "api key rotation", "check the .env file"]) {
    assert.equal(looksLikeSecret(nounText), true, `noun rule must still fire on: ${nounText}`);
  }
  // And these carry neither a noun nor a value.
  for (const clean of ["the build finished successfully", "six tasks processed", "review completed with no findings"]) {
    assert.equal(looksLikeSecret(clean), false, `must stay false: ${clean}`);
    assert.equal(containsSecretValue(clean), false, `must carry no value: ${clean}`);
  }
});

test("already-redacted markers are not reported as raw secret values", () => {
  // A marker is SAFE output. It must never be classified as a raw credential
  // merely because the category label contains the word TOKEN or SECRET.
  for (const marker of Object.values(REDACTION_MARKERS)) {
    assert.equal(containsSecretValue(marker), false, `${marker} is redacted output, not a raw value`);
    assert.deepEqual([...detectResidualSecrets(marker)], [], `${marker} must match no rule`);
  }
});

// ----------------------------------------------- S-4 EXACT-REGISTRY INTEGRATION ---

test("an opaque registered secret is detected ONLY after registration", () => {
  // Load-bearing: proves S-7 is wired to the S-4 registry and not merely to
  // regexes. The fixture matches no structural rule in either state.
  clearRegisteredEnvironmentSecrets();
  try {
    assert.deepEqual([...detectResidualSecrets(OPAQUE)], [], "the fixture must match no structural rule");
    assert.equal(containsSecretValue(OPAQUE), false, "before registration: not a secret value");
    assert.equal(looksLikeSecret(OPAQUE), false, "before registration: not secret-shaped by name either");

    registerEnvironmentSecrets([OPAQUE]);
    assert.equal(containsSecretValue(OPAQUE), true, "after registration: detected by exact value");
    assert.equal(looksLikeSecret(OPAQUE), true, "after registration: the policy sees it too");
  } finally {
    clearRegisteredEnvironmentSecrets();
  }
});

// ------------------------------------------------------ RECEIPT DETAILS (S-7) ---

function freshLog(): ReceiptLog {
  return new ReceiptLog();
}

test("a secret value directly in details is refused", () => {
  const log = freshLog();
  assert.throws(
    () => log.create({ summary: "provider attempt recorded", status: "completed", details: { diagnostic: STRIPE } }),
    /details contain a secret value/,
  );
  assert.deepEqual(log.list(), [], "nothing may be stored");
});

test("a secret value nested in an object is refused", () => {
  const log = freshLog();
  assert.throws(() => log.create({ summary: "nested", status: "completed", details: { outer: { inner: { credential: GITHUB } } } }), /secret value/);
  assert.deepEqual(log.list(), []);
});

test("a secret value inside an array is refused", () => {
  const log = freshLog();
  assert.throws(() => log.create({ summary: "array", status: "completed", details: { items: ["safe", AWS, "also safe"] } }), /secret value/);
  assert.deepEqual(log.list(), []);
});

test("a deeply nested secret value, and one in a nested array, are refused", () => {
  const deep = freshLog();
  assert.throws(() => deep.create({ summary: "deep", status: "completed", details: { a: { b: { c: { d: SLACK } } } } }), /secret value/);
  assert.deepEqual(deep.list(), []);

  const nestedArray = freshLog();
  assert.throws(() => nestedArray.create({ summary: "nested array", status: "completed", details: { rows: [[{ token: JWT }]] } }), /secret value/);
  assert.deepEqual(nestedArray.list(), []);
});

test("a secret value used as an object KEY is refused", () => {
  const log = freshLog();
  assert.throws(() => log.create({ summary: "key", status: "completed", details: { [GOOGLE]: "value" } }), /secret value/);
  assert.deepEqual(log.list(), []);
});

test("a registered opaque secret in details is refused", () => {
  clearRegisteredEnvironmentSecrets();
  try {
    const before = freshLog();
    // Not registered yet: this is ordinary text and must be accepted.
    const ok = before.create({ summary: "diagnostic recorded", status: "completed", details: { diagnostic: OPAQUE } });
    assert.equal(ok.receiptId, "receipt-1", "unregistered opaque text is ordinary data");

    registerEnvironmentSecrets([OPAQUE]);
    const after = freshLog();
    assert.throws(() => after.create({ summary: "diagnostic recorded", status: "completed", details: { diagnostic: OPAQUE } }), /secret value/);
    assert.deepEqual(after.list(), [], "registered value must be refused");
  } finally {
    clearRegisteredEnvironmentSecrets();
  }
});

test("ordinary details are still accepted, including the noun 'token'", () => {
  const log = freshLog();
  // Receipt details protection targets VALUES. A diagnostic that mentions a
  // token by name stays useful — over-refusing here would gut the audit trail.
  const receipt = log.create({
    summary: "verification completed",
    status: "completed",
    details: { note: "the token expires in 30 days", counts: { passed: 12, failed: 0 }, flags: [true, false], nothing: null, missing: undefined },
  });
  assert.equal(receipt.receiptId, "receipt-1");
  assert.equal(log.list().length, 1);
});

// ------------------------------------------------------- FAIL BEFORE MUTATION ---

test("a refused receipt consumes no id and leaves the log empty", () => {
  const log = freshLog();
  assert.throws(() => log.create({ summary: "attempt", status: "completed", details: { creds: { key: STRIPE } } }), /secret value/);
  assert.deepEqual(log.list(), [], "list stays empty after refusal");

  // The decisive assertion: the sequence did not advance.
  const first = log.create({ summary: "clean receipt", status: "completed" });
  assert.equal(first.receiptId, "receipt-1", "a rejected secret must not consume receipt-1");
  assert.equal(log.list().length, 1);
});

test("a refused SUMMARY also consumes no id", () => {
  const log = freshLog();
  assert.throws(() => log.create({ summary: `leaked ${GITHUB}`, status: "failed" }), /looks like a secret/);
  assert.deepEqual(log.list(), []);
  assert.equal(log.create({ summary: "clean", status: "completed" }).receiptId, "receipt-1");
});

// ----------------------------------------------------- ADVERSARIAL DETAILS ---

test("non-JSON-like details fail closed rather than being scanned incompletely", () => {
  // Measured across all 41 demos: 379 create() calls produced only strings,
  // numbers, booleans, null, undefined, plain objects and arrays. Anything
  // else could hide state this walk would never see, so it is refused.
  const cyclic: Record<string, unknown> = { name: "loop" };
  cyclic.self = cyclic;

  const cases: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ["cyclic reference", cyclic],
    ["Date instance", { when: new Date(0) }],
    ["Error instance", { failure: new Error("boom") }],
    ["Map instance", { m: new Map([["k", "v"]]) }],
    ["function value", { fn: () => "x" }],
    ["symbol value", { s: Symbol("x") as unknown as string }],
    ["bigint value", { b: BigInt(1) as unknown as number }],
  ];
  for (const [label, details] of cases) {
    const log = freshLog();
    assert.throws(() => log.create({ summary: "adversarial", status: "completed", details }), /not plain JSON-like data/, `${label} must fail closed`);
    assert.deepEqual(log.list(), [], `${label}: nothing stored`);
  }
});

test("a getter in details is never invoked", () => {
  let invoked = 0;
  const details: Record<string, unknown> = {};
  Object.defineProperty(details, "lazy", {
    enumerable: true,
    get() {
      invoked += 1;
      return STRIPE;
    },
  });

  const log = freshLog();
  assert.throws(() => log.create({ summary: "getter", status: "completed", details }), /not plain JSON-like data/);
  assert.equal(invoked, 0, "scanning must not execute caller code");
  assert.deepEqual(log.list(), []);
});

test("a repeated (non-cyclic) reference is still accepted", () => {
  // Sharing one object twice is ordinary, not adversarial: the seen-set must
  // not turn a diamond into a false cycle.
  const shared = { status: "ok" };
  const log = freshLog();
  const receipt = log.create({ summary: "shared", status: "completed", details: { a: shared, b: shared } });
  assert.equal(receipt.receiptId, "receipt-1");
});

// ------------------------------------------------------------- NO LEAKAGE ---

test("no raw credential appears in a thrown error or in stored receipts", () => {
  const log = freshLog();
  for (const [label, credential] of FAMILIES) {
    let message = "";
    try {
      log.create({ summary: "attempt", status: "completed", details: { d: credential } });
      assert.fail(`${label} should have been refused`);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.equal(message.includes(credential), false, `${label}: the error must not carry the value`);
    assert.equal(message.includes(credential.slice(0, 12)), false, `${label}: nor a prefix of it`);
    assert.equal(/[0-9a-f]{12,}/.test(message), false, `${label}: nor a digest`);
  }
  assert.deepEqual(log.list(), [], "nothing was stored throughout");
  assert.equal(JSON.stringify(log.list()).includes(STRIPE), false);
});

test("assertNotSecret refuses a value and names no value", () => {
  let message = "";
  try {
    assertNotSecret(`use ${AWS} to deploy`, "unit test");
    assert.fail("must throw");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.equal(message.includes(AWS), false, "the error must not carry the credential");
  assert.equal(message.includes("unit test"), true, "but must name the context");
});

// ------------------------------------------------- DOWNSTREAM CONSUMERS ---

test("downstream consumers of the shared policy now refuse a credential VALUE", () => {
  // These previously relied on noun detection alone, so a bare credential
  // passed straight through each of them.
  const memory = new ColonyMemory();
  assert.throws(
    () => memory.remember({ scope: "colony", kind: "fact", content: `key ${STRIPE}`, createdByAntId: "ant-1" } as never),
    /secret/i,
    "ColonyMemory must refuse a credential value",
  );
  // And ordinary content is still remembered.
  const entry = memory.remember({ scope: "colony", kind: "fact", content: "the build finished", createdByAntId: "ant-1" } as never);
  assert.equal(typeof entry, "object", "ordinary content is still accepted");

  assert.equal(isPheromonePayloadSafe({ note: GITHUB }), false, "a payload carrying a credential is unsafe");
  assert.equal(isPheromonePayloadSafe({ note: "ordinary status" }), true, "an ordinary payload stays safe");
  assert.throws(() => assertPheromoneSafe("deploy", { note: JWT }), /refused/, "the bus gate refuses a credential");

  const log = freshLog();
  assert.throws(() => log.create({ summary: `token ${JWT}`, status: "failed" }), /looks like a secret/);
});

// ================================================ MARKER SHIELDING (§37) ====
// A marker is what redaction PRODUCES. Scanning it would make the pipeline
// report its own safe output as a finding. Measured before shielding, 9 of the
// 14 markers returned true from `looksLikeSecret` via the lexical noun path.

test("no redaction marker is a secret, by value OR by name", () => {
  for (const [category, marker] of Object.entries(REDACTION_MARKERS)) {
    assert.equal(containsSecretValue(marker), false, `${category}: a marker is not a raw value`);
    assert.equal(looksLikeSecret(marker), false, `${category}: a marker must not trip the noun rules either`);
  }
});

test("a marker inside ordinary prose stays safe", () => {
  for (const marker of Object.values(REDACTION_MARKERS)) {
    assert.equal(looksLikeSecret(`normal diagnostic ${marker}`), false, `redacted output must stay safe: ${marker}`);
  }
  assert.equal(looksLikeSecret("verification completed [REDACTED:GITHUB_TOKEN]"), false);
  assert.equal(looksLikeSecret("two findings: [REDACTED:JWT] and [REDACTED:STRIPE_KEY]"), false);
});

test("a genuine secret noun OUTSIDE a marker is still detected", () => {
  // Shielding must not become a blanket exemption: only the marker text is
  // removed, so surrounding prose keeps its meaning.
  assert.equal(looksLikeSecret("the token expires [REDACTED:GITHUB_TOKEN]"), true);
  assert.equal(looksLikeSecret("[REDACTED:JWT] then the password rotates"), true);
  assert.equal(looksLikeSecret("[REDACTED:COOKIE] read from .env.local"), true);
});

test("a raw credential beside a marker is still detected", () => {
  for (const [label, credential] of FAMILIES) {
    assert.equal(looksLikeSecret(`${credential} [REDACTED:GITHUB_TOKEN]`), true, `${label}: a raw value beside a marker must still be caught`);
  }
});

// =========================================== DETACHED DETAILS SNAPSHOT ======
// Scanning `details` and then storing the caller's reference was necessary but
// not sufficient: the receipt held a live object, so mutating it after
// `create()` changed the stored record. Measured before this change, a
// credential injected into a nested caller object AFTER creation appeared in
// `JSON.stringify(log.list())`.

test("mutating the original details after create cannot alter the receipt", () => {
  const log = freshLog();
  const details: Record<string, unknown> = { diagnostic: "ordinary" };
  log.create({ summary: "ordinary action", status: "completed", details });

  details.diagnostic = STRIPE;
  assert.equal(JSON.stringify(log.list()).includes(STRIPE), false, "a later mutation must not reach the stored receipt");
  assert.equal((log.list()[0].details as Record<string, unknown>).diagnostic, "ordinary", "the receipt keeps what was validated");
});

test("mutating a NESTED original object after create cannot alter the receipt", () => {
  const log = freshLog();
  const nested: Record<string, unknown> = { diagnostic: "ordinary" };
  log.create({ summary: "ordinary action", status: "completed", details: { nested } });

  nested.diagnostic = GITHUB;
  assert.equal(JSON.stringify(log.list()).includes(GITHUB), false, "nested mutation must not reach the stored receipt");
});

test("mutating an original ARRAY after create cannot alter the receipt", () => {
  const log = freshLog();
  const rows: unknown[] = ["safe"];
  log.create({ summary: "ordinary action", status: "completed", details: { rows } });

  rows[0] = JWT;
  rows.push(AWS);
  const serialized = JSON.stringify(log.list());
  assert.equal(serialized.includes(JWT), false, "element replacement must not reach the log");
  assert.equal(serialized.includes(AWS), false, "an appended element must not reach the log");
  assert.deepEqual((log.list()[0].details as { rows: unknown[] }).rows, ["safe"], "the stored array is the validated one");
});

test("a credential inserted into the original after create never appears in the log", () => {
  const log = freshLog();
  const details: Record<string, unknown> = { rows: [{ note: "safe" }] };
  log.create({ summary: "ordinary", status: "completed", details });

  (details.rows as Array<Record<string, unknown>>)[0].note = STRIPE;
  details.added = GITHUB;
  const serialized = JSON.stringify(log.list());
  assert.equal(serialized.includes(STRIPE), false, "deep mutation must not reach the log");
  assert.equal(serialized.includes(GITHUB), false, "an added key must not reach the log");
});

test("the caller's links object is copied, not referenced", () => {
  const log = freshLog();
  const links = { missionId: "mission-1" };
  log.create({ summary: "ordinary", status: "completed", links });

  links.missionId = "mission-tampered";
  assert.equal(log.list()[0].links.missionId, "mission-1", "links must be detached at creation too");
});

test("freezing reaches the whole stored record and NOTHING the caller owns", () => {
  // The freeze boundary runs exactly along the detachment boundary, in BOTH
  // directions. Freezing a caller's object would be a side effect of logging:
  // passing an object to create() must not silently make it read-only
  // afterwards. Leaving the stored record unfrozen would make the audit log
  // rewritable by anyone who reads it.
  const log = freshLog();
  const nested: Record<string, unknown> = { note: "safe" };
  const rows: unknown[] = ["safe"];
  const details: Record<string, unknown> = { nested, rows, top: "safe" };
  const links = { missionId: "mission-1" };
  const receipt = log.create({ summary: "ordinary", status: "completed", links, details });

  // --- the caller keeps ownership of everything it passed in ---------------
  for (const [label, callerOwned] of [["details", details], ["nested", nested], ["rows", rows], ["links", links]] as const) {
    assert.equal(Object.isFrozen(callerOwned), false, `the caller's ${label} must be left alone`);
  }

  // --- the stored record is immutable all the way down --------------------
  const storedDetails = receipt.details as { nested: unknown; rows: unknown };
  for (const [label, stored] of [["receipt", receipt], ["links", receipt.links], ["details", receipt.details], ["nested", storedDetails.nested], ["rows", storedDetails.rows]] as const) {
    assert.equal(Object.isFrozen(stored), true, `the stored ${label} must be frozen`);
  }
  assert.notEqual(storedDetails.nested, nested, "the stored branch is a copy, so freezing it costs the caller nothing");
  assert.notEqual(storedDetails.rows, rows, "the stored array is a copy too");

  const before = JSON.stringify(log.list());

  // --- the caller mutates every original, including a credential ----------
  // None of these may throw: they are the caller's own objects.
  details.top = "changed";
  details.injected = STRIPE;
  nested.note = GITHUB;
  rows[0] = JWT;
  rows.push(AWS);
  links.missionId = "mission-tampered";

  assert.equal(JSON.stringify(log.list()), before, "no caller mutation reaches the stored record");
  for (const [label, credential] of [["Stripe", STRIPE], ["GitHub", GITHUB], ["JWT", JWT], ["AWS", AWS]] as const) {
    assert.equal(JSON.stringify(log.list()).includes(credential), false, `${label} injected after create must never appear in the log`);
  }
  assert.equal(log.list()[0].links.missionId, "mission-1", "links stay as validated");

  // --- and the read APIs cannot be used to edit it either ------------------
  for (const [label, read] of [["list", () => log.list()], ["linkedTo", () => log.linkedTo({ missionId: "mission-1" })]] as const) {
    const handed = read();
    assert.equal(handed.length, 1, `${label}: precondition, the receipt is reachable`);
    attempt(() => { (handed[0] as { summary: string }).summary = "rewritten"; });
    attempt(() => { handed[0].links.missionId = "mission-tampered"; });
    attempt(() => { (handed[0].details as Record<string, unknown>).top = STRIPE; });
    attempt(() => { ((handed[0].details as { nested: Record<string, unknown> }).nested).note = GITHUB; });
    attempt(() => { ((handed[0].details as { rows: unknown[] }).rows).push(JWT); });
    // Throwing is fine, but the point is the STORED value, checked either way.
    assert.equal(JSON.stringify(log.list()), before, `${label}: the stored record is unchanged after every attempt`);
  }
});

// ============================================ READ-API ALIASING (list) ======
// `list()` copied only the outer array, so the receipt objects inside it stayed
// live internal state. Measured before this change, assigning through
// `list()[0].details.diagnostic` was visible in a SUBSEQUENT `list()`.

/** Mutation of a frozen object throws in strict mode; either outcome is fine. */
function attempt(mutate: () => void): void {
  try {
    mutate();
  } catch {
    // Refusing loudly is at least as good as refusing silently.
  }
}

test("a receipt returned by list() cannot mutate internal state", () => {
  const log = freshLog();
  log.create({ summary: "ordinary", status: "completed", links: { missionId: "mission-1" }, details: { diagnostic: "safe", rows: [{ note: "safe" }] } });

  const first = log.list();
  attempt(() => { (first[0] as { summary: string }).summary = "rewritten"; });
  attempt(() => { (first[0] as { status: string }).status = "approved"; });
  attempt(() => { first[0].links.missionId = "mission-tampered"; });
  attempt(() => { (first[0].details as Record<string, unknown>).diagnostic = STRIPE; });
  attempt(() => { ((first[0].details as { rows: Array<Record<string, unknown>> }).rows)[0].note = GITHUB; });
  attempt(() => { ((first[0].details as { rows: unknown[] }).rows).push(JWT); });

  const second = log.list();
  assert.equal(second[0].summary, "ordinary", "summary unchanged");
  assert.equal(second[0].status, "completed", "status unchanged");
  assert.equal(second[0].links.missionId, "mission-1", "links unchanged");
  assert.deepEqual(second[0].details, { diagnostic: "safe", rows: [{ note: "safe" }] }, "details unchanged");
  const serialized = JSON.stringify(second);
  for (const credential of [STRIPE, GITHUB, JWT]) {
    assert.equal(serialized.includes(credential), false, "no credential entered internal state through list()");
  }
});

test("a receipt returned by linkedTo() cannot mutate internal state", () => {
  // linkedTo() hands out the same stored objects, so it shares the exposure
  // boundary and is audited with it rather than trusted by association.
  const log = freshLog();
  log.create({ summary: "ordinary", status: "completed", links: { missionId: "mission-1" }, details: { diagnostic: "safe" } });

  const matched = log.linkedTo({ missionId: "mission-1" });
  assert.equal(matched.length, 1, "precondition: the receipt is reachable through linkedTo");
  attempt(() => { (matched[0] as { summary: string }).summary = "rewritten"; });
  attempt(() => { matched[0].links.missionId = "mission-tampered"; });
  attempt(() => { (matched[0].details as Record<string, unknown>).diagnostic = STRIPE; });

  assert.equal(log.list()[0].summary, "ordinary");
  assert.equal(log.list()[0].links.missionId, "mission-1");
  assert.deepEqual(log.list()[0].details, { diagnostic: "safe" });
  assert.equal(log.linkedTo({ missionId: "mission-tampered" }).length, 0, "the link index cannot be rewritten from outside");
});

test("adding to the array returned by list() does not add a receipt", () => {
  const log = freshLog();
  log.create({ summary: "ordinary", status: "completed" });
  const first = log.list();
  first.push({ receiptId: "forged", summary: "forged", status: "approved", links: {}, createdAt: "now" });
  assert.equal(log.list().length, 1, "the outer array is a copy");
});

// ============================================== HIDDEN / NON-JSON SHAPES ====
// `Object.keys` sees only ENUMERABLE STRING keys, so each shape below would
// slip past a keys-only walk. Own keys are enumerated with Reflect and any
// surplus fails closed.

const HIDDEN_SHAPES: ReadonlyArray<readonly [string, () => Record<string, unknown>]> = [
  ["non-enumerable string property", () => {
    const d: Record<string, unknown> = { visible: "safe" };
    Object.defineProperty(d, "hidden", { value: STRIPE, enumerable: false, writable: true, configurable: true });
    return d;
  }],
  ["symbol-keyed property", () => {
    const d: Record<string, unknown> = { visible: "safe" };
    (d as Record<symbol, unknown>)[Symbol("hidden")] = GITHUB;
    return d;
  }],
  ["symbol VALUE", () => ({ marker: Symbol("opaque") } as unknown as Record<string, unknown>)],
  ["setter-only accessor", () => {
    const d: Record<string, unknown> = {};
    Object.defineProperty(d, "sink", { enumerable: true, set: () => undefined, configurable: true });
    return d;
  }],
  ["custom prototype", () => Object.create({ inherited: STRIPE }) as Record<string, unknown>],
  ["class instance", () => {
    class Holder {
      note = "safe";
    }
    return new Holder() as unknown as Record<string, unknown>;
  }],
  ["Date", () => ({ when: new Date(0) })],
  ["Error", () => ({ cause: new Error("boom") })],
  ["Map", () => ({ table: new Map([["k", STRIPE]]) })],
  ["Set", () => ({ bag: new Set([GITHUB]) })],
  ["array with a hidden extra property", () => {
    const rows: unknown[] = ["safe"];
    Object.defineProperty(rows, "smuggled", { value: STRIPE, enumerable: false, writable: true, configurable: true });
    return { rows };
  }],
  ["array with a symbol-keyed property", () => {
    const rows: unknown[] = ["safe"];
    (rows as unknown as Record<symbol, unknown>)[Symbol("hidden")] = GITHUB;
    return { rows };
  }],
  ["function value", () => ({ run: (() => STRIPE) as unknown as string })],
];

test("hidden and non-JSON-like shapes are refused, and nothing is stored", () => {
  for (const [label, build] of HIDDEN_SHAPES) {
    const log = freshLog();
    assert.throws(() => log.create({ summary: "probe", status: "completed", details: build() }), /not plain JSON-like data/, `${label} must fail closed`);
    assert.deepEqual(log.list(), [], `${label}: nothing stored`);
    const serialized = JSON.stringify(log.list());
    for (const credential of [STRIPE, GITHUB]) {
      assert.equal(serialized.includes(credential), false, `${label}: no credential stored`);
    }
  }
});

test("a getter is refused WITHOUT ever being invoked", () => {
  let invocations = 0;
  const details: Record<string, unknown> = { visible: "safe" };
  Object.defineProperty(details, "lazy", {
    enumerable: true,
    configurable: true,
    get: () => {
      invocations += 1;
      return STRIPE;
    },
  });

  const log = freshLog();
  assert.throws(() => log.create({ summary: "probe", status: "completed", details }), /not plain JSON-like data/);
  assert.equal(invocations, 0, "scanning must never run caller code");
  assert.deepEqual(log.list(), [], "nothing stored");
});

test("a normal array is accepted and its standard length is not treated as an attack", () => {
  const log = freshLog();
  const details = { rows: [], flat: ["a", "b"], nested: [{ note: "safe" }, [1, 2]] };
  const receipt = log.create({ summary: "ordinary", status: "completed", details });
  assert.deepEqual(receipt.details, { rows: [], flat: ["a", "b"], nested: [{ note: "safe" }, [1, 2]] });
});

test("a cycle is refused and a diamond is accepted", () => {
  const cyclic: Record<string, unknown> = { note: "safe" };
  cyclic.self = cyclic;
  assert.throws(() => freshLog().create({ summary: "cyclic", status: "completed", details: cyclic }), /not plain JSON-like data/);

  // The same object referenced from two SIBLING branches is an ordinary shared
  // reference, not a cycle. Tracking every visited node instead of the current
  // ancestor path would refuse this legitimate receipt.
  const shared = { note: "safe" };
  const receipt = freshLog().create({ summary: "diamond", status: "completed", details: { left: shared, right: shared } });
  assert.deepEqual(receipt.details, { left: { note: "safe" }, right: { note: "safe" } });
  // The snapshot copies per occurrence, so the stored branches are independent
  // and no caller-owned reference survives on either side.
  const stored = receipt.details as { left: unknown; right: unknown };
  assert.notEqual(stored.left, shared, "the left branch is detached");
  assert.notEqual(stored.right, shared, "the right branch is detached");
  assert.notEqual(stored.left, stored.right, "sharing is resolved into equivalent copies");
});

// ==================================================== REFUSAL IS INERT ======

test("a HIDDEN-SHAPE refusal also consumes no id and leaves the log empty", () => {
  const log = freshLog();
  const hidden: Record<string, unknown> = {};
  Object.defineProperty(hidden, "smuggled", { value: STRIPE, enumerable: false, writable: true, configurable: true });

  // The summary must stay neutral so the refusal comes from the DETAILS check;
  // a summary like "secret-valued" is caught by the lexical noun rules first
  // and would prove the wrong thing.
  assert.throws(() => log.create({ summary: "ordinary probe", status: "completed", details: { key: GITHUB } }), /contain a secret value/);
  assert.throws(() => log.create({ summary: "hidden", status: "completed", details: hidden }), /not plain JSON-like data/);
  assert.deepEqual(log.list(), [], "no receipt was stored by either refusal");

  // The sequence must not have advanced: a gap in the id series would look like
  // a deleted record.
  assert.equal(log.create({ summary: "ordinary", status: "completed" }).receiptId, "receipt-1");
});

test("no refusal error carries the offending value", () => {
  const hidden: Record<string, unknown> = {};
  Object.defineProperty(hidden, "smuggled", { value: JWT, enumerable: false, writable: true, configurable: true });

  const cases: ReadonlyArray<readonly [string, () => void]> = [
    ["secret value in details", () => { freshLog().create({ summary: "probe", status: "completed", details: { key: STRIPE } }); }],
    ["secret value in a key", () => { freshLog().create({ summary: "probe", status: "completed", details: { [GITHUB]: "safe" } }); }],
    ["hidden property", () => { freshLog().create({ summary: "probe", status: "completed", details: hidden }); }],
  ];

  for (const [label, run] of cases) {
    let message = "";
    try {
      run();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.notEqual(message, "", `${label}: must refuse`);
    for (const credential of [STRIPE, GITHUB, JWT]) {
      assert.equal(message.includes(credential), false, `${label}: the error must not carry the value`);
      assert.equal(message.includes(credential.slice(0, 12)), false, `${label}: nor a prefix of it`);
    }
    assert.equal(/\d{2,}/.test(message), false, `${label}: no length or offset leaks`);
  }
});
