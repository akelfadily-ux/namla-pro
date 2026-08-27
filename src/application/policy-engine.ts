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
    const direct = policy.permissions.includes(request.capability);
    const wildcard = policy.permissions.includes("*");

    if (!direct && !wildcard) {
      throw new PermissionDeniedError(
        `Capability denied: ${request.capability}`,
      );
    }
  }
}
