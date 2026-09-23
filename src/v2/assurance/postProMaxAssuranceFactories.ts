/**
 * C9C2 canonical post-ProMax assurance factories.
 *
 * These five factories are explicit, ordered, evidence-backed control-plane
 * boundaries. They perform no filesystem, process, network, deployment or
 * release effects themselves.
 *
 * A stage can advance only when the prior assurance state's COMPLETE proof
 * prefix is structurally valid AND every prior proof is reverified through the
 * injected durable proof authority. Therefore a caller cannot fabricate a
 * syntactically plausible "completedStages" prefix and skip a canonical stage.
 *
 * Canonical registry activation remains a separate atomic step (C9C3).
 */

import { createHash } from "node:crypto";
import {
  isDeepStrictEqual,
  types,
} from "node:util";

import type {
  ProMaxAssessment,
} from "../types/missionState";

import type {
  ContractBoundStageContext,
} from "../types/stageContext";

export const V2_CANONICAL_POST_PROMAX_PROOF_SCHEMA =
  "namla-v2-post-promax-proof-v1" as const;

export const V2_CANONICAL_POST_PROMAX_STATE_SCHEMA =
  "namla-v2-post-promax-state-v2" as const;

export type CanonicalPostProMaxStageId =
  | "PROMAX"
  | "FINAL_SPRINT_COURT"
  | "LIHU"
  | "DEVOPS"
  | "API_INTEGRATION"
  | "SECURITY";

export type CanonicalPostProMaxAssessmentKind =
  | "PROMAX_ASSESSMENT"
  | "COURT_VERDICT"
  | "LIHU_ASSESSMENT"
  | "RELEASE_QUALIFICATION"
  | "INTEGRATION_QUALIFICATION"
  | "SECURITY_QUALIFICATION";

export interface CanonicalPostProMaxProof {
  readonly schemaVersion:
    typeof V2_CANONICAL_POST_PROMAX_PROOF_SCHEMA;
  readonly missionId: string;
  readonly candidateId: string;
  readonly contractId: string;
  readonly contractVersion: string;
  readonly contractHash: string;
  readonly stageId: CanonicalPostProMaxStageId;
  readonly resultRef: string;
  readonly outputFingerprint: string;
}

