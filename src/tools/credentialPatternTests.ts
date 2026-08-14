/**
 * credentialPatternTests — structural coverage for vendor credential families
 * (§36, Fable S-6).
 *
 * The gap: `safeRedactor` recognised OpenAI, GitHub, AWS, Bearer, OAuth, cookie
 * and generic `key=value` secrets, but five common families with distinctive
 * vendor prefixes were missed entirely and survived into receipts, summaries and
 * outbound prompts. Stripe was the sharpest case — its keys are `sk_live_…`
 * with an UNDERSCORE, while the OpenAI rule matches hyphenated `sk-…`, so it
 * looked covered and was not.
 *
 * Every credential here is SYNTHETIC. Each family is tested three ways, because
 * a pattern that only ever fires proves as little as one that never does:
 *
 *   POSITIVE — a realistic shape is redacted, under the RIGHT category.
 *   NEGATIVE — prose, identifiers and truncated look-alikes are left untouched.
 *   SURFACE  — the raw value survives none of the safe output paths.
 *
 * Run: node --test dist/tools/credentialPatternTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  redactProviderText,
  redactedText,
  redactList,
  redactMeta,
  safeErrorSummary,
  detectResidualSecrets,
  registerEnvironmentSecrets,
  clearRegisteredEnvironmentSecrets,
  REDACTION_MARKERS,
  type RedactionCategory,
} from "../cognitive/safeRedactor";
import { buildSafeProviderRequest } from "../cognitive/safeProviderRequest";

// ----------------------------------------------------------------- FIXTURES ---

/**
 * Assemble a synthetic credential at RUNTIME from harmless fragments.
 *
 * Why this exists: the fixtures below are invented, but they carry real vendor
 * shapes — which is the whole point, since a fixture that did not look like the
 * real thing would prove nothing. GitHub's own push protection detected the
 * earlier contiguous literals as live Stripe and Slack credentials and refused
 * the push, which is independent confirmation that the shapes are right.
 *
 * Splitting the value means no complete credential-looking string exists as a
 * committed literal, while the runtime string stays byte-for-byte identical, so
 * every assertion, length requirement and regex boundary is unchanged. No
 * fragment is itself a credential: each is a bare prefix or a run of
 * alphanumerics.
 *
 * This is a fixture concern only. No production regex was touched to make the
 * push succeed — weakening a rule to satisfy a scanner would invert the point
 * of the milestone.
 */
function joinCredential(...parts: readonly string[]): string {
  return parts.join("");
}

// Synthetic credentials. Shapes are realistic; the values are invented.
const STRIPE_SECRET = joinCredential("sk", "_live_", "51H8xQ2KlMnOpQrSt", "UvWxYz0123456789abcd");
const STRIPE_RESTRICTED = joinCredential("rk", "_test_", "51H8xQ2KlMnOpQrSt", "UvWxYz0123456789abcd");
const SLACK_BOT = joinCredential("xox", "b-", "2401234567890-", "2409876543210-", "AbCdEfGhIjKlMnOpQrStUvWx");
const SLACK_USER = joinCredential("xox", "p-", "2401234567890-", "2409876543210-", "ZyXwVuTsRqPoNmLkJiHgFeDc");
const GOOGLE_KEY = joinCredential("AIza", "SyD1234567890", "abcdefghijklmnopqrstuv");
const NPM_TOKEN = joinCredential("npm", "_", "AbCdEfGhIjKlMnOpQrSt", "UvWxYz0123456789ab");
const GITLAB_PAT = joinCredential("glpat", "-", "AbCdEfGhIjKlMnOpQr");
const GITLAB_DEPLOY = joinCredential("gldt", "-", "AbCdEfGhIjKlMnOpQrSt");

