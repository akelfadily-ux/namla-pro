import test from "node:test";
import assert from "node:assert/strict";

import {
  ApiIntegrationFactory,
  DevOpsFactory,
  FinalSprintCourtFactory,
  LihuFactory,
  SecurityFactory,
  V2_CANONICAL_POST_PROMAX_PROOF_SCHEMA,
  V2_CANONICAL_POST_PROMAX_STATE_SCHEMA,
  fingerprintCanonicalPostProMaxStageAssessment,
  fingerprintCanonicalProMaxAssessment,
  type CanonicalPostProMaxAssuranceState,
  type CanonicalPostProMaxProof,
  type CanonicalPostProMaxProofAuthority,
  type CanonicalPostProMaxProofAuthorityResult,
  type CanonicalPostProMaxStageAssessment,
  type CanonicalPostProMaxStageId,
} from "../v2/assurance/postProMaxAssuranceFactories";

import type {
  PlanContract,
} from "../v2/types/contracts";

import type {
  ProMaxAssessment,
} from "../v2/types/missionState";

import type {
  ContractBoundStageContext,
} from "../v2/types/stageContext";

const MISSION = "c9c2-mission";
const CONTRACT_HASH = "a".repeat(64);

function contract(): PlanContract {
  return {
    contractId: `contract-${MISSION}`,
    version: "v1.0.0",
    contractHash: CONTRACT_HASH,
    objective: "C9C2 assurance",
    acceptanceCriteria: [],
    constraints: [],
    tasks: [],
    dependencies: [],
    allowedCapabilities: [],
    requiredTests: [],
    securityRequirements: [],
    expectedArtifacts: [],
    evidenceRequirements: [],
    riskClassification: "HIGH",
    completionConditions: [],
    frozenAt: 1_800_000_000_000,
  };
}

function context(): ContractBoundStageContext {
  return {
    missionId: MISSION,
    authoritativeInputs: [],
    policyVersions: ["policy-v1"],
    budgets: {
      virtualTicks: 20,
      providerCalls: 5,
      maxFixAttempts: 3,
    },
    evidenceRefs: [],
    missionStateRef: "mission-state-c9c2",
    contractPhase: "CONTRACT_BOUND",
    frozenPlanContract: contract(),
  };
}

function proMax(): ProMaxAssessment {
  return {
    candidateId: "candidate-c9c2",
    contractSatisfied: true,
    verifiedCriteria: ["ac-1"],
    failedCriteria: [],
    securityCheckPassed: true,
    regressionPassed: true,
    independentTestsPassed: true,
    evidenceFreshnessVerified: true,
  };
}

function kindFor(
  stage: Exclude<CanonicalPostProMaxStageId, "PROMAX">,
): CanonicalPostProMaxStageAssessment["assessmentKind"] {
  switch (stage) {
    case "FINAL_SPRINT_COURT":
      return "COURT_VERDICT";
    case "LIHU":
      return "LIHU_ASSESSMENT";
    case "DEVOPS":
      return "RELEASE_QUALIFICATION";
    case "API_INTEGRATION":
      return "INTEGRATION_QUALIFICATION";
    case "SECURITY":
      return "SECURITY_QUALIFICATION";
  }
}

function stageAssessment(
  stage: Exclude<CanonicalPostProMaxStageId, "PROMAX">,
  passed = true,
): CanonicalPostProMaxStageAssessment {
  return {
    stageId: stage,
    assessmentKind: kindFor(stage),
    passed,
    reasonCodes: [passed ? `${stage}_PASS` : `${stage}_FAIL`],
    evidenceRefs: [`evidence-${stage}`],
  };
}

function proof(
  stage: CanonicalPostProMaxStageId,
  fingerprint: string,
): CanonicalPostProMaxProof {
  return {
    schemaVersion: V2_CANONICAL_POST_PROMAX_PROOF_SCHEMA,
    missionId: MISSION,
    candidateId: "candidate-c9c2",
    contractId: `contract-${MISSION}`,
    contractVersion: "v1.0.0",
    contractHash: CONTRACT_HASH,
    stageId: stage,
    resultRef: `result://${stage}`,
    outputFingerprint: fingerprint,
  };
}

