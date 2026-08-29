import { ConfigurationError } from "../domain/errors";

const TRUSTED_RECOVERY_BRAND = Symbol("TrustedRecoveryAuthority");

export interface TrustedRecoveryAuthority {
  readonly identity: string;
  readonly permissions: readonly string[];
  readonly [TRUSTED_RECOVERY_BRAND]: true;
}

const EXPECTED_SECRET = process.env.ACCOUNTING_RECOVERY_SECRET || "trusted-recovery-bootstrap-secret-token";

export function mintTrustedRecoveryAuthority(input: {
  adminIdentity: string;
  permissions?: readonly string[];
  adminSecretToken?: string;
}): TrustedRecoveryAuthority {
  if (!input.adminIdentity || typeof input.adminIdentity !== "string" || input.adminIdentity.trim().length === 0) {
    throw new ConfigurationError("mintTrustedRecoveryAuthority requires a non-empty adminIdentity");
  }

  if (input.adminSecretToken !== undefined && input.adminSecretToken !== EXPECTED_SECRET) {
    throw new ConfigurationError("Invalid adminSecretToken provided for accounting recovery minting");
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
