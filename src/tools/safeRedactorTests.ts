/**
 * safeRedactorTests — proofs that no raw provider secret can reach a receipt,
 * a persisted record, a fingerprint, a thrown error, or the terminal.
 *
 * Fake provider outputs only; a REAL temp directory is used for the persistence
 * proofs (never the repository). No provider, network, or MCP action occurs.
 *
 * Run: node --test dist/tools/safeRedactorTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { redactProviderText, redactedText, redactList, redactMeta, safeErrorSummary, detectResidualSecrets, registerEnvironmentSecrets, clearRegisteredEnvironmentSecrets, REDACTION_MARKERS } from "../cognitive/safeRedactor";
import { utf8Bytes } from "../cognitive/safeWorkspacePath";
import { InMemoryTwinBundleStore, buildPersistedAttempt, serializeBundle } from "../twin/twinBundleStore";
import { buildTwinResumeRecordFromPersisted } from "../twin/twinResumeState";
import { freezeBundle } from "../twin/colonyForge";
import type { ColonyEvidenceBundle } from "../twin/twinColonyTypes";
import { fnv1a } from "../twin/twinColonyTypes";
import { normalizeCivRoleOutput } from "../civilization/civRoleContracts";

// --- fake provider outputs carrying planted secrets --------------------------

const OPENAI = "sk-proj-AbCdEf0123456789AbCdEf0123456789";
const GITHUB = "ghp_AbCdEf0123456789AbCdEf0123456789Ab";
const GH_PAT = "github_pat_11ABCDEFG0abcdefghijklmnop";
const AWS_ID = "AKIAIOSFODNN7EXAMPLE";
const BEARER = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig";
const PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAxyz0123456789abcdef\nGHIJKLMNOPqrstuvwxyz+/=\n-----END RSA PRIVATE KEY-----";
const ENV_SECRET = "hunter2-super-secret-env-value";

/** Every planted raw secret that must never survive anywhere. */
const ALL_RAW = [OPENAI, GITHUB, GH_PAT, AWS_ID, "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig", "MIIEowIBAAKCAQEAxyz0123456789abcdef", ENV_SECRET, "s3cr3t-cookie-value", "p@ssw0rd-value"];

function assertNoRawSecret(haystack: string, label: string): void {
  for (const raw of ALL_RAW) {
    assert.equal(haystack.includes(raw), false, `${label} must not contain the raw secret ${raw.slice(0, 8)}…`);
  }
}

// ------------------------------------------------------------ SECRET PATTERNS ---

test("redacts every secret pattern with the correct category marker", () => {
  const cases: Array<[string, string, string]> = [
    [`key is ${OPENAI} ok`, REDACTION_MARKERS.OPENAI_KEY, "OPENAI_KEY"],
    [`token ${GITHUB} end`, REDACTION_MARKERS.GITHUB_TOKEN, "GITHUB_TOKEN"],
    [`pat ${GH_PAT} end`, REDACTION_MARKERS.GITHUB_TOKEN, "GITHUB_TOKEN"],
    [`id ${AWS_ID} end`, REDACTION_MARKERS.AWS_KEY, "AWS_KEY"],
    [`aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`, REDACTION_MARKERS.AWS_KEY, "AWS_KEY"],
    [`Authorization: ${BEARER}`, REDACTION_MARKERS.BEARER_TOKEN, "BEARER_TOKEN"],
    [`sent ${BEARER} header`, REDACTION_MARKERS.BEARER_TOKEN, "BEARER_TOKEN"],
    [PEM, REDACTION_MARKERS.PRIVATE_KEY, "PRIVATE_KEY"],
    [`Cookie: s3cr3t-cookie-value`, REDACTION_MARKERS.COOKIE, "COOKIE"],
    [`session=s3cr3t-cookie-value`, REDACTION_MARKERS.COOKIE, "COOKIE"],
    [`access_token: "abcdefgh12345678"`, REDACTION_MARKERS.OAUTH_TOKEN, "OAUTH_TOKEN"],
    [`refresh_token=abcdefgh12345678`, REDACTION_MARKERS.OAUTH_TOKEN, "OAUTH_TOKEN"],
    [`api_key=p@ssw0rd-value`, REDACTION_MARKERS.SECRET_VALUE, "SECRET_VALUE"],
    [`api-key: p@ssw0rd-value`, REDACTION_MARKERS.SECRET_VALUE, "SECRET_VALUE"],
    [`password=p@ssw0rd-value`, REDACTION_MARKERS.SECRET_VALUE, "SECRET_VALUE"],
    [`secret=p@ssw0rd-value`, REDACTION_MARKERS.SECRET_VALUE, "SECRET_VALUE"],
    [`token=p@ssw0rd-value`, REDACTION_MARKERS.SECRET_VALUE, "SECRET_VALUE"],
  ];
  for (const [input, marker, category] of cases) {
    const r = redactProviderText(input);
    assert.equal(r.redactedText.includes(marker), true, `${category}: marker missing in "${r.redactedText}"`);
    assert.equal(r.redactionCount >= 1, true, `${category}: redactionCount must be >= 1`);
    assert.equal(r.redactionCategories.includes(category as never), true, `${category}: category must be reported (got ${r.redactionCategories.join(",")})`);
    assertNoRawSecret(r.redactedText, `${category} redactedText`);
    assertNoRawSecret(r.safeFingerprint, `${category} safeFingerprint`);
  }
});