class ProofAuthority
  implements CanonicalPostProMaxProofAuthority {
  public calls: CanonicalPostProMaxStageId[] = [];
  public allowed = true;
  public refuseResultRef: string | null = null;
  public mutate:
    ((value: CanonicalPostProMaxProof) => CanonicalPostProMaxProof) |
    null = null;

  public async verifyProof(
    value: CanonicalPostProMaxProof,
  ): Promise<CanonicalPostProMaxProofAuthorityResult> {
    this.calls.push(value.stageId);

    if (
      !this.allowed ||
      value.resultRef === this.refuseResultRef
    ) {
      return {
        ok: false,
        status: "REFUSED",
        reasonCode: "fixture-refused",
      };
    }

    return {
      ok: true,
      status: "VERIFIED",
      reasonCode: "ok",
      proof: this.mutate
        ? this.mutate(structuredClone(value))
        : structuredClone(value),
    };
  }
}

async function courtState(
  authority = new ProofAuthority(),
) {
  const pro = proMax();
  const court =
    stageAssessment("FINAL_SPRINT_COURT");

  const result =
    await new FinalSprintCourtFactory(authority).adjudicate(
      pro,
      context(),
      proof(
        "PROMAX",
        fingerprintCanonicalProMaxAssessment(pro),
      ),
      court,
      proof(
        "FINAL_SPRINT_COURT",
        fingerprintCanonicalPostProMaxStageAssessment(court),
      ),
    );

  assert.ok(result.success, result.reasonCode);
  if (!result.success) {
    throw new Error("fixture-court-state-failed");
  }

  return {
    authority,
    state: result.state,
  };
}

async function fullState() {
  const base = await courtState();

  const lihu = stageAssessment("LIHU");
  const lihuResult =
    await new LihuFactory(base.authority).evaluate(
      base.state,
      context(),
      lihu,
      proof(
        "LIHU",
        fingerprintCanonicalPostProMaxStageAssessment(lihu),
      ),
    );
  assert.ok(lihuResult.success, lihuResult.reasonCode);
  if (!lihuResult.success) throw new Error("fixture-lihu-failed");

  const devops = stageAssessment("DEVOPS");
  const devopsResult =
    await new DevOpsFactory(base.authority).qualifyRelease(
      lihuResult.state,
      context(),
      devops,
      proof(
        "DEVOPS",
        fingerprintCanonicalPostProMaxStageAssessment(devops),
      ),
    );
  assert.ok(devopsResult.success, devopsResult.reasonCode);
  if (!devopsResult.success) throw new Error("fixture-devops-failed");

  const api = stageAssessment("API_INTEGRATION");
  const apiResult =
    await new ApiIntegrationFactory(base.authority).verifyIntegrations(
      devopsResult.state,
      context(),
      api,
      proof(
        "API_INTEGRATION",
        fingerprintCanonicalPostProMaxStageAssessment(api),
      ),
    );
  assert.ok(apiResult.success, apiResult.reasonCode);
  if (!apiResult.success) throw new Error("fixture-api-failed");

  const security = stageAssessment("SECURITY");
  const securityResult =
    await new SecurityFactory(base.authority).verifySecurity(
      apiResult.state,
      context(),
      security,
      proof(
        "SECURITY",
        fingerprintCanonicalPostProMaxStageAssessment(security),
      ),
    );
  assert.ok(securityResult.success, securityResult.reasonCode);
  if (!securityResult.success) throw new Error("fixture-security-failed");

  return {
    authority: base.authority,
    state: securityResult.state,
  };
}

test(
  "C9C2 Final Sprint Court verifies ProMax history and court proof before creating assurance state",
  async () => {
    const result = await courtState();

    assert.deepEqual(
      result.state.completedStages,
      ["PROMAX", "FINAL_SPRINT_COURT"],
    );

    assert.deepEqual(
      result.authority.calls,
      ["PROMAX", "PROMAX", "FINAL_SPRINT_COURT"],
    );

    assert.equal(result.state.proofs.length, 2);
  },
);

