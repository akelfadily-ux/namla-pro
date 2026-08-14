/**
 * digitalRealObjectiveCli — the DECLARATION of the future human-only live
 * objective command (Build Law §24, §17). It is intentionally INERT this
 * milestone: it prints the contract for running a real 3-ant objective and
 * exits without spawning any provider, process, network, or filesystem action.
 *
 * The real flow (NOT enabled here) would require: an interactive TTY, an
 * explicit human-selected provider pool, a cohort of 1-5, an exact typed
 * confirmation, a dedicated objective workspace, bounded calls, no source-tree
 * writes, provider PROPOSALS only, independent review before any application,
 * allowlisted verification only, and a hard stop after bounded completion or
 * failure with no background continuation.
 *
 * This file imports no fs, no child_process, and no network. It reads argv only
 * to echo back the requested shape, then refuses.
 */

const CONTRACT = {
  command: "npm run digital:real-objective -- --providers claude,codex --cohort 3",
  enabled: false,
  requires: {
    interactiveTty: true,
    explicitProviderPool: true,
    cohortRange: [1, 5],
    exactTypedConfirmation: true,
    dedicatedObjectiveWorkspace: true,
    boundedProviderCalls: true,
    sourceTreeWrites: false,
    providerProducesProposalsOnly: true,
    independentReviewBeforeApplication: true,
    allowlistedVerificationOnly: true,
    hardStopAfterCompletionOrFailure: true,
    backgroundContinuation: false,
  },
  humanAuthorizationRequired: ["real-provider-activation", "real-disk-workspace", "real-verification-execution"],
};

export function describeRealObjectiveContract(): typeof CONTRACT {
  return CONTRACT;
}

if (require.main === module) {
  // Echo the requested shape (argv is read only to reflect it back), then refuse.
  const args = process.argv.slice(2).join(" ");
  console.log(JSON.stringify({ requested: args, ...CONTRACT, status: "declared-not-enabled", note: "Real execution requires separate explicit human authorization (Build Law §24). No action taken." }, null, 2));
  process.exit(0);
}