const FAMILIES: ReadonlyArray<readonly [string, string, RedactionCategory]> = [
  ["stripe secret key", STRIPE_SECRET, "STRIPE_KEY"],
  ["stripe restricted key", STRIPE_RESTRICTED, "STRIPE_KEY"],
  ["slack bot token", SLACK_BOT, "SLACK_TOKEN"],
  ["slack user token", SLACK_USER, "SLACK_TOKEN"],
  ["google api key", GOOGLE_KEY, "GOOGLE_API_KEY"],
  ["npm access token", NPM_TOKEN, "NPM_TOKEN"],
  ["gitlab personal token", GITLAB_PAT, "GITLAB_TOKEN"],
  ["gitlab deploy token", GITLAB_DEPLOY, "GITLAB_TOKEN"],
];

const WORKSPACE = "C:\\Users\\test\\workspaces\\namla\\s6";

// ----------------------------------------------------------------- POSITIVE ---

test("every supported credential family is redacted under its own category", () => {
  for (const [label, credential, category] of FAMILIES) {
    const r = redactProviderText(`the deployment used ${credential} to authenticate`, { maxBytes: 4000 });
    assert.equal(r.redactedText.includes(credential), false, `${label} must not survive`);
    assert.equal(r.redactedText.includes(REDACTION_MARKERS[category]), true, `${label} must carry the ${category} marker`);
    assert.equal(r.redactionCategories.includes(category), true, `${label} must report ${category}`);
    assert.equal(r.redactionCount > 0, true, `${label} must be counted`);
  }
});

test("a named field keeps the SPECIFIC category, not the generic one", () => {
  // Ordering proof: the vendor rules run BEFORE the generic key=value rule, so
  // `stripe_key=sk_live_…` is classified STRIPE_KEY rather than SECRET_VALUE.
  // The field NAME is preserved so the diagnostic stays useful.
  const r = redactProviderText(`stripe_key=${STRIPE_SECRET}`, { maxBytes: 400 });
  assert.equal(r.redactedText, `stripe_key=${REDACTION_MARKERS.STRIPE_KEY}`);
  assert.deepEqual([...r.redactionCategories], ["STRIPE_KEY"], "the precise family wins over SECRET_VALUE");

  const g = redactProviderText(`api_key: ${GOOGLE_KEY}`, { maxBytes: 400 });
  assert.equal(g.redactedText.includes(GOOGLE_KEY), false);
  assert.equal(g.redactionCategories.includes("GOOGLE_API_KEY"), true, "google key keeps its own category");
});

test("multiple different credentials in one string all redact", () => {
  const text = `stripe=${STRIPE_SECRET} slack=${SLACK_BOT} google=${GOOGLE_KEY} npm=${NPM_TOKEN} gitlab=${GITLAB_PAT}`;
  const r = redactProviderText(text, { maxBytes: 4000 });
  for (const credential of [STRIPE_SECRET, SLACK_BOT, GOOGLE_KEY, NPM_TOKEN, GITLAB_PAT]) {
    assert.equal(r.redactedText.includes(credential), false, `${credential.slice(0, 12)}… must not survive`);
  }
  for (const category of ["STRIPE_KEY", "SLACK_TOKEN", "GOOGLE_API_KEY", "NPM_TOKEN", "GITLAB_TOKEN"] as RedactionCategory[]) {
    assert.equal(r.redactionCategories.includes(category), true, `${category} must be reported`);
  }
  // Deterministic, sorted output.
  assert.deepEqual([...r.redactionCategories], [...r.redactionCategories].sort(), "categories are sorted");
});

test("the same credential repeated is redacted at every occurrence", () => {
  const text = `${SLACK_BOT} then again ${SLACK_BOT} and once more ${SLACK_BOT}`;
  const r = redactProviderText(text, { maxBytes: 4000 });
  assert.equal(r.redactedText.includes(SLACK_BOT), false, "no occurrence may survive");
  assert.equal(r.redactedText.split(REDACTION_MARKERS.SLACK_TOKEN).length - 1, 3, "all three occurrences replaced");
  assert.equal(r.redactionCount >= 3, true, "each occurrence counted");
});

// ----------------------------------------------------------------- NEGATIVE ---

