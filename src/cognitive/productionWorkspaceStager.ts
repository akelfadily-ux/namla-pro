import { createHash } from "crypto";
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  type Stats,
} from "fs";
import { isAbsolute, join, relative, sep } from "path";
import {
  SafeWorkspacePathResolver,
  pathIsInside,
  validateRelativePathShape,
} from "./safeWorkspacePath";

export const WORKSPACE_STAGE_SCHEMA_VERSION =
  "namla-production-workspace-stage-v1" as const;

export interface ProductionWorkspaceStagingLimits {
  readonly maxDepth: number;
  readonly maxEntries: number;
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxPayloadBytes: number;
}

export const DEFAULT_PRODUCTION_WORKSPACE_STAGING_LIMITS:
  Readonly<ProductionWorkspaceStagingLimits> = Object.freeze({
    maxDepth: 64,
    maxEntries: 8192,
    maxFiles: 4096,
    maxFileBytes: 8 * 1024 * 1024,
    maxTotalBytes: 32 * 1024 * 1024,
    maxPayloadBytes: 48 * 1024 * 1024,
  });

export type ProductionWorkspaceStagingReasonCode =
  | "OK"
  | "STAGING_WORKSPACE_REFUSED"
  | "STAGING_PATH_REFUSED"
  | "STAGING_SYMLINK_REFUSED"
  | "STAGING_HARDLINK_REFUSED"
  | "STAGING_SPECIAL_FILE_REFUSED"
  | "STAGING_DEPTH_LIMIT_EXCEEDED"
  | "STAGING_ENTRY_LIMIT_EXCEEDED"
  | "STAGING_FILE_LIMIT_EXCEEDED"
  | "STAGING_FILE_TOO_LARGE"
  | "STAGING_TOTAL_TOO_LARGE"
  | "STAGING_PAYLOAD_TOO_LARGE"
  | "STAGING_WORKSPACE_CHANGED"
  | "STAGING_READ_FAILED";

export interface ProductionWorkspaceStageDirectoryEntry {
  readonly kind: "directory";
  readonly path: string;
  readonly mode: 0o755;
}

export interface ProductionWorkspaceStageFileEntry {
  readonly kind: "file";
  readonly path: string;
  readonly mode: 0o644;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly contentBase64: string;
}

export type ProductionWorkspaceStageEntry =
  | ProductionWorkspaceStageDirectoryEntry
  | ProductionWorkspaceStageFileEntry;

export interface ProductionWorkspaceStageManifest {
  readonly schemaVersion: typeof WORKSPACE_STAGE_SCHEMA_VERSION;
  readonly entries: readonly ProductionWorkspaceStageEntry[];
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly treeSha256: string;
}

export type ProductionWorkspaceStagingResult =
  | {
      readonly ok: true;
      readonly reasonCode: "OK";
      readonly manifest: ProductionWorkspaceStageManifest;
      readonly payload: Buffer;
      readonly payloadSha256: string;
    }
  | {
      readonly ok: false;
      readonly reasonCode: Exclude<
        ProductionWorkspaceStagingReasonCode,
        "OK"
      >;
      readonly manifest: null;
      readonly payload: null;
      readonly payloadSha256: null;
    };

class StagingRefusal extends Error {
  public constructor(
    public readonly reasonCode: Exclude<
      ProductionWorkspaceStagingReasonCode,
      "OK"
    >,
  ) {
    super(reasonCode);
  }
}

function refuse(
  reasonCode: Exclude<ProductionWorkspaceStagingReasonCode, "OK">,
): never {
  throw new StagingRefusal(reasonCode);
}

function stableIdentity(a: Stats, b: Stats): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.nlink === b.nlink &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}

function portableRelativePath(realRoot: string, absolutePath: string): string {
  const lexical = relative(realRoot, absolutePath);

  if (lexical.length === 0 || isAbsolute(lexical)) {
    refuse("STAGING_PATH_REFUSED");
  }

  const portable = lexical.split(sep).join("/");
  if (validateRelativePathShape(portable) !== "ok") {
    refuse("STAGING_PATH_REFUSED");
  }

  return portable;
}

