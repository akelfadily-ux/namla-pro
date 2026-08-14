/**
 * Capability C2-A — trusted one-shot write-authority bootstrap.
 *
 * This is the ONLY approved location that mints a WriteAuthorityPermit. It
 * exists so that a permit can only originate from a deliberate, trusted,
 * one-shot bootstrap call — never from mission text, ant output, adapter
 * output, an environment variable, a CLI argument, a proposal, an untrusted
 * boolean, or an AI-generated object.
 *
 * Hard constraints (mechanically checked in SAFETY_INVARIANTS.md):
 * - no fs import (C2-A adds no filesystem capability);
 * - no process/env, no CLI argument, no network import;
 * - no ColonyEngine / ant / adapter / mission import;
 * - no top-level execution and no top-level permit creation — importing
 *   this module mints nothing;
 * - the production runtime never imports this module; only the C2-A demo
 *   imports it directly for validation.
 *
 * The factory requires explicit fixed call data (not a caller-provided
 * "enabled" boolean). Minting a permit is still inert in C2-A: no write
 * primitive exists, so a permit authorizes nothing on disk.
 */

import {
  mintWriteAuthorityPermitInternal,
  WriteAuthorityPermit,
} from "../application/writeAuthority";

/** Explicit, fixed request data a trusted caller must construct on purpose. */
export interface C2WriteAuthorityBootstrapRequest {
  bootstrapKind: "trusted-one-shot";
  scope: "create-one-generated-markdown";
  acknowledgement: "c2a-contracts-only-no-write";
}

/**
 * Deliberate one-shot factory. Returns a frozen, identity-registered permit.
 * There is no default invocation; a human/trusted script must call this with
 * the exact fixed request above.
 */
export function createTrustedC2WriteAuthorityPermit(
  request: C2WriteAuthorityBootstrapRequest
): WriteAuthorityPermit {
  return mintWriteAuthorityPermitInternal({
    bootstrapKind: request.bootstrapKind,
    scope: request.scope,
    acknowledgement: request.acknowledgement,
  });
}