export interface CanonicalPostProMaxStageAssessment {
  readonly stageId:
    Exclude<CanonicalPostProMaxStageId, "PROMAX">;
  readonly assessmentKind:
    Exclude<CanonicalPostProMaxAssessmentKind, "PROMAX_ASSESSMENT">;
  readonly passed: boolean;
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface CanonicalPostProMaxAssuranceState {
  readonly schemaVersion:
    typeof V2_CANONICAL_POST_PROMAX_STATE_SCHEMA;
  readonly missionId: string;
  readonly candidateId: string;
  readonly contractId: string;
  readonly contractVersion: string;
  readonly contractHash: string;
  readonly completedStages: readonly CanonicalPostProMaxStageId[];
  readonly resultRefs: readonly string[];
  readonly outputFingerprints: readonly string[];
  /**
   * Durable proof prefix. Each next factory reverifies every entry through the
   * trusted proof authority before accepting the state as canonical history.
   */
  readonly proofs: readonly CanonicalPostProMaxProof[];
}

export type CanonicalPostProMaxProofAuthorityResult =
  | {
      readonly ok: true;
      readonly status: "VERIFIED";
      readonly reasonCode: "ok";
      readonly proof: CanonicalPostProMaxProof;
    }
  | {
      readonly ok: false;
      readonly status: "REFUSED";
      readonly reasonCode: string;
    };

export interface CanonicalPostProMaxProofAuthority {
  verifyProof(
    proof: CanonicalPostProMaxProof,
  ): Promise<CanonicalPostProMaxProofAuthorityResult>;
}

export type CanonicalPostProMaxFactoryReasonCode =
  | "OK"
  | "CONTEXT_INVALID"
  | "PROMAX_ASSESSMENT_INVALID"
  | "PROMAX_ASSESSMENT_REFUSED"
  | "STATE_INVALID"
  | "STATE_BINDING_MISMATCH"
  | "STAGE_ORDER_INVALID"
  | "ASSESSMENT_INVALID"
  | "ASSESSMENT_REFUSED"
  | "PROOF_INVALID"
  | "PROOF_BINDING_MISMATCH"
  | "PROOF_FINGERPRINT_MISMATCH"
  | "PROOF_AUTHORITY_REFUSED"
  | "PROOF_AUTHORITY_INVALID"
  | "PROOF_AUTHORITY_FAILED";

export type CanonicalPostProMaxFactoryResult =
  | {
      readonly success: true;
      readonly reasonCode: "OK";
      readonly state: CanonicalPostProMaxAssuranceState;
    }
  | {
      readonly success: false;
      readonly reasonCode:
        Exclude<CanonicalPostProMaxFactoryReasonCode, "OK">;
      readonly detailReasonCode?: string;
    };

const HASH = /^[0-9a-f]{64}$/u;

const STAGE_ORDER:
  readonly CanonicalPostProMaxStageId[] =
    Object.freeze([
      "PROMAX",
      "FINAL_SPRINT_COURT",
      "LIHU",
      "DEVOPS",
      "API_INTEGRATION",
      "SECURITY",
    ]);

const EXPECTED_KIND:
  Readonly<Record<
    Exclude<CanonicalPostProMaxStageId, "PROMAX">,
    Exclude<CanonicalPostProMaxAssessmentKind, "PROMAX_ASSESSMENT">
  >> =
    Object.freeze({
      FINAL_SPRINT_COURT: "COURT_VERDICT",
      LIHU: "LIHU_ASSESSMENT",
      DEVOPS: "RELEASE_QUALIFICATION",
      API_INTEGRATION: "INTEGRATION_QUALIFICATION",
      SECURITY: "SECURITY_QUALIFICATION",
    });

const PROOF_FIELDS = [
  "schemaVersion",
  "missionId",
  "candidateId",
  "contractId",
  "contractVersion",
  "contractHash",
  "stageId",
  "resultRef",
  "outputFingerprint",
] as const;

const STATE_FIELDS = [
  "schemaVersion",
  "missionId",
  "candidateId",
  "contractId",
  "contractVersion",
  "contractHash",
  "completedStages",
  "resultRefs",
  "outputFingerprints",
  "proofs",
] as const;

const STAGE_ASSESSMENT_FIELDS = [
  "stageId",
  "assessmentKind",
  "passed",
  "reasonCodes",
  "evidenceRefs",
] as const;

const PROMAX_FIELDS = [
  "candidateId",
  "contractSatisfied",
  "verifiedCriteria",
  "failedCriteria",
  "securityCheckPassed",
  "regressionPassed",
  "independentTestsPassed",
  "evidenceFreshnessVerified",
] as const;

function nonempty(
  value: unknown,
  max = 4096,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      types.isProxy(value)
    ) {
      return null;
    }

    const prototype: unknown =
      Object.getPrototypeOf(value);

    if (
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      return null;
    }

    if (Reflect.ownKeys(value).length !== fields.length) {
      return null;
    }

    const out: Record<string, unknown> =
      Object.create(null);

    for (const field of fields) {
      const descriptor =
        Object.getOwnPropertyDescriptor(value, field);

      if (
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        return null;
      }

      out[field] = descriptor.value;
    }

    return out;
  } catch {
    return null;
  }
}

function plainArray(
  value: unknown,
  maxItems: number,
): readonly unknown[] | null {
  try {
    if (
      !Array.isArray(value) ||
      types.isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > maxItems
    ) {
      return null;
    }

    const lengthDescriptor =
      Object.getOwnPropertyDescriptor(value, "length");

    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      lengthDescriptor.value !== value.length ||
      Reflect.ownKeys(value).length !== value.length + 1
    ) {
      return null;
    }

    const out: unknown[] = [];

    for (let index = 0; index < value.length; index += 1) {
      const descriptor =
        Object.getOwnPropertyDescriptor(value, String(index));

      if (
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        return null;
      }

      out.push(descriptor.value);
    }

    return Object.freeze(out);
  } catch {
    return null;
  }
}

function stringArray(
  value: unknown,
  options: {
    readonly nonemptyArray: boolean;
    readonly maxItems: number;
    readonly unique: boolean;
  },
): readonly string[] | null {
  const array =
    plainArray(value, options.maxItems);

  if (
    !array ||
    (options.nonemptyArray && array.length === 0) ||
    !array.every((entry) => nonempty(entry, 2048))
  ) {
    return null;
  }

  const strings =
    array as readonly string[];

  if (
    options.unique &&
    new Set(strings).size !== strings.length
  ) {
    return null;
  }

  return Object.freeze([...strings]);
}

