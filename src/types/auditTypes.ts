/**
 * Audit types. AuditReport is produced by the AuditorAnt (Phase 4 onward) to
 * review colony behavior after the fact. Phase 0 only defines the shape.
 */

export type AuditSeverity = "info" | "minor" | "major" | "critical";

export interface AuditFinding {
  findingId: string;
  severity: AuditSeverity;
  summary: string;
  relatedTaskId?: string;
  relatedAntId?: string;
  relatedReceiptId?: string;
}

export interface AuditReport {
  auditId: string;
  missionId?: string;
  findings: AuditFinding[];
  generatedByAntId: string;
  generatedAt: string;
}
