/**
 * src/twin/final02/repairEngine.ts — Semantically Justified Repair Engine & Plug-in Contract for FINAL-02.
 *
 * NO fake string comment appending (`content + "/* repaired..."`).
 * Pluggable RepairStrategy contract. If no strategy supports the failure, returns REPAIR_UNAVAILABLE and fails closed.
 */

import type { MergeVerificationDriver } from "../mergeForge";
import { fnv1a } from "../twinColonyTypes";
import type { RepairReceipt, VerificationReceipt } from "./contracts";
import { runZeroTrustVerification } from "./verificationRunner";
import { writeLiveObjectiveFile } from "../../cognitive/smokeWorkspace";
import { computeSha256 } from "./frozenArtifactResolver";
import { calculateTreeDigestFromDisk } from "./treeDigest";

export interface RepairPlan {
  readonly failureId: string;
  readonly targetFiles: readonly string[];
  readonly expectedBeforeSha256: readonly string[];
  readonly patches: ReadonlyMap<string, string>;
  readonly verificationStagesToRerun: readonly string[];
}

export interface RepairStrategy {
  supports(failureReason: string): boolean;
  propose(failureReason: string, workspaceId: string, filesMap: ReadonlyMap<string, string>): RepairPlan | null;
}

export interface ExecuteRepairInput {
  readonly workspaceId: string;
  readonly diskHandle: { workspaceId: string; absolutePath: string } | null;
  readonly filesMap: Map<string, string>;
  readonly incidentId: string;
  readonly repairAuthorized: boolean;
  readonly driver: MergeVerificationDriver;
  readonly mergedTreeDigest: string;
  readonly repairStrategies?: readonly RepairStrategy[];
}

export interface ExecuteRepairOutput {
  readonly repairReceipt: RepairReceipt;
  readonly verificationReceipt: VerificationReceipt;
}

export type ExecuteRepairResult =
  | ExecuteRepairOutput
  | { readonly refused: true; readonly reasonCode: string };

/**
 * Executes a semantically justified repair via pluggable RepairStrategy instances.
 * NO fake comment appending. Fails closed with REPAIR_UNAVAILABLE if no strategy supports the failure.
 */
export function executeRepair(input: ExecuteRepairInput): ExecuteRepairResult {
  const { workspaceId, diskHandle, filesMap, incidentId, repairAuthorized, driver, mergedTreeDigest } = input;

  if (!repairAuthorized) {
    const repairReceipt: RepairReceipt = Object.freeze({
      repairId: "repair-declined",
      authorized: false,
      ran: false,
      resolvedIncidentId: null,
      realExecution: driver.isReal,
      filesModified: [],
      beforeFingerprints: [],
      afterFingerprints: [],
    });

    const vRun = runZeroTrustVerification(
      workspaceId,
      diskHandle?.absolutePath ?? `/simulated/${workspaceId}`,
      mergedTreeDigest,
      driver,
      "build"
    );
    return { repairReceipt, verificationReceipt: vRun };
  }

  const strategies = input.repairStrategies ?? [];
  let matchingPlan: RepairPlan | null = null;

  for (const strat of strategies) {
    if (strat.supports(incidentId)) {
      matchingPlan = strat.propose(incidentId, workspaceId, filesMap);
      if (matchingPlan) break;
    }
  }

  // P0-15: Truthful unavailable repair if no strategy matches
  if (!matchingPlan) {
    return { refused: true, reasonCode: "REPAIR_UNAVAILABLE" };
  }

  const filesModified: string[] = [];
  const beforeFingerprints: string[] = [];
  const afterFingerprints: string[] = [];

  for (const targetFile of matchingPlan.targetFiles) {
    const currentContent = filesMap.get(targetFile);
    if (!currentContent) continue;

    const patchedContent = matchingPlan.patches.get(targetFile);
    if (!patchedContent) continue;

    const beforeSha = computeSha256(currentContent);
    const afterSha = computeSha256(patchedContent);

    if (beforeSha === afterSha) continue; // No modification

    filesMap.set(targetFile, patchedContent);
    if (diskHandle) {
      writeLiveObjectiveFile(diskHandle, targetFile, patchedContent, 100000, { allowOverwrite: true });
    }

    filesModified.push(targetFile);
    beforeFingerprints.push(beforeSha);
    afterFingerprints.push(afterSha);
  }

  const ran = filesModified.length > 0;

  const repairReceipt: RepairReceipt = Object.freeze({
    repairId: `repair-${fnv1a(incidentId)}`,
    authorized: true,
    ran,
    resolvedIncidentId: incidentId,
    realExecution: driver.isReal,
    filesModified: Object.freeze(filesModified),
    beforeFingerprints: Object.freeze(beforeFingerprints),
    afterFingerprints: Object.freeze(afterFingerprints),
  });

  const actualTreeDigest = diskHandle
    ? calculateTreeDigestFromDisk(workspaceId, diskHandle.absolutePath).canonicalTreeDigest
    : fnv1a(`${mergedTreeDigest}|repaired`);

  const vRun = runZeroTrustVerification(
    workspaceId,
    diskHandle?.absolutePath ?? `/simulated/${workspaceId}`,
    actualTreeDigest,
    driver,
    null
  );

  return { repairReceipt, verificationReceipt: vRun };
}
