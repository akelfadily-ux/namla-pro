# 23 · Concurrency and WorkPackage scope

## WorkPackage is an immutable specification

A WorkPackage is the bounded unit Protocol creates. It is not the mutable state record for a running ant/colony.

```ts
interface WorkPackage {
  id: string;
  missionId: string;
  planContractVersion: string;
  objective: string;
  acceptanceCriteria: readonly string[];
  dependencies: readonly string[];
  readScope: readonly string[];
  proposedWriteScope: readonly string[];
  capabilityScope: readonly string[];
  expectedArtifacts: readonly string[];
  verificationProfile: string;
  assuranceProfile: "STANDARD" | "HIGH" | "CRITICAL";
  securityProfile: string;
  evidenceRequirements: readonly string[];
  concurrencyMode: "DISJOINT" | "SHARED_READ" | "COORDINATED_WRITE" | "MERGE_REQUIRED" | "EXCLUSIVE";
  budgetRef: string;
  risk: string;
}
```

## Independent execution instances

The same immutable WorkPackage is instantiated at least twice for the canonical A/B path:

```ts
interface WorkPackageExecution {
  executionId: string;
  workPackageId: string;
  colonyId: "A" | "B";
  stateVersion: number;
  state: WorkPackageExecutionState;
  ownerLeaseRef?: string;
  attempt: number;
  allocatedBudgetRef: string;
  artifactRefs: readonly string[];
  evidenceRefs: readonly string[];
}
```

A and B therefore never contend for one mutable `owner` field. Each execution has independent lifecycle, budget consumption, artifacts, and evidence while sharing the same immutable WorkPackage specification.

## Access modes

WorkPackages declare read/write scope and an explicit concurrency mode:

- `DISJOINT`
- `SHARED_READ`
- `COORDINATED_WRITE`
- `MERGE_REQUIRED`
- `EXCLUSIVE`

Overlapping writes are not automatically forbidden; **undeclared** overlap is.

Protocol declares the mode. Pro enforces scheduling/barriers. Leggo handles declared merge-required integration.

## A/B logical-path overlap

Colony A and Colony B intentionally solve the same WorkPackage and may propose the same **logical** target paths. This is not an undeclared concurrent-write conflict because their execution namespaces/workspaces remain isolated until Son/Leggo mediation. Access modes govern shared execution/integration namespaces; physical workspace isolation is a separate Trusted Kernel constraint.

## Barriers

- Colony A and B for one package may run concurrently.
- Independent packages may run concurrently when their declared modes permit.
- Synchronization before Son is evidence-based: Son admission requires current `GateVerdict(PASS)` for both distinct A/B `executionId` values, bound to the same WorkPackage and PlanContract version. Mere process completion is insufficient.
- Dependency/merge barriers are required before Leggo where relevant.
- Contract-wide barrier before ProMax requires every required WorkPackage dependency/merge obligation to be satisfied and every integrated artifact identity to be current.
- Delivery barrier is required before Lab finalization.

## Ownership and crash recovery

Current ownership, lease/claim state, attempts, and resume checkpoint live in the **Mission State Plane**, not EvidenceStore. Evidence records assignments and transitions for audit.

Lease/claim identity is execution-scoped. A lease for Colony A execution cannot authorize state mutation or artifact ownership for Colony B execution, even when both share one WorkPackage specification.
