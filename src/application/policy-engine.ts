import { relative, isAbsolute, resolve } from "path";
import { realpathSync, existsSync } from "fs";
import { PermissionDeniedError } from "../domain/errors";
import { PermissionRequest } from "../domain/types";

export { PermissionRequest };

export interface AntPolicy {
  permissions: readonly string[];
}

export function canonicalizePath(targetPath: string): string {
  const absolutePath = resolve(targetPath);
  if (existsSync(absolutePath)) {
    try {
      return realpathSync(absolutePath);
    } catch {
      throw new PermissionDeniedError(`Canonicalization failed for path: ${targetPath}`);
    }
  }

  // Find closest existing ancestor directory for non-existent target files
  let current = absolutePath;
  const tail: string[] = [];

  while (current && current !== resolve(current, "..")) {
    const parent = resolve(current, "..");
    const name = relative(parent, current);
    tail.unshift(name);
    current = parent;

    if (existsSync(current)) {
      try {
        const realParent = realpathSync(current);
        return resolve(realParent, ...tail);
      } catch {
        throw new PermissionDeniedError(`Canonicalization failed for path ancestor: ${current}`);
      }
    }
  }

  return absolutePath;
}

export class PolicyEngine {
  authorize(
    policy: AntPolicy,
    request: PermissionRequest,
  ): void {
    const reqCap = request.capability;
    const reqRes = request.resource;

    // ABSOLUTE HUMAN-ONLY GIT POLICY DENY: evaluated BEFORE any permission match or wildcard '*'
    const FORBIDDEN_GIT_OPS = ["pull", "merge", "rebase", "cherry-pick", "am", "git pull", "git merge", "git rebase", "git cherry-pick", "git am"];
    const isGitCapability = reqCap === "git" || reqCap.startsWith("git:") || reqCap.startsWith("tool:git") || reqCap === "shell" || reqCap.startsWith("shell.");

    if (
      isGitCapability &&
      reqRes &&
      FORBIDDEN_GIT_OPS.some((op) => reqRes.toLowerCase().includes(op))
    ) {
      throw new PermissionDeniedError(
        `HUMAN-ONLY POLICY VIOLATION: Agent execution of '${reqRes}' is strictly forbidden`,
      );
    }

    const wildcard = policy.permissions.includes("*");
    if (wildcard) return;

    const matched = policy.permissions.some((perm) => {
      if (perm === reqCap) return true;

      // Handle wildcard prefixes, e.g. "tool:shell:*" matching "tool:shell:test"
      if (perm.endsWith("*")) {
        const prefix = perm.slice(0, -1);
        if (reqCap.startsWith(prefix)) return true;
      }

      // Handle resource scoping, e.g. "tool:filesystem.read:/workspace/**"
      if (reqRes && perm.startsWith(`${reqCap}:`)) {
        const pattern = perm.slice(reqCap.length + 1);
        if (pattern === "*" || pattern === "**") return true;
        if (pattern.endsWith("/**") || pattern.endsWith("/*")) {
          const basePath = pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern.slice(0, -2);
          const realBase = canonicalizePath(basePath);
          const realReq = canonicalizePath(reqRes);

          const rel = relative(realBase, realReq);
          return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
        }
        return reqRes === pattern;
      }

      return false;
    });

    if (!matched) {
      throw new PermissionDeniedError(
        `Capability denied: ${request.capability}${request.resource ? ` on ${request.resource}` : ""}`,
      );
    }
  }
}