test(
  "C9C2 failed ProMax assessment is refused before proof authority",
  async () => {
    const authority = new ProofAuthority();
    const pro = {
      ...proMax(),
      contractSatisfied: false,
    };
    const court = stageAssessment("FINAL_SPRINT_COURT");

    const result =
      await new FinalSprintCourtFactory(authority).adjudicate(
        pro,
        context(),
        proof("PROMAX", fingerprintCanonicalProMaxAssessment(pro)),
        court,
        proof(
          "FINAL_SPRINT_COURT",
          fingerprintCanonicalPostProMaxStageAssessment(court),
        ),
      );

    assert.equal(result.success, false);
    assert.equal(result.reasonCode, "PROMAX_ASSESSMENT_REFUSED");
    assert.equal(authority.calls.length, 0);
  },
);

test(
  "C9C2 forged ProMax assessment fingerprint is refused before authority",
  async () => {
    const authority = new ProofAuthority();
    const pro = proMax();
    const court = stageAssessment("FINAL_SPRINT_COURT");

    const result =
      await new FinalSprintCourtFactory(authority).adjudicate(
        pro,
        context(),
        proof("PROMAX", "0".repeat(64)),
        court,
        proof(
          "FINAL_SPRINT_COURT",
          fingerprintCanonicalPostProMaxStageAssessment(court),
        ),
      );

    assert.equal(result.success, false);
    assert.equal(result.reasonCode, "PROOF_FINGERPRINT_MISMATCH");
    assert.equal(authority.calls.length, 0);
  },
);

test(
  "C9C2 proof authority refusal cannot create a court state",
  async () => {
    const authority = new ProofAuthority();
    authority.allowed = false;
    const pro = proMax();
    const court = stageAssessment("FINAL_SPRINT_COURT");

    const result =
      await new FinalSprintCourtFactory(authority).adjudicate(
        pro,
        context(),
        proof("PROMAX", fingerprintCanonicalProMaxAssessment(pro)),
        court,
        proof(
          "FINAL_SPRINT_COURT",
          fingerprintCanonicalPostProMaxStageAssessment(court),
        ),
      );

    assert.equal(result.success, false);
    assert.equal(result.reasonCode, "PROOF_AUTHORITY_REFUSED");
  },
);

test(
  "C9C2 proof authority cannot substitute another result reference",
  async () => {
    const authority = new ProofAuthority();
    authority.mutate = (value) => ({
      ...value,
      resultRef: "result://substituted",
    });

    const pro = proMax();
    const court = stageAssessment("FINAL_SPRINT_COURT");

    const result =
      await new FinalSprintCourtFactory(authority).adjudicate(
        pro,
        context(),
        proof("PROMAX", fingerprintCanonicalProMaxAssessment(pro)),
        court,
        proof(
          "FINAL_SPRINT_COURT",
          fingerprintCanonicalPostProMaxStageAssessment(court),
        ),
      );

    assert.equal(result.success, false);
    assert.equal(result.reasonCode, "PROOF_AUTHORITY_INVALID");
  },
);

test(
  "C9C2 failed court assessment is refused before its proof reaches authority",
  async () => {
    const authority = new ProofAuthority();
    const pro = proMax();
    const court =
      stageAssessment("FINAL_SPRINT_COURT", false);

    const result =
      await new FinalSprintCourtFactory(authority).adjudicate(
        pro,
        context(),
        proof("PROMAX", fingerprintCanonicalProMaxAssessment(pro)),
        court,
        proof(
          "FINAL_SPRINT_COURT",
          fingerprintCanonicalPostProMaxStageAssessment(court),
        ),
      );

    assert.equal(result.success, false);
    assert.equal(result.reasonCode, "ASSESSMENT_REFUSED");
    assert.deepEqual(
      authority.calls,
      ["PROMAX", "PROMAX"],
    );
  },
);