function validStage(
  value: unknown,
): value is CanonicalPostProMaxStageId {
  return (
    typeof value === "string" &&
    STAGE_ORDER.includes(value as CanonicalPostProMaxStageId)
  );
}

function contextIdentity(
  context: ContractBoundStageContext,
): {
  readonly missionId: string;
  readonly contractId: string;
  readonly contractVersion: string;
  readonly contractHash: string;
} | null {
  try {
    if (
      typeof context !== "object" ||
      context === null ||
      types.isProxy(context) ||
      context.contractPhase !== "CONTRACT_BOUND" ||
      !nonempty(context.missionId, 512) ||
      typeof context.frozenPlanContract !== "object" ||
      context.frozenPlanContract === null ||
      types.isProxy(context.frozenPlanContract) ||
      !nonempty(context.frozenPlanContract.contractId, 512) ||
      !nonempty(context.frozenPlanContract.version, 512) ||
      !HASH.test(context.frozenPlanContract.contractHash)
    ) {
      return null;
    }

    return Object.freeze({
      missionId: context.missionId,
      contractId: context.frozenPlanContract.contractId,
      contractVersion: context.frozenPlanContract.version,
      contractHash: context.frozenPlanContract.contractHash,
    });
  } catch {
    return null;
  }
}

function readProof(
  value: unknown,
): CanonicalPostProMaxProof | null {
  const data = exactRecord(value, PROOF_FIELDS);

  if (
    !data ||
    data.schemaVersion !== V2_CANONICAL_POST_PROMAX_PROOF_SCHEMA ||
    !nonempty(data.missionId, 512) ||
    !nonempty(data.candidateId, 512) ||
    !nonempty(data.contractId, 512) ||
    !nonempty(data.contractVersion, 512) ||
    typeof data.contractHash !== "string" ||
    !HASH.test(data.contractHash) ||
    !validStage(data.stageId) ||
    !nonempty(data.resultRef, 2048) ||
    typeof data.outputFingerprint !== "string" ||
    !HASH.test(data.outputFingerprint)
  ) {
    return null;
  }

  return Object.freeze({
    schemaVersion: V2_CANONICAL_POST_PROMAX_PROOF_SCHEMA,
    missionId: data.missionId,
    candidateId: data.candidateId,
    contractId: data.contractId,
    contractVersion: data.contractVersion,
    contractHash: data.contractHash,
    stageId: data.stageId,
    resultRef: data.resultRef,
    outputFingerprint: data.outputFingerprint,
  });
}

function readProofArray(
  value: unknown,
): readonly CanonicalPostProMaxProof[] | null {
  const array =
    plainArray(value, STAGE_ORDER.length);

  if (!array || array.length < 1) {
    return null;
  }

  const proofs: CanonicalPostProMaxProof[] = [];

  for (const entry of array) {
    const proof = readProof(entry);
    if (!proof) {
      return null;
    }
    proofs.push(proof);
  }

  return Object.freeze(proofs);
}

function readStageAssessmentAny(
  value: unknown,
): CanonicalPostProMaxStageAssessment | null {
  const data =
    exactRecord(value, STAGE_ASSESSMENT_FIELDS);

  if (
    !data ||
    typeof data.stageId !== "string" ||
    data.stageId === "PROMAX" ||
    !validStage(data.stageId)
  ) {
    return null;
  }

  const stage =
    data.stageId as Exclude<CanonicalPostProMaxStageId, "PROMAX">;

  const reasonCodes =
    stringArray(data.reasonCodes, {
      nonemptyArray: true,
      maxItems: 256,
      unique: true,
    });

  const evidenceRefs =
    stringArray(data.evidenceRefs, {
      nonemptyArray: true,
      maxItems: 4096,
      unique: true,
    });

  if (
    data.assessmentKind !== EXPECTED_KIND[stage] ||
    typeof data.passed !== "boolean" ||
    !reasonCodes ||
    !evidenceRefs
  ) {
    return null;
  }

  return Object.freeze({
    stageId: stage,
    assessmentKind: EXPECTED_KIND[stage],
    passed: data.passed,
    reasonCodes,
    evidenceRefs,
  });
}

