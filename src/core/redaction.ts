/**
 * Shared redaction helpers for receipts. One rule, four consumers
 * (ProposalFactory, ProjectInspector, AgentAdapterBase,
 * CommitProposalFactory): refused or untrusted text never enters the
 * receipt log raw — only non-reversible metadata that still allows an
 * auditor to correlate entries.
 */

import { createHash } from "crypto";

/** Short non-reversible fingerprint (12 hex chars of SHA-256). */
export function fingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}
