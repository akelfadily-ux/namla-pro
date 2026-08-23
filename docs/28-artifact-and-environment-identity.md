# 28 · Artifact and Environment Identity

## ArtifactIdentity

```ts
interface ArtifactIdentity {
  artifactId: string;
  version: string;
  contentHash: string;
  producerStage: string;
  missionId: string;
  /** Absent for mission-level artifacts produced before Protocol creates WorkPackages. */
  workPackageId?: string;
  /** Required for artifacts produced by a specific Colony A/B execution instance. */
  workPackageExecutionId?: string;
  /** Absent before Protocol freezes the first PlanContract. */
  planContractVersion?: string;
}
```

Evidence never binds merely to "the current file" or "latest candidate". EER and Plan outputs are mission-scoped artifacts (`missionId`, no `workPackageId` yet); Protocol and later package-scoped outputs bind the relevant `workPackageId`. Candidate artifacts created inside Colony A/B additionally bind `workPackageExecutionId`, so evidence from A cannot be mistaken for evidence from B.

## Hash semantics

`contentHash` is never a hash of an ambiguous in-memory object. File/binary artifacts hash their exact bytes. Structured artifacts (EER output, Plan draft, PlanContract-derived data, manifests) hash a schema-versioned canonical serialization. The hash algorithm and serialization/schema version are part of the applicable identity policy/evidence so future algorithm migration cannot silently reinterpret an old digest.

## EnvironmentIdentity

Captures all relevant verification context, for example:
- OS/platform
- runtime/Node version
- compiler/tool versions
- package-lock identity
- container image digest where used
- verification policy versions
- relevant environment profile

EnvironmentIdentity supports validity claims; it does not imply every process is deterministic.

## Evidence binding

`GateVerdict = f(ArtifactIdentity, EnvironmentIdentity, ContractVersion, PolicyVersions, Attestations, Assessments)`

A change to any relevant binding may invalidate downstream proof.
