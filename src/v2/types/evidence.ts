/**
 * V2 Evidence and Identity Contracts (§07, §28).
 */

export interface ArtifactIdentity {
  readonly artifactId: string;
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly missionId: string;
  readonly workPackageId?: string;
  readonly executionId?: string;
}

export interface EnvironmentIdentity {
  readonly platform: string;
  readonly nodeVersion: string;
  readonly cwd: string;
  readonly envFingerprint: string;
}

export interface EvidenceRecord {
  readonly evidenceId: string;
  readonly producer: string;
  readonly missionId: string;
  readonly stageId: string;
  readonly workPackageId?: string;
  readonly executionId?: string;
  readonly artifactIdentity?: ArtifactIdentity;
  readonly environmentIdentity: EnvironmentIdentity;
  readonly timestamp: number;
  readonly sequenceNumber: number;
  readonly status: "VALID" | "INVALIDATED" | "SUPERSEDED";
  readonly details: Record<string, unknown>;
  readonly hash: string;
}
