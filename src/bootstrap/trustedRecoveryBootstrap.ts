import { ConfigurationError } from "../domain/errors";

const TRUSTED_RECOVERY_BRAND = Symbol("TrustedRecoveryAuthority");

export interface TrustedRecoveryAuthority {
  readonly identity: string;
  readonly permissions: readonly string[];
  readonly [TRUSTED_RECOVERY_BRAND]: true;
}

export function mintTrustedRecoveryAuthority(input: {
  adminIdentity: string;
  adminSecretToken: string;
  permissions?: readonly string[];
}): TrustedRecoveryAuthority {
  const expectedSecret = process.env.ACCOUNTING_RECOVERY_SECRET;
  if (!expectedSecret || expectedSecret.trim().length === 0) {
    throw new ConfigurationError("ACCOUNTING_RECOVERY_SECRET environment variable is mandatory for recovery authority minting");
  }

  if (!input.adminIdentity || typeof input.adminIdentity !== "string" || input.adminIdentity.trim().length === 0) {
    throw new ConfigurationError("mintTrustedRecoveryAuthority requires a non-empty adminIdentity");
  }

  if (!input.adminSecretToken || input.adminSecretToken !== expectedSecret) {
    throw new ConfigurationError("Unauthenticated recovery authority mint attempt: invalid or missing adminSecretToken");
  }

  const permissions = input.permissions ?? ["accounting:recover"];

  const authority: TrustedRecoveryAuthority = Object.freeze({
    identity: input.adminIdentity,
    permissions: Object.freeze([...permissions]),
    [TRUSTED_RECOVERY_BRAND]: true as const,
  });

  return authority;
}

export function isTrustedRecoveryAuthority(authority: unknown): authority is TrustedRecoveryAuthority {
  if (!authority || typeof authority !== "object") return false;
  return (authority as any)[TRUSTED_RECOVERY_BRAND] === true;
}
