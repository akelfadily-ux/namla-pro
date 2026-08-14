/**
 * FileBoundaryPolicy ensures any path an ant reasons about stays inside the
 * project root. Phase 0 never actually touches the filesystem, but this
 * policy exists so PlannedActions can be checked before any future phase is
 * allowed to execute them.
 */

import path from "path";

export const PROJECT_ROOT_MARKER = "namla-pro";

export function isInsideProjectRoot(targetPath: string, projectRoot: string): boolean {
  const normalizedRoot = path.resolve(projectRoot);
  const normalizedTarget = path.resolve(projectRoot, targetPath);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + path.sep);
}

export function assertInsideProjectRoot(targetPath: string, projectRoot: string): void {
  if (!isInsideProjectRoot(targetPath, projectRoot)) {
    throw new Error(`FileBoundaryPolicy refused path outside project root: ${targetPath}`);
  }
}
