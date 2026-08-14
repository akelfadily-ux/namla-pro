/**
 * networkPolicyTests — proof that "we didn't look" never reports as "zero".
 *
 * Deterministic stubs only. Nothing here opens a socket, spawns a process, or
 * touches a provider.
 *
 * Run: node --test dist/tools/networkPolicyTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateNetworkCapability,
  projectNetwork,
  describeNetwork,
  classifyDestination,
  safeDestinationSummary,
  UnobservedNetworkProvider,
  NoProcessNetworkProvider,
  StubNetworkObservationProvider,
  TOOL_NETWORK_DECLARATIONS,
  type NetworkObservationResult,
  type ToolNetworkDeclaration,
} from "../cognitive/networkPolicy";
import { TWIN_COMMAND_CENTER_NETWORK } from "../twin/twinCommandCenter";

function stub(partial: Partial<NetworkObservationResult>): StubNetworkObservationProvider {
  return new StubNetworkObservationProvider({ observation: "observed-none", count: 0, destinationClasses: [], status: "verified", evidenceSource: "stub", ...partial });
}

// ------------------------------------------------------ UNKNOWN != ZERO ---

test("an unobservable provider reports unknown with a NULL count, never 0", () => {
  const r = evaluateNetworkCapability({ declaration: TOOL_NETWORK_DECLARATIONS.claude, grantedPolicy: "provider-only", observationProvider: new UnobservedNetworkProvider(), sequence: 1 });

  assert.equal(r.networkObservation, "unknown");
  assert.equal(r.observedNetworkCallCount, null, "unknown MUST be null, not 0");
  assert.notEqual(r.observedNetworkCallCount, 0, "unknown must never equal 0");
  assert.equal(r.networkEvidenceAvailable, false);
  assert.equal(r.networkObservationStatus, "unavailable");
  assert.equal(r.safeReasonCode, "network-observation-unavailable");
  // Network is genuinely required and the policy permits it, so this is not blocked.
  assert.equal(r.blocked, false, "a legitimately unobservable provider is not blocked");
});

test("unknown survives projection and rendering without becoming a number", () => {
  const r = evaluateNetworkCapability({ declaration: TOOL_NETWORK_DECLARATIONS.codex, grantedPolicy: "provider-only", observationProvider: new UnobservedNetworkProvider(), sequence: 2 });
  const p = projectNetwork(r);
  assert.equal(p.observedNetworkCallCount, null);
  assert.equal(describeNetwork(p), "policy=provider-only observation=unknown calls=unknown");
  // Serialization must not turn null into 0 anywhere along the way.
  const round = JSON.parse(JSON.stringify(p)) as typeof p;
  assert.equal(round.observedNetworkCallCount, null, "JSON round-trip must preserve null");
  assert.equal(JSON.stringify(p).includes('"observedNetworkCallCount":0'), false);
});

test("observed-none with a real observer is a PROVEN zero, and is distinguishable", () => {
  const r = evaluateNetworkCapability({ declaration: TOOL_NETWORK_DECLARATIONS["fake-provider"], grantedPolicy: "denied", observationProvider: new NoProcessNetworkProvider(), sequence: 3 });
  assert.equal(r.networkObservation, "observed-none");
  assert.equal(r.observedNetworkCallCount, 0, "a proven zero IS 0");
  assert.equal(r.networkEvidenceAvailable, true);
  assert.equal(r.evidenceSource, "no-child-process-spawned");
  assert.equal(r.blocked, false);
  assert.equal(r.safeReasonCode, "ok");
});

test("the two kinds of zero are not interchangeable", () => {
  const proven = evaluateNetworkCapability({ declaration: TOOL_NETWORK_DECLARATIONS["fake-provider"], grantedPolicy: "denied", observationProvider: new NoProcessNetworkProvider(), sequence: 4 });
  const unknown = evaluateNetworkCapability({ declaration: TOOL_NETWORK_DECLARATIONS.claude, grantedPolicy: "provider-only", observationProvider: new UnobservedNetworkProvider(), sequence: 5 });
  assert.notDeepEqual(projectNetwork(proven), projectNetwork(unknown), "proven-zero and unknown must not project identically");
  assert.equal(proven.networkEvidenceAvailable !== unknown.networkEvidenceAvailable, true);
});

// ------------------------------------------------------------ FAIL CLOSED ---

test("denied policy plus observed traffic fails closed", () => {
  const r = evaluateNetworkCapability({
    declaration: TOOL_NETWORK_DECLARATIONS["verification-command"],
    grantedPolicy: "denied",
    observationProvider: stub({ observation: "observed-some", count: 3, destinationClasses: ["package-registry"], status: "enforcement-failed" }),
    sequence: 6,
  });
  assert.equal(r.blocked, true);
  assert.equal(r.safeReasonCode, "unexpected-network-observed");
  assert.equal(r.observedNetworkCallCount, 3, "an observed count is reported truthfully");
});

test("a tool that requires network under a denied policy is refused", () => {
  const r = evaluateNetworkCapability({ declaration: TOOL_NETWORK_DECLARATIONS.claude, grantedPolicy: "denied", observationProvider: new NoProcessNetworkProvider(), sequence: 7 });
  assert.equal(r.blocked, true);
  assert.equal(r.safeReasonCode, "network-policy-denied");
});

test("a grant more permissive than the declaration is refused as an escalation", () => {
  for (const granted of ["allowed", "allowlisted"] as const) {
    const r = evaluateNetworkCapability({ declaration: TOOL_NETWORK_DECLARATIONS.ollama, grantedPolicy: granted, observationProvider: new UnobservedNetworkProvider(), sequence: 8 });
    assert.equal(r.blocked, true, `${granted} over loopback-only must be refused`);
    assert.equal(r.safeReasonCode, "network-policy-escalation-refused");
  }
});

test("a tool declaring local-only while requiring external network is incoherent and refused", () => {
  const incoherent: ToolNetworkDeclaration = { toolId: "bad-tool", requiredNetworkPolicy: "loopback-only", networkRequired: true, allowedDestinationClasses: ["loopback", "unknown-external"] };
  const r = evaluateNetworkCapability({ declaration: incoherent, grantedPolicy: "loopback-only", observationProvider: new UnobservedNetworkProvider(), sequence: 9 });
  assert.equal(r.blocked, true);
  assert.equal(r.safeReasonCode, "network-policy-escalation-refused");
});

// -------------------------------------------------------------- LOOPBACK ---

test("loopback-only accepts loopback and rejects anything external", () => {
  const ok = evaluateNetworkCapability({ declaration: TOOL_NETWORK_DECLARATIONS.ollama, grantedPolicy: "loopback-only", observationProvider: stub({ observation: "observed-some", count: 2, destinationClasses: ["loopback"] }), sequence: 10 });
  assert.equal(ok.blocked, false, "loopback traffic is permitted for a loopback-only tool");
  assert.equal(ok.observedNetworkCallCount, 2);

  for (const bad of ["provider-service", "package-registry", "unknown-external"] as const) {
    const r = evaluateNetworkCapability({ declaration: TOOL_NETWORK_DECLARATIONS.ollama, grantedPolicy: "loopback-only", observationProvider: stub({ observation: "observed-some", count: 1, destinationClasses: [bad] }), sequence: 11 });
    assert.equal(r.blocked, true, `${bad} must violate loopback-only`);
    assert.equal(r.safeReasonCode, "network-destination-not-allowed");
  }
});

test("destination classification is correct and never keeps the URL", () => {
  assert.equal(classifyDestination("http://127.0.0.1:11434/api/generate"), "loopback");
  assert.equal(classifyDestination("http://localhost:8080/x"), "loopback");
  assert.equal(classifyDestination("https://api.anthropic.com/v1/messages"), "provider-service");
  assert.equal(classifyDestination("https://registry.npmjs.org/left-pad"), "package-registry");
  assert.equal(classifyDestination("https://evil.example.com/exfil"), "unknown-external");
  assert.equal(classifyDestination("not a url at all"), "unknown-external");
});

// ------------------------------------------------------------- REDACTION ---

test("a credential-bearing URL never survives into a summary", () => {
  const hostile = ["https://user:ghp_AbCdEf0123456789AbCdEf0123456789Ab@api.github.com/repos?token=sk-proj-AbCdEf0123456789AbCdEf0123456789", "https://api.anthropic.com/v1?api_key=sk-proj-AbCdEf0123456789AbCdEf0123456789&cookie=session_id=s3cr3tCookieValue", "https://x.com/p?password=hunter2-not-a-real-password"];
  const secrets = ["ghp_AbCdEf0123456789AbCdEf0123456789Ab", "sk-proj-AbCdEf0123456789AbCdEf0123456789", "s3cr3tCookieValue", "hunter2-not-a-real-password"];

  for (const url of hostile) {
    const summary = safeDestinationSummary(url);
    for (const s of secrets) assert.equal(summary.includes(s), false, `summary must not contain ${s.slice(0, 12)}…`);
    assert.equal(summary.includes("?"), false, "no query string may survive");
    assert.equal(summary.includes("@"), false, "no userinfo may survive");
  }
  // The class is still reported, so the receipt stays useful.
  assert.equal(safeDestinationSummary(hostile[1]).includes("provider-service"), true);
});

test("a capability receipt carries no URL, header, cookie or environment value", () => {
  const r = evaluateNetworkCapability({ declaration: TOOL_NETWORK_DECLARATIONS.claude, grantedPolicy: "provider-only", observationProvider: stub({ observation: "observed-some", count: 1, destinationClasses: ["provider-service"] }), sequence: 12 });
  const json = JSON.stringify(r);
  for (const forbidden of ["http://", "https://", "Authorization", "Cookie", "api_key", "sk-", "ghp_"]) {
    assert.equal(json.includes(forbidden), false, `receipt must not contain ${forbidden}`);
  }
});

// -------------------------------------------------------- COMMAND CENTRE ---

test("the command centre reports its network position honestly", () => {
  const cc = TWIN_COMMAND_CENTER_NETWORK;
  // Twin runs use deterministic fakes: no process exists, so this zero is PROVEN,
  // and it carries evidence that distinguishes it from an unobserved zero.
  assert.equal(cc.networkObservation, "observed-none");
  assert.equal(cc.observedNetworkCallCount, 0);
  assert.equal(cc.networkEvidenceAvailable, true, "a proven zero must carry evidence");
  assert.equal(cc.networkPolicy, "denied");
  assert.equal(cc.networkObservationStatus, "verified");

  // The unqualified field is gone from the projection entirely.
  assert.equal("realNetworkCalls" in (cc as unknown as Record<string, unknown>), false, "realNetworkCalls must be removed");
  assert.equal(describeNetwork(cc), "policy=denied observation=observed-none calls=0");
});

test("a fake process driver still reports a PROVEN zero, not unknown", () => {
  // Regression guard. The honest change is narrow: only a REAL provider CLI is
  // unobservable. With a fake process driver nothing is spawned, so 0 is proven
  // and must stay 0 — over-reporting `unknown` would be its own dishonesty and
  // would destroy the zero-real-action guarantee the demos rely on.
  const fake = evaluateNetworkCapability({ declaration: TOOL_NETWORK_DECLARATIONS["fake-provider"], grantedPolicy: "denied", observationProvider: new NoProcessNetworkProvider(), sequence: 20 });
  assert.equal(fake.observedNetworkCallCount, 0, "no child process => proven zero");
  assert.equal(fake.networkEvidenceAvailable, true);

  const real = evaluateNetworkCapability({ declaration: TOOL_NETWORK_DECLARATIONS.claude, grantedPolicy: "provider-only", observationProvider: new UnobservedNetworkProvider(), sequence: 21 });
  assert.equal(real.observedNetworkCallCount, null, "real CLI, nothing watching => unknown");
  assert.equal(real.networkEvidenceAvailable, false);
});

test("no real action is taken by this suite", () => {
  const r = evaluateNetworkCapability({ declaration: TOOL_NETWORK_DECLARATIONS["fake-provider"], grantedPolicy: "denied", observationProvider: new NoProcessNetworkProvider(), sequence: 99 });
  assert.equal(r.observedNetworkCallCount, 0);
  assert.equal(r.evidenceSource, "no-child-process-spawned");
});
