/**
 * Capability C2-A — write-authority permit (architectural, not cryptographic).
 *
 * A `WriteAuthorityPermit` is the separate, default-off capability object a
 * future C2-B/C real write would require IN ADDITION to a valid
 * HumanApprovalGrant. Approval authorizes one exact proposal's bytes;
 * possession of a permit authorizes the RUNTIME to attempt a write at all.
 *
 * Identity, not shape, is the check. A module-private WeakSet records
 * permits minted by the trusted bootstrap; `isValidWriteAuthorityPermit`
 * returns true only for objects in that set. A forged object literal with
 * identical fields is NOT in the set and is rejected. Permits are frozen.
 *
 * HONEST LIMITATION: TypeScript types and module boundaries are
 * ARCHITECTURAL controls, not CRYPTOGRAPHIC ones. Arbitrary trusted local
 * code could call the internal mint hook or otherwise fabricate an object;
 * the guarantee is that within Namla's own code only the dedicated
 * bootstrap mints a permit, and no production runtime path (ColonyEngine,
 * ants, adapters, missions) imports the mint hook or a permit at all.
 *
 * C2-A adds NO write capability: possessing a permit does nothing here,
 * because projectFileCreator is non-mutating in C2-A.
 *
 * Pure: no fs, no process/env, no network, no timers.
 */

export type WriteAuthorityScope = "create-one-generated-markdown";

/** Opaque, frozen, identity-checked permit. Fields are fixed literals. */
export interface WriteAuthorityPermit {
  readonly scope: WriteAuthorityScope;
  readonly directory: "docs/generated/";
  readonly extension: ".md";
  readonly maxBytes: 65536;
  readonly authorityVersion: 1;
  readonly bootstrapKind: "trusted-one-shot";
}

/**
 * Explicit fixed call data the trusted bootstrap must supply. This is NOT a
 * caller-provided "enabled" boolean; every field is a required fixed
 * literal, and mismatches are refused.
 */
export interface WriteAuthorityMintEvidence {
  bootstrapKind: "trusted-one-shot";
  scope: WriteAuthorityScope;
  acknowledgement: "c2a-contracts-only-no-write";
}

/** Module-private registry of genuinely minted permits. */
const mintedPermits = new WeakSet<object>();

/**
 * INTERNAL minting hook. The ONLY approved caller is
 * `src/bootstrap/c2WriteAuthorityBootstrap.ts`. No other source module may
 * reference this symbol (mechanically checked in SAFETY_INVARIANTS.md).
 */
export function mintWriteAuthorityPermitInternal(
  evidence: WriteAuthorityMintEvidence
): WriteAuthorityPermit {
  if (
    evidence.bootstrapKind !== "trusted-one-shot" ||
    evidence.scope !== "create-one-generated-markdown" ||
    evidence.acknowledgement !== "c2a-contracts-only-no-write"
  ) {
    throw new Error("Refused to mint a write-authority permit: invalid bootstrap evidence.");
  }

  const permit: WriteAuthorityPermit = Object.freeze({
    scope: "create-one-generated-markdown",
    directory: "docs/generated/",
    extension: ".md",
    maxBytes: 65536,
    authorityVersion: 1,
    bootstrapKind: "trusted-one-shot",
  });
  mintedPermits.add(permit);
  return permit;
}

/**
 * True only for a permit object minted by the trusted bootstrap (identity
 * via the private WeakSet) whose fixed fields are intact. Forged object
 * literals are rejected regardless of how closely they mimic the shape.
 */
export function isValidWriteAuthorityPermit(candidate: unknown): candidate is WriteAuthorityPermit {
  if (typeof candidate !== "object" || candidate === null) return false;
  if (!mintedPermits.has(candidate as object)) return false;
  const p = candidate as WriteAuthorityPermit;
  return (
    p.scope === "create-one-generated-markdown" &&
    p.directory === "docs/generated/" &&
    p.extension === ".md" &&
    p.maxBytes === 65536 &&
    p.authorityVersion === 1 &&
    p.bootstrapKind === "trusted-one-shot"
  );
}