function readStageAssessment(
  value: unknown,
  expectedStage:
    Exclude<CanonicalPostProMaxStageId, "PROMAX">,
): CanonicalPostProMaxStageAssessment | null {
  const captured = readStageAssessmentAny(value);
  return captured?.stageId === expectedStage
    ? captured
    : null;
}

function readProMaxAssessment(
  value: unknown,
): ProMaxAssessment | null {
  const data =
    exactRecord(value, PROMAX_FIELDS);

  if (!data || !nonempty(data.candidateId, 512)) {
    return null;
  }

  const verifiedCriteria =
    stringArray(data.verifiedCriteria, {
      nonemptyArray: false,
      maxItems: 4096,
      unique: true,
    });

  const failedCriteria =
    stringArray(data.failedCriteria, {
      nonemptyArray: false,
      maxItems: 4096,
      unique: true,
    });

  if (
    !verifiedCriteria ||
    !failedCriteria ||
    typeof data.contractSatisfied !== "boolean" ||
    typeof data.securityCheckPassed !== "boolean" ||
    typeof data.regressionPassed !== "boolean" ||
    typeof data.independentTestsPassed !== "boolean" ||
    typeof data.evidenceFreshnessVerified !== "boolean"
  ) {
    return null;
  }

  return Object.freeze({
    candidateId: data.candidateId,
    contractSatisfied: data.contractSatisfied,
    verifiedCriteria,
    failedCriteria,
    securityCheckPassed: data.securityCheckPassed,
    regressionPassed: data.regressionPassed,
    independentTestsPassed: data.independentTestsPassed,
    evidenceFreshnessVerified: data.evidenceFreshnessVerified,
  });
}

function readState(
  value: unknown,
): CanonicalPostProMaxAssuranceState | null {
  const data =
    exactRecord(value, STATE_FIELDS);

  if (
    !data ||
    data.schemaVersion !== V2_CANONICAL_POST_PROMAX_STATE_SCHEMA ||
    !nonempty(data.missionId, 512) ||
    !nonempty(data.candidateId, 512) ||
    !nonempty(data.contractId, 512) ||
    !nonempty(data.contractVersion, 512) ||
    typeof data.contractHash !== "string" ||
    !HASH.test(data.contractHash)
  ) {
    return null;
  }

  const completedRaw =
    plainArray(data.completedStages, STAGE_ORDER.length);

  const resultRefs =
    stringArray(data.resultRefs, {
      nonemptyArray: true,
      maxItems: STAGE_ORDER.length,
      unique: true,
    });

  const outputFingerprints =
    stringArray(data.outputFingerprints, {
      nonemptyArray: true,
      maxItems: STAGE_ORDER.length,
      unique: true,
    });

  const proofs =
    readProofArray(data.proofs);

  if (
    !completedRaw ||
    completedRaw.length < 1 ||
    !resultRefs ||
    !outputFingerprints ||
    !proofs ||
    completedRaw.length !== resultRefs.length ||
    completedRaw.length !== outputFingerprints.length ||
    completedRaw.length !== proofs.length
  ) {
    return null;
  }

  const completedStages:
    CanonicalPostProMaxStageId[] = [];

  for (let index = 0; index < completedRaw.length; index += 1) {
    const stage = completedRaw[index];

    if (
      !validStage(stage) ||
      stage !== STAGE_ORDER[index]
    ) {
      return null;
    }

    const proof = proofs[index];

    if (
      proof.stageId !== stage ||
      proof.missionId !== data.missionId ||
      proof.candidateId !== data.candidateId ||
      proof.contractId !== data.contractId ||
      proof.contractVersion !== data.contractVersion ||
      proof.contractHash !== data.contractHash ||
      proof.resultRef !== resultRefs[index] ||
      proof.outputFingerprint !== outputFingerprints[index]
    ) {
      return null;
    }

    completedStages.push(stage);
  }

  return Object.freeze({
    schemaVersion: V2_CANONICAL_POST_PROMAX_STATE_SCHEMA,
    missionId: data.missionId,
    candidateId: data.candidateId,
    contractId: data.contractId,
    contractVersion: data.contractVersion,
    contractHash: data.contractHash,
    completedStages: Object.freeze(completedStages),
    resultRefs,
    outputFingerprints,
    proofs,
  });
}

