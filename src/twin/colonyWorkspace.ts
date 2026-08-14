/**
 * colonyWorkspace — Iron Isolation for the twin empire. An in-memory
 * `ColonyWorkspaceAuthority` gives each colony a SEPARATE workspace under
 * `workspaces/namola-twin/<mission-id>/<colony>/`; the `ColonyIsolationBoundary`
 * mechanically refuses any cross-colony read before both bundles are frozen, and
 * rejects path traversal, absolute paths, and source-tree paths. Every refusal
 * mints a `ColonyContaminationReceipt`.
 *
 * This is an INJECTED IN-MEMORY driver: no fs, no child_process, no network. It
 * therefore performs zero real filesystem access in automated tests.
 */

import type { ColonyId } from "./twinColonyTypes";
import { fnv1a } from "./twinColonyTypes";

// A twin colony root, optionally with ONE numbered repair area so a RESUMED
// colony writes beside — never over — its earlier output. Must stay in sync with
// `NAMOLA_TWIN_PATTERN` in `smokeWorkspace.ts` (the real-fs counterpart).
const TWIN_WORKSPACE_PATTERN = /^workspaces\/namola-twin\/[a-z0-9-]{1,64}\/(claude-forge|codex-crucible)(\/repair-[1-9][0-9]{0,2})?$/;

export type WorkspaceAccessReason = "ok" | "cross-colony-access-denied" | "path-traversal" | "absolute-path" | "source-tree-path" | "outside-workspace" | "not-found" | "invalid-workspace-id";

export interface WorkspaceReadResult {
  readonly ok: boolean;
  readonly reasonCode: WorkspaceAccessReason;
  readonly content?: string;
}

export interface ColonyContaminationReceipt {
  readonly seq: number;
  readonly requestingColony: ColonyId;
  readonly targetColony: ColonyId | "unknown";
  readonly reasonCode: WorkspaceAccessReason;
  /** Redacted path shape only (never the file content). */
  readonly relPathShape: string;
  readonly quarantined: true;
}

/** Resolve the owning colony, including for a nested `/repair-N` area. */
function colonyOfWorkspace(workspaceId: string): ColonyId | null {
  if (/\/claude-forge(\/repair-\d+)?$/.test(workspaceId)) return "claude-forge";
  if (/\/codex-crucible(\/repair-\d+)?$/.test(workspaceId)) return "codex-crucible";
  return null;
}

/**
 * Repository-control paths a colony must never target even inside its own
 * workspace. NOTE: `src/` is NOT here — a colony's project legitimately contains
 * `src/index.ts`. Targeting the NAMLA source tree is prevented at the
 * WORKSPACE-ID level (`TWIN_WORKSPACE_PATTERN`, which yields `source-tree-path`),
 * and a relative path can never escape that root because traversal and absolute
 * paths are rejected below.
 */
const PROTECTED_SEGMENT = /(^|\/)(\.git|node_modules)(\/|$)/;

/**
 * Validate a workspace-relative path. CONTAINMENT is the security property:
 * reject empty/oversize, absolute (Windows or Unix), traversal, null-byte/home
 * expansion, malformed segments, and repository-control paths. There is
 * deliberately NO extension allowlist — a colony may legitimately propose
 * `.tsx`, `.css`, `.mdx`, `.sh`, dotfiles (`.gitignore`, `.eslintrc.json`), and
 * extensionless files (`Dockerfile`, `LICENSE`).
 */
export function validateColonyRelPath(relPath: string): WorkspaceAccessReason {
  if (relPath.length === 0 || relPath.length > 200) return "outside-workspace";
  if (/^([A-Za-z]:|\/|\\)/.test(relPath)) return "absolute-path";
  if (relPath.includes("..")) return "path-traversal";
  if (relPath.includes("\0") || relPath.includes("~")) return "outside-workspace";
  if (PROTECTED_SEGMENT.test(relPath)) return "source-tree-path";
  // Every segment must be a plain, non-empty name (no backslashes, no bare dots).
  for (const segment of relPath.split("/")) {
    if (segment.length === 0 || segment === "." || segment.includes("\\")) return "outside-workspace";
  }
  return "ok";
}

