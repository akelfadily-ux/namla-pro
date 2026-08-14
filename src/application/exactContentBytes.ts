/**
 * Capability C2-A — exact-byte content preparation (pure).
 *
 * Prepares create-content as EXACT UTF-8 bytes and binds those bytes with a
 * full SHA-256 fingerprint, with zero transformation. This module never
 * normalizes newlines, trims, formats, re-encodes, or otherwise alters the
 * input: it either accepts the exact bytes or refuses with a fixed reason
 * code. It exists so a future C2-B/C write can bind the *exact bytes it
 * would write* to an approved fingerprint, and so that no silent mutation
 * can slip in after approval.
 *
 * Pure: no fs, no process/env, no network, no timers, no mutation of
 * anything but local values. Refusal results never carry the raw content —
 * only a fixed reason code and a safe integer offset.
 *
 * This is an ADDITIONAL, independent binding. It does not replace or weaken
 * the C0 whole-operation fingerprint (proposalIntegrity.ts).
 */

import { createHash } from "crypto";

export type ExactContentRefusalCode =
  | "bom-not-allowed"
  | "nul-not-allowed"
  | "carriage-return-not-allowed"
  | "control-char-not-allowed"
  | "del-not-allowed"
  | "unpaired-high-surrogate"
  | "unpaired-low-surrogate";

export type ExactContentReasonCode = "exact-bytes-ok" | ExactContentRefusalCode;

export interface ExactContentSuccess {
  ok: true;
  reasonCode: "exact-bytes-ok";
  byteLength: number;
  /** Full 64-char lowercase SHA-256 hex over the exact UTF-8 Buffer. */
  contentBytesFingerprint: string;
}

export interface ExactContentRefusal {
  ok: false;
  reasonCode: ExactContentRefusalCode;
  /** Safe integer position of the offending code unit — never raw content. */
  offsetIndex: number;
}

export type ExactContentResult = ExactContentSuccess | ExactContentRefusal;

/** Full 64-char lowercase SHA-256 hex over the exact bytes. */
export function computeContentBytesFingerprint(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Validate and prepare content as exact UTF-8 bytes. No transformation of
 * any kind is performed; the content is either accepted verbatim or refused.
 */
export function prepareExactUtf8Content(content: string): ExactContentResult {
  // Leading BOM (U+FEFF) is refused — it would silently change the bytes.
  if (content.length > 0 && content.charCodeAt(0) === 0xfeff) {
    return { ok: false, reasonCode: "bom-not-allowed", offsetIndex: 0 };
  }

  for (let i = 0; i < content.length; i += 1) {
    const code = content.charCodeAt(i);

    if (code === 0x0000) return { ok: false, reasonCode: "nul-not-allowed", offsetIndex: i };
    // Carriage return is refused explicitly so approved text uses exact LF
    // and no CRLF transformation can hide inside the approved bytes.
    if (code === 0x000d) return { ok: false, reasonCode: "carriage-return-not-allowed", offsetIndex: i };
    if (code === 0x007f) return { ok: false, reasonCode: "del-not-allowed", offsetIndex: i };
    // C0 control characters, except TAB (U+0009) and LF (U+000A).
    if (code < 0x20 && code !== 0x09 && code !== 0x0a) {
      return { ok: false, reasonCode: "control-char-not-allowed", offsetIndex: i };
    }

    // Reject unpaired UTF-16 surrogates (they cannot round-trip to bytes).
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < content.length ? content.charCodeAt(i + 1) : 0;
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return { ok: false, reasonCode: "unpaired-high-surrogate", offsetIndex: i };
      }
      i += 1; // valid surrogate pair — skip the low half
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return { ok: false, reasonCode: "unpaired-low-surrogate", offsetIndex: i };
    }
  }

  // Convert exactly once. These are the bytes a future write would emit.
  const buffer = Buffer.from(content, "utf8");
  return {
    ok: true,
    reasonCode: "exact-bytes-ok",
    byteLength: buffer.length,
    contentBytesFingerprint: computeContentBytesFingerprint(buffer),
  };
}