function sortedDirectoryNames(directoryAbsolutePath: string): string[] {
  try {
    return readdirSync(directoryAbsolutePath, { encoding: "utf8" }).sort(
      (a, b) => (a < b ? -1 : a > b ? 1 : 0),
    );
  } catch {
    return refuse("STAGING_READ_FAILED");
  }
}

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function readStableRegularFile(
  realRoot: string,
  candidateAbsolutePath: string,
  maxFileBytes: number,
): Buffer {
  let lexicalStat: Stats;
  try {
    lexicalStat = lstatSync(candidateAbsolutePath);
  } catch {
    return refuse("STAGING_READ_FAILED");
  }

  if (lexicalStat.isSymbolicLink()) {
    refuse("STAGING_SYMLINK_REFUSED");
  }

  if (!lexicalStat.isFile()) {
    refuse("STAGING_SPECIAL_FILE_REFUSED");
  }

  if (lexicalStat.nlink !== 1) {
    refuse("STAGING_HARDLINK_REFUSED");
  }

  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(candidateAbsolutePath);
  } catch {
    return refuse("STAGING_READ_FAILED");
  }

  if (!pathIsInside(realRoot, canonicalPath) || canonicalPath === realRoot) {
    refuse("STAGING_PATH_REFUSED");
  }

  let settledPathStat: Stats;
  try {
    settledPathStat = lstatSync(canonicalPath);
  } catch {
    return refuse("STAGING_READ_FAILED");
  }

  if (settledPathStat.isSymbolicLink()) {
    refuse("STAGING_SYMLINK_REFUSED");
  }

  if (!settledPathStat.isFile()) {
    refuse("STAGING_SPECIAL_FILE_REFUSED");
  }

  if (settledPathStat.nlink !== 1) {
    refuse("STAGING_HARDLINK_REFUSED");
  }

  let fd: number | null = null;
  try {
    fd = openSync(canonicalPath, "r");

    const before = fstatSync(fd);

    if (!before.isFile()) {
      refuse("STAGING_SPECIAL_FILE_REFUSED");
    }

    if (before.nlink !== 1) {
      refuse("STAGING_HARDLINK_REFUSED");
    }

    /*
     * Prove that open() acquired the exact filesystem object that was measured
     * immediately before the open. A pathname replacement in that interval
     * must never silently become the staged file.
     */
    if (
      !stableIdentity(lexicalStat, settledPathStat) ||
      !stableIdentity(settledPathStat, before)
    ) {
      refuse("STAGING_WORKSPACE_CHANGED");
    }

    if (before.size > maxFileBytes) {
      refuse("STAGING_FILE_TOO_LARGE");
    }

    const bytes = readFileSync(fd);
    const after = fstatSync(fd);

    if (
      bytes.length !== before.size ||
      !stableIdentity(before, after)
    ) {
      refuse("STAGING_WORKSPACE_CHANGED");
    }

    let finalPathStat: Stats;
    try {
      finalPathStat = lstatSync(canonicalPath);
    } catch {
      return refuse("STAGING_WORKSPACE_CHANGED");
    }

    if (
      finalPathStat.isSymbolicLink() ||
      !finalPathStat.isFile() ||
      finalPathStat.nlink !== 1 ||
      !stableIdentity(after, finalPathStat)
    ) {
      refuse("STAGING_WORKSPACE_CHANGED");
    }

    return bytes;
  } catch (error) {
    if (error instanceof StagingRefusal) throw error;
    return refuse("STAGING_READ_FAILED");
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // The read result cannot become trusted because close failed silently.
        // The caller still receives only already-copied bytes; no file handle
        // is retained across the trust boundary.
      }
    }
  }
}