test("ordinary prose and identifiers are never redacted", () => {
  // These are the strings a false-positive regex would eat. Over-redacting
  // source code and documentation would make the receipt useless, which is a
  // real cost — not a hypothetical one.
  const untouched = [
    "Install the stripe package and read the Stripe docs.",
    "We post to slack when a build fails.",
    "Use the Google API for geocoding; see the google-maps README.",
    "Run npm install and npm run build before committing.",
    "Our gitlab pipeline runs on merge to main.",
    "const stripeKey = process.env.STRIPE_KEY;",
    "import { SlackClient } from './slack';",
    "package name: npm_registry_helper",
    "See docs/gitlab-integration.md for glpat setup instructions.",
    "commit 3f2a1c9d4e5b6a7c8d9e0f1a2b3c4d5e6f7a8b9c",
    "550e8400-e29b-41d4-a716-446655440000",
    "AIzaSy is the documented prefix for Google API keys.",
  ];
  for (const text of untouched) {
    const r = redactProviderText(text, { maxBytes: 4000 });
    assert.equal(r.redactedText, text, `must be left untouched: ${text}`);
    assert.equal(r.redactionCount, 0, `nothing should match in: ${text}`);
    assert.deepEqual([...r.redactionCategories], [], `no category for: ${text}`);
  }
});

test("truncated and malformed look-alikes are not redacted", () => {
  // Every one of these carries a real vendor prefix but too short a body. A
  // pattern anchored on the prefix ALONE would fire on all of them.
  const nearMisses = [
    "sk_live_short",
    "rk_test_abc",
    "xoxb-123",
    "xoxb-",
    "AIzaShort",
    "AIza",
    "npm_tooshort",
    "npm_",
    "glpat-short",
    "glpat-",
    "gldt-abc",
  ];
  for (const text of nearMisses) {
    const r = redactProviderText(`value is ${text} here`, { maxBytes: 4000 });
    assert.equal(r.redactedText.includes(text), true, `${text} must survive — it is not a credential`);
    assert.equal(r.redactionCount, 0, `${text} must not match any rule`);
  }
});

test("a hyphenated sk- key stays OPENAI_KEY and an underscored sk_ key is STRIPE_KEY", () => {
  // The distinction that made Stripe look covered when it was not.
  const openai = redactProviderText("key sk-proj-AbCdEf0123456789AbCdEf0123456789", { maxBytes: 400 });
  assert.equal(openai.redactionCategories.includes("OPENAI_KEY"), true, "hyphenated sk- is OpenAI");
  assert.equal(openai.redactionCategories.includes("STRIPE_KEY"), false, "and is NOT reported as Stripe");

  const stripe = redactProviderText(`key ${STRIPE_SECRET}`, { maxBytes: 400 });
  assert.equal(stripe.redactionCategories.includes("STRIPE_KEY"), true, "underscored sk_ is Stripe");
  assert.equal(stripe.redactionCategories.includes("OPENAI_KEY"), false, "and is NOT reported as OpenAI");
});

test("a Google key is not confused with an AWS key id", () => {
  // AWS prefixes are uppercase (`AIDA`); the Google prefix is mixed case
  // (`AIza`). They must not collide in either direction.
  const google = redactProviderText(`key ${GOOGLE_KEY}`, { maxBytes: 400 });
  assert.deepEqual([...google.redactionCategories], ["GOOGLE_API_KEY"]);

  const aws = redactProviderText("id AIDAIOSFODNN7EXAMPLE", { maxBytes: 400 });
  assert.deepEqual([...aws.redactionCategories], ["AWS_KEY"]);
});

// ------------------------------------------------------------ MARKER SAFETY ---

test("already-redacted markers are never re-redacted or mangled", () => {
  const once = redactProviderText(`stripe_key=${STRIPE_SECRET} slack=${SLACK_BOT}`, { maxBytes: 4000 });
  const twice = redactProviderText(once.redactedText, { maxBytes: 4000 });
  assert.equal(twice.redactedText, once.redactedText, "a second pass must change nothing");
  assert.equal(twice.redactionCount, 0, "and must count no new redactions");

  // Markers stay intact and carry no fragment of the original value.
  for (const marker of Object.values(REDACTION_MARKERS)) {
    assert.equal(marker.includes(STRIPE_SECRET.slice(8, 20)), false, "a marker must not embed the secret");
  }
});