function hashJson(
  value: unknown,
): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

export function fingerprintCanonicalProMaxAssessment(
  assessment: ProMaxAssessment,
): string {
  const captured =
    readProMaxAssessment(assessment);

  if (!captured) {
    throw new Error("PROMAX_ASSESSMENT_INVALID");
  }

  return hashJson({
    candidateId: captured.candidateId,
    contractSatisfied: captured.contractSatisfied,
    verifiedCriteria: [...captured.verifiedCriteria],
    failedCriteria: [...captured.failedCriteria],
    securityCheckPassed: captured.securityCheckPassed,
    regressionPassed: captured.regressionPassed,
    independentTestsPassed: captured.independentTestsPassed,
    evidenceFreshnessVerified: captured.evidenceFreshnessVerified,
  });
}

export function fingerprintCanonicalPostProMaxStageAssessment(
  assessment: CanonicalPostProMaxStageAssessment,
): string {
  const captured =
    readStageAssessmentAny(assessment);

  if (!captured) {
    throw new Error("POST_PROMAX_ASSESSMENT_INVALID");
  }

  return hashJson({
    stageId: captured.stageId,
    assessmentKind: captured.assessmentKind,
    passed: captured.passed,
    reasonCodes: [...captured.reasonCodes],
    evidenceRefs: [...captured.evidenceRefs],
  });
}

function refused(
  reasonCode:
    Exclude<CanonicalPostProMaxFactoryReasonCode, "OK">,
  detailReasonCode?: string,
): CanonicalPostProMaxFactoryResult {
  return Object.freeze({
    success: false as const,
    reasonCode,
    ...(detailReasonCode === undefined
      ? {}
      : { detailReasonCode }),
  });
}

function captureAuthority(
  authority: CanonicalPostProMaxProofAuthority,
): CanonicalPostProMaxProofAuthority["verifyProof"] {
  if (
    typeof authority !== "object" ||
    authority === null ||
    types.isProxy(authority)
  ) {
    throw new Error("POST_PROMAX_PROOF_AUTHORITY_INVALID");
  }

  let at: object | null = authority;

  for (
    let depth = 0;
    at !== null && depth < 16;
    depth += 1, at = Object.getPrototypeOf(at)
  ) {
    if (types.isProxy(at)) {
      throw new Error("POST_PROMAX_PROOF_AUTHORITY_INVALID");
    }

    const descriptor =
      Object.getOwnPropertyDescriptor(at, "verifyProof");

    if (!descriptor) {
      continue;
    }

    if (
      !("value" in descriptor) ||
      typeof descriptor.value !== "function" ||
      types.isProxy(descriptor.value)
    ) {
      throw new Error("POST_PROMAX_PROOF_AUTHORITY_INVALID");
    }

    return descriptor.value.bind(
      authority,
    ) as CanonicalPostProMaxProofAuthority["verifyProof"];
  }

  throw new Error("POST_PROMAX_PROOF_AUTHORITY_INVALID");
}

abstract class PostProMaxFactoryBase {
  private readonly verifyProof:
    CanonicalPostProMaxProofAuthority["verifyProof"];

  protected constructor(
    authority: CanonicalPostProMaxProofAuthority,
  ) {
    this.verifyProof =
      captureAuthority(authority);
  }

  protected async verifyExactProof(
    proof: CanonicalPostProMaxProof,
  ): Promise<CanonicalPostProMaxFactoryResult | null> {
    let authorityResult:
      CanonicalPostProMaxProofAuthorityResult;

    try {
      authorityResult =
        await this.verifyProof(proof);
    } catch {
      return refused("PROOF_AUTHORITY_FAILED");
    }

    if (authorityResult.ok === false) {
      return refused(
        "PROOF_AUTHORITY_REFUSED",
        authorityResult.reasonCode,
      );
    }

    const returned =
      readProof(authorityResult.proof);

    if (
      authorityResult.status !== "VERIFIED" ||
      authorityResult.reasonCode !== "ok" ||
      !returned ||
      !isDeepStrictEqual(returned, proof)
    ) {
      return refused("PROOF_AUTHORITY_INVALID");
    }

    return null;
  }

