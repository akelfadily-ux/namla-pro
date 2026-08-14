/**
 * VisionSense: perceives structure — file names, folder shapes, diagram
 * nodes. The sense itself never reads the filesystem.
 *
 * Phase 0: reads caller-supplied `context.structures`.
 * Phase 1: can additionally consume a real ProjectSnapshot passed as
 * `context.snapshot` (produced by the read-only ProjectInspector), which
 * yields a higher-confidence reading because the structures were actually
 * observed rather than asserted.
 */

import type { SenseInput, VisionReading } from "../types/senseTypes";
import { isProjectSnapshotLike } from "../inspector/inspectorTypes";

export function see(input: SenseInput): VisionReading {
  const snapshot = input.context.snapshot;
  if (isProjectSnapshotLike(snapshot)) {
    const observedStructures = [
      ...snapshot.folders.map((folder) => `${folder.relativePath}/`),
      ...snapshot.files.map((file) => file.relativePath),
    ];

    return {
      senseType: "vision",
      summary: `Observed ${snapshot.summary.totalFolders} folder(s) and ${snapshot.summary.totalFiles} file(s) from a read-only ProjectSnapshot (${snapshot.summary.totalSkipped} item(s) skipped).`,
      confidence: 0.9,
      generatedAt: new Date().toISOString(),
      observedStructures,
    };
  }

  const structures = Array.isArray(input.context.structures)
    ? (input.context.structures as string[])
    : [];

  return {
    senseType: "vision",
    summary: structures.length > 0
      ? `Observed ${structures.length} structure(s) in the given context.`
      : "No structures were provided to observe.",
    confidence: structures.length > 0 ? 0.7 : 0.2,
    generatedAt: new Date().toISOString(),
    observedStructures: structures,
  };
}
