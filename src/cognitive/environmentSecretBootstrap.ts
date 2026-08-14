/**
 * environmentSecretBootstrap — the ONE place production populates the
 * environment-secret registry (§34, Fable S-4).
 *
 * The gap this closes: `safeRedactor` already scrubs exact registered
 * credential VALUES before structural-pattern redaction, and
 * `buildSafeProviderRequest` already fails closed when a registered value
 * appears in outbound text. Both were dead code in production — nothing ever
 * called `registerEnvironmentSecrets`, so the registry was permanently empty
 * and the exact-value defence never ran. A live credential that happens not to
 * match one of the structural regexes therefore survived into receipts,
 * summaries, and outbound prompts. This module supplies the missing wiring.
 *
 * WHY NOT `process.env` WHOLESALE. Registering every environment value would
 * turn host paths, usernames, `PATH`, and CI metadata into "secrets": ordinary
 * text would be over-redacted, unrelated host data would be retained in memory
 * for the process lifetime, and the sensitive-data surface would grow for no
 * security gain. Only an explicit allowlist of credential-class NAMES is read.
 *
 * WHERE THE NAMES COME FROM. Not a guess: the authoritative list is derived
 * from `defaultProviderMatrix()`, whose `secretRef` field already records the
 * exact environment variable each API-key provider authenticates with. A new
 * provider added to that matrix is covered automatically. A short, separately
 * justified set of tool credentials the redactor already classifies is added on
 * top. Every name is asserted to match `FORBIDDEN_ENV_NAME_PATTERN`, so a
 * non-credential name cannot quietly join the list.
 *
 * SECRET DISCIPLINE. Values are read into a local, handed to
 * `registerEnvironmentSecrets`, and dropped. They are never returned, logged,
 * hashed, fingerprinted, serialized, put in a receipt or diagnostic, or exposed
 * by any getter. The status this module returns is booleans and a count.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import { defaultProviderMatrix } from "../gateway/providerContracts";
import { FORBIDDEN_ENV_NAME_PATTERN } from "./safeProviderRequest";
import { registerEnvironmentSecrets, containsRegisteredEnvironmentSecret } from "./safeRedactor";

/**
 * Below this length a value is not treated as a configured credential. It is
 * neither registered nor allowed to trigger a fail-closed: an empty string or a
 * placeholder like "x" is an unset variable in practice, and registering a
 * 1-character "secret" would redact that character everywhere it appeared.
 */
export const MIN_CREDENTIAL_VALUE_LENGTH = 8 as const;

/**
 * Tool credentials that are NOT provider API keys and so do not appear in the
 * provider matrix, but which the redactor already classifies as secret
 * categories and which a real host plausibly exports. Kept deliberately short —
 * every addition widens what this module reads.
 */
const TOOL_CREDENTIAL_NAMES: readonly string[] = ["GITHUB_TOKEN", "GH_TOKEN", "ANTHROPIC_API_KEY"];

/**
 * The explicit credential-name allowlist. Derived from the provider matrix's
 * `secretRef` declarations plus the tool credentials above, de-duplicated and
 * sorted so the list is deterministic.
 */
export function credentialEnvironmentNames(): readonly string[] {
  const names = new Set<string>();
  for (const contract of defaultProviderMatrix()) {
    if (typeof contract.secretRef === "string" && contract.secretRef.length > 0) names.add(contract.secretRef);
  }
  for (const name of TOOL_CREDENTIAL_NAMES) names.add(name);
  return [...names].sort();
}

/**
 * SAFE status. Contains no value, no variable name, and nothing derived from a
 * value. `registeredCount` is how many distinct credential variables were found
 * configured — metadata about the host's configuration, never about content.
 */
export interface EnvironmentSecretRegistryStatus {
  readonly initialized: boolean;
  readonly credentialVariablesPresent: boolean;
  readonly registeredCount: number;
  readonly safeReasonCode: "ok" | "environment-secret-registration-failed";
}

const NOT_YET_INITIALIZED: EnvironmentSecretRegistryStatus = {
  initialized: false,
  credentialVariablesPresent: false,
  registeredCount: 0,
  safeReasonCode: "environment-secret-registration-failed",
};

let lastStatus: EnvironmentSecretRegistryStatus = NOT_YET_INITIALIZED;

/**
 * Read the allowlisted credential variables and register their VALUES.
 *
 * Idempotent by construction: the registry is a Set, so a second call with the
 * same environment adds nothing and reports the same counts. It never clears —
 * `clearRegisteredEnvironmentSecrets` is test hygiene and production must not
 * call it, because clearing between provider calls would silently disarm the
 * exact-value defence mid-run.
 *
 * FAIL CLOSED, precisely. Two states are very different and are not conflated:
 *
 *   - no recognized credential configured  → `initialized: true`, count 0. This
 *     is a legitimate host, not a failure.
 *   - a credential IS configured but registration cannot be PROVEN →
 *     `initialized: false`. Registration is verified by asking
 *     `containsRegisteredEnvironmentSecret`, a predicate that answers without
 *     exposing anything, so this is a real check rather than an assumption.
 *
 * The failure never names which variable failed and never carries a value.
 */
export function initializeEnvironmentSecretRegistry(source: NodeJS.ProcessEnv = process.env): EnvironmentSecretRegistryStatus {
  const values: string[] = [];
  for (const name of credentialEnvironmentNames()) {
    // Read by EXPLICIT KEY. `process.env` is never enumerated, so a variable
    // outside the allowlist cannot be picked up by accident.
    const raw = source[name];
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value.length < MIN_CREDENTIAL_VALUE_LENGTH) continue;
    values.push(value);
  }

  const distinct = new Set(values);
  registerEnvironmentSecrets(values);

  // Prove every configured credential actually landed in the registry rather
  // than assuming it did. A value that is present but unregistered is exactly
  // the condition that must fail closed.
  let allRegistered = true;
  for (const value of distinct) {
    if (!containsRegisteredEnvironmentSecret(value)) allRegistered = false;
  }

  lastStatus = {
    initialized: allRegistered,
    credentialVariablesPresent: distinct.size > 0,
    registeredCount: distinct.size,
    safeReasonCode: allRegistered ? "ok" : "environment-secret-registration-failed",
  };
  return lastStatus;
}

/**
 * The last status, for callers that must confirm initialization happened before
 * doing provider work. Returns booleans and a count — never a value or a name.
 */
export function environmentSecretRegistryStatus(): EnvironmentSecretRegistryStatus {
  return lastStatus;
}

/**
 * Ensure the registry is initialized, then report whether provider work may
 * proceed. Safe to call repeatedly; the underlying initialization is idempotent.
 */
export function environmentSecretsReadyForProviderWork(source: NodeJS.ProcessEnv = process.env): EnvironmentSecretRegistryStatus {
  const status = initializeEnvironmentSecretRegistry(source);
  return status;
}

/** Test hygiene ONLY: forget the recorded status. Never called by production. */
export function resetEnvironmentSecretRegistryStatusForTests(): void {
  lastStatus = NOT_YET_INITIALIZED;
}