test("redacts explicit environment-secret values supplied to SafeRedactor", () => {
  const r = redactProviderText(`the deploy used ${ENV_SECRET} to authenticate`, { environmentSecrets: [ENV_SECRET] });
  assert.equal(r.redactedText.includes(ENV_SECRET), false);
  assert.equal(r.redactedText.includes(REDACTION_MARKERS.SECRET_VALUE), true);
  assert.equal(r.redactionCategories.includes("SECRET_VALUE"), true);
  assertNoRawSecret(r.safeFingerprint, "env secret fingerprint");
});

test("finds secrets embedded in prose, JSON, TS comments, Arabic, Hebrew and PEM", () => {
  const carriers: Array<[string, string]> = [
    ["prose", `The build failed because the key ${OPENAI} was rejected by the API.`],
    ["json", JSON.stringify({ note: "auth failed", api_key: "p@ssw0rd-value", nested: { token: GITHUB } })],
    ["ts-comment", `// TODO: rotate ${OPENAI}\nexport const x = 1; /* Authorization: ${BEARER} */`],
    ["arabic", `فشل الاتصال لأن المفتاح ${OPENAI} غير صالح. يرجى المحاولة مرة أخرى.`],
    ["hebrew", `החיבור נכשל מכיוון שהמפתח ${GITHUB} אינו תקף. נסה שוב.`],
    ["pem-multiline", `Deployment log:\n${PEM}\nend of log`],
  ];
  for (const [label, carrier] of carriers) {
    const r = redactProviderText(carrier, { maxBytes: 100000 });
    assert.equal(r.redactionCount >= 1, true, `${label}: expected at least one redaction`);
    assertNoRawSecret(r.redactedText, `${label} redactedText`);
    assert.equal(detectResidualSecrets(r.redactedText).length, 0, `${label}: zero residual secrets`);
  }
});

test("clean non-secret text and ordinary source code are unchanged", () => {
  const clean = [
    "export class TaskManager { list() { return []; } }",
    "// a normal comment about tokens in a parser\nconst tokens = source.split(' ');",
    "مرحبا بالعالم، هذه رسالة اختبار.",
    "שלום עולם, זו הודעת בדיקה.",
    "🐜🔥🚀 build succeeded",
    "the session was productive and the password policy was discussed",
  ];
  for (const text of clean) {
    const r = redactProviderText(text, { maxBytes: 100000 });
    assert.equal(r.redactedText, text, `clean text must be unchanged: ${text.slice(0, 40)}`);
    assert.equal(r.redactionCount, 0);
    assert.deepEqual(r.redactionCategories, []);
  }
});

// ------------------------------------------------------------- FINGERPRINTS ---

test("safe fingerprints are deterministic, distinct, and secret-free", () => {
  const a1 = redactProviderText(`failure with ${OPENAI}`);
  const a2 = redactProviderText(`failure with ${OPENAI}`);
  const b = redactProviderText(`different failure with ${GITHUB}`);
  assert.equal(a1.safeFingerprint, a2.safeFingerprint, "identical safe input -> identical fingerprint");
  assert.notEqual(a1.safeFingerprint, b.safeFingerprint, "different redacted results -> different fingerprints");
  assertNoRawSecret(a1.safeFingerprint, "fingerprint");
  assertNoRawSecret(b.safeFingerprint, "fingerprint");

  // Two DIFFERENT secrets of the same category collapse to the same marker, so
  // the fingerprint reflects the redacted text — it can never leak which secret.
  const s1 = redactProviderText("key sk-proj-1111111111111111111111");
  const s2 = redactProviderText("key sk-proj-2222222222222222222222");
  assert.equal(s1.safeFingerprint, s2.safeFingerprint, "fingerprint must not distinguish two redacted secrets");
});

// ------------------------------------------------------------------- UTF-8 ---