  private async verifyPriorStateProofs(
    state: CanonicalPostProMaxAssuranceState,
  ): Promise<CanonicalPostProMaxFactoryResult | null> {
    for (const proof of state.proofs) {
      const failure =
        await this.verifyExactProof(proof);

      if (failure) {
        return failure;
      }
    }

    return null;
  }

  protected async advance(
    stateValue: unknown,
    context: ContractBoundStageContext,
    assessmentValue: unknown,
    proofValue: unknown,
    stageId:
      Exclude<CanonicalPostProMaxStageId, "PROMAX">,
  ): Promise<CanonicalPostProMaxFactoryResult> {
    const state = readState(stateValue);

    if (!state) {
      return refused("STATE_INVALID");
    }

    const identity = contextIdentity(context);

    if (!identity) {
      return refused("CONTEXT_INVALID");
    }

    if (
      state.missionId !== identity.missionId ||
      state.contractId !== identity.contractId ||
      state.contractVersion !== identity.contractVersion ||
      state.contractHash !== identity.contractHash
    ) {
      return refused("STATE_BINDING_MISMATCH");
    }

    const expectedIndex =
      STAGE_ORDER.indexOf(stageId);

    if (
      expectedIndex < 1 ||
      state.completedStages.length !== expectedIndex
    ) {
      return refused("STAGE_ORDER_INVALID");
    }

    const priorFailure =
      await this.verifyPriorStateProofs(state);

    if (priorFailure) {
      return priorFailure;
    }

    const assessment =
      readStageAssessment(assessmentValue, stageId);

    if (!assessment) {
      return refused("ASSESSMENT_INVALID");
    }

    if (!assessment.passed) {
      return refused(
        "ASSESSMENT_REFUSED",
        assessment.reasonCodes.join(","),
      );
    }

    const proof = readProof(proofValue);

    if (!proof) {
      return refused("PROOF_INVALID");
    }

    const fingerprint =
      fingerprintCanonicalPostProMaxStageAssessment(assessment);

    if (
      proof.stageId !== stageId ||
      proof.missionId !== state.missionId ||
      proof.candidateId !== state.candidateId ||
      proof.contractId !== state.contractId ||
      proof.contractVersion !== state.contractVersion ||
      proof.contractHash !== state.contractHash
    ) {
      return refused("PROOF_BINDING_MISMATCH");
    }

    if (proof.outputFingerprint !== fingerprint) {
      return refused("PROOF_FINGERPRINT_MISMATCH");
    }

    const authorityFailure =
      await this.verifyExactProof(proof);

    if (authorityFailure) {
      return authorityFailure;
    }

    return Object.freeze({
      success: true as const,
      reasonCode: "OK" as const,
      state: Object.freeze({
        schemaVersion: V2_CANONICAL_POST_PROMAX_STATE_SCHEMA,
        missionId: state.missionId,
        candidateId: state.candidateId,
        contractId: state.contractId,
        contractVersion: state.contractVersion,
        contractHash: state.contractHash,
        completedStages: Object.freeze([
          ...state.completedStages,
          stageId,
        ]),
        resultRefs: Object.freeze([
          ...state.resultRefs,
          proof.resultRef,
        ]),
        outputFingerprints: Object.freeze([
          ...state.outputFingerprints,
          proof.outputFingerprint,
        ]),
        proofs: Object.freeze([
          ...state.proofs,
          proof,
        ]),
      }),
    });
  }
}

