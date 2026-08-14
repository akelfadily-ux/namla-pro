# Civilization Incident & Repair Economy

When a live mission's verification fails, the settlement does not silently retry.
It records an **incident**, convenes an **incident council**, and only then — under
a *separately confirmed* repair authorization — spends one bounded repair provider
call. Every failure is recycled by the waste economy so nothing is lost.

## Failure → incident → repair

1. **Failure** — a present defect (`defectPresent`, or a defect introduced by an
   applied artifact) fails the first allowlisted verification run
   (`verificationFailures` ≥ 1).
2. **Incident** — an incident is recorded (`incidentsCreated` ≥ 1) and an
   **incident council** is convened for the high-impact failure.
3. **Repair authorization** — repair runs only if `approveRepair` is set. In the
   human-only CLI each repair call requires the separate exact phrase
   **`RUN ONE CIVILIZATION REPAIR ANT`** — it is never bundled with the initial
   run authorization.
4. **Bounded repair** — one `recordCivilizationCall("repair")` provider call
   (≤3 repair calls total, part of the ≤8 provider-call cap) attempts a fix.
   Success sets `defectRepaired` and the final verification runs green
   (`repairsCompleted` ≥ 1).
5. **Recycling** — every failure (security finding, verification failure,
   incident) is recorded by the `WasteRepairEconomy` (`wasteRecycled` ≥ 1) and
   tracked as technical debt (`technicalDebtTracked` ≥ 1).

## Guarantees

- No repair without a recorded incident (`incident-from-failure` safety check).
- Repair spend is capped and permit-metered — it cannot exceed `CIV_MAX_REPAIR_CALLS`.
- The conserving ledger still closes after repair; `safetyViolations` stays 0.
- In tests the repair provider call goes through the fake process driver, so
  `realProviderCalls` stays 0.

See [Civilization Live Run](civilization-live-run.md) and
[digital-review-verification-repair.md](digital-review-verification-repair.md).
