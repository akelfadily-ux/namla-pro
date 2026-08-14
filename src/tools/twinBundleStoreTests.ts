/**
 * twinBundleStoreTests — focused proofs for the Twin Bundle Store milestone,
 * using the in-memory store ONLY (zero real filesystem, provider, or network
 * action). The real disk-backed store is human-only and is never constructed
 * here; its path/byte safety is already covered by workspaceSecurityTests.
 *
 * Run: node --test dist/tools/twinBundleStoreTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryTwinBundleStore, buildPersistedAttempt, validateLoadedBundle, validateLoadedAttempt, guardRecordForWrite, colonyOfWorkspaceId, missionOfWorkspaceId, serializeBundle, deserializeBundle } from "../twin/twinBundleStore";
import { buildTwinResumeRecordFromPersisted, verifyPreservedBundle } from "../twin/twinResumeState";
import { freezeBundle } from "../twin/colonyForge";
import type { ColonyEvidenceBundle, ColonyId } from "../twin/twinColonyTypes";
import { fnv1a } from "../twin/twinColonyTypes";

const MISSION = "namola-twin-taskmgr";
const CLAUDE_WS = `workspaces/namola-twin/${MISSION}/claude-forge`;
const CODEX_WS = `workspaces/namola-twin/${MISSION}/codex-crucible`;

/** A genuinely frozen colony bundle (same freeze path the runner uses). */
function makeBundle(colonyId: ColonyId, missionId = MISSION): ColonyEvidenceBundle {
  const artifact = { relativePath: "src/taskManager.ts", content: "export class TaskManager {}\n", purpose: "task manager", acceptanceCriteriaCovered: ["tasks CRUD + completion"] };
  return freezeBundle({
    colonyId,
    missionId,
    culture: colonyId === "claude-forge" ? "architecture-first" : "implementation-first",
    workspacePath: colonyId === "claude-forge" ? CLAUDE_WS : CODEX_WS,
    architecture: { architectureSummary: "plan", filePlan: ["src/taskManager.ts"], acceptanceMapping: [], interfaceDecisions: [], risks: [] },
    artifacts: [artifact],
    artifactManifest: [{ relativePath: artifact.relativePath, bytes: artifact.content.length, fingerprint: fnv1a(`${artifact.relativePath}|${artifact.content}`) }],
    reviews: [{ reviewerAntId: "r1", authorAntId: "a1", decision: "approve", findings: ["ok"], securityFindings: [], selfReview: false }],
    testEvidence: { testsProposed: 1, independentReviews: 1, artifactCount: 1 },
    securityEvidence: { findings: [], passed: true },
    performanceEvidence: [{ check: "size", observed: 1, budget: 20000, withinBudget: true }],
    riskRegister: ["scope"],
    failureRegister: [],
    uncertaintyRegister: ["scale-up"],
    minorityReports: [],
    providerReceipts: [{ antId: "a1", providerId: colonyId === "claude-forge" ? "claude" : "codex", role: "implementation", ok: true, real: false }],
    costReport: { providerCalls: 3, realProviderCalls: 0 },
    reproductionInstructions: ["npx.cmd tsc --noEmit"],
  });
}

test("a valid frozen Codex bundle saves and loads with an unchanged fingerprint", () => {
  const store = new InMemoryTwinBundleStore();
  const codex = makeBundle("codex-crucible");
  const before = codex.fingerprint;

  const wrote = store.writeBundle(CODEX_WS, codex);
  assert.equal(wrote.ok, true, `save must succeed (got ${wrote.reasonCode})`);

  const read = store.readBundle(CODEX_WS);
  assert.equal(read.ok, true, "load must succeed");
  const loaded = (read as { ok: true; value: ColonyEvidenceBundle }).value;
  assert.equal(loaded.fingerprint, before, "fingerprint must be unchanged across save/load");
  assert.equal(validateLoadedBundle(loaded, MISSION, "codex-crucible").ok, true, "loaded bundle must validate for its own mission+colony");

  // A JSON round-trip (what the real store does on disk) preserves the digest.
  const roundTripped = deserializeBundle(serializeBundle(codex));
  assert.notEqual(roundTripped, null);
  assert.equal((roundTripped as ColonyEvidenceBundle).fingerprint, before);
  assert.equal(validateLoadedBundle(roundTripped as ColonyEvidenceBundle, MISSION, "codex-crucible").ok, true, "digest must still recompute after serialization");
});