export function stageProductionWorkspace(
  workspaceAbsolutePath: string,
  limits: Readonly<ProductionWorkspaceStagingLimits> =
    DEFAULT_PRODUCTION_WORKSPACE_STAGING_LIMITS,
): ProductionWorkspaceStagingResult {
  try {
    if (
      typeof workspaceAbsolutePath !== "string" ||
      workspaceAbsolutePath.length === 0 ||
      !isAbsolute(workspaceAbsolutePath)
    ) {
      refuse("STAGING_WORKSPACE_REFUSED");
    }

    let lexicalRoot: Stats;
    try {
      lexicalRoot = lstatSync(workspaceAbsolutePath);
    } catch {
      return refuse("STAGING_WORKSPACE_REFUSED");
    }

    if (lexicalRoot.isSymbolicLink() || !lexicalRoot.isDirectory()) {
      refuse("STAGING_WORKSPACE_REFUSED");
    }

    const opened = SafeWorkspacePathResolver.forRoot(workspaceAbsolutePath);
    if (!opened.ok) {
      refuse("STAGING_WORKSPACE_REFUSED");
    }

    const resolver = opened.resolver;
    const realRoot = resolver.root;

    /*
     * Seal the workspace-root object itself.
     *
     * The first lstat happened before SafeWorkspacePathResolver.forRoot(),
     * whose realpath operation necessarily follows filesystem resolution.
     * Re-prove immediately afterwards that the lexical root is still the
     * same non-link directory and still resolves to the exact same canonical
     * root. This narrows root-substitution TOCTOU just as file identity is
     * narrowed below.
     */
    let settledRoot: Stats;
    let settledRootRealPath: string;
    let canonicalRootStat: Stats;

    try {
      settledRoot = lstatSync(workspaceAbsolutePath);
      settledRootRealPath = realpathSync(workspaceAbsolutePath);
      canonicalRootStat = lstatSync(realRoot);
    } catch {
      return refuse("STAGING_WORKSPACE_CHANGED");
    }

    if (
      settledRoot.isSymbolicLink() ||
      !settledRoot.isDirectory() ||
      canonicalRootStat.isSymbolicLink() ||
      !canonicalRootStat.isDirectory() ||
      settledRootRealPath !== realRoot ||
      !stableIdentity(lexicalRoot, settledRoot) ||
      !stableIdentity(settledRoot, canonicalRootStat)
    ) {
      refuse("STAGING_WORKSPACE_CHANGED");
    }

    const entries: ProductionWorkspaceStageEntry[] = [];
    let entryCount = 0;
    let fileCount = 0;
    let totalBytes = 0;

    const addEntry = (): void => {
      entryCount += 1;
      if (entryCount > limits.maxEntries) {
        refuse("STAGING_ENTRY_LIMIT_EXCEEDED");
      }
    };

    const walk = (directoryAbsolutePath: string, depth: number): void => {
      if (depth > limits.maxDepth) {
        refuse("STAGING_DEPTH_LIMIT_EXCEEDED");
      }

      let directoryBefore: Stats;
      try {
        directoryBefore = lstatSync(directoryAbsolutePath);
      } catch {
        return refuse("STAGING_READ_FAILED");
      }

      if (
        directoryBefore.isSymbolicLink() ||
        !directoryBefore.isDirectory()
      ) {
        refuse(
          directoryBefore.isSymbolicLink()
            ? "STAGING_SYMLINK_REFUSED"
            : "STAGING_SPECIAL_FILE_REFUSED",
        );
      }

      let canonicalDirectory: string;
      try {
        canonicalDirectory = realpathSync(directoryAbsolutePath);
      } catch {
        return refuse("STAGING_READ_FAILED");
      }

      if (!pathIsInside(realRoot, canonicalDirectory)) {
        refuse("STAGING_PATH_REFUSED");
      }

      const namesBefore = sortedDirectoryNames(canonicalDirectory);

      for (const name of namesBefore) {
        const absoluteEntry = join(canonicalDirectory, name);
        const relPath = portableRelativePath(realRoot, absoluteEntry);

        const resolved = resolver.resolveForWrite(relPath);
        if (!resolved.ok) {
          refuse(
            resolved.reasonCode.includes("symlink")
              ? "STAGING_SYMLINK_REFUSED"
              : "STAGING_PATH_REFUSED",
          );
        }

        let entryStat: Stats;
        try {
          entryStat = lstatSync(absoluteEntry);
        } catch {
          return refuse("STAGING_READ_FAILED");
        }

        if (entryStat.isSymbolicLink()) {
          refuse("STAGING_SYMLINK_REFUSED");
        }

        let canonicalEntry: string;
        try {
          canonicalEntry = realpathSync(absoluteEntry);
        } catch {
          return refuse("STAGING_READ_FAILED");
        }

        if (
          !pathIsInside(realRoot, canonicalEntry) ||
          canonicalEntry === realRoot
        ) {
          refuse("STAGING_PATH_REFUSED");
        }

        if (entryStat.isDirectory()) {
          addEntry();
          entries.push({
            kind: "directory",
            path: relPath,
            mode: 0o755,
          });

          walk(canonicalEntry, depth + 1);
          continue;
        }

        if (!entryStat.isFile()) {
          refuse("STAGING_SPECIAL_FILE_REFUSED");
        }

        if (entryStat.nlink !== 1) {
          refuse("STAGING_HARDLINK_REFUSED");
        }

        fileCount += 1;
        if (fileCount > limits.maxFiles) {
          refuse("STAGING_FILE_LIMIT_EXCEEDED");
        }

        const bytes = readStableRegularFile(
          realRoot,
          canonicalEntry,
          limits.maxFileBytes,
        );

        totalBytes += bytes.length;
        if (totalBytes > limits.maxTotalBytes) {
          refuse("STAGING_TOTAL_TOO_LARGE");
        }

        addEntry();

        entries.push({
          kind: "file",
          path: relPath,
          mode: 0o644,
          sizeBytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          contentBase64: bytes.toString("base64"),
        });
      }

      const namesAfter = sortedDirectoryNames(canonicalDirectory);

      let directoryAfter: Stats;
      try {
        directoryAfter = lstatSync(canonicalDirectory);
      } catch {
        return refuse("STAGING_WORKSPACE_CHANGED");
      }

      if (
        directoryAfter.isSymbolicLink() ||
        !directoryAfter.isDirectory() ||
        !stableIdentity(directoryBefore, directoryAfter) ||
        !sameStringArray(namesBefore, namesAfter)
      ) {
        refuse("STAGING_WORKSPACE_CHANGED");
      }
    };

    walk(realRoot, 0);

    /*
     * Re-prove the root after the complete walk. Any rename, replacement,
     * junction insertion, or directory mutation observed across staging makes
     * the snapshot untrusted rather than producing a partial-success payload.
     */
    let finalLexicalRoot: Stats;
    let finalCanonicalRoot: Stats;
    let finalRootRealPath: string;

    try {
      finalLexicalRoot = lstatSync(workspaceAbsolutePath);
      finalRootRealPath = realpathSync(workspaceAbsolutePath);
      finalCanonicalRoot = lstatSync(realRoot);
    } catch {
      return refuse("STAGING_WORKSPACE_CHANGED");
    }

    if (
      finalLexicalRoot.isSymbolicLink() ||
      !finalLexicalRoot.isDirectory() ||
      finalCanonicalRoot.isSymbolicLink() ||
      !finalCanonicalRoot.isDirectory() ||
      finalRootRealPath !== realRoot ||
      !stableIdentity(settledRoot, finalLexicalRoot) ||
      !stableIdentity(canonicalRootStat, finalCanonicalRoot)
    ) {
      refuse("STAGING_WORKSPACE_CHANGED");
    }

    entries.sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );

    const treeHasher = createHash("sha256");
    for (const entry of entries) {
      treeHasher.update(entry.kind, "utf8");
      treeHasher.update("\0", "utf8");
      treeHasher.update(entry.path, "utf8");
      treeHasher.update("\0", "utf8");

      if (entry.kind === "file") {
        treeHasher.update(String(entry.sizeBytes), "utf8");
        treeHasher.update("\0", "utf8");
        treeHasher.update(entry.sha256, "utf8");
      }

      treeHasher.update("\n", "utf8");
    }

    const manifest: ProductionWorkspaceStageManifest = {
      schemaVersion: WORKSPACE_STAGE_SCHEMA_VERSION,
      entries,
      fileCount,
      totalBytes,
      treeSha256: treeHasher.digest("hex"),
    };

    const payload = Buffer.from(JSON.stringify(manifest), "utf8");

    if (payload.length > limits.maxPayloadBytes) {
      refuse("STAGING_PAYLOAD_TOO_LARGE");
    }

    return {
      ok: true,
      reasonCode: "OK",
      manifest,
      payload,
      payloadSha256: createHash("sha256").update(payload).digest("hex"),
    };
  } catch (error) {
    if (error instanceof StagingRefusal) {
      return {
        ok: false,
        reasonCode: error.reasonCode,
        manifest: null,
        payload: null,
        payloadSha256: null,
      };
    }

    return {
      ok: false,
      reasonCode: "STAGING_READ_FAILED",
      manifest: null,
      payload: null,
      payloadSha256: null,
    };
  }
}