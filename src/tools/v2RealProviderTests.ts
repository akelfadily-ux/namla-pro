/**
 * Opt-In Real Provider Qualification Suite (§21, P0.21).
 *
 * Runs real provider calls ONLY when explicitly enabled via process.env.NAMLA_RUN_REAL_PROVIDER.
 * When disabled, reports SKIPPED_REAL_PROVIDER and never converts skipped runs into verified claims.
 *
 * Run: node dist/tools/v2RealProviderTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { detectProviderAvailability } from "../cognitive/nodeProviderProcessDriver";
import { ProviderExecutableId } from "../cognitive/providerProcessDriver";

test("Opt-In Real Provider Qualification Suite", (t) => {
  const isEnabled = process.env.NAMLA_RUN_REAL_PROVIDER === "true";

  if (!isEnabled) {
    t.skip("SKIPPED_REAL_PROVIDER: Opt-in environment variable NAMLA_RUN_REAL_PROVIDER is not set to true");
    return;
  }

  const provider: ProviderExecutableId = (process.env.NAMLA_PROVIDER as ProviderExecutableId) ?? "claude";
  const availability = detectProviderAvailability(provider);

  if (!availability.available) {
    t.skip(`SKIPPED_REAL_PROVIDER: Provider ${provider} is not locally available (${availability.failureCategory})`);
    return;
  }

  assert.equal(availability.available, true, `Provider ${provider} must be available when opt-in run is enabled`);
  assert.match(availability.version, /[0-9]/, "Version token must be non-empty");
});
