/**
 * AntFacadeTrace: the honest name for what ant façade methods return.
 *
 * Architecture Hardening 2 Step 4C: real receipts come from ReceiptLog and
 * nowhere else. Ant façade classes historically returned receipt-SHAPED
 * objects with locally minted ids that never entered any log — two
 * parallel receipt systems in all but name. This type ends that: façade
 * outputs are traces. A trace may point at real receipts (by id, when the
 * underlying capability wrote them), but it never pretends to be one.
 *
 * Pure by construction: no fs, no process, no network, no timers, no
 * ReceiptLog dependency. Traces follow the redaction discipline — ids,
 * codes, counts, and lengths only; never raw prompts, paths, code, or
 * caller text.
 *
 * ARCHITECTURAL DECISION (Pre-Capability Closure): traces are NOT
 * automatically written to ReceiptLog, by design. ReceiptLog records
 * canonical runtime and capability events; traces record lightweight
 * façade-local activity and may point at real receipts via
 * relatedReceiptIds. Automatic trace-to-log conversion would duplicate
 * events (the injected capability already receipted the real action) and
 * inflate audit trails. A future façade action may write a real receipt
 * only when that action is itself part of the canonical runtime and
 * receives the shared ReceiptLog through explicit injection.
 */

import { randomUUID } from "crypto";
import type { AntRole } from "../types/antTypes";

export type AntFacadeTraceStatus = "completed" | "refused" | "skipped";

export interface AntFacadeTrace {
  traceKind: "ant-facade-trace";
  /** Trace id — deliberately NOT named receiptId; not from any ReceiptLog. */
  traceId: string;
  role: AntRole;
  /** Kebab-case action name, e.g. "inspect-project". */
  action: string;
  status: AntFacadeTraceStatus;
  /** Short kebab-case code; never raw text. */
  noteCode: string;
  /** The antId that produced this trace. */
  createdBy: string;
  createdAt: string;
  /** Ids of REAL ReceiptLog receipts tied to this action, when known. */
  relatedReceiptIds?: string[];
  /** Ids, counts, and lengths only. */
  details?: Record<string, unknown>;
}

export function createFacadeTrace(params: {
  role: AntRole;
  action: string;
  status: AntFacadeTraceStatus;
  noteCode: string;
  createdBy: string;
  relatedReceiptIds?: string[];
  details?: Record<string, unknown>;
}): AntFacadeTrace {
  return {
    traceKind: "ant-facade-trace",
    traceId: `trace-${params.role}-${randomUUID()}`,
    role: params.role,
    action: params.action,
    status: params.status,
    noteCode: params.noteCode,
    createdBy: params.createdBy,
    createdAt: new Date().toISOString(),
    relatedReceiptIds: params.relatedReceiptIds,
    details: params.details,
  };
}