test("Claude cannot load or replace the Codex bundle as its own", () => {
  const store = new InMemoryTwinBundleStore();
  const codex = makeBundle("codex-crucible");
  assert.equal(store.writeBundle(CODEX_WS, codex).ok, true);

  // (a) Writing the Codex bundle under the CLAUDE root is refused at the store.
  const substituted = store.writeBundle(CLAUDE_WS, codex);
  assert.equal(substituted.ok, false, "cross-colony write must be refused");
  assert.equal(substituted.reasonCode, "cross-colony-write-refused");

  // (b) Even if such a record were somehow present, read-side validation refuses
  //     to accept a Codex bundle as a Claude bundle.
  const asClaude = validateLoadedBundle(codex, MISSION, "claude-forge");
  assert.equal(asClaude.ok, false);
  assert.equal((asClaude as { ok: false; reasonCode: string }).reasonCode, "bundle-colony-mismatch");

  // (c) The Claude root still holds nothing — the Codex bundle was not moved.
  const claudeRead = store.readBundle(CLAUDE_WS);
  assert.equal(claudeRead.ok, false);
  assert.equal((claudeRead as { ok: false; reasonCode: string }).reasonCode, "bundle-not-found");

  // (d) The preserved Codex bundle is untouched and still valid.
  const codexRead = store.readBundle(CODEX_WS);
  assert.equal(codexRead.ok, true);
  assert.equal((codexRead as { ok: true; value: ColonyEvidenceBundle }).value.fingerprint, codex.fingerprint);
});

test("an invalid fingerprint is rejected on write and on read", () => {
  const store = new InMemoryTwinBundleStore();
  const codex = makeBundle("codex-crucible");
  // Tamper with the digest only (the object is frozen, so build a mutated copy).
  const tampered = { ...codex, fingerprint: "tw-deadbeef-000" } as ColonyEvidenceBundle;

  const wrote = store.writeBundle(CODEX_WS, tampered);
  assert.equal(wrote.ok, false, "a bundle whose digest does not recompute must not persist");
  assert.equal(wrote.reasonCode, "bundle-fingerprint-mismatch");

  const validated = validateLoadedBundle(tampered, MISSION, "codex-crucible");
  assert.equal(validated.ok, false);
  assert.equal((validated as { ok: false; reasonCode: string }).reasonCode, "bundle-fingerprint-mismatch");

  // A bundle that is not frozen is refused too.
  const unfrozen = { ...codex, frozen: false } as ColonyEvidenceBundle;
  assert.equal(store.writeBundle(CODEX_WS, unfrozen).reasonCode, "bundle-not-frozen");

  // A cross-MISSION bundle cannot be parked under this mission's root.
  const otherMission = makeBundle("codex-crucible", "different-mission");
  assert.equal(store.writeBundle(CODEX_WS, otherMission).reasonCode, "cross-mission-write-refused");
});

test("overwrite is rejected; the first frozen bundle wins", () => {
  const store = new InMemoryTwinBundleStore();
  const first = makeBundle("codex-crucible");
  assert.equal(store.writeBundle(CODEX_WS, first).ok, true);

  const second = makeBundle("codex-crucible");
  const overwrite = store.writeBundle(CODEX_WS, second);
  assert.equal(overwrite.ok, false, "a second bundle write must not silently overwrite");
  assert.equal(overwrite.reasonCode, "file-exists-refused-overwrite");

  const read = store.readBundle(CODEX_WS);
  assert.equal((read as { ok: true; value: ColonyEvidenceBundle }).value.fingerprint, first.fingerprint, "the original bundle is preserved");

  // Attempts follow the same write-once rule.
  const attempt = buildPersistedAttempt({ colonyId: "claude-forge", missionId: MISSION, ok: false, failureReason: "provider-timeout", reviewSkippedReason: "provider-timeout", completedRoles: ["architecture"], providerCalls: 2, artifactsApplied: 0, diagnostics: [], architecturePlan: ["src/taskManager.ts"] });
  assert.equal(store.writeAttempt(CLAUDE_WS, attempt).ok, true);
  assert.equal(store.writeAttempt(CLAUDE_WS, attempt).reasonCode, "file-exists-refused-overwrite");
});

test("a missing bundle returns an explicit reason", () => {
  const store = new InMemoryTwinBundleStore();
  const bundle = store.readBundle(CODEX_WS);
  assert.equal(bundle.ok, false);
  assert.equal((bundle as { ok: false; reasonCode: string }).reasonCode, "bundle-not-found");
  const attempt = store.readAttempt(CLAUDE_WS);
  assert.equal(attempt.ok, false);
  assert.equal((attempt as { ok: false; reasonCode: string }).reasonCode, "attempt-not-found");
});

test("workspace identity helpers scope by mission and colony (incl. repair areas)", () => {
  assert.equal(colonyOfWorkspaceId(CLAUDE_WS), "claude-forge");
  assert.equal(colonyOfWorkspaceId(CODEX_WS), "codex-crucible");
  assert.equal(colonyOfWorkspaceId(`${CLAUDE_WS}/repair-1`), "claude-forge");
  assert.equal(colonyOfWorkspaceId("workspaces/namla-civilization/run-x"), null);
  assert.equal(missionOfWorkspaceId(CODEX_WS), MISSION);
  assert.equal(missionOfWorkspaceId(`${CLAUDE_WS}/repair-2`), MISSION);
  // A non-twin root can never receive a colony record.
  const stray = guardRecordForWrite("src/twin", { colonyId: "claude-forge", missionId: MISSION });
  assert.equal(stray.ok, false);
  assert.equal((stray as { ok: false; reasonCode: string }).reasonCode, "workspace-not-a-twin-colony-root");
});