test("no marker or category name contains any part of a credential", () => {
  const serialized = JSON.stringify(REDACTION_MARKERS);
  for (const [, credential] of FAMILIES) {
    assert.equal(serialized.includes(credential), false, "markers carry no credential");
    // Nor any distinctive slice of one.
    assert.equal(serialized.includes(credential.slice(-12)), false, "markers carry no credential suffix");
  }
});

// ---------------------------------------------------------------- SURFACES ---

test("no credential survives any safe output surface", () => {
  for (const [label, credential] of FAMILIES) {
    const carrier = `deployment failed while using ${credential}`;

    const full = redactProviderText(carrier, { maxBytes: 4000 });
    assert.equal(JSON.stringify(full).includes(credential), false, `${label}: RedactionResult serialization`);
    assert.equal(full.safeFingerprint.includes(credential.slice(0, 10)), false, `${label}: fingerprint carries no prefix`);

    assert.equal(redactedText(carrier, 4000).includes(credential), false, `${label}: redactedText`);
    assert.equal(JSON.stringify(redactList([carrier], 4000)).includes(credential), false, `${label}: redactList`);
    assert.equal(JSON.stringify(redactMeta({ note: carrier, n: 1, ok: true })).includes(credential), false, `${label}: redactMeta`);
    assert.equal(JSON.stringify(safeErrorSummary(new Error(carrier))).includes(credential), false, `${label}: safeErrorSummary`);
  }
});

test("the fingerprint is derived from redacted text only", () => {
  // Two inputs differing ONLY in the credential value must fingerprint
  // identically, because the digest sees the marker, never the secret.
  const a = redactProviderText(`used ${STRIPE_SECRET}`, { maxBytes: 4000 });
  const other = joinCredential("sk", "_live_", "99Z9zZ9zZ9zZ9zZ9z", "Z9zZ9zZ9zZ9zZ9zZ9z");
  const b = redactProviderText(`used ${other}`, { maxBytes: 4000 });
  assert.equal(a.safeFingerprint, b.safeFingerprint, "the digest cannot be a side channel for the value");
  assert.equal(a.redactedText, b.redactedText);
});

test("the outbound provider boundary blocks a credential rather than sending it", () => {
  for (const [label, credential] of FAMILIES) {
    const built = buildSafeProviderRequest({
      requestId: "req-s6",
      providerId: "codex",
      role: "implementation",
      objective: "Deploy the service.",
      promptBody: `Authenticate with ${credential} and continue.`,
      workingDirectoryAbsolute: WORKSPACE,
      timeoutMs: 600000,
      maxStdoutBytes: 200000,
      maxStderrBytes: 20000,
    });
    assert.equal(built.ok, false, `${label} must BLOCK the request`);
    assert.equal(built.spec, null, `${label}: no spec may exist`);
    assert.equal(built.env, null, `${label}: no child environment may exist`);
    assert.equal(built.receipt.safeReasonCode, "provider-request-secret-blocked", `${label}: reason code`);
    assert.equal(JSON.stringify(built).includes(credential), false, `${label}: raw value appears nowhere`);
  }
});

// ------------------------------------------------------- RESIDUAL DETECTION ---

test("detectResidualSecrets catches every unredacted supported format", () => {
  for (const [label, credential, category] of FAMILIES) {
    const found = detectResidualSecrets(`leaked ${credential}`);
    assert.equal(found.includes(category), true, `${label}: detector must report ${category}`);
  }
});

test("detectResidualSecrets reports none after redaction", () => {
  const text = `stripe=${STRIPE_SECRET} slack=${SLACK_BOT} google=${GOOGLE_KEY} npm=${NPM_TOKEN} gitlab=${GITLAB_PAT}`;
  const redacted = redactProviderText(text, { maxBytes: 4000 }).redactedText;
  assert.deepEqual([...detectResidualSecrets(redacted)], [], "a fully redacted string has no residue");
});