test("byte limits are real UTF-8 bytes and truncation never splits characters", () => {
  const emoji = "🐜".repeat(50); // 200 bytes, 50 code points
  assert.equal(utf8Bytes(emoji), 200);
  const r = redactProviderText(emoji, { maxBytes: 30 });
  assert.equal(r.truncated, true);
  assert.equal(r.acceptedBytes, 28, "must back off to a 4-byte boundary (7 emoji)");
  assert.equal(r.acceptedBytes + r.rejectedBytes, 200, "byte accounting must be exact");
  assert.equal(r.redactedText.includes("�"), false, "no replacement character");
  assert.equal(utf8Bytes(r.redactedText), r.acceptedBytes);

  // Arabic + Hebrew truncation stays on a boundary.
  for (const text of ["مرحبا بالعالم، هذه رسالة اختبار طويلة جدا", "שלום עולם, זו הודעת בדיקה ארוכה מאוד"]) {
    const t = redactProviderText(text, { maxBytes: 15 });
    assert.equal(t.redactedText.includes("�"), false, "multilingual truncation must stay valid");
    assert.equal(utf8Bytes(t.redactedText), t.acceptedBytes);
    assert.ok(t.acceptedBytes <= 15);
  }
});

test("a secret is redacted even when it straddles the byte limit", () => {
  // Long Unicode output that exceeds the cap, with the secret near the end.
  const long = `${"م".repeat(300)} ${OPENAI}`;
  const r = redactProviderText(long, { maxBytes: 120 });
  assert.equal(r.truncated, true);
  // Redaction runs BEFORE truncation, so the raw key cannot survive either way.
  assertNoRawSecret(r.redactedText, "straddling secret");
  assert.equal(detectResidualSecrets(r.redactedText).length, 0);
  assert.equal(r.redactedText.includes("�"), false);
});

// --------------------------------------------------------------- PERSISTENCE ---