export class FinalSprintCourtFactory
  extends PostProMaxFactoryBase {
  public constructor(
    authority: CanonicalPostProMaxProofAuthority,
  ) {
    super(authority);
  }

  public async adjudicate(
    proMaxAssessmentValue: ProMaxAssessment,
    context: ContractBoundStageContext,
    proMaxProofValue: unknown,
    courtAssessmentValue: unknown,
    courtProofValue: unknown,
  ): Promise<CanonicalPostProMaxFactoryResult> {
    const identity = contextIdentity(context);

    if (!identity) {
      return refused("CONTEXT_INVALID");
    }

    const proMaxAssessment =
      readProMaxAssessment(proMaxAssessmentValue);

    if (!proMaxAssessment) {
      return refused("PROMAX_ASSESSMENT_INVALID");
    }

    if (
      proMaxAssessment.contractSatisfied !== true ||
      proMaxAssessment.securityCheckPassed !== true ||
      proMaxAssessment.regressionPassed !== true ||
      proMaxAssessment.independentTestsPassed !== true ||
      proMaxAssessment.evidenceFreshnessVerified !== true ||
      proMaxAssessment.failedCriteria.length !== 0
    ) {
      return refused("PROMAX_ASSESSMENT_REFUSED");
    }

    const proMaxProof =
      readProof(proMaxProofValue);

    if (!proMaxProof) {
      return refused("PROOF_INVALID");
    }

    if (
      proMaxProof.stageId !== "PROMAX" ||
      proMaxProof.missionId !== identity.missionId ||
      proMaxProof.candidateId !== proMaxAssessment.candidateId ||
      proMaxProof.contractId !== identity.contractId ||
      proMaxProof.contractVersion !== identity.contractVersion ||
      proMaxProof.contractHash !== identity.contractHash
    ) {
      return refused("PROOF_BINDING_MISMATCH");
    }

    const proMaxFingerprint =
      fingerprintCanonicalProMaxAssessment(proMaxAssessment);

    if (
      proMaxProof.outputFingerprint !== proMaxFingerprint
    ) {
      return refused("PROOF_FINGERPRINT_MISMATCH");
    }

    const proMaxAuthorityFailure =
      await this.verifyExactProof(proMaxProof);

    if (proMaxAuthorityFailure) {
      return proMaxAuthorityFailure;
    }

    const initialState:
      CanonicalPostProMaxAssuranceState =
        Object.freeze({
          schemaVersion: V2_CANONICAL_POST_PROMAX_STATE_SCHEMA,
          missionId: identity.missionId,
          candidateId: proMaxAssessment.candidateId,
          contractId: identity.contractId,
          contractVersion: identity.contractVersion,
          contractHash: identity.contractHash,
          completedStages: Object.freeze(["PROMAX" as const]),
          resultRefs: Object.freeze([proMaxProof.resultRef]),
          outputFingerprints:
            Object.freeze([proMaxProof.outputFingerprint]),
          proofs: Object.freeze([proMaxProof]),
        });

    return this.advance(
      initialState,
      context,
      courtAssessmentValue,
      courtProofValue,
      "FINAL_SPRINT_COURT",
    );
  }
}

export class LihuFactory
  extends PostProMaxFactoryBase {
  public constructor(
    authority: CanonicalPostProMaxProofAuthority,
  ) {
    super(authority);
  }

  public evaluate(
    state: unknown,
    context: ContractBoundStageContext,
    assessment: unknown,
    proof: unknown,
  ): Promise<CanonicalPostProMaxFactoryResult> {
    return this.advance(
      state,
      context,
      assessment,
      proof,
      "LIHU",
    );
  }
}

export class DevOpsFactory
  extends PostProMaxFactoryBase {
  public constructor(
    authority: CanonicalPostProMaxProofAuthority,
  ) {
    super(authority);
  }

  public qualifyRelease(
    state: unknown,
    context: ContractBoundStageContext,
    assessment: unknown,
    proof: unknown,
  ): Promise<CanonicalPostProMaxFactoryResult> {
    return this.advance(
      state,
      context,
      assessment,
      proof,
      "DEVOPS",
    );
  }
}

export class ApiIntegrationFactory
  extends PostProMaxFactoryBase {
  public constructor(
    authority: CanonicalPostProMaxProofAuthority,
  ) {
    super(authority);
  }

  public verifyIntegrations(
    state: unknown,
    context: ContractBoundStageContext,
    assessment: unknown,
    proof: unknown,
  ): Promise<CanonicalPostProMaxFactoryResult> {
    return this.advance(
      state,
      context,
      assessment,
      proof,
      "API_INTEGRATION",
    );
  }
}

export class SecurityFactory
  extends PostProMaxFactoryBase {
  public constructor(
    authority: CanonicalPostProMaxProofAuthority,
  ) {
    super(authority);
  }

  public verifySecurity(
    state: unknown,
    context: ContractBoundStageContext,
    assessment: unknown,
    proof: unknown,
  ): Promise<CanonicalPostProMaxFactoryResult> {
    return this.advance(
      state,
      context,
      assessment,
      proof,
      "SECURITY",
    );
  }
}