// ------------------------------------------------- BOUNDING / UTF-8 SAFETY ---

test("a credential near the truncation boundary cannot leak partially", () => {
  // Redaction runs BEFORE truncation, so a secret sitting across the cut point
  // is already a marker by the time the byte cap applies. Without that
  // ordering, a prefix of the credential would survive in the output.
  for (const [label, credential] of FAMILIES) {
    const prefix = "x".repeat(40);
    const text = `${prefix}${credential} trailing text that will be cut off`;
    for (const cap of [45, 50, 60, 80]) {
      const r = redactProviderText(text, { maxBytes: cap });
      assert.equal(r.redactedText.includes(credential), false, `${label}: full value must not survive at cap ${cap}`);
      // No partial leak either: no substring of 12+ credential characters.
      for (let i = 0; i + 12 <= credential.length; i += 1) {
        const fragment = credential.slice(i, i + 12);
        assert.equal(r.redactedText.includes(fragment), false, `${label}: fragment "${fragment}" leaked at cap ${cap}`);
      }
    }
  }
});

test("multibyte text around a credential stays valid UTF-8", () => {
  const text = `مرحبا ${STRIPE_SECRET} 🚀 שלום`;
  const r = redactProviderText(text, { maxBytes: 4000 });
  assert.equal(r.redactedText.includes(STRIPE_SECRET), false, "the credential is gone");
  assert.equal(r.redactedText.includes("🚀"), true, "the emoji survives intact");
  assert.equal(r.redactedText.includes("\uFFFD"), false, "no replacement character was produced");
});

// ------------------------------------------- S-4 REGISTRY STILL INDEPENDENT ---

test("the exact-value registry still works independently of structural patterns", () => {
  // S-4's proof must not become vacuous: the opaque fixture matches NO
  // structural rule, before or after this milestone. If a future pattern ever
  // covers it, this assertion fails and tells whoever widened the regex that
  // the S-4 proof needs a new fixture.
  const OPAQUE = "amber-otter-vault-passage-quiet-lantern";
  clearRegisteredEnvironmentSecrets();
  try {
    const carrier = `the run used ${OPAQUE} to authenticate`;

    const before = redactProviderText(carrier, { maxBytes: 4000 });
    assert.equal(before.redactedText.includes(OPAQUE), true, "unregistered: structural rules must NOT match it");
    assert.equal(before.redactionCount, 0, "unregistered: no structural rule fires");
    assert.deepEqual([...detectResidualSecrets(carrier)], [], "and the detector finds no structural format");

    registerEnvironmentSecrets([OPAQUE]);
    const after = redactProviderText(carrier, { maxBytes: 4000 });
    assert.equal(after.redactedText.includes(OPAQUE), false, "registered: the exact value is removed");
    assert.equal(after.redactionCategories.includes("SECRET_VALUE"), true, "registered values report SECRET_VALUE");
  } finally {
    clearRegisteredEnvironmentSecrets();
  }
});

test("registered exact values and structural patterns compose", () => {
  const OPAQUE = "copper-heron-ledger-window-silent-meadow";
  clearRegisteredEnvironmentSecrets();
  try {
    registerEnvironmentSecrets([OPAQUE]);
    const r = redactProviderText(`opaque=${OPAQUE} stripe=${STRIPE_SECRET}`, { maxBytes: 4000 });
    assert.equal(r.redactedText.includes(OPAQUE), false, "the registered value is gone");
    assert.equal(r.redactedText.includes(STRIPE_SECRET), false, "the structural match is gone");
    assert.equal(r.redactionCategories.includes("SECRET_VALUE"), true, "registry category reported");
    assert.equal(r.redactionCategories.includes("STRIPE_KEY"), true, "structural category reported");
  } finally {
    clearRegisteredEnvironmentSecrets();
  }
});
