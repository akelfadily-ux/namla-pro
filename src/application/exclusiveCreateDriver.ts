/**
 * Capability C2-B — exclusive-create driver contract (no fs import).
 *
 * This module defines the narrow driver interface that ProjectFileCreator
 * drives an exclusive-create through. It imports NO fs and performs NO
 * mutation; it is the seam that lets C2-B verify the full create lifecycle
 * with a deterministic injected FAKE driver, while the real Node-backed
 * driver (which lives module-private inside projectFileCreator.ts) is never
 * invoked.
 *
 * Errors carry only a fixed, safe category — never a raw OS message, path,
 * filename, content, or credential.
 */

/** Fixed, safe driver error categories. No raw OS text is ever exposed. */
export type DriverErrorCategory =
  | "target-exists"
  | "exclusive-open-failed"
  | "write-failed"
  | "zero-progress-write"
  | "sync-failed"
  | "close-failed"
  | "internal-driver-failed";

/** A driver failure that carries only a safe category. */
export class ExclusiveCreateDriverError extends Error {
  readonly category: DriverErrorCategory;
  constructor(category: DriverErrorCategory) {
    super(`exclusive-create driver failure: ${category}`);
    this.name = "ExclusiveCreateDriverError";
    this.category = category;
  }
}

/** Opaque handle to an open exclusive-create target. Carries no path. */
export interface ExclusiveCreateHandle {
  readonly handleId: string;
}

/**
 * The minimal driver surface. `kind` lets the creator report truthfully
 * whether a real fs-backed driver executed ("real-node") or a simulation did
 * ("fake"); in C2-B only fake drivers are ever passed to the creator.
 */
export interface ExclusiveCreateDriver {
  readonly kind: "fake" | "real-node";
  /** Exclusive-create open. Must fail (never overwrite) if the target exists. */
  openExclusive(targetPath: string): ExclusiveCreateHandle;
  /** Write `length` bytes of `buffer` starting at `offset`; returns bytes written. */
  write(handle: ExclusiveCreateHandle, buffer: Buffer, offset: number, length: number): number;
  /** Flush to durable storage (best effort). */
  sync(handle: ExclusiveCreateHandle): void;
  /** Close the handle. */
  close(handle: ExclusiveCreateHandle): void;
}
