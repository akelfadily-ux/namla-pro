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
        if (pattern.endsWith("/**")) {
          const basePath = pattern.slice(0, -3);
          return reqRes.startsWith(basePath);
        }
        if (pattern.endsWith("/*")) {
          const basePath = pattern.slice(0, -2);
          return reqRes.startsWith(basePath);
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
