/**
 * receiptStatusSemantics: the canonical meaning of every ReceiptStatus
 * value (Architecture Hardening 2 Step 4G).
 *
 * A receipt's STATUS describes where the operation stood in its lifecycle
 * (admission → processing → outcome); the concrete event lives in reason
 * codes and structured details. The registry is typed
 * Record<ReceiptStatus, ...>, so covering the full union — no more, no
 * fewer — is compiler-enforced, and this file is the only place these
 * semantics are defined.
 *
 * Pure and deterministic: no fs, no process, no network, no timers, no
 * text matching, no ReceiptLog dependency.
 */

import type { ReceiptStatus } from "../types/receiptTypes";

export type ReceiptStatusCategory =
  | "admission"
  | "success"
  | "policy-rejection"
  | "boundary-stop"
  | "internal-error";

export interface ReceiptStatusMeaning {
  status: ReceiptStatus;
  category: ReceiptStatusCategory;
  /** True when the receipt describes a finished outcome. */
  terminal: boolean;
  meaning: string;
  mustNotBeUsedFor: string;
}

export const RECEIPT_STATUS_SEMANTICS: Record<ReceiptStatus, ReceiptStatusMeaning> = {
  approved: {
    status: "approved",
    category: "admission",
    terminal: false,
    meaning:
      "A request, plan, or gate was accepted — admitted for present or future work. It does not mean the operation completed.",
    mustNotBeUsedFor: "recording that an operation finished (use completed).",
  },
  completed: {
    status: "completed",
    category: "success",
    terminal: true,
    meaning: "The modeled operation or bookkeeping process finished successfully.",
    mustNotBeUsedFor: "mere acceptance of a request that has not run (use approved).",
  },
  refused: {
    status: "refused",
    category: "policy-rejection",
    terminal: true,
    meaning:
      "A request was rejected before the requested operation was admitted or processed (gate said no at the door).",
    mustNotBeUsedFor: "stopping an already-admitted or active flow (use blocked).",
  },
  blocked: {
    status: "blocked",
    category: "boundary-stop",
    terminal: true,
    meaning:
      "An admitted, planned, or active flow could not continue — a safety rule, dependency, budget, or runtime boundary stopped it.",
    mustNotBeUsedFor: "pre-admission rejection (use refused).",
  },
  failed: {
    status: "failed",
    category: "internal-error",
    terminal: true,
    meaning:
      "An internal operation hit an error or invalid state. Structurally modeled; no current runtime path emits it.",
    mustNotBeUsedFor: "policy refusals or boundary stops of healthy flows.",
  },
};

export function getReceiptStatusMeaning(status: ReceiptStatus): ReceiptStatusMeaning {
  return RECEIPT_STATUS_SEMANTICS[status];
}

export function isTerminalReceiptStatus(status: ReceiptStatus): boolean {
  return RECEIPT_STATUS_SEMANTICS[status].terminal;
}

/** Strict: policy rejections only; boundary stops are "blocked", not refusals. */
export function isRefusalReceiptStatus(status: ReceiptStatus): boolean {
  return RECEIPT_STATUS_SEMANTICS[status].category === "policy-rejection";
}

/** Runtime guard for cast-corrupted status values. */
export function isKnownReceiptStatus(value: unknown): value is ReceiptStatus {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RECEIPT_STATUS_SEMANTICS, value);
}

/** True when a status is being used for the lifecycle category it means. */
export function validateReceiptStatusUse(
  status: ReceiptStatus,
  expectedCategory: ReceiptStatusCategory
): boolean {
  return RECEIPT_STATUS_SEMANTICS[status].category === expectedCategory;
}