test("resume state references ONLY the preserved bundle fingerprint and keeps every required field", () => {
  const store = new InMemoryTwinBundleStore();
  const codex = makeBundle("codex-crucible");
  assert.equal(store.writeBundle(CODEX_WS, codex).ok, true);
  const attempt = buildPersistedAttempt({
    colonyId: "claude-forge",
    missionId: MISSION,
    ok: false,
    failureReason: "provider-timeout",
    reviewSkippedReason: "provider-timeout",
    completedRoles: ["architecture"],
    providerCalls: 2,
    artifactsApplied: 0,
    diagnostics: [{ role: "implementation", antId: "cl-impl", providerId: "claude", ok: false, failureCategory: "provider-timeout", timeoutMs: 600000, durationMs: 600001, requestBytes: 512, responseBytes: 0 }],
    architecturePlan: ["src/taskManager.ts"],
  });
  assert.equal(store.writeAttempt(CLAUDE_WS, attempt).ok, true);

  // Reload both records exactly as a later `twin:resume` process would.
  const loadedBundle = (store.readBundle(CODEX_WS) as { ok: true; value: ColonyEvidenceBundle }).value;
  const loadedAttempt = (store.readAttempt(CLAUDE_WS) as { ok: true; value: typeof attempt }).value;
  assert.equal(validateLoadedBundle(loadedBundle, MISSION, "codex-crucible").ok, true);
  assert.equal(validateLoadedAttempt(loadedAttempt, MISSION, "claude-forge").ok, true);

  const record = buildTwinResumeRecordFromPersisted({ missionId: MISSION, failedColony: "claude-forge", successfulColony: "codex-crucible", successfulBundle: loadedBundle, failedAttempt: loadedAttempt, totalCallBudget: 10, repairAttempt: 1 });

  // Every required field is preserved.
  assert.equal(record.missionId, MISSION);
  assert.equal(record.failedColony, "claude-forge");
  assert.equal(record.successfulColony, "codex-crucible");
  assert.equal(record.successfulBundleFingerprint, codex.fingerprint, "must reference the PRESERVED fingerprint only");
  assert.deepEqual(record.completedRoles, ["architecture"]);
  assert.equal(record.failedRole, "implementation");
  assert.equal(record.failureCategory, "provider-timeout");
  assert.equal(record.remainingCallBudget, 5, "10 budget - (2 failed + 3 successful) calls");
  assert.ok(record.workspaceFingerprints.failedColony.length > 0);
  assert.ok(record.workspaceFingerprints.successfulColony.length > 0);
  assert.equal(record.providerReceipts.length, 1);
  assert.equal(record.resumeStatus, "resumable");

  // It references the preserved bundle by FINGERPRINT, never by embedding it.
  const serialized = JSON.stringify(record);
  assert.equal(serialized.includes(codex.fingerprint), true);
  assert.equal(serialized.includes("TaskManager"), false, "no artifact content may leak into the resume record");

  // And the preserved bundle still verifies against that record.
  assert.equal(verifyPreservedBundle(loadedBundle, record).ok, true);
});

test("no credentials, prompts, or raw provider output are persisted", () => {
  const store = new InMemoryTwinBundleStore();
  const codex = makeBundle("codex-crucible");
  store.writeBundle(CODEX_WS, codex);
  const attempt = buildPersistedAttempt({ colonyId: "claude-forge", missionId: MISSION, ok: false, failureReason: "provider-timeout", reviewSkippedReason: "provider-timeout", completedRoles: ["architecture"], providerCalls: 2, artifactsApplied: 0, diagnostics: [{ role: "implementation", antId: "cl-impl", providerId: "claude", ok: false, failureCategory: "provider-timeout", timeoutMs: 600000, durationMs: 600001, requestBytes: 512, responseBytes: 0 }], architecturePlan: [] });
  const serialized = `${serializeBundle(codex)}|${JSON.stringify(attempt)}`;
  for (const forbidden of [/sk-[A-Za-z0-9]{16,}/, /ghp_[A-Za-z0-9]{16,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /api[_-]?key\s*[:=]/i, /\bprompt\b/i, /process\.env/, /Bearer\s+[A-Za-z0-9._-]{12,}/]) {
    assert.equal(forbidden.test(serialized), false, `persisted record must not contain ${forbidden}`);
  }
  // Provider receipts carry safe scalars only — `real:false` in automated tests.
  assert.equal(codex.providerReceipts.every((r) => r.real === false), true);
  assert.equal(codex.costReport.realProviderCalls, 0, "real-action counter stays zero");
});
