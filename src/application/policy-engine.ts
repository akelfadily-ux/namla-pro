import { relative, isAbsolute, resolve } from "path";
import { realpathSync, existsSync } from "fs";
import { PermissionDeniedError } from "../domain/errors";

export interface PermissionRequest {
  capability: string;
  resource?: string;
}

export interface AntPolicy {
  permissions: readonly string[];
}

export class PolicyEngine {
  authorize(
    policy: AntPolicy,
    request: PermissionRequest,
  ): void {
    const wildcard = policy.permissions.includes("*");
    if (wildcard) return;

    const reqCap = request.capability;
    const reqRes = request.resource;

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
          let realBase = basePath;
          let realReq = reqRes;
          try {
            if (existsSync(basePath)) realBase = realpathSync(basePath);
            if (existsSync(reqRes)) realReq = realpathSync(reqRes);
          } catch {
            /* compare lexically if unresolvable */
          }
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