/** The in-memory workspace store — one isolated map per colony workspace root. */
export class ColonyWorkspaceAuthority {
  private readonly stores = new Map<string, Map<string, string>>();
  private realFilesystemWrites = 0; // stays 0 — this is an in-memory driver

  get realWrites(): number {
    return this.realFilesystemWrites;
  }

  private storeFor(workspaceId: string): Map<string, string> {
    let s = this.stores.get(workspaceId);
    if (!s) {
      s = new Map<string, string>();
      this.stores.set(workspaceId, s);
    }
    return s;
  }

  /** Same-colony write (validated). Returns the reason; "ok" on success. */
  write(workspaceId: string, relPath: string, content: string): WorkspaceAccessReason {
    if (!TWIN_WORKSPACE_PATTERN.test(workspaceId)) return "source-tree-path";
    const pathReason = validateColonyRelPath(relPath);
    if (pathReason !== "ok") return pathReason;
    this.storeFor(workspaceId).set(relPath, content);
    return "ok";
  }

  fileCount(workspaceId: string): number {
    return this.stores.get(workspaceId)?.size ?? 0;
  }

  /** RAW read used only by the boundary after it has authorized the request. */
  rawRead(workspaceId: string, relPath: string): string | undefined {
    return this.stores.get(workspaceId)?.get(relPath);
  }
}

export interface WorkspaceReadRequest {
  readonly requestingColony: ColonyId;
  readonly targetWorkspaceId: string;
  readonly relPath: string;
  /** Whether the TARGET colony's bundle is already frozen (post-freeze reads are allowed). */
  readonly targetFrozen: boolean;
}

/**
 * The isolation boundary. Every read flows through `read(...)`, which fails
 * mechanically (never returns content) on any violation and mints a contamination
 * receipt on a cross-colony attempt.
 */
export class ColonyIsolationBoundary {
  private readonly receipts: ColonyContaminationReceipt[] = [];
  private seq = 0;

  constructor(private readonly authority: ColonyWorkspaceAuthority) {}

  get contaminationReceipts(): readonly ColonyContaminationReceipt[] {
    return this.receipts;
  }

  private redactShape(relPath: string): string {
    return relPath.replace(/[^/.]+/g, "x");
  }

  private quarantine(requestingColony: ColonyId, targetColony: ColonyId | "unknown", reasonCode: WorkspaceAccessReason, relPath: string): void {
    this.seq += 1;
    this.receipts.push({ seq: this.seq, requestingColony, targetColony, reasonCode, relPathShape: this.redactShape(relPath), quarantined: true });
  }

  read(req: WorkspaceReadRequest): WorkspaceReadResult {
    // 1. Workspace-id shape: anything outside the twin root (e.g. `src/...`) is a source-tree path.
    if (!TWIN_WORKSPACE_PATTERN.test(req.targetWorkspaceId)) {
      this.quarantine(req.requestingColony, "unknown", "source-tree-path", req.relPath);
      return { ok: false, reasonCode: "source-tree-path" };
    }
    const targetColony = colonyOfWorkspace(req.targetWorkspaceId);
    if (!targetColony) {
      this.quarantine(req.requestingColony, "unknown", "invalid-workspace-id", req.relPath);
      return { ok: false, reasonCode: "invalid-workspace-id" };
    }
    // 2. Path validation (absolute / traversal) before any cross-colony logic.
    const pathReason = validateColonyRelPath(req.relPath);
    if (pathReason !== "ok") {
      this.quarantine(req.requestingColony, targetColony, pathReason, req.relPath);
      return { ok: false, reasonCode: pathReason };
    }
    // 3. Cross-colony read BEFORE freeze is a contamination breach — denied.
    if (req.requestingColony !== targetColony && !req.targetFrozen) {
      this.quarantine(req.requestingColony, targetColony, "cross-colony-access-denied", req.relPath);
      return { ok: false, reasonCode: "cross-colony-access-denied" };
    }
    // 4. Authorized: same-colony, or post-freeze cross-colony.
    const content = this.authority.rawRead(req.targetWorkspaceId, req.relPath);
    if (content === undefined) return { ok: false, reasonCode: "not-found" };
    return { ok: true, reasonCode: "ok", content };
  }
}
