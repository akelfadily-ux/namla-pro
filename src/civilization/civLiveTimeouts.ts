/**
 * civLiveTimeouts — role-aware bounded provider timeouts (Real Provider
 * Reliability V4). The second real run failed because a single 60s timeout
 * killed real Codex project work mid-flight. Timeouts are now per-role, bounded,
 * validated, and never sourced from mission text or provider output.
 *
 * A timeout is still ONE consumed provider call and ONE incident — never an
 * automatic retry.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import type { LiveRole } from "./civLiveCohort";
import { capabilityFamilyOfRole } from "./civLiveCohort";

/** Absolute ceiling for any single provider call. */
export const MAX_PROVIDER_TIMEOUT_MS = 600000 as const;
export const MIN_PROVIDER_TIMEOUT_MS = 1000 as const;

/** Default bounded timeouts by capability family / role need. */
export const DEFAULT_ROLE_TIMEOUTS = {
  architecture: 240000,
  implementation: 600000,
  review: 240000,
  repair: 600000,
  documentation: 240000,
} as const;

export interface RoleTimeoutPolicy {
  readonly architecture: number;
  readonly implementation: number;
  readonly review: number;
  readonly repair: number;
  readonly documentation: number;
}

export function defaultRoleTimeoutPolicy(): RoleTimeoutPolicy {
  return { ...DEFAULT_ROLE_TIMEOUTS };
}

export type TimeoutValidation = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly reasonCode: string };

/** Validate one human-supplied timeout override: reject negative/zero/over-max/non-numeric. */
export function validateTimeoutOverride(raw: unknown): TimeoutValidation {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return { ok: false, reasonCode: "non-numeric-timeout" };
  if (!Number.isInteger(n)) return { ok: false, reasonCode: "non-integer-timeout" };
  if (n <= 0) return { ok: false, reasonCode: "non-positive-timeout" };
  if (n < MIN_PROVIDER_TIMEOUT_MS) return { ok: false, reasonCode: "timeout-below-minimum" };
  if (n > MAX_PROVIDER_TIMEOUT_MS) return { ok: false, reasonCode: "timeout-above-maximum" };
  return { ok: true, value: n };
}

/** Build a validated policy from optional overrides; any invalid override is refused (returns null). */
export function buildRoleTimeoutPolicy(overrides: Partial<Record<keyof RoleTimeoutPolicy, unknown>>): { readonly ok: true; readonly policy: RoleTimeoutPolicy } | { readonly ok: false; readonly reasonCode: string; readonly field: string } {
  const policy = defaultRoleTimeoutPolicy();
  const mutable: Record<keyof RoleTimeoutPolicy, number> = { ...policy };
  for (const key of Object.keys(overrides) as (keyof RoleTimeoutPolicy)[]) {
    if (overrides[key] === undefined) continue;
    const v = validateTimeoutOverride(overrides[key]);
    if (!v.ok) return { ok: false, reasonCode: v.reasonCode, field: key };
    mutable[key] = v.value;
  }
  return { ok: true, policy: mutable };
}

/**
 * Resolve the bounded timeout for a civilization role. Repair is always the
 * repair timeout regardless of the underlying role. The result is clamped to
 * [MIN, MAX] as a final safety net.
 */
export function resolveRoleTimeout(role: LiveRole, policy: RoleTimeoutPolicy, isRepair = false): number {
  let base: number;
  if (isRepair) base = policy.repair;
  else {
    const family = capabilityFamilyOfRole(role);
    base = role === "documentation" ? policy.documentation : family === "architecture" ? policy.architecture : family === "implementation" ? policy.implementation : policy.review;
  }
  return Math.max(MIN_PROVIDER_TIMEOUT_MS, Math.min(MAX_PROVIDER_TIMEOUT_MS, Math.floor(base)));
}
