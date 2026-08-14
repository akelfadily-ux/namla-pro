/**
 * VerificationRunner: the tester ant's engine. Only hard-coded, allowlisted
 * commands may ever be named — mission text can never become a shell
 * command, because nothing here accepts arbitrary command text at all.
 *
 * Every verification result produced in this codebase is simulated —
 * `FakeVerificationRunner` checks workspace content deterministically.
 * `RealVerificationRunner` exists to show what a future authorized phase
 * would actually invoke (`npx tsc --noEmit`, `npm test`, `npm run build` —
 * the exact three named in this milestone's own spec), but it always
 * refuses, mirroring `src/bodies/commandAdapter.ts` and the CLI adapters in
 * this same directory. Node's process-spawning module is not imported here.
 */

import { randomUUID } from "crypto";
import type { VerificationResult } from "./artifactTypes";
import { DEFECT_MARKER } from "./deterministicCognitiveWorker";

export const VERIFICATION_COMMAND_ALLOWLIST = ["npx tsc --noEmit", "npm test", "npm run build"] as const;
export type AllowlistedVerificationCommand = (typeof VERIFICATION_COMMAND_ALLOWLIST)[number];

export interface VerificationRunner {
  run(missionId: string, commandLabel: AllowlistedVerificationCommand, workspaceFiles: ReadonlyMap<string, string>): VerificationResult;
}

/**
 * Deterministic, content-based simulation: fails if any workspace file still
 * contains DEFECT_MARKER, passes otherwise. This is a genuine, reproducible
 * check — not a hard-coded pass flag — so injecting and then removing the
 * marker is a real, verifiable defect/repair cycle in the demo.
 */
export class FakeVerificationRunner implements VerificationRunner {
  run(missionId: string, commandLabel: AllowlistedVerificationCommand, workspaceFiles: ReadonlyMap<string, string>): VerificationResult {
    const defectivePaths = [...workspaceFiles.entries()].filter(([, content]) => content.includes(DEFECT_MARKER));
    const outcome = defectivePaths.length === 0 ? "passed" : "failed";

    return {
      verificationId: `verify-${randomUUID()}`,
      missionId,
      commandLabel,
      outcome,
      summary:
        outcome === "passed"
          ? `${commandLabel}: no defect marker found in ${workspaceFiles.size} file(s) (simulated).`
          : `${commandLabel}: defect marker present in ${defectivePaths.length} file(s) (simulated).`,
      simulated: true,
      createdAt: new Date().toISOString(),
    };
  }
}

/**
 * Never invoked by anything in this codebase's demo/test suite. Exists so
 * the allowlist and bounds are real, reviewable data — not to be called.
 */
export class RealVerificationRunner implements VerificationRunner {
  run(missionId: string, commandLabel: AllowlistedVerificationCommand): VerificationResult {
    return {
      verificationId: `verify-refused-${randomUUID()}`,
      missionId,
      commandLabel,
      outcome: "failed",
      summary: `Real verification execution refused (Phase 0 hard boundary): ${commandLabel}.`,
      simulated: true,
      createdAt: new Date().toISOString(),
    };
  }
}