test(
  "C9C2 LIHU cannot skip Final Sprint Court",
  async () => {
    const authority = new ProofAuthority();
    const pro = proMax();
    const proProof = proof(
      "PROMAX",
      fingerprintCanonicalProMaxAssessment(pro),
    );

    const state: CanonicalPostProMaxAssuranceState = {
      schemaVersion: V2_CANONICAL_POST_PROMAX_STATE_SCHEMA,
      missionId: MISSION,
      candidateId: pro.candidateId,
      contractId: `contract-${MISSION}`,
      contractVersion: "v1.0.0",
      contractHash: CONTRACT_HASH,
      completedStages: ["PROMAX"],
      resultRefs: [proProof.resultRef],
      outputFingerprints: [proProof.outputFingerprint],
      proofs: [proProof],
    };

    const lihu = stageAssessment("LIHU");

    const result =
      await new LihuFactory(authority).evaluate(
        state,
        context(),
        lihu,
        proof(
          "LIHU",
          fingerprintCanonicalPostProMaxStageAssessment(lihu),
        ),
      );

    assert.equal(result.success, false);
    assert.equal(result.reasonCode, "STAGE_ORDER_INVALID");
    assert.equal(authority.calls.length, 0);
  },
);

test(
  "C9C2 a forged completed prefix is reverified and refused before LIHU",
  async () => {
    const authority = new ProofAuthority();
    const pro = proMax();
    const proProof = proof(
      "PROMAX",
      fingerprintCanonicalProMaxAssessment(pro),
    );

    const forgedCourt = proof(
      "FINAL_SPRINT_COURT",
      "b".repeat(64),
    );
    authority.refuseResultRef = forgedCourt.resultRef;

    const forgedState: CanonicalPostProMaxAssuranceState = {
      schemaVersion: V2_CANONICAL_POST_PROMAX_STATE_SCHEMA,
      missionId: MISSION,
      candidateId: pro.candidateId,
      contractId: `contract-${MISSION}`,
      contractVersion: "v1.0.0",
      contractHash: CONTRACT_HASH,
      completedStages: ["PROMAX", "FINAL_SPRINT_COURT"],
      resultRefs: [proProof.resultRef, forgedCourt.resultRef],
      outputFingerprints: [
        proProof.outputFingerprint,
        forgedCourt.outputFingerprint,
      ],
      proofs: [proProof, forgedCourt],
    };

    const lihu = stageAssessment("LIHU");
    const result =
      await new LihuFactory(authority).evaluate(
        forgedState,
        context(),
        lihu,
        proof(
          "LIHU",
          fingerprintCanonicalPostProMaxStageAssessment(lihu),
        ),
      );

    assert.equal(result.success, false);
    assert.equal(result.reasonCode, "PROOF_AUTHORITY_REFUSED");
    assert.deepEqual(
      authority.calls,
      ["PROMAX", "FINAL_SPRINT_COURT"],
    );
  },
);

test(
  "C9C2 stage assessment kind cannot be substituted across factories",
  async () => {
    const base = await courtState();
    const invalid = {
      ...stageAssessment("LIHU"),
      assessmentKind: "RELEASE_QUALIFICATION",
    };

    const result =
      await new LihuFactory(base.authority).evaluate(
        base.state,
        context(),
        invalid,
        proof("LIHU", "0".repeat(64)),
      );

    assert.equal(result.success, false);
    assert.equal(result.reasonCode, "ASSESSMENT_INVALID");
  },
);

test(
  "C9C2 stage proof cannot bind to another contract",
  async () => {
    const base = await courtState();
    const lihu = stageAssessment("LIHU");
    const forged = {
      ...proof(
        "LIHU",
        fingerprintCanonicalPostProMaxStageAssessment(lihu),
      ),
      contractHash: "b".repeat(64),
    };

    const result =
      await new LihuFactory(base.authority).evaluate(
        base.state,
        context(),
        lihu,
        forged,
      );

    assert.equal(result.success, false);
    assert.equal(result.reasonCode, "PROOF_BINDING_MISMATCH");
  },
);

