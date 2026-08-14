/**
 * Receipt types. A receipt is the colony's accountability record: every
 * attempted action, approved or blocked, produces one. Receipts never store
 * secrets.
 */

export type ReceiptStatus = "approved" | "blocked" | "completed" | "failed" | "refused";

export interface ReceiptLink {
  missionId?: string;
  taskId?: string;
  antId?: string;
  pheromoneId?: string;
}

export interface ActionReceipt {
  receiptId: string;
  summary: string;
  status: ReceiptStatus;
  links: ReceiptLink;
  createdAt: string;
  details?: Record<string, unknown>;
}
