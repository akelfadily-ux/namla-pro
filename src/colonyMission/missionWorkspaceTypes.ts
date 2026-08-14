/**
 * Mission workspace types. A mission workspace is a bounded, isolated area
 * under `workspaces/<mission-id>/` — never Namla source, never a path
 * outside the mission's own root, never a protected/secret-shaped name.
 */

export interface ProposedFileOperation {
  readonly operationId: string;
  readonly missionId: string;
  readonly targetRelativePath: string;
  readonly changeKind: "create" | "modify";
  readonly content: string;
  readonly contentFingerprint: string;
  readonly proposedByAntId: string;
  readonly proposedAt: string;
}

export interface AppliedFileOperation {
  readonly operationId: string;
  readonly targetRelativePath: string;
  readonly contentFingerprint: string;
  readonly appliedAt: string;
}

export interface WorkspaceBoundaryViolation {
  readonly targetRelativePath: string;
  readonly reasonCode: string;
}

/**
 * Pluggable so the deterministic demo/tests never touch real disk (an
 * in-memory `FakeWorkspaceDriver`), while the same MissionWorkspace shape
 * could later be given a real driver under its own separate authorization.
 */
export interface WorkspaceDriver {
  write(relativePath: string, content: string): void;
  read(relativePath: string): string | undefined;
  list(): readonly string[];
}