test(
  "C9C2 full ordered chain reaches SECURITY without skipping a factory",
  async () => {
    const result = await fullState();

    assert.deepEqual(
      result.state.completedStages,
      [
        "PROMAX",
        "FINAL_SPRINT_COURT",
        "LIHU",
        "DEVOPS",
        "API_INTEGRATION",
        "SECURITY",
      ],
    );

    assert.equal(result.state.resultRefs.length, 6);
    assert.equal(result.state.outputFingerprints.length, 6);
    assert.equal(result.state.proofs.length, 6);
  },
);

test(
  "C9C2 replaying an already completed stage is refused",
  async () => {
    const base = await courtState();
    const lihu = stageAssessment("LIHU");

    const first =
      await new LihuFactory(base.authority).evaluate(
        base.state,
        context(),
        lihu,
        proof(
          "LIHU",
          fingerprintCanonicalPostProMaxStageAssessment(lihu),
        ),
      );

    assert.ok(first.success);
    if (!first.success) return;

    const replay =
      await new LihuFactory(base.authority).evaluate(
        first.state,
        context(),
        lihu,
        proof(
          "LIHU",
          fingerprintCanonicalPostProMaxStageAssessment(lihu),
        ),
      );

    assert.equal(replay.success, false);
    assert.equal(replay.reasonCode, "STAGE_ORDER_INVALID");
  },
);

test(
  "C9C2 assurance state is immutable at every successful boundary",
  async () => {
    const result = await fullState();

    assert.equal(Object.isFrozen(result.state), true);
    assert.equal(Object.isFrozen(result.state.completedStages), true);
    assert.equal(Object.isFrozen(result.state.resultRefs), true);
    assert.equal(Object.isFrozen(result.state.outputFingerprints), true);
    assert.equal(Object.isFrozen(result.state.proofs), true);
    assert.equal(
      result.state.proofs.every((entry) => Object.isFrozen(entry)),
      true,
    );
  },
);

test(
  "C9C2 context contract mismatch refuses the next stage before current-stage proof",
  async () => {
    const base = await courtState();
    const lihu = stageAssessment("LIHU");

    const changedContext = {
      ...context(),
      frozenPlanContract: {
        ...contract(),
        contractHash: "c".repeat(64),
      },
    };

    const callsBefore = base.authority.calls.length;

    const result =
      await new LihuFactory(base.authority).evaluate(
        base.state,
        changedContext,
        lihu,
        proof(
          "LIHU",
          fingerprintCanonicalPostProMaxStageAssessment(lihu),
        ),
      );

    assert.equal(result.success, false);
    assert.equal(result.reasonCode, "STATE_BINDING_MISMATCH");
    assert.equal(base.authority.calls.length, callsBefore);
  },
);

test(
  "C9C2 SECURITY cannot run before API_INTEGRATION",
  async () => {
    const base = await courtState();
    const security = stageAssessment("SECURITY");

    const result =
      await new SecurityFactory(base.authority).verifySecurity(
        base.state,
        context(),
        security,
        proof(
          "SECURITY",
          fingerprintCanonicalPostProMaxStageAssessment(security),
        ),
      );

    assert.equal(result.success, false);
    assert.equal(result.reasonCode, "STAGE_ORDER_INVALID");
  },
);

test(
  "C9C2 ProMax assessment proxies are refused without invoking their getters",
  async () => {
    let getterCalls = 0;

    const malicious = new Proxy(
      proMax(),
      {
        get(target, property, receiver) {
          getterCalls += 1;
          return Reflect.get(target, property, receiver);
        },
      },
    );

    const authority = new ProofAuthority();
    const court = stageAssessment("FINAL_SPRINT_COURT");

    const result =
      await new FinalSprintCourtFactory(authority).adjudicate(
        malicious,
        context(),
        proof("PROMAX", "0".repeat(64)),
        court,
        proof(
          "FINAL_SPRINT_COURT",
          fingerprintCanonicalPostProMaxStageAssessment(court),
        ),
      );

    assert.equal(result.success, false);
    assert.equal(result.reasonCode, "PROMAX_ASSESSMENT_INVALID");
    assert.equal(getterCalls, 0);
    assert.equal(authority.calls.length, 0);
  },
);
