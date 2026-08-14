/**
 * civProviderDiagnostics — safe, persistable provider/run diagnostics for the
 * live civilization pipeline (Real Provider Reliability V4). The second real run
 * left ZERO diagnosable evidence: the run workspace was empty, so a failed
 * provider call could not be tuned after the terminal closed. These records carry
 * ONLY safe scalars — bytes, durations, exit categories, roles, ids, counts —
 * never prompts, raw output, credentials, environment, or private AntMind state.
 *
 * This module builds the manifests; the human CLI persists them through the
 * already-authorized workspace boundary (`writeLiveObjectiveFile`). It imports no
 * fs, no child_process, and no network of its own.
 */

import type { CivNormalizationReceipt } from "./civRoleContracts";

/** One provider call's safe execution metadata. */
export interface CivProviderDiagnostic {
  readonly stage: "architecture" | "implementation" | "review" | "repair";
  readonly antId: string;
  readonly providerId: string;
  readonly role: string;
  readonly timeoutMs: number;
  readonly durationMs: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly exitCode: number | null;
  readonly warningCount: number;
  readonly ok: boolean;
  readonly failureCategory: string;
}

export interface CivIncidentDiagnostic {
  readonly source: string;
  readonly category: string;
  readonly stage: string;
}

export interface CivVerificationDiagnostic {
  readonly command: string;
  readonly run: number;
  readonly status: string;
}

/** The full safe run manifest persisted into the isolated run workspace. */
export interface CivRunDiagnosticsManifest {
  readonly runId: string;
  readonly objectiveId: string;
  readonly schemaVersion: string;
  readonly providerDiagnostics: readonly CivProviderDiagnostic[];
  readonly normalizationReceipts: readonly CivNormalizationReceipt[];
  readonly incidents: readonly CivIncidentDiagnostic[];
  readonly verification: readonly CivVerificationDiagnostic[];
  readonly artifactManifest: readonly { readonly relativePath: string; readonly bytes: number }[];
  readonly reviewManifest: readonly { readonly reviewerCount: number; readonly relativePath: string; readonly applied: boolean }[];
  readonly repairManifest: readonly { readonly antId: string; readonly role: string; readonly ok: boolean; readonly artifactCount: number }[];
  readonly degradedArchitectureMode: boolean;
  readonly providerTimeouts: number;
  readonly finalObjectivePassed: boolean;
  readonly finalStatus: string;
}

export const RUN_DIAGNOSTICS_SCHEMA_VERSION = "civ-run-diagnostics-v4" as const;

/** JSON-encode the manifest for a bounded workspace receipt (bytes-capped by the writer). */
export function encodeDiagnosticsManifest(manifest: CivRunDiagnosticsManifest): string {
  return JSON.stringify(manifest, null, 2);
}