test("raw secrets cannot reach bundle JSON, attempt JSON, or resume JSON", () => {
  // The composition root registers the live environment-secret VALUES once; every
  // downstream redaction call then scrubs them without plumbing a list through.
  registerEnvironmentSecrets([ENV_SECRET]);
  const store = new InMemoryTwinBundleStore();
  const MISSION = "namola-twin-taskmgr";
  const CODEX_WS = `workspaces/namola-twin/${MISSION}/codex-crucible`;
  const CLAUDE_WS = `workspaces/namola-twin/${MISSION}/claude-forge`;

  // A provider returns an artifact + summary carrying secrets. The role contract
  // is the boundary that redacts before anything is persisted.
  const roleOut = normalizeCivRoleOutput({
    role: "coding",
    callFailureCategory: null,
    summary: `built with key ${OPENAI} and ${BEARER}`,
    filesProposed: [{ relPath: "src/taskManager.ts", content: "export class TaskManager {}\n" }],
    risks: [`rotate ${GITHUB}`],
    testSuggestions: [],
    malformed: false,
    outputTruncated: false,
  });
  assert.equal(roleOut.ok, true);
  assertNoRawSecret(roleOut.artifacts[0].purpose, "artifact purpose");

  const artifact = { relativePath: roleOut.artifacts[0].relativePath, content: roleOut.artifacts[0].content, purpose: roleOut.artifacts[0].purpose, acceptanceCriteriaCovered: ["tasks CRUD"] };
  const bundle: ColonyEvidenceBundle = freezeBundle({
    colonyId: "codex-crucible",
    missionId: MISSION,
    culture: "implementation-first",
    workspacePath: CODEX_WS,
    architecture: { architectureSummary: redactedText(`plan using ${OPENAI}`, 2000), filePlan: ["src/taskManager.ts"], acceptanceMapping: [], interfaceDecisions: [], risks: redactList([`leaked ${GITHUB}`]) },
    artifacts: [artifact],
    artifactManifest: [{ relativePath: artifact.relativePath, bytes: artifact.content.length, fingerprint: fnv1a(`${artifact.relativePath}|${artifact.content}`) }],
    reviews: [{ reviewerAntId: "r1", authorAntId: "a1", decision: "approve", findings: redactList([`saw ${AWS_ID}`]), securityFindings: [], selfReview: false }],
    testEvidence: { testsProposed: 1, independentReviews: 1, artifactCount: 1 },
    securityEvidence: { findings: [], passed: true },
    performanceEvidence: [{ check: "size", observed: 1, budget: 20000, withinBudget: true }],
    riskRegister: redactList([`env had ${ENV_SECRET}`]), // scrubbed via the registered env secret, not a structural pattern
    failureRegister: [],
    uncertaintyRegister: [],
    minorityReports: [],
    providerReceipts: [{ antId: "a1", providerId: "codex", role: "implementation", ok: true, real: false }],
    costReport: { providerCalls: 3, realProviderCalls: 0 },
    reproductionInstructions: ["npx.cmd tsc --noEmit"],
  });
  assert.equal(store.writeBundle(CODEX_WS, bundle).ok, true);

  // FAIL-CLOSED PROOF: raw, un-redacted secrets are handed to the persistence
  // builder on purpose. A caller that forgets to redact must still not be able
  // to leak — the builder itself is the boundary.
  const attempt = buildPersistedAttempt({
    colonyId: "claude-forge",
    missionId: MISSION,
    ok: false,
    failureReason: `provider-timeout after ${OPENAI}`,
    reviewSkippedReason: "provider-timeout",
    completedRoles: ["architecture"],
    providerCalls: 2,
    artifactsApplied: 0,
    diagnostics: [{ role: "implementation", antId: "cl-impl", providerId: "claude", ok: false, failureCategory: `failed: ${GITHUB}`, timeoutMs: 600000, durationMs: 600001, requestBytes: 512, responseBytes: 0, realProcessExecution: false }],
    architecturePlan: [],
  });
  assertNoRawSecret(attempt.failureReason ?? "", "attempt.failureReason (fail-closed)");
  assertNoRawSecret(attempt.diagnostics[0].failureCategory, "diagnostic.failureCategory (fail-closed)");
  assert.equal(store.writeAttempt(CLAUDE_WS, attempt).ok, true);

  const record = buildTwinResumeRecordFromPersisted({ missionId: MISSION, failedColony: "claude-forge", successfulColony: "codex-crucible", successfulBundle: bundle, failedAttempt: attempt, totalCallBudget: 10 });

  // Write all three to a REAL temp directory, then read them back off disk.
  const dir = mkdtempSync(resolve(tmpdir(), "namla-redact-"));
  try {
    mkdirSync(resolve(dir, "out"), { recursive: true });
    const files: Array<[string, string]> = [
      ["bundle.json", serializeBundle(bundle)],
      ["attempt.json", JSON.stringify(attempt)],
      ["resume.json", JSON.stringify(record)],
      ["diagnostics.json", JSON.stringify({ diagnostics: attempt.diagnostics, fingerprint: record.recordFingerprint })],
    ];
    for (const [name, body] of files) {
      const p = resolve(dir, "out", name);
      require("fs").writeFileSync(p, body, "utf8");
      const onDisk = readFileSync(p, "utf8");
      assertNoRawSecret(onDisk, name);
      assert.equal(detectResidualSecrets(onDisk).length, 0, `${name} must have zero residual secrets`);
    }
    // Fingerprints and receipt ids carry no secret data.
    assertNoRawSecret(bundle.fingerprint, "bundle fingerprint");
    assertNoRawSecret(record.recordFingerprint, "resume record fingerprint");
    assertNoRawSecret(attempt.recordFingerprint, "attempt fingerprint");
    // Real-action counters stay zero.
    assert.equal(bundle.costReport.realProviderCalls, 0);
    assert.equal(bundle.providerReceipts.every((r) => r.real === false), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    clearRegisteredEnvironmentSecrets();
  }
});

// ------------------------------------------------------- TERMINAL + ERRORS ---

test("stage-log metadata is redacted before terminal output", () => {
  const meta = redactMeta({ stage: "provider-completed", failureCategory: `boom ${OPENAI}`, note: `Authorization: ${BEARER}`, durationMs: 1200, ok: false });
  const captured = JSON.stringify(meta);
  assertNoRawSecret(captured, "stage-log capture");
  assert.equal(detectResidualSecrets(captured).length, 0);
  // Non-string values pass through untouched.
  assert.equal(meta.durationMs, 1200);
  assert.equal(meta.ok, false);
});

test("thrown errors yield safe reason codes only — no secret, no stack", () => {
  const err = new Error(`request failed using ${OPENAI} and Cookie: s3cr3t-cookie-value`);
  const summary = safeErrorSummary(err);
  assert.equal(summary.name, "Error");
  assertNoRawSecret(summary.safeMessage, "safe error message");
  assertNoRawSecret(summary.safeFingerprint, "safe error fingerprint");
  assert.equal(detectResidualSecrets(summary.safeMessage).length, 0);
  assert.equal(summary.safeMessage.includes("at Object"), false, "no stack frames");
  // A non-Error throw is handled without leaking its payload shape.
  const odd = safeErrorSummary({ secret: OPENAI });
  assert.equal(odd.name, "unknown");
  assertNoRawSecret(odd.safeMessage, "non-Error summary");
});

test("detectResidualSecrets is a working leak detector (negative control)", () => {
  // Sanity: the detector MUST flag an unredacted string, otherwise the proofs
  // above would be vacuous.
  assert.ok(detectResidualSecrets(`raw ${OPENAI}`).includes("OPENAI_KEY"), "detector must catch a raw key");
  assert.ok(detectResidualSecrets(PEM).includes("PRIVATE_KEY"), "detector must catch a PEM block");
  assert.equal(detectResidualSecrets("perfectly clean text").length, 0);
});
