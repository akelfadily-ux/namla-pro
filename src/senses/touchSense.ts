/**
 * TouchSense: perceives which paths an ant is "in contact with" — i.e.
 * considering — without ever implying a file was actually modified. Touch
 * is purely observational in every phase.
 *
 * Phase 0: reads caller-supplied `context.paths`.
 * Phase 1: can additionally consume a real ProjectSnapshot passed as
 * `context.snapshot`, treating the snapshot's observed files as the paths
 * currently in contact.
 */

import type { SenseInput, TouchReading } from "../types/senseTypes";
import { isProjectSnapshotLike } from "../inspector/inspectorTypes";

export function touch(input: SenseInput): TouchReading {
  const snapshot = input.context.snapshot;
  if (isProjectSnapshotLike(snapshot)) {
    const contactedPaths = snapshot.files.map((file) => file.relativePath);

    return {
      senseType: "touch",
      summary: `In contact with ${contactedPaths.length} path(s) via a read-only ProjectSnapshot, no modification performed.`,
      confidence: 0.9,
      generatedAt: new Date().toISOString(),
      contactedPaths,
    };
  }

  const paths = Array.isArray(input.context.paths) ? (input.context.paths as string[]) : [];

  return {
    senseType: "touch",
    summary: paths.length > 0
      ? `In contact with ${paths.length} path(s), no modification performed.`
      : "No paths in contact.",
    confidence: paths.length > 0 ? 0.7 : 0.2,
    generatedAt: new Date().toISOString(),
    contactedPaths: paths,
  };
}
